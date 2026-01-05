import React, { useState } from 'react';
import { Calendar, Tag, Code, Star, Shield, AlertCircle } from 'lucide-react';

interface PriorityClassDetailsProps {
    priorityClass: any;
    onExplain?: () => void;
    isExplaining?: boolean;
    explanation?: string | null;
}

export const PriorityClassDetails: React.FC<PriorityClassDetailsProps> = ({
    priorityClass,
    onExplain,
    isExplaining,
    explanation
}) => {
    const [showRaw, setShowRaw] = useState(false);

    if (!priorityClass || !priorityClass.metadata) {
        return (
            <div className="p-6 text-center text-gray-400">
                <p>No priority class details available</p>
            </div>
        );
    }

    const { metadata, value, description, preemptionPolicy, globalDefault } = priorityClass;

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
                        <p className="whitespace-pre-wrap">{explanation}</p>
                    </div>
                </div>
            )}

            {/* Metadata Section */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider">Metadata</h3>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowRaw(!showRaw)}
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border ${showRaw
                                    ? 'bg-green-600/80 hover:bg-green-500 text-white border-transparent'
                                    : 'bg-gradient-to-r from-green-600/80 to-emerald-600/80 hover:from-green-500 hover:to-emerald-500 text-white border-transparent'
                                } hover:shadow-lg hover:scale-105 active:scale-95`}
                        >
                            <Code size={10} /> {showRaw ? 'Hide' : 'Show'} Raw
                        </button>
                        {onExplain && (
                            <button
                                onClick={onExplain}
                                disabled={isExplaining}
                                className={`
                                    flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider
                                    transition-all duration-300 border
                                    ${isExplaining
                                        ? 'bg-purple-500/10 border-purple-500/20 text-purple-400 cursor-wait'
                                        : 'bg-gradient-to-r from-blue-600/80 to-purple-600/80 hover:from-blue-500 hover:to-purple-500 text-white border-transparent hover:shadow-lg hover:scale-105 active:scale-95'
                                    }
                                `}
                            >
                                {isExplaining ? (
                                    <>
                                        <div className="w-2 h-2 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Analyzing...
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xs">✨</span> Explain
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Name</span>
                        <span className="col-span-2 text-white font-mono">{metadata.name}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">UID</span>
                        <span className="col-span-2 text-gray-500 font-mono text-xs">{metadata.uid}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Created</span>
                        <span className="col-span-2 text-white">{new Date(metadata.creationTimestamp).toLocaleString()}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">API Version</span>
                        <span className="col-span-2 text-gray-500 font-mono text-xs">{priorityClass.apiVersion}</span>
                    </div>
                </div>

                {/* Labels */}
                {metadata.labels && Object.keys(metadata.labels).length > 0 && (
                    <div className="mt-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Tag className="text-blue-400" size={16} />
                            <p className="text-sm text-gray-400">Labels</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(metadata.labels).map(([key, value]) => (
                                <span
                                    key={key}
                                    className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono"
                                >
                                    {key}: {String(value)}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Annotations */}
                {metadata.annotations && Object.keys(metadata.annotations).length > 0 && (
                    <div className="mt-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Calendar className="text-blue-400" size={16} />
                            <p className="text-sm text-gray-400">Annotations</p>
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                            {Object.entries(metadata.annotations).map(([key, value]) => (
                                <div key={key} className="text-xs">
                                    <span className="text-gray-400">{key}:</span>
                                    <span className="text-gray-300 ml-2">{String(value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Priority Class Configuration */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Star className="text-yellow-400" size={20} />
                    <h3 className="text-lg font-semibold text-white">Priority Configuration</h3>
                </div>

                <div className="space-y-4">
                    {/* Priority Value */}
                    <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 mb-1">Priority Value</p>
                                <p className="text-2xl font-bold text-yellow-400">{value?.toLocaleString() || 'N/A'}</p>
                            </div>
                            <Star className="text-yellow-400" size={32} />
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                            Higher values indicate higher priority. Pods with higher priority are scheduled before lower priority pods.
                        </p>
                    </div>

                    {/* Preemption Policy */}
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Shield className="text-blue-400" size={18} />
                            <p className="text-sm font-medium text-white">Preemption Policy</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${preemptionPolicy === 'PreemptLowerPriority'
                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                    : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                }`}>
                                {preemptionPolicy || 'PreemptLowerPriority'}
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                            {preemptionPolicy === 'PreemptLowerPriority'
                                ? 'Pods of this priority class can preempt lower-priority pods.'
                                : preemptionPolicy === 'Never'
                                    ? 'Pods of this priority class will never cause preemption.'
                                    : 'Defines whether pods can preempt lower-priority pods.'}
                        </p>
                    </div>

                    {/* Global Default */}
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="text-purple-400" size={18} />
                            <p className="text-sm font-medium text-white">Global Default</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${globalDefault
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                }`}>
                                {globalDefault ? 'Yes' : 'No'}
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                            {globalDefault
                                ? 'This priority class is used for pods that do not specify a priority class.'
                                : 'Pods must explicitly reference this priority class to use it.'}
                        </p>
                    </div>

                    {/* Description */}
                    {description && (
                        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                            <p className="text-sm font-medium text-white mb-2">Description</p>
                            <p className="text-sm text-gray-300 leading-relaxed">{description}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Raw JSON/YAML */}
            {showRaw && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Code className="text-green-400" size={20} />
                        <h3 className="text-lg font-semibold text-white">Raw Data</h3>
                    </div>
                    <pre className="bg-black/30 p-4 rounded-lg overflow-x-auto text-xs text-gray-300 font-mono">
                        {JSON.stringify(priorityClass, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
};
