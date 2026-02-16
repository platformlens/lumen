import React, { useRef, useState, useCallback } from 'react';
import { AutoSizer, Table, Column, SortDirection, SortDirectionType } from 'react-virtualized';
import 'react-virtualized/styles.css';

// Custom styles to match the original glassmorphism table design exactly.
// We use ::-webkit-scrollbar to style the scrollbars to match the app theme.
const tableStyles = `
  .ReactVirtualized__Table__headerRow {
    display: flex;
    flex-direction: row;
    align-items: center;
    background-color: rgba(255, 255, 255, 0.03); /* Subtle header background */
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: #9ca3af; /* text-gray-400 */
    text-transform: uppercase;
    font-size: 0.75rem; /* text-xs */
    font-weight: 600; /* font-semibold */
    letter-spacing: 0.05em; /* tracking-wider */
    padding-right: 0 !important;
  }

  .ReactVirtualized__Table__row {
    display: flex;
    flex-direction: row;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05); /* Separator */
    cursor: pointer;
    transition: background-color 0.1s ease;
  }

  .ReactVirtualized__Table__row:hover {
    background-color: rgba(255, 255, 255, 0.05); /* Hover effect */
  }

  .ReactVirtualized__Table__headerColumn {
    padding: 0.75rem 1.5rem; /* px-6 py-3 */
    outline: none;
    position: relative;
  }

  .ReactVirtualized__Table__rowColumn {
    padding: 0.75rem 1.5rem; /* px-6 py-3 */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    display: flex;
    align-items: center;
  }
  
  /* Column resize handle */
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
    background-color: rgba(59, 130, 246, 0.5); /* blue-500 with opacity */
  }
  
  .column-resize-handle.resizing::after {
    background-color: rgba(59, 130, 246, 0.8);
  }
  
  /* Scrollbar styling for the table container */
  .virtualized-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .virtualized-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .virtualized-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .virtualized-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
`;

export interface IColumn {
    label: string;
    dataKey: string;
    width?: number; // Used as min-width for scrolling calculation
    flexGrow?: number; // If set, column expands to fill space
    sortable?: boolean;
    cellRenderer?: (cellData: any, rowData: any) => React.ReactNode;
}

interface VirtualizedTableProps {
    data: any[];
    columns: IColumn[];
    onRowClick?: (rowData: any) => void;
    sortConfig?: { key: string; direction: 'asc' | 'desc' } | null;
    onSort?: (key: string) => void;
    rowHeight?: number;
    headerHeight?: number;
    tableId?: string; // Unique identifier for persisting column widths
}

