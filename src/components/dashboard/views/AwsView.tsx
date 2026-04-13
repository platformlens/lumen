import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Network, Server, Shield, Layers, AlertCircle, RefreshCw, FileText } from 'lucide-react';
import { TableVirtuoso } from 'react-virtuoso';
import { IColumn } from '../../shared/VirtualizedTable';
import { GlassButton } from '../../shared/GlassButton';
import { AccessLogsView } from './AccessLogsView';

const tableStyles = `
  .aws-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .aws-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .aws-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .aws-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .aws-table-container th {
    padding: 0.75rem 1.5rem;
    outline: none;
    position: relative;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: #6b7280;
    text-transform: uppercase;
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-align: left;
    white-space: nowrap;
  }
  .aws-table-container th:first-child {
    border-top-left-radius: 0;
  }
  .aws-table-container th:last-child {
    border-top-right-radius: 0;
  }
  .aws-table-container th.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .aws-table-container td {
    padding: 0.75rem 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    font-size: var(--lumen-table-font-size, 14px);
  }
  .aws-table-container td.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .aws-table-container td.no-truncate {
    overflow: visible;
    text-overflow: clip;
  }
  .column-resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .column-resize-handle:hover::after,
  .column-resize-handle.resizing::after {
    content: '';
    width: 2px;
    height: 100%;
    background-color: rgba(59, 130, 246, 0.5);
  }
  .column-resize-handle.resizing::after {
    background-color: rgba(59, 130, 246, 0.8);
  }
`;

