import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { EKSClient, DescribeClusterCommand, ListPodIdentityAssociationsCommand } from "@aws-sdk/client-eks";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export class AwsService {
    // Cache clients by region to avoid recreating them, but allow refresh
    private ec2Clients: Map<string, EC2Client> = new Map();
    private eksClients: Map<string, EKSClient> = new Map();
    private stsClients: Map<string, STSClient> = new Map();
    private lastCredentialRefresh: number = 0;
    private readonly CREDENTIAL_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

    /**
     * Clear all cached clients to force credential refresh
     * Call this when switching AWS accounts/profiles
     * 
     * NOTE: This only clears our application-level cache. The AWS SDK's
     * credential provider chain caches credentials at the Node.js process level,
     * which cannot be cleared without restarting the application.
     * 
     * If you've switched AWS accounts/profiles, you may need to restart the app
     * to pick up the new credentials.
     */
    public clearClientCache() {
        console.log('[AwsService] Clearing client cache');
        console.log('[AwsService] WARNING: AWS SDK credential cache persists at process level - may need app restart for account switches');
        this.ec2Clients.clear();
        this.eksClients.clear();
        this.stsClients.clear();
        this.lastCredentialRefresh = Date.now();
    }

    /**
     * Check if credentials should be refreshed
     */
    private shouldRefreshCredentials(): boolean {
        const timeSinceRefresh = Date.now() - this.lastCredentialRefresh;
        return timeSinceRefresh > this.CREDENTIAL_REFRESH_INTERVAL;
    }

    /**
     * Create a fresh credential provider that doesn't use cached credentials
     */
    private getFreshCredentialProvider() {
        // Force a new credential provider chain each time to avoid caching
        return fromNodeProviderChain({
            // Disable caching by creating a new provider each time
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
}
