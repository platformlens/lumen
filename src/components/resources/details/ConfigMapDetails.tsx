import React, { useState, useMemo } from 'react';
import { Copy, Check, Search } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface ConfigMapDetailsProps {
    configMap: any;
    onExplain?: () => void;
    onOpenYaml?: () => void;
}

export const ConfigMapDetails: React.FC<ConfigMapDetailsProps> = ({ configMap, onExplain: _onExplain, onOpenYaml: _onOpenYaml }) => {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    if (!configMap) return null;

    const metadata = configMap.metadata || {};
    const data = configMap.data || {};
    const entries = Object.entries(data) as [string, string][];

    const filtered = useMemo(() => {
        if (!searchTerm) return entries;
        const lower = searchTerm.toLowerCase();
        return entries.filter(([k, v]) => k.toLowerCase().includes(lower) || String(v).toLowerCase().includes(lower));
    }, [entries, searchTerm]);

    const handleCopy = (key: string, value: string) => {
        navigator.clipboard.writeText(`${key}=${value}`);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1500);
    };

    const isMultiLine = (value: string) => String(value).includes('\n');

    return (
        <div className="space-y-6 text-sm">
            {/* Metadata */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Metadata</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Namespace</div>
                        <div className="col-span-2 text-white font-mono text-sm">{metadata.namespace}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">API Version</div>
                        <div className="col-span-2 text-white font-mono text-sm">{configMap.apiVersion}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {metadata.creationTimestamp ? <TimeAgo timestamp={metadata.creationTimestamp} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Data */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider">
                        Data ({entries.length})
                    </h3>
                    {entries.length > 0 && (
                        <div className="relative">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Filter..."
                                className="bg-black/40 border border-white/10 rounded px-2 py-0.5 pl-6 text-xs text-white w-36 focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                    )}
                </div>
                {entries.length === 0 ? (
                    <div className="bg-white/5 rounded-md p-4 border border-white/10 text-gray-500 italic">
                        No data
                    </div>
                ) : (
                    <div className="bg-black/40 rounded border border-white/10 overflow-hidden">
                        <table className="w-full text-xs font-mono">
                            <thead>
                                <tr className="border-b border-white/10">
                                    <th className="text-left text-gray-600 font-medium px-2 py-1.5 w-[40%]">Key</th>
                                    <th className="text-left text-gray-600 font-medium px-2 py-1.5">Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && (
                                    <tr><td colSpan={2} className="text-gray-600 italic py-2 px-2">No matching entries</td></tr>
                                )}
                                {filtered.map(([key, value]) => (
                                    <tr key={key} className="group border-b border-white/5 last:border-0 hover:bg-white/5">
                                        <td className="px-2 py-1 text-blue-400 align-top truncate max-w-0">{key}</td>
                                        <td className="px-2 py-1 align-top">
                                            <div className="flex items-start gap-1">
                                                <span className={`flex-1 text-green-400 ${isMultiLine(value) ? 'whitespace-pre-wrap break-all' : 'break-all'}`}>
                                                    {value || <span className="text-gray-600 italic">empty</span>}
                                                </span>
                                                <button
                                                    onClick={() => handleCopy(key, value)}
                                                    className="shrink-0 p-0.5 text-gray-700 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                                    title="Copy"
                                                >
                                                    {copiedKey === key ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Labels */}
            {metadata.labels && Object.keys(metadata.labels).length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Labels</h3>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(metadata.labels).map(([k, v]) => (
                            <span key={k} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                                {k}: {String(v)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
