import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { TimeAgo } from '../../shared/TimeAgo';
import { PodVisualizer } from '../../resources/visualizers/PodVisualizer';
import { ErrorBoundary } from '../../shared/ErrorBoundary';
import { SkeletonLoader } from '../../shared/SkeletonLoader';

interface PodsViewProps {
    viewMode: 'list' | 'visual';
    pods: any[];
    sortedPods: any[];
    nodes: any[];
    sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
    onSort: (key: string) => void;
    onRowClick: (pod: any) => void;
    searchQuery?: string;
    isLoading?: boolean;
    podMetrics?: Record<string, { cpu: string; memory: string }>;
}

export const PodsView: React.FC<PodsViewProps> = ({
    viewMode,
    // pods,
    sortedPods,
    nodes,
    sortConfig,
    onSort,
    onRowClick,
    searchQuery = '',
    isLoading = false,
    podMetrics = {}
}) => {
    const pageVariants = {
        initial: { opacity: 0, y: 10 },
        in: { opacity: 1, y: 0 },
        out: { opacity: 0, y: -10 }
    };

    const pageTransition = {
        type: "tween",
        ease: "anticipate",
        duration: 0.3
    };

    const filteredPods = useMemo(() => {
        if (!searchQuery) return sortedPods;
        const lowerQuery = searchQuery.toLowerCase();
        return sortedPods.filter(pod => {
            const name = pod.metadata?.name?.toLowerCase() || '';
            const namespace = pod.metadata?.namespace?.toLowerCase() || '';
            const status = pod.status?.toLowerCase() || '';
            return name.includes(lowerQuery) || namespace.includes(lowerQuery) || status.includes(lowerQuery);
        });
    }, [sortedPods, searchQuery]);

    const columns: IColumn[] = useMemo(() => [
        {
            label: 'Name',
            dataKey: 'name',
            sortable: true,
            flexGrow: 2,
            cellRenderer: (name: any) => <span className="font-medium text-gray-200">{name}</span>
        },
        {
            label: 'Namespace',
            dataKey: 'namespace',
            sortable: true,
            flexGrow: 1,
            cellRenderer: (ns: any) => <span className="text-gray-400">{ns}</span>
        },
        {
            label: 'CPU',
            dataKey: 'cpu',
            width: 80,
            flexGrow: 0,
            cellRenderer: (_: any, rowData: any) => {
                const key = `${rowData.namespace}/${rowData.name}`;
                const metrics = podMetrics[key];
                return <span className="text-gray-400 font-mono text-xs">{metrics?.cpu || '-'}</span>;
            }
        },
        {
            label: 'Memory',
            dataKey: 'memory',
            width: 90,
            flexGrow: 0,
            cellRenderer: (_: any, rowData: any) => {
                const key = `${rowData.namespace}/${rowData.name}`;
                const metrics = podMetrics[key];
                return <span className="text-gray-400 font-mono text-xs">{metrics?.memory || '-'}</span>;
            }
        },
        {
            label: 'Restarts',
            dataKey: 'restarts',
            sortable: true,
            width: 80,
            flexGrow: 0,
            cellRenderer: (restarts: any) => <span className="text-gray-400">{restarts}</span>
        },
        {
            label: 'Status',
            dataKey: 'status',
            sortable: true,
            width: 100,
            flexGrow: 0,
            cellRenderer: (status: any) => (
                <span className={`px-2 py-0.5 rounded text-xs border ${status === 'Running' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                    status === 'Pending' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                        status === 'Succeeded' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                            status === 'Failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                'bg-gray-500/10 text-gray-400 border-gray-500/20'
                    }`}>
                    {status}
                </span>
            )
        },
        {
            label: 'Containers',
            dataKey: 'containers',
            width: 120,
            flexGrow: 0,
            cellRenderer: (containers: any) => (
                <div className="flex gap-1 items-center">
                    {containers?.map((c: any, idx: number) => {
                        let color = 'bg-gray-500';
                        if (c.state === 'running' && c.ready) color = 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]';
                        else if (c.state === 'running' && !c.ready) color = 'bg-yellow-500';
                        else if (c.state === 'waiting') color = 'bg-yellow-500 animate-pulse';
                        else if (c.state === 'terminated' && c.restartCount > 0) color = 'bg-red-500';
                        else if (c.state === 'terminated') color = 'bg-gray-500';

                        return (
                            <div
                                key={idx}
                                className={`w-2 h-2 rounded-full ${color}`}
                                title={`${c.name}: ${c.state} (Restarts: ${c.restartCount})`}
                            />
                        );
                    })}
                </div>
            )
        },
        {
            label: 'Age',
            dataKey: 'age',
            sortable: true,
            width: 100,
            flexGrow: 0,
            cellRenderer: (age: any) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span>
        }
    ], [podMetrics]);

    return (
        <motion.div
            key="pods"
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition as any}
            className="mb-8 flex flex-col h-full"
        >
            {viewMode === 'list' ? (
                <>
                    <p className="text-sm text-gray-400 mb-4 flex-none">
                        The smallest deployable units of computing that you can create and manage.
                    </p>
                    <div className="flex-1 min-h-0">
                        {isLoading ? (
                            <SkeletonLoader />
                        ) : (
                            <VirtualizedTable
                                data={filteredPods}
                                columns={columns}
                                sortConfig={sortConfig}
                                onSort={onSort}
                                onRowClick={onRowClick}
                            />
                        )}
                    </div>
                </>
            ) : (
                <ErrorBoundary>
                    <PodVisualizer
                        pods={filteredPods}
                        nodes={nodes}
                    />
                </ErrorBoundary>
            )}
        </motion.div>
    );
};
