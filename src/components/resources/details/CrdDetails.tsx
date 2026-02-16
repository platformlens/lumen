import React from 'react';
import { FileJson, Layers, Clock, Shield, Sparkles } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';
import ReactMarkdown from 'react-markdown';

interface CrdDetailsProps {
    crd: any;
    explanation?: string | null;
    onOpenYaml?: () => void;
}

export const CrdDetails: React.FC<CrdDetailsProps> = ({ crd, explanation }) => {
    if (!crd) return null;

    if (crd.error) {
        return (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                <h3 className="font-bold flex items-center gap-2 mb-2">
                    <Shield size={18} />
                    Failed to load CRD
                </h3>
                <p className="text-sm">{crd.error}</p>
            </div>
        );
    }

    const metadata = crd.metadata || {};
    const spec = crd.spec || {};
    const scope = spec.scope || 'Namespaced';
    const versions = spec.versions || [];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                            <FileJson size={20} className="text-purple-400" />
                            {metadata.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                {spec.group}
                            </span>
                            <span className="text-xs text-gray-500">
                                Age: <TimeAgo timestamp={metadata.creationTimestamp} />
                            </span>
                        </div>
                    </div>
                </div>
                {explanation && (
                    <div className="mt-4 p-4 rounded-lg bg-purple-500/10 border border-purple-500/20 animate-in fade-in slide-in-from-top-2 duration-300">
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-purple-300 mb-2">
                            <Sparkles size={14} />
                            AI Explanation
                        </h4>
                        <div className="prose prose-invert prose-sm max-w-none text-gray-300">
                            <ReactMarkdown>{explanation}</ReactMarkdown>
                        </div>
                    </div>
                )}
            </div>

            {/* General Info */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Layers size={16} /> details
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <span className="block text-gray-500 text-xs">Group</span>
                        <span className="text-gray-300 font-mono">{spec.group}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Kind</span>
                        <span className="text-gray-300">{spec.names.kind}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Scope</span>
                        <span className="text-gray-300">{scope}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">List Kind</span>
                        <span className="text-gray-300">{spec.names.listKind}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Plural</span>
                        <span className="text-gray-300">{spec.names.plural}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Singular</span>
                        <span className="text-gray-300">{spec.names.singular}</span>
                    </div>
                </div>
            </div>

            {/* Versions */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Clock size={16} /> Stored Versions
                </h4>
                <div className="mt-2 space-y-2">
                    {versions.map((v: any) => (
                        <div key={v.name} className="flex items-center justify-between p-2 rounded bg-black/20 border border-white/5">
                            <span className="text-sm font-medium text-gray-200">{v.name}</span>
                            <div className="flex gap-2 text-xs">
                                {v.served && <span className="text-green-400">Served</span>}
                                {v.storage && <span className="text-blue-400">Storage</span>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* JSON Definition */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <FileJson size={16} /> Full Definition
                </h4>
                <div className="bg-black/50 rounded-lg p-2 overflow-auto max-h-[400px]">
                    <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap word-break-break-all">
                        {JSON.stringify(crd, null, 2)}
                    </pre>
                </div>
            </div>
        </div>
    );
};
