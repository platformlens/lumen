import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TableVirtuoso } from 'react-virtuoso';
import { IColumn } from '../../shared/VirtualizedTable';
import { SkeletonLoader } from '../../shared/SkeletonLoader';
import { useResourceSorting } from '../../../hooks/useResourceSorting';

const tableStyles = `
  .generic-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .generic-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .generic-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .generic-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .generic-table-container th {
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
  .generic-table-container th:first-child {
    border-top-left-radius: 0;
  }
  .generic-table-container th:last-child {
    border-top-right-radius: 0;
  }
  .generic-table-container th.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .generic-table-container td {
    padding: 0.75rem 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    font-size: var(--lumen-table-font-size, 14px);
  }
  .generic-table-container td.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .generic-table-container td.no-truncate {
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

interface GenericResourceViewProps {
    title?: string;
    description?: string;
    columns: IColumn[];
    data: any[];
    onRowClick?: (item: any) => void;
    sortConfig?: { key: string; direction: 'asc' | 'desc' } | null;
    onSort?: (key: string) => void;
    viewKey?: string;
    searchQuery?: string;
    selectedNamespaces?: string[];
    isLoading?: boolean;
    isUpdating?: boolean;
}

// Stable TableVirtuoso sub-component (defined outside render to avoid remounts)
const VirtuosoTableHead = React.forwardRef<HTMLTableSectionElement>((props, ref) => (
    <thead {...props} ref={ref} style={{ ...(props as any).style, position: 'sticky', top: 0, zIndex: 2 }} />
));

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

const GenericResourceViewInner: React.FC<GenericResourceViewProps> = ({
    description,
    columns,
    data,
    onRowClick,
    sortConfig: externalSortConfig,
    onSort: externalOnSort,
    viewKey = 'resource-view',
    searchQuery = '',
    selectedNamespaces,
    isLoading = false,
    isUpdating,
}) => {
    const internalSorting = useResourceSorting();
    const sortConfig = externalSortConfig !== undefined ? externalSortConfig : internalSorting.sortConfig;
    const onSort = externalOnSort || internalSorting.handleSort;

    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadColumnWidths(viewKey, columns));
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // Track container width via ResizeObserver
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        setContainerWidth(el.clientWidth);
        return () => observer.disconnect();
    }, []);

    // Column resize logic
    useEffect(() => {
        if (!resizing) return;
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX;
            const newW = Math.max(50, resizing.startW + delta);
            setColumnWidths(prev => ({ ...prev, [resizing.key]: newW }));
        };
        const onUp = () => {
            setColumnWidths(prev => { saveColumnWidths(viewKey, prev); return prev; });
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
    }, [resizing, viewKey]);

    // Compute effective widths: distribute extra space via flexGrow
    const effectiveWidths = useMemo(() => {
        const baseTotal = Object.values(columnWidths).reduce((a, b) => a + b, 0);
        if (containerWidth <= baseTotal || containerWidth === 0) {
            return columnWidths;
        }
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

    // Filtering
    const filteredData = useMemo(() => {
        let result = data;

        // Namespace filter (skip for 'all' or when not provided)
        if (selectedNamespaces && selectedNamespaces.length > 0 && !selectedNamespaces.includes('all')) {
            result = result.filter(item => {
                const ns = item.namespace || item.metadata?.namespace;
                // Keep cluster-scoped resources (no namespace) and matching namespaced ones
                return !ns || selectedNamespaces.includes(ns);
            });
        }

        // Search filter
        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            result = result.filter(item => {
                const name = item.metadata?.name?.toLowerCase() || item.name?.toLowerCase() || '';
                const namespace = item.metadata?.namespace?.toLowerCase() || item.namespace?.toLowerCase() || '';
                return name.includes(lowerQuery) || namespace.includes(lowerQuery);
            });
        }

        return result;
    }, [data, searchQuery, selectedNamespaces]);

    // Apply internal sorting when no external sort is provided
    const sortedData = useMemo(() => {
        if (externalSortConfig !== undefined) return filteredData;
        return internalSorting.getSortedData(filteredData);
    }, [filteredData, externalSortConfig, internalSorting]);

    // Refs for stable TableVirtuoso component callbacks
    const effectiveTotalWidthRef = useRef(effectiveTotalWidth);
    effectiveTotalWidthRef.current = effectiveTotalWidth;
    const dataRef = useRef(sortedData);
    dataRef.current = sortedData;
    const onRowClickRef = useRef(onRowClick);
    onRowClickRef.current = onRowClick;

    const virtuosoComponents = useMemo(() => ({
        Table: ({ style, ...props }: any) => (
            <table
                {...props}
                style={{
                    ...style,
                    width: '100%',
                    minWidth: effectiveTotalWidthRef.current,
                    tableLayout: 'fixed' as const,
                    borderCollapse: 'separate' as const,
                    borderSpacing: 0,
                }}
            />
        ),
        TableHead: VirtuosoTableHead,
        TableRow: ({ style, item, ...props }: any) => {
            const index = props['data-index'] as number;
            const rowData = dataRef.current[index];
            return (
                <tr
                    {...props}
                    style={{ ...style, height: 52, cursor: onRowClickRef.current ? 'pointer' : 'default' }}
                    className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]"
                    onClick={() => rowData && onRowClickRef.current?.(rowData)}
                />
            );
        },
    }), []); // Stable — never recreated

    // Header row renderer
    const fixedHeaderContent = useCallback(() => (
        <tr>
            {columns.map(col => (
                <th
                    key={col.dataKey}
                    style={{ width: effectiveWidths[col.dataKey], minWidth: columnWidths[col.dataKey] }}
                    className={col.compact ? 'compact-column' : ''}
                    onClick={col.sortable ? () => onSort(col.dataKey) : undefined}
                >
                    {col.headerRenderer ? col.headerRenderer() : (
                        <div className="flex items-center gap-1 cursor-pointer select-none group w-full">
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                                {col.label}
                                {col.sortable && sortConfig?.key === col.dataKey && (
                                    <span className="text-xs text-blue-400">
                                        {sortConfig.direction === 'asc' ? '▲' : '▼'}
                                    </span>
                                )}
                            </div>
                            <div
                                className={`column-resize-handle ${resizing?.key === col.dataKey ? 'resizing' : ''}`}
                                onMouseDown={(e) => {
                                    e.stopPropagation();
                                    setResizing({ key: col.dataKey, startX: e.clientX, startW: columnWidths[col.dataKey] });
                                }}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                    )}
                </th>
            ))}
        </tr>
    ), [columns, effectiveWidths, columnWidths, onSort, sortConfig, resizing]);

    // Row content renderer
    const rowContent = useCallback((index: number) => {
        const rowData = sortedData[index];
        if (!rowData) return null;
        return (
            <>
                {columns.map(col => {
                    const cellData = rowData[col.dataKey];
                    return (
                        <td
                            key={col.dataKey}
                            style={{ width: effectiveWidths[col.dataKey], minWidth: columnWidths[col.dataKey] }}
                            className={col.compact ? 'compact-column' : ''}
                        >
                            {col.cellRenderer
                                ? col.cellRenderer(cellData, rowData)
                                : <span className="text-gray-300 text-sm truncate">{cellData}</span>
                            }
                        </td>
                    );
                })}
            </>
        );
    }, [sortedData, columns, effectiveWidths, columnWidths]);

    const pageVariants = {
        initial: { opacity: 0, y: 10 },
        in: { opacity: 1, y: 0 },
        out: { opacity: 0, y: -10 },
    };
    const pageTransition = { type: 'tween' as const, ease: 'anticipate', duration: 0.3 };

    return (
        <motion.div
            key={viewKey}
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition}
            className="mb-8 flex flex-col h-full"
        >
            {description && (
                <p className="text-sm text-gray-400 mb-4 flex-none flex items-center justify-between">
                    <span>{description}</span>
                    {isUpdating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                </p>
            )}
            <div className="flex-1 min-h-0">
                {isLoading ? (
                    <SkeletonLoader />
                ) : (
                    <div
                        ref={containerRef}
                        className="relative flex-1 h-full w-full min-h-[400px] generic-table-container rounded-t-xl"
                        style={{ overflowClipMargin: 0, overflow: 'clip' }}
                    >
                        <style>{tableStyles}</style>
                        <TableVirtuoso
                            totalCount={sortedData.length}
                            fixedHeaderContent={fixedHeaderContent}
                            itemContent={rowContent}
                            style={{ height: '100%' }}
                            overscan={200}
                            components={virtuosoComponents}
                        />
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export const GenericResourceView = React.memo(GenericResourceViewInner);
