import React, { useMemo, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreVertical, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { TimeAgo } from '../../shared/TimeAgo';
import { PodVisualizer } from '../../resources/visualizers/PodVisualizer';
import { ErrorBoundary } from '../../shared/ErrorBoundary';
import { SkeletonLoader } from '../../shared/SkeletonLoader';
import { ConfirmModal } from '../../shared/ConfirmModal';

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
    onExec?: (pod: any, containerName: string) => void;
    onOpenLogs?: (pod: any, containerName: string) => void;
    clusterName?: string;
    onDeletePods?: (pods: Array<{ namespace: string; name: string }>) => Promise<void>;
    isUpdating?: boolean;
}

const PodsViewInner: React.FC<PodsViewProps> = ({
    viewMode,
    // pods,
    sortedPods,
    nodes,
    sortConfig,
    onSort,
    onRowClick,
    searchQuery = '',
    isLoading = false,
    podMetrics: _podMetrics = {},
    onExec,
    onOpenLogs,
    clusterName: _clusterName,
    onDeletePods,
    isUpdating
}) => {
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [activeMenuData, setActiveMenuData] = useState<{ pod: any; containerName: string } | null>(null);
    const [selectedPods, setSelectedPods] = useState<Set<string>>(new Set());
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Component for the actions cell button
    const ActionsCell: React.FC<{
        pod: any;
        containerName: string;
        menuId: string;
        isOpen: boolean;
        onToggle: (buttonRef: HTMLButtonElement) => void;
    }> = ({ onToggle }) => {
        const buttonRef = useRef<HTMLButtonElement>(null);

        return (
            <button
                ref={buttonRef}
                onClick={(e) => {
                    e.stopPropagation();
                    if (buttonRef.current) {
                        onToggle(buttonRef.current);
                    }
                }}
                className="p-1 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-gray-200"
                title="Actions"
            >
                <MoreVertical size={16} />
            </button>
        );
    };

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
            const name = pod.metadata?.name?.toLowerCase() || pod.name?.toLowerCase() || '';
            const namespace = pod.metadata?.namespace?.toLowerCase() || pod.namespace?.toLowerCase() || '';
            const status = pod.status?.toLowerCase() || '';
            const cpu = pod.cpu?.toLowerCase() || '';
            const memory = pod.memory?.toLowerCase() || '';
            return name.includes(lowerQuery) || namespace.includes(lowerQuery) || status.includes(lowerQuery) || cpu.includes(lowerQuery) || memory.includes(lowerQuery);
        });
    }, [sortedPods, searchQuery]);

    const getPodKey = useCallback((pod: any) => `${pod.namespace}/${pod.name}`, []);

    const handleTogglePod = useCallback((podKey: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedPods(prev => {
            const next = new Set(prev);
            if (next.has(podKey)) next.delete(podKey);
            else next.add(podKey);
            return next;
        });
    }, []);

    const handleToggleAll = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedPods(prev => {
            if (prev.size === filteredPods.length && filteredPods.length > 0) return new Set();
            return new Set(filteredPods.map(getPodKey));
        });
    }, [filteredPods, getPodKey]);

    const handleDeleteSelected = useCallback(async () => {
        if (!onDeletePods) return;
        setIsDeleting(true);
        try {
            const podsToDelete = Array.from(selectedPods).map(key => {
                const [namespace, name] = key.split('/');
                return { namespace, name };
            });
            await onDeletePods(podsToDelete);
            setSelectedPods(new Set());
        } catch (err) {
            console.error('Failed to delete pods:', err);
        } finally {
            setIsDeleting(false);
        }
    }, [selectedPods, onDeletePods]);

    const columns: IColumn[] = useMemo(() => [
        {
            label: '',
            dataKey: '_select',
            width: 52,
            flexGrow: 0,
            compact: true,
            headerRenderer: () => {
                const allSelected = filteredPods.length > 0 && selectedPods.size === filteredPods.length;
                const someSelected = selectedPods.size > 0 && !allSelected;
                return (
                    <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={() => {/* handled by onClick */ }}
                        onClick={handleToggleAll}
                        className="w-4 h-4 cursor-pointer accent-blue-500 flex-shrink-0"
                    />
                );
            },
            cellRenderer: (_: any, rowData: any) => {
                const podKey = getPodKey(rowData);
                const isSelected = selectedPods.has(podKey);
                return (
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {/* handled by onClick */ }}
                        onClick={(e) => handleTogglePod(podKey, e as any)}
                        className="w-4 h-4 cursor-pointer accent-blue-500 flex-shrink-0"
                    />
                );
            }
        },
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
            sortable: true,
            width: 80,
            flexGrow: 0,
            cellRenderer: (cpu: any) => {
                return <span className="text-gray-400 font-mono text-xs">{cpu || '-'}</span>;
            }
        },
        {
            label: 'Memory',
            dataKey: 'memory',
            sortable: true,
            width: 90,
            flexGrow: 0,
            cellRenderer: (memory: any) => {
                return <span className="text-gray-400 font-mono text-xs">{memory || '-'}</span>;
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
                                status === 'Terminating' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
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
        },
        {
            label: 'Actions',
            dataKey: 'actions',
            width: 60,
            flexGrow: 0,
            cellRenderer: (_: any, rowData: any) => {
                const pod = sortedPods.find(p => p.name === rowData.name && p.namespace === rowData.namespace);
                if (!pod) return null;

                // Get first running container
                const runningContainer = rowData.containers?.find((c: any) => c.state === 'running');
                const containerName = runningContainer?.name || rowData.containers?.[0]?.name;

                if (!containerName) return null;

                const menuId = `${rowData.namespace}-${rowData.name}`;
                const isOpen = openMenuId === menuId;

                return (
                    <ActionsCell
                        pod={pod}
                        containerName={containerName}
                        menuId={menuId}
                        isOpen={isOpen}
                        onToggle={(buttonRef) => {
                            if (isOpen) {
                                setOpenMenuId(null);
                                setMenuPosition(null);
                                setActiveMenuData(null);
                            } else {
                                setOpenMenuId(menuId);
                                setActiveMenuData({ pod, containerName });
                                const rect = buttonRef.getBoundingClientRect();
                                setMenuPosition({
                                    top: rect.bottom + 4,
                                    left: rect.right - 120
                                });
                            }
                        }}
                    />
                );
            }
        }
    ], [onExec, onOpenLogs, sortedPods, openMenuId, selectedPods, filteredPods, handleToggleAll, handleTogglePod, getPodKey]);

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
                    <p className="text-sm text-gray-400 mb-4 flex-none flex items-center justify-between">
                        <span>The smallest deployable units of computing that you can create and manage.</span>
                        {isUpdating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
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
                                tableId="pods-view"
                                isUpdating={isUpdating}
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

            {/* Portal menu */}
            {openMenuId && menuPosition && activeMenuData && createPortal(
                <>
                    {/* Backdrop to close menu */}
                    <div
                        className="fixed inset-0 z-[100]"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setMenuPosition(null);
                            setActiveMenuData(null);
                        }}
                    />

                    {/* Dropdown menu */}
                    <div
                        className="fixed bg-[#1e1e1e] border border-white/10 rounded-md shadow-xl py-1 min-w-[120px] z-[101]"
                        style={{
                            top: `${menuPosition.top}px`,
                            left: `${menuPosition.left}px`
                        }}
                    >
                        {onOpenLogs && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenLogs(activeMenuData.pod, activeMenuData.containerName);
                                    setOpenMenuId(null);
                                    setMenuPosition(null);
                                    setActiveMenuData(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-2"
                            >
                                <span className="text-purple-400">📋</span>
                                View Logs
                            </button>
                        )}
                        {onExec && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onExec(activeMenuData.pod, activeMenuData.containerName);
                                    setOpenMenuId(null);
                                    setMenuPosition(null);
                                    setActiveMenuData(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-2"
                            >
                                <span className="text-blue-400">💻</span>
                                Exec Shell
                            </button>
                        )}
                    </div>
                </>,
                document.body
            )}

            {/* Floating Delete Button - portaled to body to escape transform containing block */}
            {createPortal(
                <AnimatePresence>
                    {selectedPods.size > 0 && onDeletePods && (
                        <motion.div
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 20, scale: 0.95 }}
                            className="fixed bottom-12 right-8 z-[50] flex items-center gap-3"
                        >
                            <button
                                onClick={() => setSelectedPods(new Set())}
                                className="bg-white/5 backdrop-blur-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl px-3 py-2.5 shadow-2xl transition-colors flex items-center gap-2 text-sm"
                            >
                                <X size={14} />
                                Clear
                            </button>
                            <button
                                onClick={() => setShowDeleteModal(true)}
                                className="bg-red-500/10 backdrop-blur-xl border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-xl px-4 py-2.5 shadow-2xl transition-colors flex items-center gap-2 text-sm font-medium"
                            >
                                <Trash2 size={14} />
                                Delete {selectedPods.size} pod{selectedPods.size > 1 ? 's' : ''}
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}

            {/* Delete Confirmation Modal - portaled to body to escape transform containing block */}
            {createPortal(
                <ConfirmModal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    onConfirm={handleDeleteSelected}
                    title="Delete Pods"
                    message={`Are you sure you want to delete ${selectedPods.size} pod${selectedPods.size > 1 ? 's' : ''}? This action cannot be undone. Pods managed by a controller (Deployment, ReplicaSet, etc.) will be recreated automatically.`}
                    confirmText={`Delete ${selectedPods.size} pod${selectedPods.size > 1 ? 's' : ''}`}
                    variant="danger"
                    isLoading={isDeleting}
                />,
                document.body
            )}
        </motion.div>
    );
};

export const PodsView = React.memo(PodsViewInner);
