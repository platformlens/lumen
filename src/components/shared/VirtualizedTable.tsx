import React, { useRef } from 'react';
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
}

export const VirtualizedTable: React.FC<VirtualizedTableProps> = ({
    data,
    columns,
    onRowClick,
    sortConfig,
    onSort,
    rowHeight = 52, // Slightly increased to standard comfortable touch/click size (was ~53px in HTML table with padding)
    headerHeight = 40
}) => {
    // Ref to the Table component to force recompute on resize
    const tableRef = useRef<Table>(null);

    // Calculate the total minimum width required by all columns
    const minTableWidth = columns.reduce((acc, col) => acc + (col.width || 100), 0);

    const headerRenderer = ({ label, dataKey, sortBy, sortDirection }: any) => {
        return (
            <div className="flex items-center gap-1 cursor-pointer select-none group">
                {label}
                {/* Always show sort icon placeholder or active icon to prevent layout jump? 
                    Actually, just showing it when active or on hover is nice. 
                    Let's stick to showing when active for now. */}
                {sortBy === dataKey && (
                    <span className="text-xs text-blue-400">
                        {sortDirection === SortDirection.ASC ? '▲' : '▼'}
                    </span>
                )}
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
                                        width={col.width || 100}
                                        flexGrow={col.flexGrow ?? 0} // Default to 0 if not specified to respect manual widths more strictly when scrolling
                                        headerRenderer={col.sortable ? headerRenderer : undefined}
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
