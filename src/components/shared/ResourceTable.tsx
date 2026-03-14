import { ArrowUp, ArrowDown } from 'lucide-react';

export const ResourceTable = ({ headers, data, renderRow, onRowClick, sortConfig, onSort }: any) => {
    if (data.length === 0) {
        return <div className="p-8 text-center text-gray-500 italic text-sm">No resources found.</div>
    }

    // Normalize headers to objects if they are strings (backward compatibility)
    const normalizedHeaders = headers.map((h: any) =>
        typeof h === 'string' ? { label: h } : h
    );

    return (
        <div className="overflow-hidden">
            <table className="w-full text-left border-collapse" style={{ fontSize: 'var(--lumen-table-font-size, 14px)' }}>
                <thead className="border-b border-white/5">
                    <tr>
                        {normalizedHeaders.map((h: any, idx: number) => (
                            <th
                                key={idx}
                                className={`px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-[11px] ${h.sortable ? 'cursor-pointer hover:text-gray-300 select-none' : ''}`}
                                onClick={() => h.sortable && onSort && onSort(h.key)}
                            >
                                <div className="flex items-center gap-2">
                                    {h.label}
                                    {h.sortable && sortConfig?.key === h.key && (
                                        sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                                    )}
                                </div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                    {data.map((item: any) => (
                        <tr
                            key={`${item.namespace}-${item.name}`}
                            className={`group hover:bg-white/[0.03] transition-colors ${onRowClick ? 'cursor-pointer active:bg-white/5' : ''}`}
                            onClick={() => onRowClick && onRowClick(item)}
                        >
                            {renderRow(item)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
