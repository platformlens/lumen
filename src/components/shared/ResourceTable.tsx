import { ArrowUp, ArrowDown } from 'lucide-react';

export const ResourceTable = ({ headers, data, renderRow, onRowClick, sortConfig, onSort }: any) => {
    if (data.length === 0) {
        return <div className="p-8 text-center text-gray-400 bg-white/5 rounded-xl border border-white/10 italic">No resources found.</div>
    }

    // Normalize headers to objects if they are strings (backward compatibility)
    const normalizedHeaders = headers.map((h: any) => 
        typeof h === 'string' ? { label: h } : h
    );

    return (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-md shadow-lg">
            <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-white/5 border-b border-white/10">
                <tr>
                {normalizedHeaders.map((h: any, idx: number) => (
                    <th 
                        key={idx} 
                        className={`px-6 py-4 font-semibold text-gray-300 uppercase tracking-wider text-xs ${h.sortable ? 'cursor-pointer hover:text-white select-none' : ''}`}
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
            <tbody className="divide-y divide-white/5">
                {data.map((item: any) => (
                    <tr 
                        key={`${item.namespace}-${item.name}`} 
                        className={`group hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 ${onRowClick ? 'cursor-pointer active:bg-white/10' : ''}`}
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
