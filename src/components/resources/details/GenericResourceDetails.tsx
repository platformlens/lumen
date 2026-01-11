import React from 'react';
import { FileJson, Layers, Tag, List } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';
import ReactMarkdown from 'react-markdown';

interface GenericResourceDetailsProps {
    resource: any;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
    onOpenYaml?: () => void;
}

export const GenericResourceDetails: React.FC<GenericResourceDetailsProps> = ({ resource, explanation }) => {
    if (!resource) return null;

    const metadata = resource.metadata || {};
    // Extract everything else as "Spec" or "Status" for now, or just dump it safely
    // A lot of CRDs follow spec/status pattern, but not all. Be generic.
    const { metadata: _, ...others } = resource;

    return (
        <div className="space-y-6">
            {/* AI Explanation Section */}
            {explanation && (
                <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-lg p-4 mb-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500"></div>
                    <h3 className="text-blue-400 font-bold text-sm mb-2 flex items-center gap-2">
                        <span className="text-lg">✨</span> AI Explanation
                    </h3>
                    <div className="text-gray-200 leading-relaxed font-sans text-sm prose prose-invert max-w-none prose-p:my-1 prose-headings:text-blue-300 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1 prose-li:my-0">
                        <ReactMarkdown>{explanation}</ReactMarkdown>
                    </div>
                </div>
            )}

            {/* Header / Basic Info */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                            <FileJson size={20} className="text-purple-400" />
                            {metadata.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                {resource.kind}
                            </span>
                            <span className="text-xs text-gray-500">
                                Age: <TimeAgo timestamp={metadata.creationTimestamp} />
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Labels & Annotations */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Tag size={14} /> Labels
                </h3>
                <div className="flex flex-wrap gap-2 mb-6">
                    {metadata.labels ? Object.entries(metadata.labels).map(([k, v]) => (
                        <div key={k} className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded text-xs border border-blue-500/20 font-mono">
                            {k}: {String(v)}
                        </div>
                    )) : <span className="text-gray-500 italic">No labels</span>}
                </div>

                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <List size={14} /> Annotations
                </h3>
                <div className="space-y-1">
                    {metadata.annotations ? Object.entries(metadata.annotations).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-1 gap-1 border-b border-white/10 pb-2 mb-2 last:border-0">
                            <span className="text-gray-400 font-mono text-xs">{k}</span>
                            <span className="text-gray-300 break-all text-xs">{String(v)}</span>
                        </div>
                    )) : <span className="text-gray-500 italic">No annotations</span>}
                </div>
            </div>

            {/* Full Content */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Layers size={16} /> Data
                </h4>
                <div className="bg-black/50 rounded-lg p-2 overflow-auto max-h-[600px]">
                    <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap word-break-break-all">
                        {JSON.stringify(others, null, 2)}
                    </pre>
                </div>
            </div>
        </div>
    );
};
