import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { EKSClient, DescribeClusterCommand, ListPodIdentityAssociationsCommand } from "@aws-sdk/client-eks";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export class AwsService {
    private getEc2Client(region: string, creds: any) {
        // Robust check: ensure strings and not empty
        if (creds && typeof creds.accessKeyId === 'string' && creds.accessKeyId.trim() !== '' &&
            typeof creds.secretAccessKey === 'string' && creds.secretAccessKey.trim() !== '') {
            return new EC2Client({
                region,
                credentials: {
                    accessKeyId: creds.accessKeyId,
                    secretAccessKey: creds.secretAccessKey,
                    sessionToken: creds.sessionToken
                }
            });
        }
        return new EC2Client({ region, credentials: fromNodeProviderChain() });
    }

    private getEksClient(region: string, creds: any) {
        if (creds && typeof creds.accessKeyId === 'string' && creds.accessKeyId.trim() !== '' &&
            typeof creds.secretAccessKey === 'string' && creds.secretAccessKey.trim() !== '') {
            return new EKSClient({
                region,
                credentials: {
                    accessKeyId: creds.accessKeyId,
                    secretAccessKey: creds.secretAccessKey,
                    sessionToken: creds.sessionToken
                }
            });
        }
        return new EKSClient({ region, credentials: fromNodeProviderChain() });
    }

    private getStsClient(region: string, creds: any) {
        if (creds && typeof creds.accessKeyId === 'string' && creds.accessKeyId.trim() !== '' &&
            typeof creds.secretAccessKey === 'string' && creds.secretAccessKey.trim() !== '') {
            return new STSClient({
                region,
                credentials: {
                    accessKeyId: creds.accessKeyId,
                    secretAccessKey: creds.secretAccessKey,
                    sessionToken: creds.sessionToken
                }
            });
        }
        return new STSClient({ region, credentials: fromNodeProviderChain() });
    }

    async checkAuth(region: string, creds: any) {
        try {
            const client = this.getStsClient(region, creds);
            const command = new GetCallerIdentityCommand({});
            const response = await client.send(command);
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
            const client = this.getEksClient(region, creds);
            const command = new DescribeClusterCommand({ name: clusterName });
            const response = await client.send(command);
            return response.cluster;
        } catch (error: any) {
            console.error("[AwsService] Error getting EKS cluster:", error);
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
