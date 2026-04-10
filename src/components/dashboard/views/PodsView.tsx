import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreVertical, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { TableVirtuoso } from 'react-virtuoso';
import { TimeAgo } from '../../shared/TimeAgo';
import { PodVisualizer } from '../../resources/visualizers/PodVisualizer';
import { ErrorBoundary } from '../../shared/ErrorBoundary';
import { SkeletonLoader } from '../../shared/SkeletonLoader';
import { ConfirmModal } from '../../shared/ConfirmModal';
import type { LightweightPod } from '../../../types/pod-worker';

// Matches VirtualizedTable's styling exactly
const tableStyles = `
  .pods-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .pods-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .pods-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .pods-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .pods-table-container th {
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
  }
  .pods-table-container th:first-child {
    border-top-left-radius: 0;
  }
  .pods-table-container th:last-child {
    border-top-right-radius: 0;
  }
  .pods-table-container th.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .pods-table-container td {
    padding: 0.75rem 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    font-size: var(--lumen-table-font-size, 14px);
  }
  .pods-table-container td.no-truncate {
    overflow: visible;
    text-overflow: clip;
  }
  .pods-table-container td.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
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

interface PodColumnDef {
    key: string;
    label: string;
    defaultWidth: number;
    sortable?: boolean;
    compact?: boolean;
    flexGrow?: number;
}

const POD_COLUMNS: PodColumnDef[] = [
    { key: '_select', label: '', defaultWidth: 52, compact: true },
    { key: 'name', label: 'Name', defaultWidth: 220, sortable: true, flexGrow: 2 },
    { key: 'namespace', label: 'Namespace', defaultWidth: 150, sortable: true, flexGrow: 1 },
    { key: 'cpu', label: 'CPU', defaultWidth: 80, sortable: true },
    { key: 'memory', label: 'Memory', defaultWidth: 90, sortable: true },
    { key: 'restarts', label: 'Restarts', defaultWidth: 80, sortable: true },
    { key: 'status', label: 'Status', defaultWidth: 110, sortable: true },
    { key: 'containers', label: 'Containers', defaultWidth: 120 },
    { key: 'node', label: 'Node', defaultWidth: 240, sortable: true, flexGrow: 1 },
    { key: 'age', label: 'Age', defaultWidth: 100, sortable: true },
    { key: 'actions', label: '', defaultWidth: 60 },
];

const TABLE_ID = 'pods-virtuoso';

// Stable TableVirtuoso sub-components (defined outside render to avoid remounts)
const VirtuosoTableHead = React.forwardRef<HTMLTableSectionElement>((props, ref) => (
    <thead {...props} ref={ref} style={{ ...(props as any).style, position: 'sticky', top: 0, zIndex: 2 }} />
));

function loadColumnWidths(): Record<string, number> {
    const defaults: Record<string, number> = {};
    POD_COLUMNS.forEach(c => { defaults[c.key] = c.defaultWidth; });
    try {
        const saved = localStorage.getItem(`table-column-widths-${TABLE_ID}`);
        if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaults;
}

function saveColumnWidths(widths: Record<string, number>) {
    try {
        localStorage.setItem(`table-column-widths-${TABLE_ID}`, JSON.stringify(widths));
    } catch { /* ignore */ }
}

interface PodsViewProps {
    viewMode: 'list' | 'visual';
    pods: LightweightPod[];
    sortedPods: LightweightPod[];
    nodes: any[];
    sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
    onSort: (key: string) => void;
    onRowClick: (pod: any) => void;
    onNodeClick?: (nodeName: string) => void;
    searchQuery?: string;
    selectedNamespaces?: string[];
    isLoading?: boolean;
    isSynced?: boolean;
    error?: string | null;
    podMetrics?: Record<string, { cpu: string; memory: string }>;
    onExec?: (pod: any, containerName: string) => void;
    onOpenLogs?: (pod: any, containerName: string) => void;
    clusterName?: string;
    onDeletePods?: (pods: Array<{ namespace: string; name: string }>) => Promise<void>;
    isUpdating?: boolean;
}

const PodsViewInner: React.FC<PodsViewProps> = ({
    viewMode,
    sortedPods,
    nodes,
    sortConfig,
    onSort,
    onRowClick,
    onNodeClick,
    searchQuery = '',
    selectedNamespaces,
    isLoading = false,
    onExec,
    onOpenLogs,
    onDeletePods,
    isUpdating,
}) => {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths);
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const [activeMenuData, setActiveMenuData] = useState<{ pod: LightweightPod; containerName: string } | null>(null);
    const [selectedPods, setSelectedPods] = useState<Set<string>>(new Set());
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // Track container width via ResizeObserver (matches VirtualizedTable's AutoSizer behavior)
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        // Set initial width
        setContainerWidth(el.clientWidth);
        return () => observer.disconnect();
    }, []);

    // --- Column resize logic (matches VirtualizedTable) ---
    useEffect(() => {
        if (!resizing) return;
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX;
            const newW = Math.max(50, resizing.startW + delta);
            setColumnWidths(prev => ({ ...prev, [resizing.key]: newW }));
        };
        const onUp = () => {
            setColumnWidths(prev => { saveColumnWidths(prev); return prev; });
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
    }, [resizing]);

    // Compute effective widths: if container is wider than the sum of base widths,
    // distribute extra space proportionally via flexGrow (matches VirtualizedTable/AutoSizer)
    const effectiveWidths = useMemo(() => {
        const baseTotal = Object.values(columnWidths).reduce((a, b) => a + b, 0);
        if (containerWidth <= baseTotal || containerWidth === 0) {
            // Container is narrower or equal — use base widths, enable horizontal scroll
            return columnWidths;
        }
        const extraSpace = containerWidth - baseTotal;
        const totalGrow = POD_COLUMNS.reduce((sum, col) => sum + (col.flexGrow ?? 0), 0);
        if (totalGrow === 0) return columnWidths;

        const result: Record<string, number> = {};
        for (const col of POD_COLUMNS) {
            const base = columnWidths[col.key] ?? col.defaultWidth;
            const grow = col.flexGrow ?? 0;
            result[col.key] = base + (grow > 0 ? Math.floor(extraSpace * grow / totalGrow) : 0);
        }
        return result;
    }, [columnWidths, containerWidth]);

    const effectiveTotalWidth = useMemo(() => Object.values(effectiveWidths).reduce((a, b) => a + b, 0), [effectiveWidths]);

    // --- Filtering ---
    const filteredPods = useMemo(() => {
        let result = sortedPods;

        // Namespace filter
        if (selectedNamespaces && selectedNamespaces.length > 0 && !selectedNamespaces.includes('all')) {
            result = result.filter(pod => {
                const ns = pod.namespace ?? '';
                return selectedNamespaces.includes(ns);
            });
        }

        // Search filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(pod =>
                (pod.name ?? '').toLowerCase().includes(q) ||
                (pod.namespace ?? '').toLowerCase().includes(q) ||
                (pod.status ?? '').toLowerCase().includes(q) ||
                (pod.cpu ?? '').toLowerCase().includes(q) ||
                (pod.memory ?? '').toLowerCase().includes(q)
            );
        }

        return result;
    }, [sortedPods, searchQuery, selectedNamespaces]);

    // Refs for stable TableVirtuoso component callbacks (avoids recreating components object on every render)
    const effectiveTotalWidthRef = useRef(effectiveTotalWidth);
    effectiveTotalWidthRef.current = effectiveTotalWidth;
    const filteredPodsRef = useRef(filteredPods);
    filteredPodsRef.current = filteredPods;
    const onRowClickRef = useRef(onRowClick);
    onRowClickRef.current = onRowClick;

    const virtuosoComponents = useMemo(() => ({
        Table: ({ style, ...props }: any) => (
            <table {...props} style={{ ...style, width: '100%', minWidth: effectiveTotalWidthRef.current, tableLayout: 'fixed' as const, borderCollapse: 'separate' as const, borderSpacing: 0 }} />
        ),
        TableHead: VirtuosoTableHead,
        TableRow: ({ style, item, ...props }: any) => {
            const index = props['data-index'] as number;
            const pod = filteredPodsRef.current[index];
            return (
                <tr
                    {...props}
                    style={{ ...style, height: 52, cursor: 'pointer' }}
                    className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]"
                    onClick={() => pod && onRowClickRef.current(pod)}
                />
            );
        },
    }), []); // Stable — never recreated

    // --- Selection ---
    const getPodKey = useCallback((pod: LightweightPod) => `${pod.namespace}/${pod.name}`, []);
    const allSelected = filteredPods.length > 0 && selectedPods.size === filteredPods.length;
    const someSelected = selectedPods.size > 0 && !allSelected;

    const handleTogglePod = useCallback((podKey: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedPods(prev => {
            const next = new Set(prev);
            if (next.has(podKey)) next.delete(podKey); else next.add(podKey);
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

    // --- Cell renderers ---
    const renderCell = useCallback((col: PodColumnDef, pod: LightweightPod) => {
        const podKey = getPodKey(pod);
        const isSelected = selectedPods.has(podKey);
        const menuId = `${pod.namespace}-${pod.name}`;
        const runningContainer = pod.containers?.find(c => c.state === 'running');
        const containerName = runningContainer?.name || pod.containers?.[0]?.name;

        switch (col.key) {
            case '_select':
                return (
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {/* handled by onClick */}}
                        onClick={(e) => handleTogglePod(podKey, e)}
                        className="w-4 h-4 cursor-pointer accent-blue-500 flex-shrink-0"
                    />
                );
            case 'name':
                return <span className="font-medium text-gray-200 truncate">{pod.name}</span>;
            case 'namespace':
                return <span className="text-gray-400 truncate">{pod.namespace}</span>;
            case 'node':
                return pod.node ? (
                    <span
                        className="text-blue-400 hover:text-blue-300 cursor-pointer hover:underline truncate"
                        onClick={(e) => { e.stopPropagation(); onNodeClick?.(pod.node); }}
                        title={pod.node}
                    >{pod.node}</span>
                ) : <span className="text-gray-500">-</span>;
            case 'cpu':
                return <span className="text-gray-400 font-mono text-xs">{pod.cpu || '-'}</span>;
            case 'memory':
                return <span className="text-gray-400 font-mono text-xs">{pod.memory || '-'}</span>;
            case 'restarts':
                return <span className="text-gray-400">{pod.restarts}</span>;
            case 'status':
                return (
                    <span className={`px-2 py-0.5 rounded text-xs border ${
                        pod.status === 'Running' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                        pod.status === 'Pending' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                        pod.status === 'Succeeded' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                        pod.status === 'Failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        pod.status === 'Terminating' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                        'bg-gray-500/10 text-gray-400 border-gray-500/20'
                    }`}>{pod.status}</span>
                );
            case 'containers':
                return (
                    <div className="flex gap-1 items-center">
                        {pod.containers?.map((c, idx) => {
                            let color = 'bg-gray-500';
                            if (c.state === 'running' && c.ready) color = 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]';
                            else if (c.state === 'running' && !c.ready) color = 'bg-yellow-500';
                            else if (c.state === 'waiting') color = 'bg-yellow-500 animate-pulse';
                            else if (c.state === 'terminated' && c.restartCount > 0) color = 'bg-red-500';
                            else if (c.state === 'terminated') color = 'bg-gray-500';
                            return <div key={idx} className={`w-2 h-2 rounded-full ${color}`} title={`${c.name}: ${c.state} (Restarts: ${c.restartCount})`} />;
                        })}
                    </div>
                );
            case 'age':
                return <span className="text-gray-400"><TimeAgo timestamp={pod.age} /></span>;
            case 'actions':
                return containerName ? (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (openMenuId === menuId) {
                                setOpenMenuId(null); setMenuPosition(null); setActiveMenuData(null);
                            } else {
                                setOpenMenuId(menuId);
                                setActiveMenuData({ pod, containerName });
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setMenuPosition({ top: rect.bottom + 4, left: rect.right - 120 });
                            }
                        }}
                        className="p-1 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-gray-200"
                        title="Actions"
                    ><MoreVertical size={16} /></button>
                ) : null;
            default:
                return null;
        }
    }, [selectedPods, getPodKey, handleTogglePod, onNodeClick, openMenuId]);

    // --- Header row renderer for TableVirtuoso (matches VirtualizedTable styling) ---
    const fixedHeaderContent = useCallback(() => (
        <tr>
            {POD_COLUMNS.map(col => (
                <th
                    key={col.key}
                    style={{ width: effectiveWidths[col.key], minWidth: columnWidths[col.key] }}
                    className={col.compact ? 'compact-column' : ''}
                    onClick={col.sortable ? () => onSort(col.key) : undefined}
                >
                    {col.key === '_select' ? (
                        <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => { if (el) el.indeterminate = someSelected; }}
                            onChange={() => {}}
                            onClick={handleToggleAll}
                            className="w-4 h-4 cursor-pointer accent-blue-500 flex-shrink-0"
                        />
                    ) : (
                        <div className="flex items-center gap-1 cursor-pointer select-none group w-full">
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                                {col.label}
                                {col.sortable && sortConfig?.key === col.key && (
                                    <span className="text-xs text-blue-400">
                                        {sortConfig.direction === 'asc' ? '▲' : '▼'}
                                    </span>
                                )}
                            </div>
                            {col.key !== 'actions' && (
                                <div
                                    className={`column-resize-handle ${resizing?.key === col.key ? 'resizing' : ''}`}
                                    onMouseDown={(e) => { e.stopPropagation(); setResizing({ key: col.key, startX: e.clientX, startW: columnWidths[col.key] }); }}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            )}
                        </div>
                    )}
                </th>
            ))}
        </tr>
    ), [effectiveWidths, columnWidths, onSort, sortConfig, allSelected, someSelected, handleToggleAll, resizing]);

    // --- Row renderer for TableVirtuoso ---
    const rowContent = useCallback((index: number) => {
        const pod = filteredPods[index];
        if (!pod) return null;
        return (
            <>
                {POD_COLUMNS.map(col => (
                    <td
                        key={col.key}
                        style={{ width: effectiveWidths[col.key], minWidth: columnWidths[col.key] }}
                        className={`${col.compact ? 'compact-column' : ''}${col.key === 'actions' ? ' no-truncate' : ''}`}
                    >
                        {renderCell(col, pod)}
                    </td>
                ))}
            </>
        );
    }, [filteredPods, effectiveWidths, columnWidths, renderCell]);

    const pageVariants = { initial: { opacity: 0, y: 10 }, in: { opacity: 1, y: 0 }, out: { opacity: 0, y: -10 } };
    const pageTransition = { type: 'tween' as const, ease: 'anticipate', duration: 0.3 };

    return (
        <motion.div key="pods" initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition} className="mb-8 flex flex-col h-full">
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
                            <div ref={containerRef} className="relative flex-1 h-full w-full min-h-[400px] pods-table-container rounded-t-xl" style={{ overflowClipMargin: 0, overflow: 'clip' }}>
                                <style>{tableStyles}</style>
                                <TableVirtuoso
                                    totalCount={filteredPods.length}
                                    fixedHeaderContent={fixedHeaderContent}
                                    itemContent={rowContent}
                                    style={{ height: '100%' }}
                                    overscan={200}
                                    components={virtuosoComponents}
                                />
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <ErrorBoundary>
                    <PodVisualizer pods={filteredPods} nodes={nodes} />
                </ErrorBoundary>
            )}

            {/* Portal action menu */}
            {openMenuId && menuPosition && activeMenuData && createPortal(
                <>
                    <div className="fixed inset-0 z-[100]" onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setMenuPosition(null); setActiveMenuData(null); }} />
                    <div className="fixed bg-[#1e1e1e] border border-white/10 rounded-md shadow-xl py-1 min-w-[120px] z-[101]" style={{ top: menuPosition.top, left: menuPosition.left }}>
                        {onOpenLogs && (
                            <button onClick={(e) => { e.stopPropagation(); onOpenLogs(activeMenuData.pod, activeMenuData.containerName); setOpenMenuId(null); setMenuPosition(null); setActiveMenuData(null); }}
                                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-2">
                                <span className="text-purple-400">📋</span> View Logs
                            </button>
                        )}
                        {onExec && (
                            <button onClick={(e) => { e.stopPropagation(); onExec(activeMenuData.pod, activeMenuData.containerName); setOpenMenuId(null); setMenuPosition(null); setActiveMenuData(null); }}
                                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-2">
                                <span className="text-blue-400">💻</span> Exec Shell
                            </button>
                        )}
                    </div>
                </>, document.body
            )}

            {/* Floating delete button */}
            {createPortal(
                <AnimatePresence>
                    {selectedPods.size > 0 && onDeletePods && (
                        <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }}
                            className="fixed bottom-12 right-8 z-[50] flex items-center gap-3">
                            <button onClick={() => setSelectedPods(new Set())}
                                className="bg-white/5 backdrop-blur-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl px-3 py-2.5 shadow-2xl transition-colors flex items-center gap-2 text-sm">
                                <X size={14} /> Clear
                            </button>
                            <button onClick={() => setShowDeleteModal(true)}
                                className="bg-red-500/10 backdrop-blur-xl border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-xl px-4 py-2.5 shadow-2xl transition-colors flex items-center gap-2 text-sm font-medium">
                                <Trash2 size={14} /> Delete {selectedPods.size} pod{selectedPods.size > 1 ? 's' : ''}
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>, document.body
            )}

            {/* Delete confirmation modal */}
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
                />, document.body
            )}
        </motion.div>
    );
};

export const PodsView = React.memo(PodsViewInner);
