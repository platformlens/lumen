import React from 'react';
import { Tag, List, Activity, Clock, Shield } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';
import ReactMarkdown from 'react-markdown';

interface NamespaceDetailsProps {
    namespace: any;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
    onOpenYaml?: () => void;
}

export const NamespaceDetails: React.FC<NamespaceDetailsProps> = ({ namespace, explanation }) => {
    if (!namespace) return null;

    const { status, statusObj, metadata, age } = namespace;
    // Use metadata from namespace object if available, otherwise fallback
    const labels = metadata?.labels || {};
    const annotations = metadata?.annotations || {};
    const creationTimestamp = age || metadata?.creationTimestamp;
    const phase = status || statusObj?.phase;

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

            {/* Status & Age Cards */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <div className="text-gray-400 text-xs uppercase font-bold tracking-wider mb-1 flex items-center gap-1.5">
                        <Activity size={14} /> Status
                    </div>
                    <div className={`text-lg font-medium ${phase === 'Active' ? 'text-green-400' : 'text-gray-200'}`}>
                        {phase || 'Unknown'}
                    </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <div className="text-gray-400 text-xs uppercase font-bold tracking-wider mb-1 flex items-center gap-1.5">
                        <Clock size={14} /> Age
                    </div>
                    <div className="text-lg font-medium text-gray-200">
                        <TimeAgo timestamp={creationTimestamp} />
                    </div>
                </div>
            </div>

            {/* Labels */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Tag size={14} /> Labels
                </h3>
                <div className="flex flex-wrap gap-2">
                    {Object.keys(labels).length > 0 ? Object.entries(labels).map(([k, v]) => (
                        <div key={k} className="bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded text-xs border border-blue-500/20 font-mono">
                            <span className="opacity-70">{k}:</span> <span className="font-semibold">{String(v)}</span>
                        </div>
                    )) : <span className="text-gray-500 italic text-sm">No labels</span>}
                </div>
            </div>

            {/* Annotations */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <List size={14} /> Annotations
                </h3>
                <div className="bg-white/5 rounded-lg border border-white/10 divide-y divide-white/5">
                    {Object.keys(annotations).length > 0 ? Object.entries(annotations).map(([k, v]) => (
                        <div key={k} className="p-3 grid grid-cols-1 gap-1">
                            <span className="text-gray-400 font-mono text-xs select-all text-purple-300/80">{k}</span>
                            <span className="text-gray-300 break-all text-xs font-mono select-all">{String(v)}</span>
                        </div>
                    )) : <div className="p-3 text-gray-500 italic text-sm">No annotations</div>}
                </div>
            </div>

            {/* Finalizers */}
            {namespace.spec?.finalizers && namespace.spec.finalizers.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Shield size={14} /> Finalizers
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {namespace.spec.finalizers.map((f: string) => (
                            <div key={f} className="bg-purple-500/10 text-purple-400 px-2.5 py-1 rounded text-xs border border-purple-500/20 font-mono font-medium">
                                {f}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Spec / Other Details (excluding finalizers if that's all there is) */}
            {namespace.spec && (() => {
                const { finalizers, ...restSpec } = namespace.spec;
                if (Object.keys(restSpec).length === 0) return null;
                return (
                    <div>
                        <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Spec</h3>
                        <div className="bg-black/30 rounded-lg p-3 border border-white/10 font-mono text-xs text-gray-300">
                            <pre className="whitespace-pre-wrap">{JSON.stringify(restSpec, null, 2)}</pre>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
