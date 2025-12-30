import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { Server, Zap, AlertCircle, CheckCircle } from 'lucide-react';
import { getNodeProviderInfo } from '../../../utils/cluster-utils';
import { TimeAgo } from '../../shared/TimeAgo';
import { StatusBadge } from '../../shared/StatusBadge';

interface NodesViewProps {
    nodes: any[];
    onRowClick?: (node: any) => void;
}

export const NodesView: React.FC<NodesViewProps> = ({ nodes, onRowClick }) => {
    // Calculate Stats
    const stats = useMemo(() => {
        let onDemand = 0;
        let spot = 0;
        let ready = 0;
        let notReady = 0;

        nodes.forEach(node => {
            const info = getNodeProviderInfo(node);
            if (info.isSpot) spot++;
            else onDemand++;

            const isReady = node.status === 'Ready'; // node.status comes from getNodes which computes it
            if (isReady) ready++;
            else notReady++;
        });

        return { onDemand, spot, ready, notReady };
    }, [nodes]);

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
            width: 140,
            cellRenderer: (_, node) => {
                const info = getNodeProviderInfo(node);
                return <span className="font-mono text-xs text-gray-400">{info.instanceType}</span>;
            }
        },
        {
            label: 'Zone',
            dataKey: 'zone',
            width: 140,
            cellRenderer: (_, node) => {
                const info = getNodeProviderInfo(node);
                return <span className="text-gray-400 text-xs">{info.zone}</span>;
            }
        },
        {
            label: 'Capacity',
            dataKey: 'capacityType',
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

            {/* Table */}
            <div className="flex-1 min-h-0">
                <VirtualizedTable
                    columns={columns}
                    data={nodes}
                    onRowClick={onRowClick}
                />
            </div>
        </motion.div>
    );
};
