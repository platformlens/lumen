import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { Server, Zap, AlertCircle, CheckCircle, BarChart2 } from 'lucide-react';
import { getNodeProviderInfo } from '../../../utils/cluster-utils';
import { TimeAgo } from '../../shared/TimeAgo';
import { StatusBadge } from '../../shared/StatusBadge';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell
} from 'recharts';

interface NodesViewProps {
    nodes: any[];
    onRowClick?: (node: any) => void;
    searchQuery?: string;
}

export const NodesView: React.FC<NodesViewProps> = ({ nodes, onRowClick, searchQuery = '' }) => {
    const [showStats, setShowStats] = React.useState(false);
    const [sortConfig, setSortConfig] = React.useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    // Filter Logic
    const filteredNodes = useMemo(() => {
        if (!searchQuery) return nodes;
        const lowerQuery = searchQuery.toLowerCase();
        return nodes.filter(node => {
            const name = node.metadata?.name?.toLowerCase() || '';
            const info = getNodeProviderInfo(node);
            const instanceType = info.instanceType?.toLowerCase() || '';
            const zone = info.zone?.toLowerCase() || '';

            return name.includes(lowerQuery) || instanceType.includes(lowerQuery) || zone.includes(lowerQuery);
        });
    }, [nodes, searchQuery]);

    // Sort Logic
    const sortedNodes = useMemo(() => {
        if (!sortConfig) return filteredNodes;

        const sorted = [...filteredNodes].sort((a, b) => {
            let aValue: any;
            let bValue: any;

            switch (sortConfig.key) {
                case 'name':
                    aValue = a.name || '';
                    bValue = b.name || '';
                    break;
                case 'status':
                    aValue = a.status || '';
                    bValue = b.status || '';
                    break;
                case 'age':
                    aValue = new Date(a.age).getTime();
                    bValue = new Date(b.age).getTime();
                    break;
                case 'instanceType':
                    aValue = getNodeProviderInfo(a).instanceType || '';
                    bValue = getNodeProviderInfo(b).instanceType || '';
                    break;
                case 'zone':
                    aValue = getNodeProviderInfo(a).zone || '';
                    bValue = getNodeProviderInfo(b).zone || '';
                    break;
                case 'capacityType':
                    aValue = getNodeProviderInfo(a).capacityType || '';
                    bValue = getNodeProviderInfo(b).capacityType || '';
                    break;
                default:
                    return 0;
            }

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        return sorted;
    }, [filteredNodes, sortConfig]);

    const handleSort = (key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) {
                // Toggle direction
                return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            // New column, default to ascending
            return { key, direction: 'asc' };
        });
    };

    // Calculate Stats based on FILTERED nodes
    const { stats, chartData } = useMemo(() => {
        let onDemand = 0;
        let spot = 0;
        let ready = 0;
        let notReady = 0;

        const zoneMap = new Map<string, number>();
        const typeMap = new Map<string, number>();

        sortedNodes.forEach(node => {
            const info = getNodeProviderInfo(node);
            if (info.isSpot) spot++;
            else onDemand++;

            const isReady = node.status === 'Ready';
            if (isReady) ready++;
            else notReady++;

            // Zone Aggregation
            const zone = info.zone || 'Unknown';
            zoneMap.set(zone, (zoneMap.get(zone) || 0) + 1);

            // Type Aggregation
            const type = info.instanceType || 'Unknown';
            typeMap.set(type, (typeMap.get(type) || 0) + 1);
        });

        const capacityData = [
            { name: 'On-Demand', value: onDemand },
            { name: 'Spot', value: spot }
        ];

        const zoneData = Array.from(zoneMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        const typeData = Array.from(typeMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10); // Top 10

        return {
            stats: { onDemand, spot, ready, notReady },
            chartData: { capacity: capacityData, zones: zoneData, types: typeData }
        };
    }, [sortedNodes]);

    const columns: IColumn[] = [
        {
            label: 'Name',
            dataKey: 'name',
            sortable: true,
            flexGrow: 1.5,
            width: 200,
            cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span>
        },
        {
            label: 'Status',
            dataKey: 'status',
            sortable: true,
            width: 100,
            cellRenderer: (status) => <StatusBadge condition={status === 'Ready'} />
        },
        {
            label: 'Instance Type',
            dataKey: 'instanceType',
            sortable: true,
            width: 140,
            cellRenderer: (_, node) => {
                const info = getNodeProviderInfo(node);
                return <span className="font-mono text-xs text-gray-400">{info.instanceType}</span>;
            }
        },
        {
            label: 'Zone',
            dataKey: 'zone',
            sortable: true,
            width: 140,
            cellRenderer: (_, node) => {
                const info = getNodeProviderInfo(node);
                return <span className="text-gray-400 text-xs">{info.zone}</span>;
            }
        },
        {
            label: 'Capacity',
            dataKey: 'capacityType',
            sortable: true,
            width: 120,
            cellRenderer: (_, node) => {
                const info = getNodeProviderInfo(node);
                return (
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${info.isSpot
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        }`}>
                        {info.capacityType}
                    </span>
                );
            }
        },
        {
            label: 'Age',
            dataKey: 'age',
            sortable: true,
            width: 100,
            cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span>
        }
    ];

    const cardStyles = "bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between hover:bg-white/10 transition-colors";

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col h-full overflow-hidden"
        >
            <div className="flex items-center justify-between mb-4 flex-none">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowStats(!showStats)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${showStats
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                            }`}
                    >
                        <BarChart2 size={14} />
                        {showStats ? 'Hide Stats' : 'Show Stats'}
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6 flex-none">
                <div className={cardStyles}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">On-Demand</span>
                        <Server size={16} className="text-blue-400" />
                    </div>
                    <div className="text-2xl font-bold text-white">{stats.onDemand}</div>
                </div>
                <div className={cardStyles}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Spot</span>
                        <Zap size={16} className="text-purple-400" />
                    </div>
                    <div className="text-2xl font-bold text-white">{stats.spot}</div>
                </div>
                <div className={cardStyles}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ready</span>
                        <CheckCircle size={16} className="text-green-400" />
                    </div>
                    <div className="text-2xl font-bold text-white">{stats.ready}</div>
                </div>
                {stats.notReady > 0 && (
                    <div className={`${cardStyles} border-red-500/20 bg-red-500/5`}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Not Ready</span>
                            <AlertCircle size={16} className="text-red-500" />
                        </div>
                        <div className="text-2xl font-bold text-white">{stats.notReady}</div>
                    </div>
                )}
                {stats.notReady === 0 && (
                    <div className={cardStyles}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Not Ready</span>
                            <AlertCircle size={16} className="text-gray-600" />
                        </div>
                        <div className="text-2xl font-bold text-gray-500">0</div>
                    </div>
                )}
            </div>

            {/* Expanded Stats View */}
            {showStats && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="grid grid-cols-3 gap-4 mb-6 flex-none"
                >
                    {/* Capacity Distribution */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col h-64">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Capacity Distribution</h4>
                        <div className="flex-1 w-full min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={chartData.capacity}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={40}
                                        outerRadius={70}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {chartData.capacity.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.name === 'Spot' ? '#a855f7' : '#3b82f6'} stroke="rgba(0,0,0,0.2)" />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }}
                                        itemStyle={{ color: '#E5E7EB' }}
                                    />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Zone Distribution */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col h-64">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Zone Distribution</h4>
                        <div className="flex-1 w-full min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData.zones} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }}
                                        itemStyle={{ color: '#E5E7EB' }}
                                    />
                                    <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Instance Types */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col h-64">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Instance Types</h4>
                        <div className="flex-1 w-full min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData.types} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} />
                                    <YAxis hide />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }}
                                        itemStyle={{ color: '#E5E7EB' }}
                                    />
                                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* Table */}
            <div className="flex-1 min-h-0">
                <VirtualizedTable
                    columns={columns}
                    data={sortedNodes}
                    onRowClick={onRowClick}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    tableId="nodes-view"
                />
            </div>
        </motion.div>
    );
};