function loadColumnWidths(tableId: string, columns: IColumn[]): Record<string, number> {
    const defaults: Record<string, number> = {};
    columns.forEach(c => { defaults[c.dataKey] = c.width ?? 150; });
    try {
        const saved = localStorage.getItem(`table-column-widths-${tableId}`);
        if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaults;
}

function saveColumnWidths(tableId: string, widths: Record<string, number>) {
    try {
        localStorage.setItem(`table-column-widths-${tableId}`, JSON.stringify(widths));
    } catch { /* ignore */ }
}

const VirtuosoTableHead = React.forwardRef<HTMLTableSectionElement>((props, ref) => (
    <thead {...props} ref={ref} style={{ ...(props as any).style, position: 'sticky', top: 0, zIndex: 2 }} />
));

interface AwsViewProps {
    clusterName: string;
    onResourceClick?: (resource: any, type: string) => void;
}

export const AwsView: React.FC<AwsViewProps> = ({ clusterName, onResourceClick }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [eksCluster, setEksCluster] = useState<any>(null);
    const [vpc, setVpc] = useState<any>(null);
    const [subnets, setSubnets] = useState<any[]>([]);
    const [instances, setInstances] = useState<any[]>([]);
    const [podIdentities, setPodIdentities] = useState<any[]>([]);
    const [region, setRegion] = useState<string | null>(null);
    const [clusterNodes, setClusterNodes] = useState<any[]>([]);

    const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
    const [showAccessLogs, setShowAccessLogs] = useState(false);
    const [derivedClusterNameState, setDerivedClusterNameState] = useState<string>(clusterName);

    const subnetColumns: IColumn[] = React.useMemo(() => [
        { label: 'Name', dataKey: 'name', width: 200, sortable: true, flexGrow: 1 },
        { label: 'Subnet ID', dataKey: 'SubnetId', width: 180, sortable: true },
        { label: 'CIDR', dataKey: 'CidrBlock', width: 140, sortable: true },
        { label: 'AZ', dataKey: 'AvailabilityZone', width: 120, sortable: true },
        { label: 'Available IPs', dataKey: 'AvailableIpAddressCount', width: 120, sortable: true },
        {
            label: 'Public/Private', dataKey: 'isPublic', width: 120, sortable: true,
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
            label: 'Node', dataKey: 'nodeName', width: 250, sortable: true,
            cellRenderer: (val: any) => val ? (
                <div className="flex items-center gap-1.5 text-blue-300">
                    <Server size={12} />
                    <span className="font-mono text-xs" title={val}>{val}</span>
                </div>
            ) : <span className="text-gray-500 text-xs italic">Not mapped</span>
        },
        { label: 'Type', dataKey: 'InstanceType', width: 120, sortable: true },
        {
            label: 'State', dataKey: 'stateName', width: 100, sortable: true,
            cellRenderer: (val: any) => (
                <span className={`px-2 py-0.5 rounded text-xs ${val === 'running' ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-300'}`}>{val}</span>
            )
        },
        { label: 'Private IP', dataKey: 'PrivateIpAddress', width: 140, sortable: true },
    ], []);

    const podIdentityColumns: IColumn[] = React.useMemo(() => [
        { label: 'Namespace', dataKey: 'namespace', width: 150, sortable: true },
        {
            label: 'Service Account', dataKey: 'serviceAccount', width: 200, sortable: true,
            cellRenderer: (val: any) => (<span className="text-blue-400 cursor-pointer hover:underline">{val}</span>),
        },
        { label: 'Association ID', dataKey: 'associationId', width: 200, sortable: true },
        { label: 'Role ARN', dataKey: 'roleArn', width: 300, sortable: true, flexGrow: 1 },
    ], []);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        await window.k8s.aws.clearCache();

        try {
            const nodes = await window.k8s.getNodes(clusterName);
            setClusterNodes(nodes || []);
            if (!nodes || nodes.length === 0) throw new Error("No nodes found in cluster. Cannot determine AWS region.");

            const node = nodes[0];
            const providerId = node.spec?.providerID || '';
            let detectedRegion = '';
            if (providerId.startsWith('aws:///')) {
                const parts = providerId.replace('aws:///', '').split('/');
                detectedRegion = parts[0].slice(0, -1);
            }
            if (!detectedRegion) {
                detectedRegion = node.metadata?.labels?.['topology.kubernetes.io/region'] || node.metadata?.labels?.['failure-domain.beta.kubernetes.io/region'] || '';
            }
            if (!detectedRegion) throw new Error("Could not detect AWS Region from nodes.");
            setRegion(detectedRegion);

            const authResult = await window.k8s.aws.checkAuth(detectedRegion);
            if (!authResult.isAuthenticated) {
                console.warn("[AwsView] AWS Auth check failed:", authResult.error);
                setAuthStatus('unauthenticated');
                setLoading(false);
                return;
            } else {
                setAuthStatus('authenticated');
            }

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
                            }
                        }
                    } catch (e) { console.warn("Failed to get instance details", e); }
                }
            }
            if (derivedClusterName === clusterName) derivedClusterName = `${clusterName}-eks`;

            const clusterNameVariations = [derivedClusterName, clusterName, `${clusterName}-eks`].filter((name, index, self) => self.indexOf(name) === index);
            let clusterDetails = null;
            let successfulClusterName = '';
            for (const nameToTry of clusterNameVariations) {
                try {
                    clusterDetails = await window.k8s.aws.getEksCluster(detectedRegion, nameToTry);
                    if (clusterDetails) {
                        successfulClusterName = nameToTry;
                        setEksCluster(clusterDetails);
                        if (!vpcId && clusterDetails.resourcesVpcConfig?.vpcId) vpcId = clusterDetails.resourcesVpcConfig.vpcId;
                        break;
                    }
                } catch (e: any) { console.warn(`Failed to get EKS cluster with name '${nameToTry}':`, e.message); }
            }
            if (!clusterDetails) {
                setError(`Cannot find EKS cluster in ${detectedRegion}. Tried: ${clusterNameVariations.join(', ')}. Please ensure your AWS credentials have access to this region and account.`);
                setLoading(false);
                return;
            }
            derivedClusterName = successfulClusterName;
            setDerivedClusterNameState(derivedClusterName);

            const promises = [];
            if (vpcId) {
                promises.push(window.k8s.aws.getVpcDetails(detectedRegion, vpcId).then(setVpc).catch(e => console.warn("Failed to get VPC details:", e)));
                promises.push(window.k8s.aws.getSubnets(detectedRegion, vpcId).then(setSubnets).catch(e => console.warn("Failed to get subnets:", e)));
                promises.push(window.k8s.aws.getEc2Instances(detectedRegion, vpcId, derivedClusterName).then(setInstances).catch(e => console.warn("Failed to get EC2 instances:", e)));
            }
            promises.push(window.k8s.aws.getPodIdentities(detectedRegion, derivedClusterName).then(setPodIdentities).catch(e => { console.warn("Failed to get pod identities:", e); setPodIdentities([]); }));
            await Promise.allSettled(promises);
        } catch (err: any) {
            console.error("Error loading AWS data", err);
            setError(err.message || "Failed to load AWS resources");
            if (err.message && (err.message.includes("ExpiredToken") || err.message.includes("security token included"))) setAuthStatus('unauthenticated');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [clusterName]);

    const getNameFromTags = (resource: any) => {
        const tags = resource.Tags || [];
        const nameTag = tags.find((t: any) => t.Key === 'Name');
        return nameTag ? nameTag.Value : '-';
    };

    const getMatchingNode = (instance: any) => {
        const instanceId = instance.InstanceId || '';
        const privateDns = instance.PrivateDnsName || '';
        const privateIp = instance.PrivateIpAddress || '';
        return clusterNodes.find(node => {
            const providerId = node.spec?.providerID || '';
            const nodeName = node.metadata?.name || '';
            const nodeInternalIp = (node.status?.addresses || []).find((a: any) => a.type === 'InternalIP')?.address || '';
            const nodeHostname = (node.status?.addresses || []).find((a: any) => a.type === 'Hostname')?.address || '';
            if (instanceId && providerId.includes(instanceId)) return true;
            if (privateDns && (nodeName === privateDns || nodeHostname === privateDns)) return true;
            if (privateIp && (nodeName === privateIp || nodeInternalIp === privateIp)) return true;
            return false;
        });
    };

    const processedSubnets = subnets.map(s => ({ ...s, name: getNameFromTags(s), isPublic: s.MapPublicIpOnLaunch }));
    const processedInstances = instances.map(i => {
        const node = getMatchingNode(i);
        return { ...i, name: getNameFromTags(i), nodeName: node?.metadata?.name || '', stateName: i.State?.Name };
    });

    if (showAccessLogs && region) {
        return <AccessLogsView region={region} clusterName={derivedClusterNameState} onBack={() => setShowAccessLogs(false)} />;
    }

    if (authStatus === 'unauthenticated') {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Shield size={48} className="text-gray-600 mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">AWS Credentials Required</h2>
                <p className="text-gray-400 mb-6 max-w-md">Unable to authenticate with AWS. This could be due to:</p>
                <ul className="text-left text-gray-400 mb-6 space-y-2">
                    <li>• Missing or expired AWS credentials</li>
                    <li>• Switched AWS accounts/profiles</li>
                    <li>• Insufficient permissions</li>
                </ul>
                <div className="flex gap-3">
                    <button onClick={async () => { await window.k8s.aws.clearCache(); setAuthStatus('checking'); fetchData(); }} className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg transition-colors">Retry</button>
                    <button onClick={async () => { await window.k8s.app.restart(); }} className="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-lg transition-colors">Restart App</button>
                </div>
                <div className="mt-6 text-xs text-gray-500 max-w-md">
                    <p className="mb-2"><strong>Note:</strong> AWS SDK caches credentials at the process level. If you've switched AWS accounts or profiles, you may need to restart the app to pick up the new credentials.</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>);
    }

    if (error) {
        const isAuthErr = error.includes('ExpiredToken') || error.includes('security token') || error.includes('credentials') || error.includes('401');
        return (
            <div className="p-8 space-y-4">
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-400">
                    <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="font-semibold mb-1">Error Loading AWS Resources</p>
                        <p className="text-sm">{error}</p>
                    </div>
                    <button onClick={fetchData} className="p-2 hover:bg-red-500/20 rounded-lg flex-shrink-0"><RefreshCw size={16} /></button>
                </div>
                {isAuthErr && (
                    <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
                        <p className="text-orange-300 text-sm mb-3"><strong>Credential Issue Detected:</strong> If you've recently switched AWS accounts or profiles, the app may need to be restarted to pick up new credentials.</p>
                        <button onClick={async () => { await window.k8s.app.restart(); }} className="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-lg transition-colors text-sm">Restart App</button>
                    </div>
                )}
            </div>
        );
    }

    const InfoCard: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({ label, value, icon }) => (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">{icon}{label}</div>
            <div className="text-white font-mono text-lg truncate" title={value}>{value}</div>
        </div>
    );

    return (
        <>
            <div className="p-6 space-y-8 pb-20">
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <div className="w-1 h-8 bg-orange-500 rounded-full"></div>
                            AWS Infrastructure
                            {region && <span className="text-sm font-normal text-gray-400 bg-white/5 px-2 py-1 rounded-md ml-2">{region}</span>}
                        </h2>
                        {authStatus === 'authenticated' && eksCluster && (
                            <GlassButton variant="primary" icon={<FileText size={16} />} onClick={() => setShowAccessLogs(true)}>Access Logs</GlassButton>
                        )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <InfoCard label="VPC ID" value={vpc?.VpcId || '-'} icon={<Network size={14} />} />
                        <InfoCard label="CIDR Block" value={vpc?.CidrBlock || '-'} icon={<Network size={14} />} />
                        <InfoCard label="EKS Version" value={eksCluster?.version || '-'} icon={<Layers size={14} />} />
                        <InfoCard label="Status" value={eksCluster?.status || '-'} icon={<Shield size={14} />} />
                    </div>
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Network size={18} className="text-blue-400" />Subnets</h3>
                    <PagedTable tableId="aws-subnets" data={processedSubnets} columns={subnetColumns} />
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Server size={18} className="text-orange-400" />EC2 Instances</h3>
                    <PagedTable tableId="aws-ec2-instances" data={processedInstances} columns={ec2Columns} onRowClick={(row) => { if (!onResourceClick) return; const node = getMatchingNode(row); onResourceClick({ ...row, _matchedNode: node }, 'ec2instance'); }} />
                </section>

                <section>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Shield size={18} className="text-purple-400" />Pod Identities</h3>
                    <PagedTable tableId="aws-pod-identities" data={podIdentities} columns={podIdentityColumns} onRowClick={async (row) => { if (!onResourceClick) return; try { const sa = await window.k8s.getServiceAccount(clusterName, row.namespace, row.serviceAccount); if (sa) onResourceClick({ ...sa, name: sa.metadata?.name, namespace: sa.metadata?.namespace, type: 'serviceaccount' }, 'serviceaccount'); } catch (e) { console.warn('Failed to fetch service account:', e); } }} />
                </section>
            </div>
        </>
    );
};


