import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { Shield, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { ToggleGroup } from '../../shared/ToggleGroup';
import { StatusBadge } from '../../shared/StatusBadge';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';

interface CertManagerViewProps {
    clusterName: string;
    searchQuery?: string;
}

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
            // Fetch Certificates
            const certs = await window.k8s.listCustomObjects(
                clusterName,
                'cert-manager.io',
                'v1',
                'certificates',
                '' // All namespaces
            );
            setCertificates(certs);

            // Fetch Issuers
            const iss = await window.k8s.listCustomObjects(
                clusterName,
                'cert-manager.io',
                'v1',
                'issuers',
                ''
            );
            setIssuers(iss);

            // Fetch ClusterIssuers
            const cIss = await window.k8s.listCustomObjects(
                clusterName,
                'cert-manager.io',
                'v1',
                'clusterissuers'
            );
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
        // Group by expiry month/year
        const data: Record<string, number> = {};
        certificates.forEach(cert => {
            if (!cert.status?.notAfter) return;
            const date = new Date(cert.status.notAfter);
            const key = date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
            data[key] = (data[key] || 0) + 1;
        });
        return Object.entries(data)
            .map(([name, count]) => ({ name, count, date: new Date(name) })) // Create a date object for sorting
            .sort((a, b) => a.date.getTime() - b.date.getTime()) // Sort by time
            .map(({ name, count }) => ({ name, count })); // cleanup
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
                // true > false, so if asc, false comes first? tailored behavior:
                // usually we want strict boolean comparison.
                return sortConfig.direction === 'asc' ? (aReady === bReady ? 0 : aReady ? 1 : -1) : (aReady === bReady ? 0 : aReady ? -1 : 1);
            }

            const getValue = (obj: any, path: string) => {
                return path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);
            };

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

    // Combine Issuers and ClusterIssuers for list
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
            label: 'Name',
            dataKey: 'metadata.name',
            sortable: true,
            flexGrow: 1,
            width: 200,
            cellRenderer: (_, cert) => (
                <div className="flex flex-col">
                    <span className="font-medium text-gray-200">{cert.metadata?.name}</span>
                    <span className="text-xs text-gray-500">{cert.spec?.dnsNames?.join(', ')}</span>
                </div>
            )
        },
        {
            label: 'Namespace',
            dataKey: 'metadata.namespace',
            sortable: true,
            width: 150,
            cellRenderer: (_, cert) => <span className="text-gray-400">{cert.metadata?.namespace}</span>
        },
        {
            label: 'Issuer',
            dataKey: 'spec.issuerRef.name',
            width: 150,
            cellRenderer: (_, cert) => (
                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">
                    {cert.spec?.issuerRef?.kind === 'ClusterIssuer' ? 'Cluster: ' : ''}{cert.spec?.issuerRef?.name}
                </span>
            )
        },
        {
            label: 'Status',
            dataKey: 'status', // Sorting by status object might be weird, but kept for ID. Custom sort logic might be needed if strictly sorting by "Ready" is desired.
            width: 100,
            cellRenderer: (_, cert) => {
                const isReady = cert.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True');
                return <StatusBadge condition={isReady} />;
            }
        },
        {
            label: 'Expiry',
            dataKey: 'status.notAfter',
            sortable: true,
            width: 150,
            cellRenderer: (_, cert) => {
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
            label: 'Name',
            dataKey: 'metadata.name',
            sortable: true,
            flexGrow: 1,
            width: 200,
            cellRenderer: (_, i) => <span className="font-medium text-gray-200">{i.metadata?.name}</span>
        },
        {
            label: 'Kind',
            dataKey: 'kind',
            sortable: true,
            width: 150,
            cellRenderer: (_, i) => <span className={`text-xs px-2 py-0.5 rounded border ${i.kind === 'ClusterIssuer' ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' : 'bg-gray-700/50 border-gray-600 text-gray-300'}`}>{i.kind}</span>
        },
        {
            label: 'Namespace',
            dataKey: 'metadata.namespace',
            sortable: true,
            width: 150,
            cellRenderer: (_, i) => <span className="text-gray-400">{i.metadata?.namespace}</span>
        },
        {
            label: 'Ready',
            dataKey: 'status',
            width: 100,
            cellRenderer: (_, i) => {
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
                <div>
                    {/* Title removed as requested */}
                </div>
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
                                            <Pie
                                                data={issuerData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={50}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                            >
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
                        <VirtualizedTable
                            columns={certColumns}
                            data={sortedCertificates}
                            sortConfig={sortConfig}
                            onSort={handleSort}
                        />
                    </div>
                )}

                {activeTab === 'issuers' && (
                    <div className="h-full">
                        <VirtualizedTable
                            columns={issuerColumns}
                            data={sortedIssuers}
                            sortConfig={sortConfig}
                            onSort={handleSort}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