export const VirtualizedTable: React.FC<VirtualizedTableProps> = ({
    data,
    columns,
    onRowClick,
    sortConfig,
    onSort,
    rowHeight = 52, // Slightly increased to standard comfortable touch/click size (was ~53px in HTML table with padding)
    headerHeight = 40,
    tableId
}) => {
    // Ref to the Table component to force recompute on resize
    const tableRef = useRef<Table>(null);

    // Load saved column widths from localStorage or use defaults
    const loadColumnWidths = useCallback(() => {
        const initialWidths: Record<string, number> = {};
        columns.forEach(col => {
            initialWidths[col.dataKey] = col.width || 100;
        });

        if (tableId) {
            try {
                const saved = localStorage.getItem(`table-column-widths-${tableId}`);
                if (saved) {
                    const savedWidths = JSON.parse(saved);
                    // Merge saved widths with defaults (in case new columns were added)
                    return { ...initialWidths, ...savedWidths };
                }
            } catch (e) {
                console.warn('Failed to load saved column widths:', e);
            }
        }

        return initialWidths;
    }, [columns, tableId]);

    // State to track column widths
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths);

    // Save column widths to localStorage
    const saveColumnWidths = useCallback((widths: Record<string, number>) => {
        if (tableId) {
            try {
                localStorage.setItem(`table-column-widths-${tableId}`, JSON.stringify(widths));
            } catch (e) {
                console.warn('Failed to save column widths:', e);
            }
        }
    }, [tableId]);

    // State for tracking resize operation
    const [resizing, setResizing] = useState<{ dataKey: string; startX: number; startWidth: number } | null>(null);

    // Handle resize start
    const handleResizeStart = useCallback((dataKey: string, startX: number) => {
        const currentWidth = columnWidths[dataKey] || 100;
        setResizing({ dataKey, startX, startWidth: currentWidth });
    }, [columnWidths]);

    // Handle resize move
    const handleResizeMove = useCallback((e: MouseEvent) => {
        if (!resizing) return;

        const delta = e.clientX - resizing.startX;
        const newWidth = Math.max(50, resizing.startWidth + delta); // Minimum width of 50px

        setColumnWidths(prev => ({
            ...prev,
            [resizing.dataKey]: newWidth
        }));

        // Force table to recompute
        if (tableRef.current) {
            tableRef.current.recomputeRowHeights();
        }
    }, [resizing]);

    // Handle resize end
    const handleResizeEnd = useCallback(() => {
        if (resizing) {
            // Save the final widths when resize ends
            setColumnWidths(prev => {
                saveColumnWidths(prev);
                return prev;
            });
        }
        setResizing(null);
    }, [resizing, saveColumnWidths]);

    // Set up global mouse event listeners for resize
    React.useEffect(() => {
        if (resizing) {
            document.addEventListener('mousemove', handleResizeMove);
            document.addEventListener('mouseup', handleResizeEnd);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            return () => {
                document.removeEventListener('mousemove', handleResizeMove);
                document.removeEventListener('mouseup', handleResizeEnd);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };
        }
    }, [resizing, handleResizeMove, handleResizeEnd]);

    // Calculate the total minimum width required by all columns
    const minTableWidth = Object.values(columnWidths).reduce((acc, width) => acc + width, 0);

    const headerRenderer = ({ label, dataKey, sortBy, sortDirection }: any) => {
        return (
            <div className="flex items-center gap-1 cursor-pointer select-none group w-full">
                <div className="flex items-center gap-1 flex-1 min-w-0">
                    {label}
                    {sortBy === dataKey && (
                        <span className="text-xs text-blue-400">
                            {sortDirection === SortDirection.ASC ? '▲' : '▼'}
                        </span>
                    )}
                </div>
                <div
                    className={`column-resize-handle ${resizing?.dataKey === dataKey ? 'resizing' : ''}`}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        handleResizeStart(dataKey, e.clientX);
                    }}
                    onClick={(e) => e.stopPropagation()}
                />
            </div>
        );
    };

    const _sort = ({ sortBy }: { sortBy: string, sortDirection: SortDirectionType }) => {
        if (onSort) {
            onSort(sortBy);
        }
    };

    const _rowGetter = ({ index }: { index: number }) => data[index];

    const _onRowClick = ({ rowData }: { rowData: any }) => {
        if (onRowClick) {
            onRowClick(rowData);
        }
    };

    return (
        <div className="flex-1 h-full w-full min-h-[400px] flex flex-col bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden virtualized-table-container-outer">
            <style>{tableStyles}</style>
            <div className="flex-1 virtualized-table-container overflow-x-auto overflow-y-hidden">
                <AutoSizer>
                    {({ width, height }) => {
                        // If the container width is less than the minimum required table width,
                        // use the minimum width to force horizontal scrolling.
                        // Otherwise, use the container width to allow flex columns to expand.
                        const tableWidth = Math.max(width, minTableWidth);

                        // Force table to recompute when size changes
                        if (tableRef.current) {
                            tableRef.current.recomputeRowHeights();
                        }

                        return (
                            <Table
                                ref={tableRef}
                                width={tableWidth}
                                height={height}
                                headerHeight={headerHeight}
                                rowHeight={rowHeight}
                                rowCount={data.length}
                                rowGetter={_rowGetter}
                                onRowClick={_onRowClick}
                                sort={_sort}
                                sortBy={sortConfig?.key}
                                sortDirection={sortConfig?.direction === 'asc' ? SortDirection.ASC : SortDirection.DESC}
                                className="outline-none"
                            >
                                {columns.map((col, index) => (
                                    <Column
                                        key={col.dataKey || index}
                                        label={col.label}
                                        dataKey={col.dataKey}
                                        width={columnWidths[col.dataKey] || col.width || 100}
                                        flexGrow={col.flexGrow ?? 0} // Default to 0 if not specified to respect manual widths more strictly when scrolling
                                        headerRenderer={headerRenderer}
                                        cellRenderer={({ cellData, rowData }) => {
                                            if (col.cellRenderer) {
                                                return col.cellRenderer(cellData, rowData);
                                            }
                                            return <span className="text-gray-300 text-sm truncate">{cellData}</span>;
                                        }}
                                    />
                                ))}
                            </Table>
                        );
                    }}
                </AutoSizer>
            </div>
        </div>
    );
};