const PagedTable = ({ tableId, data, columns, onRowClick }: { tableId?: string, data: any[], columns: IColumn[], onRowClick?: (row: any) => void }) => {
    const [page, setPage] = useState(1);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const pageSize = 10;

    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadColumnWidths(tableId || 'aws-table', columns));
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const maxPage = Math.ceil(data.length / pageSize) || 1;
        if (page > maxPage) setPage(1);
    }, [data.length]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) setContainerWidth(entry.contentRect.width);
        });
        observer.observe(el);
        setContainerWidth(el.clientWidth);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!resizing) return;
        const tid = tableId || 'aws-table';
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX;
            const newW = Math.max(50, resizing.startW + delta);
            setColumnWidths(prev => ({ ...prev, [resizing.key]: newW }));
        };
        const onUp = () => {
            setColumnWidths(prev => { saveColumnWidths(tid, prev); return prev; });
            setResizing(null);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [resizing, tableId]);

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
            if (current?.key === key) return current.direction === 'asc' ? { key, direction: 'desc' } : null;
            return { key, direction: 'asc' };
        });
    };

    const effectiveWidths = useMemo(() => {
        const baseTotal = Object.values(columnWidths).reduce((a, b) => a + b, 0);
        if (containerWidth <= baseTotal || containerWidth === 0) return columnWidths;
        const extraSpace = containerWidth - baseTotal;
        const totalGrow = columns.reduce((sum, col) => sum + (col.flexGrow ?? 0), 0);
        if (totalGrow === 0) return columnWidths;
        const result: Record<string, number> = {};
        for (const col of columns) {
            const base = columnWidths[col.dataKey] ?? (col.width ?? 150);
            const grow = col.flexGrow ?? 0;
            result[col.dataKey] = base + (grow > 0 ? Math.floor(extraSpace * grow / totalGrow) : 0);
        }
        return result;
    }, [columnWidths, containerWidth, columns]);

    const effectiveTotalWidth = useMemo(
        () => Object.values(effectiveWidths).reduce((a, b) => a + b, 0),
        [effectiveWidths]
    );

    const effectiveTotalWidthRef = useRef(effectiveTotalWidth);
    effectiveTotalWidthRef.current = effectiveTotalWidth;
    const dataRef = useRef(paginatedData);
    dataRef.current = paginatedData;
    const onRowClickRef = useRef(onRowClick);
    onRowClickRef.current = onRowClick;

    const virtuosoComponents = useMemo(() => ({
        Table: ({ style, ...props }: any) => (
            <table {...props} style={{ ...style, width: '100%', minWidth: effectiveTotalWidthRef.current, tableLayout: 'fixed' as const, borderCollapse: 'separate' as const, borderSpacing: 0 }} />
        ),
        TableHead: VirtuosoTableHead,
        TableRow: ({ style, ...props }: any) => {
            const index = props['data-index'] as number;
            const rowData = dataRef.current[index];
            return (
                <tr
                    {...props}
                    style={{ ...style, height: 50, cursor: onRowClickRef.current ? 'pointer' : 'default' }}
                    className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]"
                    onClick={() => rowData && onRowClickRef.current?.(rowData)}
                />
            );
        },
    }), []);

    const fixedHeaderContent = useCallback(() => (
        <tr>
            {columns.map(col => (
                <th
                    key={col.dataKey}
                    style={{ width: effectiveWidths[col.dataKey], minWidth: columnWidths[col.dataKey] }}
                    className={col.compact ? 'compact-column' : ''}
                    onClick={col.sortable ? () => handleSort(col.dataKey) : undefined}
                >
                    <div className="flex items-center gap-1 cursor-pointer select-none group w-full">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                            {col.label}
                            {col.sortable && sortConfig?.key === col.dataKey && (
                                <span className="text-xs text-blue-400">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                            )}
                        </div>
                        <div
                            className={`column-resize-handle ${resizing?.key === col.dataKey ? 'resizing' : ''}`}
                            onMouseDown={(e) => { e.stopPropagation(); setResizing({ key: col.dataKey, startX: e.clientX, startW: columnWidths[col.dataKey] }); }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </th>
            ))}
        </tr>
    ), [columns, effectiveWidths, columnWidths, sortConfig, resizing]);

    const rowContent = useCallback((index: number) => {
        const rowData = paginatedData[index];
        if (!rowData) return null;
        return (
            <>
                {columns.map(col => {
                    const cellData = rowData[col.dataKey];
                    return (
                        <td key={col.dataKey} style={{ width: effectiveWidths[col.dataKey], minWidth: columnWidths[col.dataKey] }} className={col.compact ? 'compact-column' : ''}>
                            {col.cellRenderer ? col.cellRenderer(cellData, rowData) : <span className="text-gray-300 text-sm truncate">{cellData}</span>}
                        </td>
                    );
                })}
            </>
        );
    }, [paginatedData, columns, effectiveWidths, columnWidths]);

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
                <div ref={containerRef} className="relative h-full w-full aws-table-container rounded-t-lg" style={{ overflowClipMargin: 0, overflow: 'clip' }}>
                    <style>{tableStyles}</style>
                    <TableVirtuoso
                        totalCount={paginatedData.length}
                        fixedHeaderContent={fixedHeaderContent}
                        itemContent={rowContent}
                        style={{ height: '100%' }}
                        overscan={200}
                        components={virtuosoComponents}
                    />
                </div>
            </div>
            {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 text-xs">
                    <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 bg-white/5 disabled:opacity-50 hover:bg-white/10 rounded text-white">Prev</button>
                    <span className="text-gray-400">Page {page} of {totalPages}</span>
                    <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 bg-white/5 disabled:opacity-50 hover:bg-white/10 rounded text-white">Next</button>
                </div>
            )}
        </div>
    );
};
