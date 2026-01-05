import React, { useState } from 'react';
import { Calendar, Tag, Code, Shield, AlertCircle, CheckCircle, XCircle, Target } from 'lucide-react';

interface PodDisruptionBudgetDetailsProps {
    podDisruptionBudget: any;
    onExplain?: () => void;
    isExplaining?: boolean;
    explanation?: string | null;
}

export const PodDisruptionBudgetDetails: React.FC<PodDisruptionBudgetDetailsProps> = ({
    podDisruptionBudget,
    onExplain,
    isExplaining,
    explanation
}) => {
    const [showRaw, setShowRaw] = useState(false);

    if (!podDisruptionBudget || !podDisruptionBudget.metadata) {
        return (
            <div className="p-6 text-center text-gray-400">
                <p>No pod disruption budget details available</p>
            </div>
        );
    }

    const { metadata, spec, status } = podDisruptionBudget;

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
                        <span className="text-gray-400">Namespace</span>
                        <span className="col-span-2 text-white font-mono">{metadata.namespace}</span>
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
                        <span className="col-span-2 text-gray-500 font-mono text-xs">{podDisruptionBudget.apiVersion}</span>
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

            {/* Disruption Budget Configuration */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Shield className="text-blue-400" size={20} />
                    <h3 className="text-lg font-semibold text-white">Disruption Budget</h3>
                </div>

                <div className="space-y-4">
                    {/* Budget Constraints */}
                    <div className="grid grid-cols-2 gap-4">
                        {spec?.minAvailable !== undefined && (
                            <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <CheckCircle className="text-green-400" size={18} />
                                    <p className="text-sm font-medium text-white">Min Available</p>
                                </div>
                                <p className="text-2xl font-bold text-green-400">{spec.minAvailable}</p>
                                <p className="text-xs text-gray-400 mt-2">
                                    Minimum number of pods that must remain available during disruptions
                                </p>
                            </div>
                        )}

                        {spec?.maxUnavailable !== undefined && (
                            <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <XCircle className="text-orange-400" size={18} />
                                    <p className="text-sm font-medium text-white">Max Unavailable</p>
                                </div>
                                <p className="text-2xl font-bold text-orange-400">{spec.maxUnavailable}</p>
                                <p className="text-xs text-gray-400 mt-2">
                                    Maximum number of pods that can be unavailable during disruptions
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Pod Selector */}
                    {spec?.selector && (
                        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Target className="text-purple-400" size={18} />
                                <p className="text-sm font-medium text-white">Pod Selector</p>
                            </div>
                            {spec.selector.matchLabels && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {Object.entries(spec.selector.matchLabels).map(([key, value]) => (
                                        <span
                                            key={key}
                                            className="px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded text-xs text-purple-300 font-mono"
                                        >
                                            {key}: {String(value)}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Status */}
            {status && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <AlertCircle className="text-yellow-400" size={20} />
                        <h3 className="text-lg font-semibold text-white">Current Status</h3>
                    </div>

                    <div className="space-y-4">
                        {/* Pod Health Stats */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                <p className="text-xs text-gray-400 mb-1">Current Healthy</p>
                                <p className="text-xl font-bold text-green-400">{status.currentHealthy || 0}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                <p className="text-xs text-gray-400 mb-1">Desired Healthy</p>
                                <p className="text-xl font-bold text-blue-400">{status.desiredHealthy || 0}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                <p className="text-xs text-gray-400 mb-1">Expected Pods</p>
                                <p className="text-xl font-bold text-purple-400">{status.expectedPods || 0}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                <p className="text-xs text-gray-400 mb-1">Disruptions Allowed</p>
                                <p className="text-xl font-bold text-yellow-400">{status.disruptionsAllowed || 0}</p>
                            </div>
                        </div>

                        {/* Conditions */}
                        {status.conditions && status.conditions.length > 0 && (
                            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                                <p className="text-sm font-medium text-white mb-3">Conditions</p>
                                <div className="space-y-2">
                                    {status.conditions.map((condition: any, index: number) => (
                                        <div key={index} className="flex items-start gap-3 p-2 bg-black/20 rounded">
                                            <div className={`mt-0.5 ${condition.status === 'True'
                                                    ? 'text-green-400'
                                                    : condition.status === 'False'
                                                        ? 'text-red-400'
                                                        : 'text-yellow-400'
                                                }`}>
                                                {condition.status === 'True' ? (
                                                    <CheckCircle size={16} />
                                                ) : condition.status === 'False' ? (
                                                    <XCircle size={16} />
                                                ) : (
                                                    <AlertCircle size={16} />
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-white">{condition.type}</span>
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${condition.status === 'True'
                                                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                            : condition.status === 'False'
                                                                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                                                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                                        }`}>
                                                        {condition.status}
                                                    </span>
                                                </div>
                                                {condition.reason && (
                                                    <p className="text-xs text-gray-400 mt-1">
                                                        <span className="font-medium">Reason:</span> {condition.reason}
                                                    </p>
                                                )}
                                                {condition.message && (
                                                    <p className="text-xs text-gray-400 mt-1">{condition.message}</p>
                                                )}
                                                {condition.lastTransitionTime && (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Last transition: {new Date(condition.lastTransitionTime).toLocaleString()}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Raw JSON/YAML */}
            {showRaw && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Code className="text-green-400" size={20} />
                        <h3 className="text-lg font-semibold text-white">Raw Data</h3>
                    </div>
                    <pre className="bg-black/30 p-4 rounded-lg overflow-x-auto text-xs text-gray-300 font-mono">
                        {JSON.stringify(podDisruptionBudget, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
};
