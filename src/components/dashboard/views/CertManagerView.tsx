import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { TableVirtuoso } from 'react-virtuoso';
import { IColumn } from '../../shared/VirtualizedTable';
import { Shield, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { ToggleGroup } from '../../shared/ToggleGroup';
import { StatusBadge } from '../../shared/StatusBadge';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';

const tableStyles = `
  .cert-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .cert-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .cert-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .cert-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .cert-table-container th {
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
  .cert-table-container th:first-child {
    border-top-left-radius: 0;
  }
  .cert-table-container th:last-child {
    border-top-right-radius: 0;
  }
  .cert-table-container th.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .cert-table-container td {
    padding: 0.75rem 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    font-size: var(--lumen-table-font-size, 14px);
  }
  .cert-table-container td.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .cert-table-container td.no-truncate {
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

// --- Helpers ---

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

interface CertManagerViewProps {
    clusterName: string;
    searchQuery?: string;
}

// --- Reusable TableVirtuoso wrapper for this view ---

interface CertTableProps {
    tableId: string;
    columns: IColumn[];
    data: any[];
    sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
    onSort: (key: string) => void;
}

const CertTable: React.FC<CertTableProps> = React.memo(({ tableId, columns, data, sortConfig, onSort }) => {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadColumnWidths(tableId, columns));
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

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
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX;
            const newW = Math.max(50, resizing.startW + delta);
            setColumnWidths(prev => ({ ...prev, [resizing.key]: newW }));
        };
        const onUp = () => {
            setColumnWidths(prev => { saveColumnWidths(tableId, prev); return prev; });
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
    const dataRef = useRef(data);
    dataRef.current = data;

    const virtuosoComponents = useMemo(() => ({
        Table: ({ style, ...props }: any) => (
            <table {...props} style={{ ...style, width: '100%', minWidth: effectiveTotalWidthRef.current, tableLayout: 'fixed' as const, borderCollapse: 'separate' as const, borderSpacing: 0 }} />
        ),
        TableHead: VirtuosoTableHead,
        TableRow: ({ style, ...props }: any) => (
            <tr {...props} style={{ ...style, height: 52 }} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]" />
        ),
    }), []);

    const fixedHeaderContent = useCallback(() => (
        <tr>
            {columns.map(col => (
                <th
                    key={col.dataKey}
                    style={{ width: effectiveWidths[col.dataKey], minWidth: columnWidths[col.dataKey] }}
                    className={col.compact ? 'compact-column' : ''}
                    onClick={col.sortable ? () => onSort(col.dataKey) : undefined}
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
    ), [columns, effectiveWidths, columnWidths, onSort, sortConfig, resizing]);

    const rowContent = useCallback((index: number) => {
        const rowData = data[index];
        if (!rowData) return null;
        return (
            <>
                {columns.map(col => {
                    const cellData = col.dataKey.split('.').reduce((o: any, i: string) => (o ? o[i] : undefined), rowData);
                    return (
                        <td key={col.dataKey} style={{ width: effectiveWidths[col.dataKey], minWidth: columnWidths[col.dataKey] }} className={col.compact ? 'compact-column' : ''}>
                            {col.cellRenderer ? col.cellRenderer(cellData, rowData) : <span className="text-gray-300 text-sm truncate">{cellData}</span>}
                        </td>
                    );
                })}
            </>
        );
    }, [data, columns, effectiveWidths, columnWidths]);

    return (
        <div ref={containerRef} className="relative flex-1 h-full w-full min-h-[400px] cert-table-container rounded-t-xl" style={{ overflowClipMargin: 0, overflow: 'clip' }}>
            <style>{tableStyles}</style>
            <TableVirtuoso
                totalCount={data.length}
                fixedHeaderContent={fixedHeaderContent}
                itemContent={rowContent}
                style={{ height: '100%' }}
                overscan={200}
                components={virtuosoComponents}
            />
        </div>
    );
});

export const CertManagerView: React.FC<CertManagerViewProps> = ({ clusterName, searchQuery = '' }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'certificates' | 'issuers'>('overview');
    const [certificates, setCertificates] = useState<any[]>([]);
    const [issuers, setIssuers] = useState<any[]>([]);
    const [clusterIssuers, setClusterIssuers] = useState<any[]>([]);
    const [_loading, setLoading] = useState(false);

    useEffect(() => {
        loadData();
    }, [clusterName]);

    const loadData = async () => {
        setLoading(true);
        try {
            const certs = await window.k8s.listCustomObjects(clusterName, 'cert-manager.io', 'v1', 'certificates', '');
            setCertificates(certs);
            const iss = await window.k8s.listCustomObjects(clusterName, 'cert-manager.io', 'v1', 'issuers', '');
            setIssuers(iss);
            const cIss = await window.k8s.listCustomObjects(clusterName, 'cert-manager.io', 'v1', 'clusterissuers');
            setClusterIssuers(cIss);
        } catch (error) {
            console.error("Failed to load Cert Manager resources", error);
        } finally {
            setLoading(false);
        }
    };

    const stats = useMemo(() => {
        const total = certificates.length;
        let ready = 0;
        let expired = 0;
        let expiringSoon = 0;
        const now = new Date();
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;

        certificates.forEach(cert => {
            const conditions = cert.status?.conditions || [];
            const isReady = conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
            if (isReady) ready++;
            const notAfter = cert.status?.notAfter ? new Date(cert.status.notAfter) : null;
            if (notAfter) {
                if (notAfter < now) expired++;
                else if (notAfter.getTime() - now.getTime() < thirtyDays) expiringSoon++;
            }
        });
        return { total, ready, expired, expiringSoon };
    }, [certificates]);

    const expiryData = useMemo(() => {
        const data: Record<string, number> = {};
        certificates.forEach(cert => {
            if (!cert.status?.notAfter) return;
            const date = new Date(cert.status.notAfter);
            const key = date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
            data[key] = (data[key] || 0) + 1;
        });
        return Object.entries(data)
            .map(([name, count]) => ({ name, count, date: new Date(name) }))
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map(({ name, count }) => ({ name, count }));
    }, [certificates]);

    const issuerData = useMemo(() => {
        const data: Record<string, number> = {};
        certificates.forEach(cert => {
            const issuer = cert.spec?.issuerRef?.name || 'Unknown';
            data[issuer] = (data[issuer] || 0) + 1;
        });
        return Object.entries(data).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
    }, [certificates]);

    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortedData = (data: any[]) => {
        if (!sortConfig) return data;
        return [...data].sort((a, b) => {
            if (sortConfig.key === 'status') {
                const getIsReady = (item: any) => item.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True') || false;
                const aReady = getIsReady(a);
                const bReady = getIsReady(b);
                if (aReady === bReady) return 0;
                return sortConfig.direction === 'asc' ? (aReady ? 1 : -1) : (aReady ? -1 : 1);
            }
            const getValue = (obj: any, path: string) => path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);
            const aValue = getValue(a, sortConfig.key);
            const bValue = getValue(b, sortConfig.key);
            if (!aValue && !bValue) return 0;
            if (!aValue) return 1;
            if (!bValue) return -1;
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    };

    const allIssuers = useMemo(() => {
        return [
            ...clusterIssuers.map(i => ({ ...i, kind: 'ClusterIssuer', namespace: '-' })),
            ...issuers.map(i => ({ ...i, kind: 'Issuer' }))
        ];
    }, [issuers, clusterIssuers]);

    const filteredCertificates = useMemo(() => {
        if (!searchQuery) return certificates;
        const lowerQuery = searchQuery.toLowerCase();
        return certificates.filter(cert => {
            const name = cert.metadata?.name?.toLowerCase() || '';
            const namespace = cert.metadata?.namespace?.toLowerCase() || '';
            const issuer = cert.spec?.issuerRef?.name?.toLowerCase() || '';
            return name.includes(lowerQuery) || namespace.includes(lowerQuery) || issuer.includes(lowerQuery);
        });
    }, [certificates, searchQuery]);

    const filteredIssuers = useMemo(() => {
        if (!searchQuery) return allIssuers;
        const lowerQuery = searchQuery.toLowerCase();
        return allIssuers.filter(issuer => {
            const name = issuer.metadata?.name?.toLowerCase() || '';
            const namespace = issuer.metadata?.namespace?.toLowerCase() || '';
            const kind = issuer.kind?.toLowerCase() || '';
            return name.includes(lowerQuery) || namespace.includes(lowerQuery) || kind.includes(lowerQuery);
        });
    }, [allIssuers, searchQuery]);

    const sortedCertificates = useMemo(() => getSortedData(filteredCertificates), [filteredCertificates, sortConfig]);
    const sortedIssuers = useMemo(() => getSortedData(filteredIssuers), [filteredIssuers, sortConfig]);

    const certColumns: IColumn[] = [
        {
            label: 'Name', dataKey: 'metadata.name', sortable: true, flexGrow: 1, width: 200,
            cellRenderer: (_: any, cert: any) => (
                <div className="flex flex-col">
                    <span className="font-medium text-gray-200">{cert.metadata?.name}</span>
                    <span className="text-xs text-gray-500">{cert.spec?.dnsNames?.join(', ')}</span>
                </div>
            )
        },
        {
            label: 'Namespace', dataKey: 'metadata.namespace', sortable: true, width: 150,
            cellRenderer: (_: any, cert: any) => <span className="text-gray-400">{cert.metadata?.namespace}</span>
        },
        {
            label: 'Issuer', dataKey: 'spec.issuerRef.name', width: 150,
            cellRenderer: (_: any, cert: any) => (
                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">
                    {cert.spec?.issuerRef?.kind === 'ClusterIssuer' ? 'Cluster: ' : ''}{cert.spec?.issuerRef?.name}
                </span>
            )
        },
        {
            label: 'Status', dataKey: 'status', width: 100,
            cellRenderer: (_: any, cert: any) => {
                const isReady = cert.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True');
                return <StatusBadge condition={isReady} />;
            }
        },
        {
            label: 'Expiry', dataKey: 'status.notAfter', sortable: true, width: 150,
            cellRenderer: (_: any, cert: any) => {
                const date = cert.status?.notAfter;
                if (!date) return <span className="text-gray-500">-</span>;
                const d = new Date(date);
                const now = new Date();
                const daysLeft = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                let color = "text-gray-400";
                if (daysLeft < 0) color = "text-red-400 font-bold";
                else if (daysLeft < 30) color = "text-yellow-400 font-bold";
                return (
                    <div className="flex flex-col">
                        <span className={color}>{d.toLocaleDateString()}</span>
                        <span className="text-xs text-gray-600">{daysLeft} days left</span>
                    </div>
                );
            }
        }
    ];

    const issuerColumns: IColumn[] = [
        {
            label: 'Name', dataKey: 'metadata.name', sortable: true, flexGrow: 1, width: 200,
            cellRenderer: (_: any, i: any) => <span className="font-medium text-gray-200">{i.metadata?.name}</span>
        },
        {
            label: 'Kind', dataKey: 'kind', sortable: true, width: 150,
            cellRenderer: (_: any, i: any) => <span className={`text-xs px-2 py-0.5 rounded border ${i.kind === 'ClusterIssuer' ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' : 'bg-gray-700/50 border-gray-600 text-gray-300'}`}>{i.kind}</span>
        },
        {
            label: 'Namespace', dataKey: 'metadata.namespace', sortable: true, width: 150,
            cellRenderer: (_: any, i: any) => <span className="text-gray-400">{i.metadata?.namespace}</span>
        },
        {
            label: 'Ready', dataKey: 'status', width: 100,
            cellRenderer: (_: any, i: any) => {
                const isReady = i.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True');
                return <StatusBadge condition={isReady} />;
            }
        }
    ];

    const cardStyles = "bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between hover:bg-white/10 transition-colors";

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-6 pb-0 mb-6">
                <div></div>
                <ToggleGroup
                    options={[
                        { value: 'overview', label: 'Overview' },
                        { value: 'certificates', label: 'Certificates' },
                        { value: 'issuers', label: 'Issuers' }
                    ]}
                    value={activeTab}
                    onChange={(val) => setActiveTab(val as any)}
                />
            </div>

            <div className="flex-1 overflow-hidden p-6 pt-0">
                {activeTab === 'overview' && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="h-full flex flex-col gap-6 overflow-y-auto"
                    >
                        {/* Stats Row */}
                        <div className="grid grid-cols-4 gap-4 flex-none">
                            <div className={cardStyles}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Certs</span>
                                    <Shield size={16} className="text-blue-400" />
                                </div>
                                <div className="text-3xl font-bold text-white">{stats.total}</div>
                            </div>
                            <div className={cardStyles}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Healthy</span>
                                    <CheckCircle size={16} className="text-green-400" />
                                </div>
                                <div className="text-3xl font-bold text-white">{stats.ready}</div>
                            </div>
                            <div className={`${cardStyles} ${stats.expiringSoon > 0 ? 'bg-yellow-500/5 border-yellow-500/20' : ''}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className={`text-xs font-semibold uppercase tracking-wider ${stats.expiringSoon > 0 ? 'text-yellow-400' : 'text-gray-400'}`}>Expiring Soon (30d)</span>
                                    <Clock size={16} className={stats.expiringSoon > 0 ? 'text-yellow-400' : 'text-gray-400'} />
                                </div>
                                <div className={`text-3xl font-bold ${stats.expiringSoon > 0 ? 'text-yellow-400' : 'text-white'}`}>{stats.expiringSoon}</div>
                            </div>
                            <div className={`${cardStyles} ${stats.expired > 0 ? 'bg-red-500/5 border-red-500/20' : ''}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className={`text-xs font-semibold uppercase tracking-wider ${stats.expired > 0 ? 'text-red-400' : 'text-gray-400'}`}>Expired</span>
                                    <AlertTriangle size={16} className={stats.expired > 0 ? 'text-red-400' : 'text-gray-400'} />
                                </div>
                                <div className={`text-3xl font-bold ${stats.expired > 0 ? 'text-red-400' : 'text-white'}`}>{stats.expired}</div>
                            </div>
                        </div>

                        {/* Charts Row */}
                        <div className="grid grid-cols-2 gap-6 flex-none h-80">
                            <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col">
                                <h3 className="text-lg font-semibold text-white mb-4">Top Issuers</h3>
                                <div className="flex-1 w-full min-h-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={issuerData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value">
                                                {issuerData.map((_entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ec4899'][index % 5]} stroke="rgba(0,0,0,0.2)" />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }} itemStyle={{ color: '#E5E7EB' }} />
                                            <Legend verticalAlign="bottom" align="center" />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col">
                                <h3 className="text-lg font-semibold text-white mb-4">Expiry Timeline</h3>
                                <div className="flex-1 w-full min-h-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={expiryData}>
                                            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                                            <YAxis hide />
                                            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }} itemStyle={{ color: '#E5E7EB' }} />
                                            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}

                {activeTab === 'certificates' && (
                    <div className="h-full">
                        <CertTable tableId="cert-manager-certificates" columns={certColumns} data={sortedCertificates} sortConfig={sortConfig} onSort={handleSort} />
                    </div>
                )}

                {activeTab === 'issuers' && (
                    <div className="h-full">
                        <CertTable tableId="cert-manager-issuers" columns={issuerColumns} data={sortedIssuers} sortConfig={sortConfig} onSort={handleSort} />
                    </div>
                )}
            </div>
        </div>
    );
};
