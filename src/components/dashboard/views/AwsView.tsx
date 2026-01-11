import React, { useEffect, useState } from 'react';
import { Network, Server, Shield, Layers, AlertCircle, RefreshCw } from 'lucide-react';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { Drawer } from '../../shared/Drawer';
import { Ec2InstanceDetails } from './Ec2InstanceDetails';

interface AwsViewProps {
    clusterName: string;
}

export const AwsView: React.FC<AwsViewProps> = ({ clusterName }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [eksCluster, setEksCluster] = useState<any>(null);
    const [vpc, setVpc] = useState<any>(null);
    const [subnets, setSubnets] = useState<any[]>([]);
    const [instances, setInstances] = useState<any[]>([]);
    const [podIdentities, setPodIdentities] = useState<any[]>([]);
    const [region, setRegion] = useState<string | null>(null);
    const [clusterNodes, setClusterNodes] = useState<any[]>([]);
    const [selectedInstance, setSelectedInstance] = useState<any>(null);

    const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');

    // Column Definitions
    const subnetColumns: IColumn[] = React.useMemo(() => [
        { label: 'Name', dataKey: 'name', width: 200, sortable: true, flexGrow: 1 },
        { label: 'Subnet ID', dataKey: 'SubnetId', width: 180, sortable: true },
        { label: 'CIDR', dataKey: 'CidrBlock', width: 140, sortable: true },
        { label: 'AZ', dataKey: 'AvailabilityZone', width: 120, sortable: true },
        { label: 'Available IPs', dataKey: 'AvailableIpAddressCount', width: 120, sortable: true },
        {
            label: 'Public/Private',
            dataKey: 'isPublic',
            width: 120,
            sortable: true,
            cellRenderer: (val: any) => (
                <span className={`px-2 py-0.5 rounded text-xs ${val ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-300'}`}>
                    {val ? 'Public' : 'Private'}
                </span>
            )
        }
    ], []);

    const ec2Columns: IColumn[] = React.useMemo(() => [
        { label: 'Name', dataKey: 'name', width: 200, sortable: true, flexGrow: 1 },
        { label: 'Instance ID', dataKey: 'InstanceId', width: 180, sortable: true },
        {
            label: 'Node',
            dataKey: 'nodeName',
            width: 250,
            sortable: true,
            cellRenderer: (val: any) => val ? (
                <div className="flex items-center gap-1.5 text-blue-300">
                    <Server size={12} />
                    <span className="font-mono text-xs" title={val}>{val}</span>
                </div>
            ) : <span className="text-gray-500 text-xs italic">Not mapped</span>
        },
        { label: 'Type', dataKey: 'InstanceType', width: 120, sortable: true },
        {
            label: 'State',
            dataKey: 'stateName',
            width: 100,
            sortable: true,
            cellRenderer: (val: any) => (
                <span className={`px-2 py-0.5 rounded text-xs ${val === 'running' ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-300'}`}>
                    {val}
                </span>
            )
        },
        { label: 'Private IP', dataKey: 'PrivateIpAddress', width: 140, sortable: true },
    ], []);

    const podIdentityColumns: IColumn[] = React.useMemo(() => [
        { label: 'Namespace', dataKey: 'namespace', width: 150, sortable: true },
        { label: 'Service Account', dataKey: 'serviceAccount', width: 200, sortable: true },
        { label: 'Association ID', dataKey: 'associationId', width: 200, sortable: true },
        { label: 'Role ARN', dataKey: 'roleArn', width: 300, sortable: true, flexGrow: 1 },
    ], []);

    const fetchData = async () => {
        setLoading(true);
        setError(null);

        // Clear AWS client cache to ensure fresh credentials
        await window.k8s.aws.clearCache();

        try {
            // 1. Get Nodes (No AWS Auth)
            const nodes = await window.k8s.getNodes(clusterName);
            setClusterNodes(nodes || []);

            if (!nodes || nodes.length === 0) {
                throw new Error("No nodes found in cluster. Cannot determine AWS region.");
            }

            // Region Detection
            const node = nodes[0];
            const providerId = node.spec?.providerID || '';
            let detectedRegion = '';

            if (providerId.startsWith('aws:///')) {
                const parts = providerId.replace('aws:///', '').split('/');
                detectedRegion = parts[0].slice(0, -1);
            }

            if (!detectedRegion) {
                detectedRegion = node.metadata?.labels?.['topology.kubernetes.io/region'] ||
                    node.metadata?.labels?.['failure-domain.beta.kubernetes.io/region'] || '';
            }

            if (!detectedRegion) {
                throw new Error("Could not detect AWS Region from nodes.");
            }
            setRegion(detectedRegion);

            // 2. Check AWS Auth
            const authResult = await window.k8s.aws.checkAuth(detectedRegion);
            if (!authResult.isAuthenticated) {
                console.warn("[AwsView] AWS Auth check failed:", authResult.error);
                setAuthStatus('unauthenticated');
                setLoading(false);
                return;
            } else {
                setAuthStatus('authenticated');
            }

            // 3. Resolve Cluster Name / VPC
            let derivedClusterName = clusterName;
            let vpcId = '';

            if (providerId) {
                const instanceId = providerId.split('/').pop();
                if (instanceId && instanceId.startsWith('i-')) {
                    try {
                        const instance = await window.k8s.aws.getInstanceDetails(detectedRegion, instanceId);
                        if (instance) {
                            vpcId = instance.VpcId;
                            const tags = instance.Tags || [];
                            const clusterTag = tags.find((t: any) => t.Key?.startsWith('kubernetes.io/cluster/'));
                            if (clusterTag) {
                                derivedClusterName = clusterTag.Key.replace('kubernetes.io/cluster/', '');
                                console.log(`[AwsView] Derived EKS cluster name from instance tags: ${derivedClusterName}`);
                            }
                        }
                    } catch (e) {
                        console.warn("Failed to get instance details", e);
                    }
                }
            }

            // If we still don't have the cluster name from tags, try common patterns
            if (derivedClusterName === clusterName) {
                // Try appending -eks suffix (common pattern)
                console.log(`[AwsView] Trying cluster name with -eks suffix: ${clusterName}-eks`);
                derivedClusterName = `${clusterName}-eks`;
            }

            // 4. Fetch EKS Cluster
            // Try multiple cluster name variations
            const clusterNameVariations = [
                derivedClusterName,  // From instance tags or with -eks suffix
                clusterName,         // Original context name
                `${clusterName}-eks` // Common pattern if not already tried
            ].filter((name, index, self) => self.indexOf(name) === index); // Remove duplicates

            let clusterDetails = null;
            let successfulClusterName = '';

            for (const nameToTry of clusterNameVariations) {
                try {
                    console.log(`[AwsView] Trying EKS cluster name: ${nameToTry}`);
                    clusterDetails = await window.k8s.aws.getEksCluster(detectedRegion, nameToTry);
                    if (clusterDetails) {
                        successfulClusterName = nameToTry;
                        setEksCluster(clusterDetails);
                        if (!vpcId && clusterDetails.resourcesVpcConfig?.vpcId) {
                            vpcId = clusterDetails.resourcesVpcConfig.vpcId;
                        }
                        console.log(`[AwsView] Successfully found EKS cluster with name: ${nameToTry}`);
                        break;
                    }
                } catch (e: any) {
                    console.warn(`Failed to get EKS cluster with name '${nameToTry}':`, e.message);
                    // Continue trying other variations
                }
            }

            if (!clusterDetails) {
                console.warn(`Could not find EKS cluster. Tried names: ${clusterNameVariations.join(', ')}`);
                setError(`Cannot find EKS cluster in ${detectedRegion}. Tried: ${clusterNameVariations.join(', ')}. Please ensure your AWS credentials have access to this region and account.`);
                setLoading(false);
                return;
            }

            // Use the successful cluster name for subsequent calls
            derivedClusterName = successfulClusterName;

            // 5. Fetch Resources
            const promises = [];
            if (vpcId) {
                promises.push(
                    window.k8s.aws.getVpcDetails(detectedRegion, vpcId)
                        .then(setVpc)
                        .catch(e => console.warn("Failed to get VPC details:", e))
                );
                promises.push(
                    window.k8s.aws.getSubnets(detectedRegion, vpcId)
                        .then(setSubnets)
                        .catch(e => console.warn("Failed to get subnets:", e))
                );
                promises.push(
                    window.k8s.aws.getEc2Instances(detectedRegion, vpcId, derivedClusterName)
                        .then(setInstances)
                        .catch(e => console.warn("Failed to get EC2 instances:", e))
                );
            }

            // 6. Pod Identities
            promises.push(
                window.k8s.aws.getPodIdentities(detectedRegion, derivedClusterName)
                    .then(setPodIdentities)
                    .catch(e => {
                        console.warn("Failed to get pod identities:", e);
                        // Don't fail the whole view if pod identities fail
                        setPodIdentities([]);
                    })
            );

            await Promise.allSettled(promises);

        } catch (err: any) {
            console.error("Error loading AWS data", err);
            setError(err.message || "Failed to load AWS resources");
            if (err.message && (err.message.includes("ExpiredToken") || err.message.includes("security token included"))) {
                setAuthStatus('unauthenticated');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [clusterName]);

    const getNameFromTags = (resource: any) => {
        const tags = resource.Tags || [];
        const nameTag = tags.find((t: any) => t.Key === 'Name');
        return nameTag ? nameTag.Value : '-';
    };

    const getMatchingNode = (instanceId: string) => {
        return clusterNodes.find(node => {
            const providerId = node.spec?.providerID || '';
            return providerId.endsWith(instanceId) || providerId.includes(instanceId);
        });
    };

    const processedSubnets = subnets.map(s => ({
        ...s,
        name: getNameFromTags(s),
        isPublic: s.MapPublicIpOnLaunch
    }));

    const processedInstances = instances.map(i => {
        const node = getMatchingNode(i.InstanceId);
        return {
            ...i,
            name: getNameFromTags(i),
            nodeName: node?.metadata?.name || '',
            stateName: i.State?.Name
        };
    });

    if (authStatus === 'unauthenticated') {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Shield size={48} className="text-gray-600 mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">AWS Credentials Required</h2>
                <p className="text-gray-400 mb-6 max-w-md">
                    Unable to authenticate with AWS. This could be due to:
                </p>
                <ul className="text-left text-gray-400 mb-6 space-y-2">
                    <li>• Missing or expired AWS credentials</li>
                    <li>• Switched AWS accounts/profiles</li>
                    <li>• Insufficient permissions</li>
                </ul>
                <div className="flex gap-3">
                    <button
                        onClick={async () => {
                            await window.k8s.aws.clearCache();
                            setAuthStatus('checking');
                            fetchData();
                        }}
                        className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg transition-colors"
                    >
                        Retry
                    </button>
                    <button
                        onClick={async () => {
                            await window.k8s.app.restart();
                        }}
                        className="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-lg transition-colors"
                    >
                        Restart App
                    </button>
                </div>
                <div className="mt-6 text-xs text-gray-500 max-w-md">
                    <p className="mb-2">
                        <strong>Note:</strong> AWS SDK caches credentials at the process level.
                        If you've switched AWS accounts or profiles, you may need to restart the app
                        to pick up the new credentials.
                    </p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
        );
    }

    if (error) {
        const isAuthError = error.includes('ExpiredToken') ||
            error.includes('security token') ||
            error.includes('credentials') ||
            error.includes('401');

        return (
            <div className="p-8 space-y-4">
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-400">
                    <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="font-semibold mb-1">Error Loading AWS Resources</p>
                        <p className="text-sm">{error}</p>
                    </div>
                    <button onClick={fetchData} className="p-2 hover:bg-red-500/20 rounded-lg flex-shrink-0">
                        <RefreshCw size={16} />
                    </button>
                </div>

                {isAuthError && (
                    <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
                        <p className="text-orange-300 text-sm mb-3">
                            <strong>Credential Issue Detected:</strong> If you've recently switched AWS accounts or profiles,
                            the app may need to be restarted to pick up new credentials.
                        </p>
                        <button
                            onClick={async () => {
                                await window.k8s.app.restart();
                            }}
                            className="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-lg transition-colors text-sm"
                        >
                            Restart App
                        </button>
                    </div>
                )}
            </div>
        );
    }

    const InfoCard: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({ label, value, icon }) => (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                {icon}
                {label}
            </div>
            <div className="text-white font-mono text-lg truncate" title={value}>{value}</div>
        </div>
    );

    return (
        <>
            <div className="p-6 space-y-8 pb-20">
                <section>
                    <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                        <div className="w-1 h-8 bg-orange-500 rounded-full"></div>
                        AWS Infrastructure
                        {region && <span className="text-sm font-normal text-gray-400 bg-white/5 px-2 py-1 rounded-md ml-2">{region}</span>}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <InfoCard label="VPC ID" value={vpc?.VpcId || '-'} icon={<Network size={14} />} />
                        <InfoCard label="CIDR Block" value={vpc?.CidrBlock || '-'} icon={<Network size={14} />} />
                        <InfoCard label="EKS Version" value={eksCluster?.version || '-'} icon={<Layers size={14} />} />
                        <InfoCard label="Status" value={eksCluster?.status || '-'} icon={<Shield size={14} />} />
                    </div>
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <Network size={18} className="text-blue-400" />
                        Subnets
                    </h3>
                    <PagedTable tableId="aws-subnets" data={processedSubnets} columns={subnetColumns} />
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <Server size={18} className="text-orange-400" />
                        EC2 Instances
                    </h3>
                    <PagedTable
                        tableId="aws-ec2-instances"
                        data={processedInstances}
                        columns={ec2Columns}
                        onRowClick={(row) => setSelectedInstance(row)}
                    />
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <Shield size={18} className="text-purple-400" />
                        Pod Identities
                    </h3>
                    <PagedTable tableId="aws-pod-identities" data={podIdentities} columns={podIdentityColumns} />
                </section>
            </div>

            <Drawer
                isOpen={!!selectedInstance}
                onClose={() => setSelectedInstance(null)}
                title="Instance Details"
            >
                {selectedInstance && (
                    <Ec2InstanceDetails
                        instance={selectedInstance}
                        node={getMatchingNode(selectedInstance.InstanceId)}
                        onClose={() => setSelectedInstance(null)}
                    />
                )}
            </Drawer>
        </>
    );
};

const PagedTable = ({ tableId, data, columns, onRowClick }: { tableId?: string, data: any[], columns: IColumn[], onRowClick?: (row: any) => void }) => {
    const [page, setPage] = useState(1);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const pageSize = 10;

    useEffect(() => {
        const maxPage = Math.ceil(data.length / pageSize) || 1;
        if (page > maxPage) setPage(1);
    }, [data.length]);

    const sortedData = React.useMemo(() => {
        if (!sortConfig) return data;
        return [...data].sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];

            if (aVal === bVal) return 0;

            let comparison = 0;
            if (aVal > bVal) comparison = 1;
            else if (aVal < bVal) comparison = -1;

            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
    }, [data, sortConfig]);

    const totalPages = Math.ceil(sortedData.length / pageSize);
    const paginatedData = sortedData.slice((page - 1) * pageSize, page * pageSize);

    const handleSort = (key: string) => {
        setSortConfig(current => {
            if (current?.key === key) {
                return current.direction === 'asc' ? { key, direction: 'desc' } : null;
            }
            return { key, direction: 'asc' };
        });
    };

    if (data.length === 0) {
        return (
            <div className="border border-white/10 rounded-xl bg-black/20 p-8 text-center text-gray-500">
                No resources found
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="h-[400px]">
                <VirtualizedTable
                    tableId={tableId}
                    data={paginatedData}
                    columns={columns}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    onRowClick={onRowClick}
                    rowHeight={50}
                    headerHeight={40}
                />
            </div>
            {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 text-xs">
                    <button
                        disabled={page === 1}
                        onClick={() => setPage(p => p - 1)}
                        className="px-2 py-1 bg-white/5 disabled:opacity-50 hover:bg-white/10 rounded text-white"
                    >
                        Prev
                    </button>
                    <span className="text-gray-400">Page {page} of {totalPages}</span>
                    <button
                        disabled={page === totalPages}
                        onClick={() => setPage(p => p + 1)}
                        className="px-2 py-1 bg-white/5 disabled:opacity-50 hover:bg-white/10 rounded text-white"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
};
