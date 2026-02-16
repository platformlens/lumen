import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { EKSClient, DescribeClusterCommand, ListPodIdentityAssociationsCommand } from "@aws-sdk/client-eks";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { readFile } from 'fs/promises';
import { watchFile, unwatchFile, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';

export class AwsService extends EventEmitter {
    // Cache clients by region to avoid recreating them, but allow refresh
    private ec2Clients: Map<string, EC2Client> = new Map();
    private eksClients: Map<string, EKSClient> = new Map();
    private stsClients: Map<string, STSClient> = new Map();
    private cloudTrailClients: Map<string, CloudTrailClient> = new Map();
    private lastCredentialRefresh: number = 0;
    private readonly CREDENTIAL_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private currentProfile: string | undefined;
    private watchedFiles: string[] = [];
    private fileWatchDebounce: NodeJS.Timeout | null = null;
    private lastKnownIdentity: string | null = null;

    constructor() {
        super();
    }

    /**
     * Detect if Granted (or similar tool) has exported credentials into the environment.
     * Returns the env-based credentials if present, or null.
     * Note: These are only available if Lumen was launched from a Granted-configured shell.
     */
    public getGrantedCredentials(): { accessKeyId: string; secretAccessKey: string; sessionToken?: string; profile?: string; expiration?: string; region?: string } | null {
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
        if (accessKeyId && secretAccessKey) {
            return {
                accessKeyId,
                secretAccessKey,
                sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
                profile: process.env.AWS_PROFILE || undefined,
                expiration: process.env.AWS_SESSION_EXPIRATION || undefined,
                region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || undefined,
            };
        }
        return null;
    }

    /**
     * Check if Granted-style environment credentials are active and not expired.
     */
    public isGrantedActive(): boolean {
        const creds = this.getGrantedCredentials();
        if (!creds) return false;
        if (creds.expiration) {
            const expiry = new Date(creds.expiration).getTime();
            if (expiry < Date.now()) return false;
        }
        return true;
    }

    /**
     * Check if Granted's credential_process is configured for any profile in ~/.aws/config.
     * This works even when the app wasn't launched from a Granted shell.
     */
    public async isGrantedConfigured(): Promise<{ configured: boolean; profiles: string[] }> {
        const profiles: string[] = [];
        try {
            const configPath = process.env.AWS_CONFIG_FILE || join(homedir(), '.aws', 'config');
            const content = await readFile(configPath, 'utf-8');

            let currentProfile: string | null = null;
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                const profileMatch = trimmed.match(/^\[(?:profile\s+)?([^\]]+)\]$/);
                if (profileMatch) {
                    currentProfile = profileMatch[1].trim();
                }
                if (currentProfile && trimmed.startsWith('credential_process') && trimmed.includes('granted')) {
                    profiles.push(currentProfile);
                }
            }
        } catch {
            // ~/.aws/config may not exist
        }
        return { configured: profiles.length > 0, profiles };
    }

    /**
     * Set the active AWS profile. Clears cached clients and sets AWS_PROFILE env var.
     * Also clears any Granted env var overrides so the SDK uses the profile's credential_process.
     */
    public setProfile(profile: string | undefined) {
        const effectiveProfile = profile && profile !== 'default' ? profile : undefined;
        console.log(`[AwsService] Switching AWS profile: ${this.currentProfile || 'default'} → ${effectiveProfile || 'default'}`);
        this.currentProfile = effectiveProfile;
        if (effectiveProfile) {
            process.env.AWS_PROFILE = effectiveProfile;
        } else {
            delete process.env.AWS_PROFILE;
        }
        // Clear env-based credential overrides so the SDK resolves fresh from the profile
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;
        delete process.env.AWS_SESSION_TOKEN;
        delete process.env.AWS_SESSION_EXPIRATION;
        this.clearClientCache();
    }

    /**
     * List available AWS profiles from ~/.aws/config and ~/.aws/credentials
     */
    public async listProfiles(): Promise<string[]> {
        const profiles = new Set<string>();
        profiles.add('default');

        try {
            const configPath = process.env.AWS_CONFIG_FILE || join(homedir(), '.aws', 'config');
            const configContent = await readFile(configPath, 'utf-8');
            // Matches [profile foo] and [default]
            const profileRegex = /^\[(?:profile\s+)?([^\]]+)\]$/gm;
            let match;
            while ((match = profileRegex.exec(configContent)) !== null) {
                profiles.add(match[1].trim());
            }
        } catch {
            // ~/.aws/config may not exist
        }

        try {
            const credsPath = process.env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), '.aws', 'credentials');
            const credsContent = await readFile(credsPath, 'utf-8');
            const profileRegex = /^\[([^\]]+)\]$/gm;
            let match;
            while ((match = profileRegex.exec(credsContent)) !== null) {
                profiles.add(match[1].trim());
            }
        } catch {
            // ~/.aws/credentials may not exist
        }

        return Array.from(profiles).sort();
    }

    /**
     * Clear all cached clients to force credential refresh
     * Call this when switching AWS accounts/profiles
     */
    public clearClientCache() {
        console.log('[AwsService] Clearing client cache');
        this.ec2Clients.clear();
        this.eksClients.clear();
        this.stsClients.clear();
        this.cloudTrailClients.clear();
        this.lastCredentialRefresh = Date.now();
    }

    /**
     * Start watching AWS credential files for changes.
     * Watches ~/.aws/credentials and ~/.granted/ for modifications
     * that indicate a profile switch via Granted in another terminal.
     * Emits 'credentialsChanged' event with the new identity when detected.
     */
    public startCredentialFileWatcher() {
        this.stopCredentialFileWatcher(); // Clean up any existing watchers

        const filesToWatch = [
            join(homedir(), '.aws', 'credentials'),
            join(homedir(), '.aws', 'sso', 'cache'),
        ];

        // Also watch Granted's frecency file if it exists
        const grantedFrecency = join(homedir(), '.granted', 'aws_profiles_frecency');
        filesToWatch.push(grantedFrecency);

        for (const filePath of filesToWatch) {
            if (existsSync(filePath)) {
                console.log(`[AwsService] Watching for changes: ${filePath}`);
                watchFile(filePath, { interval: 2000 }, () => {
                    this.handleCredentialFileChange(filePath);
                });
                this.watchedFiles.push(filePath);
            }
        }

        console.log(`[AwsService] Credential file watchers started (${this.watchedFiles.length} files)`);
    }

    /**
     * Stop all credential file watchers.
     */
    public stopCredentialFileWatcher() {
        for (const filePath of this.watchedFiles) {
            unwatchFile(filePath);
        }
        this.watchedFiles = [];
        if (this.fileWatchDebounce) {
            clearTimeout(this.fileWatchDebounce);
            this.fileWatchDebounce = null;
        }
    }

    /**
     * Handle a credential file change. Debounced to avoid rapid-fire events.
     * Reads the most recently assumed profile from the frecency file or credentials file,
     * resolves identity for that profile, and emits event if identity changed.
     */
    private handleCredentialFileChange(filePath: string) {
        // Debounce: Granted may write multiple files in quick succession
        if (this.fileWatchDebounce) {
            clearTimeout(this.fileWatchDebounce);
        }
        this.fileWatchDebounce = setTimeout(async () => {
            console.log(`[AwsService] Credential file changed: ${filePath}`);
            this.clearClientCache();

            try {
                // Detect which profile was most recently assumed externally (from frecency)
                const detectedProfile = await this.detectMostRecentProfile();
                console.log(`[AwsService] Detected most recent profile: ${detectedProfile || 'none'}`);

                let result;

                if (detectedProfile) {
                    // Use fromNodeProviderChain with the detected profile.
                    // This invokes credential_process for that profile, returning fresh creds.
                    console.log(`[AwsService] Resolving identity via credential_process for profile: ${detectedProfile}`);
                    const credentials = fromNodeProviderChain({
                        profile: detectedProfile,
                        clientConfig: { region: 'us-east-1' }
                    });
                    const client = new STSClient({ region: 'us-east-1', credentials });
                    const response = await client.send(new GetCallerIdentityCommand({}));
                    result = { isAuthenticated: true, identity: response.Arn, account: response.Account };
                    console.log(`[AwsService] credential_process identity resolved to: ${response.Arn}`);
                } else {
                    // No frecency data — try reading [default] from credentials file
                    const fileCreds = await this.readCredentialsFile('default');
                    if (fileCreds) {
                        console.log(`[AwsService] Using file-based [default] credentials`);
                        const client = new STSClient({
                            region: fileCreds.region || 'us-east-1',
                            credentials: {
                                accessKeyId: fileCreds.accessKeyId!,
                                secretAccessKey: fileCreds.secretAccessKey!,
                                sessionToken: fileCreds.sessionToken,
                            },
                        });
                        const response = await client.send(new GetCallerIdentityCommand({}));
                        result = { isAuthenticated: true, identity: response.Arn, account: response.Account };
                    } else {
                        result = await this.getFreshCallerIdentity();
                    }
                }

                if (result.isAuthenticated && result.identity) {
                    if (result.identity !== this.lastKnownIdentity) {
                        console.log(`[AwsService] Identity changed: ${this.lastKnownIdentity} → ${result.identity}`);
                        this.lastKnownIdentity = result.identity;

                        // Update currentProfile so subsequent AWS calls use the new profile
                        if (detectedProfile && detectedProfile !== this.currentProfile) {
                            console.log(`[AwsService] Updating currentProfile: ${this.currentProfile || 'default'} → ${detectedProfile}`);
                            this.currentProfile = detectedProfile;
                            if (detectedProfile !== 'default') {
                                process.env.AWS_PROFILE = detectedProfile;
                            } else {
                                delete process.env.AWS_PROFILE;
                            }
                            this.clearClientCache(); // Clear again so new clients use the new profile
                        }

                        this.emit('credentialsChanged', {
                            identity: result.identity,
                            account: result.account,
                            profile: detectedProfile || this.currentProfile,
                        });
                    }
                }
            } catch (err) {
                console.error('[AwsService] Error checking identity after file change:', err);
            }
        }, 2500); // 2.5s debounce — Granted writes frecency first, then credentials file
    }

    /**
     * Detect the most recently assumed profile by reading the Granted frecency file.
     * The frecency file has format: { Entries: [{ Entry: "profile-name", LastUsed: "ISO date", ... }] }
     * Returns the profile with the most recent LastUsed timestamp, or null.
     */
    private async detectMostRecentProfile(): Promise<string | null> {
        try {
            const frecencyPath = join(homedir(), '.granted', 'aws_profiles_frecency');
            const content = await readFile(frecencyPath, 'utf-8');
            const data = JSON.parse(content);

            const entries = data.Entries || data.entries || [];
            if (!Array.isArray(entries) || entries.length === 0) return null;

            let bestProfile: string | null = null;
            let bestTime = 0;

            for (const entry of entries) {
                const profileName = entry.Entry || entry.entry;
                const lastUsed = entry.LastUsed || entry.lastUsed;
                if (!profileName || !lastUsed) continue;

                const accessDate = new Date(lastUsed).getTime();
                if (accessDate > bestTime) {
                    bestTime = accessDate;
                    bestProfile = profileName;
                }
            }

            console.log(`[AwsService] Frecency: most recent profile = ${bestProfile}, lastUsed = ${new Date(bestTime).toISOString()}`);
            return bestProfile;
        } catch (err) {
            console.error('[AwsService] Error reading frecency file:', err);
            return null;
        }
    }

    /**
     * Read credentials directly from ~/.aws/credentials file for the given profile.
     * This bypasses process.env and picks up changes made by Granted's ExportCredsToAWS.
     */
    public async readCredentialsFile(profile?: string): Promise<{ accessKeyId?: string; secretAccessKey?: string; sessionToken?: string; region?: string } | null> {
        try {
            const credsPath = process.env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), '.aws', 'credentials');
            const content = await readFile(credsPath, 'utf-8');
            const targetProfile = profile || this.currentProfile || 'default';

            let inTargetProfile = false;
            const creds: any = {};

            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                const profileMatch = trimmed.match(/^\[([^\]]+)\]$/);
                if (profileMatch) {
                    inTargetProfile = profileMatch[1].trim() === targetProfile;
                    continue;
                }
                if (inTargetProfile && trimmed.includes('=')) {
                    const [key, ...valueParts] = trimmed.split('=');
                    const k = key.trim().toLowerCase();
                    const v = valueParts.join('=').trim();
                    // Handle both standard (aws_access_key_id) and Granted uppercase (AWS_ACCESS_KEY_ID) formats
                    if (k === 'aws_access_key_id') creds.accessKeyId = v;
                    if (k === 'aws_secret_access_key') creds.secretAccessKey = v;
                    if (k === 'aws_session_token') creds.sessionToken = v;
                    if (k === 'region' || k === 'aws_region') creds.region = v;
                }
            }

            if (creds.accessKeyId && creds.secretAccessKey) return creds;
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Get the current caller identity using a fresh (uncached) STS client.
     * Always creates a new client to ensure we pick up the latest credentials.
     * @param region AWS region for the STS client
     * @param profileOverride If provided, resolve credentials for this profile instead of this.currentProfile.
     *                        Used by file watchers to detect externally-assumed profiles.
     */
    public async getFreshCallerIdentity(region: string = 'us-east-1', profileOverride?: string | null): Promise<{ isAuthenticated: boolean; identity?: string; account?: string; error?: string }> {
        try {
            const effectiveProfile = profileOverride !== undefined ? (profileOverride || undefined) : this.currentProfile;
            console.log(`[AwsService] getFreshCallerIdentity: resolving with effectiveProfile=${effectiveProfile || 'default'}, currentProfile=${this.currentProfile || 'default'}${profileOverride !== undefined ? ` (override: ${profileOverride})` : ''}`);

            // First, try reading credentials directly from ~/.aws/credentials for this profile.
            // This picks up Granted's ExportCredsToAWS writes immediately without relying on
            // the SDK's credential_process caching.
            const fileCreds = await this.readCredentialsFile(effectiveProfile);
            let credentials;

            if (fileCreds) {
                console.log(`[AwsService] Using file-based credentials for profile: ${effectiveProfile || 'default'}`);
                credentials = {
                    accessKeyId: fileCreds.accessKeyId!,
                    secretAccessKey: fileCreds.secretAccessKey!,
                    sessionToken: fileCreds.sessionToken,
                };
            } else {
                credentials = fromNodeProviderChain({
                    ...(effectiveProfile ? { profile: effectiveProfile } : {}),
                    clientConfig: { region }
                });
            }

            const client = new STSClient({ region, credentials });
            const response = await client.send(new GetCallerIdentityCommand({}));
            console.log(`[AwsService] getFreshCallerIdentity: resolved to ${response.Arn}`);
            return {
                isAuthenticated: true,
                identity: response.Arn,
                account: response.Account
            };
        } catch (error: any) {
            console.error('[AwsService] Fresh identity check failed:', error);
            return {
                isAuthenticated: false,
                error: error.message
            };
        }
    }

    /**
     * Check if credentials should be refreshed
     */
    private shouldRefreshCredentials(): boolean {
        const timeSinceRefresh = Date.now() - this.lastCredentialRefresh;
        return timeSinceRefresh > this.CREDENTIAL_REFRESH_INTERVAL;
    }

    /**
     * Create a fresh credential provider that respects file-based creds, then the selected profile.
     * When Granted's ExportCredsToAWS is active, credentials are in [default] of ~/.aws/credentials,
     * so we should NOT pass a profile override to the provider chain.
     */
    private getFreshCredentialProvider() {
        // fromNodeProviderChain checks: env vars → shared credentials file → config file (credential_process).
        // Granted writes to [default] in ~/.aws/credentials, so passing no profile lets the SDK
        // pick up those credentials naturally. Only pass a profile if there's no [default] file creds.
        return fromNodeProviderChain({
            ...(this.currentProfile ? { profile: this.currentProfile } : {}),
            clientConfig: { region: 'us-east-1' }
        });
    }

    private getEc2Client(region: string, creds: any) {
        // Always clear cache if we should refresh
        if (this.shouldRefreshCredentials()) {
            this.clearClientCache();
        }

        // Check cache first
        const cacheKey = `${region}-${creds?.accessKeyId || 'default'}`;
        if (this.ec2Clients.has(cacheKey)) {
            return this.ec2Clients.get(cacheKey)!;
        }

        // Create new client
        let client: EC2Client;
        // Robust check: ensure strings and not empty
        if (creds && typeof creds.accessKeyId === 'string' && creds.accessKeyId.trim() !== '' &&
            typeof creds.secretAccessKey === 'string' && creds.secretAccessKey.trim() !== '') {
            client = new EC2Client({
                region,
                credentials: {
                    accessKeyId: creds.accessKeyId,
                    secretAccessKey: creds.secretAccessKey,
                    sessionToken: creds.sessionToken
                }
            });
        } else {
            // Use fresh credential provider to avoid caching
            client = new EC2Client({
                region,
                credentials: this.getFreshCredentialProvider()
            });
        }

        this.ec2Clients.set(cacheKey, client);
        return client;
    }

    private getEksClient(region: string, creds: any) {
        // Always clear cache if we should refresh
        if (this.shouldRefreshCredentials()) {
            this.clearClientCache();
        }

        const cacheKey = `${region}-${creds?.accessKeyId || 'default'}`;
        if (this.eksClients.has(cacheKey)) {
            return this.eksClients.get(cacheKey)!;
        }

        let client: EKSClient;
        if (creds && typeof creds.accessKeyId === 'string' && creds.accessKeyId.trim() !== '' &&
            typeof creds.secretAccessKey === 'string' && creds.secretAccessKey.trim() !== '') {
            client = new EKSClient({
                region,
                credentials: {
                    accessKeyId: creds.accessKeyId,
                    secretAccessKey: creds.secretAccessKey,
                    sessionToken: creds.sessionToken
                }
            });
        } else {
            // Use fresh credential provider to avoid caching
            client = new EKSClient({
                region,
                credentials: this.getFreshCredentialProvider()
            });
        }

        this.eksClients.set(cacheKey, client);
        return client;
    }

    private getStsClient(region: string, creds: any) {
        // Always clear cache if we should refresh
        if (this.shouldRefreshCredentials()) {
            this.clearClientCache();
        }

        const cacheKey = `${region}-${creds?.accessKeyId || 'default'}`;
        if (this.stsClients.has(cacheKey)) {
            return this.stsClients.get(cacheKey)!;
        }

        let client: STSClient;
        if (creds && typeof creds.accessKeyId === 'string' && creds.accessKeyId.trim() !== '' &&
            typeof creds.secretAccessKey === 'string' && creds.secretAccessKey.trim() !== '') {
            client = new STSClient({
                region,
                credentials: {
                    accessKeyId: creds.accessKeyId,
                    secretAccessKey: creds.secretAccessKey,
                    sessionToken: creds.sessionToken
                }
            });
        } else {
            // Use fresh credential provider to avoid caching
            client = new STSClient({
                region,
                credentials: this.getFreshCredentialProvider()
            });
        }

        this.stsClients.set(cacheKey, client);
        return client;
    }

    private getCloudTrailClient(region: string, creds: any) {
        if (this.shouldRefreshCredentials()) {
            this.clearClientCache();
        }

        const cacheKey = `${region}-${creds?.accessKeyId || 'default'}`;
        if (this.cloudTrailClients.has(cacheKey)) {
            return this.cloudTrailClients.get(cacheKey)!;
        }

        let client: CloudTrailClient;
        if (creds && typeof creds.accessKeyId === 'string' && creds.accessKeyId.trim() !== '' &&
            typeof creds.secretAccessKey === 'string' && creds.secretAccessKey.trim() !== '') {
            client = new CloudTrailClient({
                region,
                credentials: {
                    accessKeyId: creds.accessKeyId,
                    secretAccessKey: creds.secretAccessKey,
                    sessionToken: creds.sessionToken
                }
            });
        } else {
            client = new CloudTrailClient({
                region,
                credentials: this.getFreshCredentialProvider()
            });
        }

        this.cloudTrailClients.set(cacheKey, client);
        return client;
    }


    async checkAuth(region: string, creds: any) {
        try {
            const client = this.getStsClient(region, creds);
            const command = new GetCallerIdentityCommand({});
            const response = await client.send(command);
            console.log(`[AwsService] Auth check successful - Account: ${response.Account}, Identity: ${response.Arn}`);
            return {
                isAuthenticated: true,
                identity: response.Arn,
                account: response.Account
            };
        } catch (error: any) {
            console.error("[AwsService] Auth check failed:", error);
            return {
                isAuthenticated: false,
                error: error.message
            };
        }
    }

    async getEksCluster(region: string, clusterName: string, creds: any) {
        try {
            console.log(`[AwsService] getEksCluster region=${region} name=${clusterName}`);

            // First verify auth to see which account we're using
            const authCheck = await this.checkAuth(region, creds);
            if (!authCheck.isAuthenticated) {
                throw new Error(`Not authenticated to AWS in region ${region}: ${authCheck.error}`);
            }

            const client = this.getEksClient(region, creds);
            const command = new DescribeClusterCommand({ name: clusterName });
            const response = await client.send(command);
            return response.cluster;
        } catch (error: any) {
            console.error("[AwsService] Error getting EKS cluster:", error);

            // Provide more helpful error messages
            if (error.name === 'ResourceNotFoundException') {
                throw new Error(`EKS cluster '${clusterName}' not found in region ${region}. The cluster may be in a different AWS account or have a different name in EKS. Try running: aws eks list-clusters --region ${region}`);
            }

            throw new Error(`Failed to get EKS cluster: ${error.message}`);
        }
    }

    async getVpcDetails(region: string, vpcId: string, creds: any) {
        try {
            console.log(`[AwsService] getVpcDetails region=${region} vpcId=${vpcId}`);
            const client = this.getEc2Client(region, creds);
            // Verify vpcId format (basic check)
            if (!vpcId) throw new Error("VPC ID is required");

            const command = new DescribeVpcsCommand({ VpcIds: [vpcId] });
            const response = await client.send(command);
            return response.Vpcs?.[0];
        } catch (error: any) {
            console.error("[AwsService] Error getting VPC details:", error);
            throw new Error(`Failed to get VPC details: ${error.message}`);
        }
    }

    async getSubnets(region: string, vpcId: string, creds: any) {
        try {
            console.log(`[AwsService] getSubnets region=${region} vpcId=${vpcId}`);
            const client = this.getEc2Client(region, creds);
            if (!vpcId) throw new Error("VPC ID is required");

            const command = new DescribeSubnetsCommand({
                Filters: [{ Name: "vpc-id", Values: [vpcId] }]
            });
            const response = await client.send(command);
            return response.Subnets || [];
        } catch (error: any) {
            console.error("[AwsService] Error getting subnets:", error);
            throw new Error(`Failed to get subnets: ${error.message}`);
        }
    }

    async getInstanceDetails(region: string, instanceId: string, creds: any) {
        try {
            console.log(`[AwsService] getInstanceDetails region=${region} instanceId=${instanceId}`);
            const client = this.getEc2Client(region, creds);
            const command = new DescribeInstancesCommand({ InstanceIds: [instanceId] });
            const response = await client.send(command);
            return response.Reservations?.[0]?.Instances?.[0];
        } catch (error: any) {
            console.error("[AwsService] Error getting instance details:", error);
            throw new Error(`Failed to get instance details: ${error.message}`);
        }
    }

    async getEc2Instances(region: string, vpcId: string, clusterName: string | undefined, creds: any) {
        try {
            console.log(`[AwsService] getEc2Instances region=${region} vpcId=${vpcId}`);
            const client = this.getEc2Client(region, creds);
            if (!vpcId) throw new Error("VPC ID is required");

            const filters = [{ Name: "vpc-id", Values: [vpcId] }];

            // Filter by cluster tag if clusterName is provided to avoid showing instances from other clusters in shared VPC
            // Tag key format: "kubernetes.io/cluster/<clusterName>"
            // Value can be "owned" or "shared"
            if (clusterName) {
                filters.push({ Name: `tag:kubernetes.io/cluster/${clusterName}`, Values: ["owned", "shared"] });
            }

            // Also filter for running instances to keep the list relevant
            filters.push({ Name: "instance-state-name", Values: ["running"] });

            const command = new DescribeInstancesCommand({ Filters: filters });
            const response = await client.send(command);

            // Flatten reservations
            const instances = response.Reservations?.flatMap(r => r.Instances || []) || [];
            return instances;
        } catch (error: any) {
            console.error("[AwsService] Error getting EC2 instances:", error);
            throw new Error(`Failed to get EC2 instances: ${error.message}`);
        }
    }

    async getPodIdentities(region: string, clusterName: string, creds: any) {
        try {
            console.log(`[AwsService] getPodIdentities region=${region} cluster=${clusterName}`);
            const client = this.getEksClient(region, creds);

            // List associations
            const command = new ListPodIdentityAssociationsCommand({ clusterName });
            const response = await client.send(command);

            // We could fetch details for each, but list might be enough for initial view
            return response.associations || [];
        } catch (error: any) {
            // Pod Identity is a newer feature, might fail on older clusters or permissions
            console.warn("[AwsService] Error getting pod identities:", error);
            return [];
        }
    }

    async lookupCloudTrailEvents(params: {
        region: string;
        clusterName: string;
        startTime: string;
        endTime: string;
        nextToken?: string;
        maxResults?: number;
    }, creds: any): Promise<{
        events: Array<{
            eventId: string;
            eventTime: string;
            eventName: string;
            username: string;
            sourceIpAddress: string;
            userAgent: string;
            readOnly: boolean;
            resources: Array<{ resourceType: string; resourceName: string }>;
            rawEvent: string;
        }>;
        nextToken?: string;
    }> {
        console.log(`[AwsService] lookupCloudTrailEvents region=${params.region} cluster=${params.clusterName}`);
        const client = this.getCloudTrailClient(params.region, creds);

        const command = new LookupEventsCommand({
            LookupAttributes: [
                {
                    AttributeKey: 'EventSource',
                    AttributeValue: 'eks.amazonaws.com'
                }
            ],
            StartTime: new Date(params.startTime),
            EndTime: new Date(params.endTime),
            MaxResults: params.maxResults ?? 50,
            NextToken: params.nextToken
        });

        const response = await client.send(command);

        const events = (response.Events ?? []).map(event => {
            let parsed: any = {};
            try {
                parsed = JSON.parse(event.CloudTrailEvent ?? '{}');
            } catch {
                // If parsing fails, leave parsed as empty object
            }

            return {
                eventId: event.EventId ?? '',
                eventTime: event.EventTime ? event.EventTime.toISOString() : '',
                eventName: event.EventName ?? '',
                username: event.Username ?? '',
                sourceIpAddress: parsed.sourceIPAddress ?? '',
                userAgent: parsed.userAgent ?? '',
                readOnly: parsed.readOnly ?? false,
                resources: (event.Resources ?? []).map(r => ({
                    resourceType: r.ResourceType ?? '',
                    resourceName: r.ResourceName ?? ''
                })),
                rawEvent: event.CloudTrailEvent ?? '{}'
            };
        });

        return {
            events,
            nextToken: response.NextToken
        };
    }

}
