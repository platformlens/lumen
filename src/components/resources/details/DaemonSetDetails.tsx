import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Box, Activity, Tag, List } from 'lucide-react';
import { ResourceTopology } from '../visualizers/ResourceTopology';
import { ContainerResources } from './ContainerResources';

interface DaemonSetDetailsProps {
    daemonSet: any;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
    onShowTopology?: () => void;
    onOpenYaml?: () => void;
    clusterName?: string;
}

export const DaemonSetDetails: React.FC<DaemonSetDetailsProps> = ({ daemonSet, explanation, onExplain, isExplaining, onShowTopology, clusterName }) => {
    const [showTopology, setShowTopology] = useState(false);
    if (!daemonSet) return null;

    const { metadata, spec, status } = daemonSet;

    return (
        <div className="space-y-8 text-sm">
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

            {/* Metadata Section */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider">Metadata</h3>
                    <div className="flex items-center gap-2">
                        {onShowTopology && (
                            <button
                                onClick={() => setShowTopology(!showTopology)}
                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border ${showTopology
                                    ? 'bg-pink-600/80 hover:bg-pink-500 text-white border-transparent'
                                    : 'bg-gradient-to-r from-purple-600/80 to-pink-600/80 hover:from-purple-500 hover:to-pink-500 text-white border-transparent'
                                    } hover:shadow-lg hover:scale-105 active:scale-95`}
                            >
                                <span className="text-xs">{showTopology ? '✖️' : '🔗'}</span> {showTopology ? 'Hide' : 'Display'} Topology
                            </button>
                        )}
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
                        <span className="text-gray-400">Created</span>
                        <span className="col-span-2 text-white">{new Date(metadata.creationTimestamp).toLocaleString()}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">UID</span>
                        <span className="col-span-2 text-gray-500 font-mono text-xs">{metadata.uid}</span>
                    </div>
                </div>
            </div>


            {/* Inline Topology View */}
            {showTopology && clusterName && (
                <div className="border border-purple-500/30 rounded-lg overflow-hidden bg-black/20">
                    <ResourceTopology clusterName={clusterName} resource={daemonSet} />
                </div>
            )}


            {/* Inline Topology View */}
            {showTopology && clusterName && (
                <div className="border border-purple-500/30 rounded-lg overflow-hidden bg-black/20">
                    <ResourceTopology clusterName={clusterName} resource={daemonSet} />
                </div>
            )}

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
                            <span className="text-gray-300 break-all">{String(v)}</span>
                        </div>
                    )) : <span className="text-gray-500 italic">No annotations</span>}
                </div>
            </div>

            {/* Spec */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Activity size={14} /> Status
                </h3>
                <div className="bg-white/5 rounded-md overflow-hidden border border-white/10">
                    <div className="p-3 border-b border-white/10 flex justify-between">
                        <span className="text-gray-400">Desired</span>
                        <span className="text-white">{status.desiredNumberScheduled}</span>
                    </div>
                    <div className="p-3 border-b border-white/10 flex justify-between">
                        <span className="text-gray-400">Current</span>
                        <span className="text-white">{status.currentNumberScheduled}</span>
                    </div>
                    <div className="p-3 border-b border-white/10 flex justify-between">
                        <span className="text-gray-400">Ready</span>
                        <span className="text-white">{status.numberReady}</span>
                    </div>
                    <div className="p-3 border-b border-white/10 flex justify-between">
                        <span className="text-gray-400">Available</span>
                        <span className="text-white">{status.numberAvailable}</span>
                    </div>
                    <div className="p-3">
                        <span className="text-gray-400 block mb-1">Update Strategy</span>
                        <span className="text-white bg-white/10 px-2 py-0.5 rounded text-xs">{spec.updateStrategy?.type}</span>
                    </div>
                </div>
            </div>

            {/* Pod Template */}
            {spec.template && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Box size={14} /> Pod Template
                    </h3>
                    <div className="space-y-4">
                        {spec.template.spec?.containers?.map((c: any) => (
                            <div key={c.name} className="bg-white/5 border border-white/10 rounded-md p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                    <span className="font-bold text-white">{c.name}</span>
                                    <span className="text-gray-500 text-xs bg-white/10 px-2 py-0.5 rounded">{c.image}</span>
                                </div>

                                {/* Env Vars */}
                                {c.env && (
                                    <div className="mb-3">
                                        <span className="text-gray-500 text-xs uppercase font-bold block mb-2">Environment</span>
                                        <div className="grid grid-cols-1 gap-1">
                                            {c.env.map((e: any) => (
                                                <div key={e.name} className="flex gap-2 text-xs font-mono">
                                                    <span className="text-blue-400">{e.name}</span>
                                                    <span className="text-gray-400">=</span>
                                                    <span className="text-green-400 truncate">{e.value || "fromRef..."}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Mounted Volumes */}
                                {c.volumeMounts && (
                                    <div>
                                        <span className="text-gray-500 text-xs uppercase font-bold block mb-2">Volume Mounts</span>
                                        <div className="space-y-1">
                                            {c.volumeMounts.map((vm: any) => (
                                                <div key={vm.name} className="flex items-center gap-2 text-xs bg-white/5 px-2 py-1 rounded">
                                                    <span className="text-gray-300">{vm.mountPath}</span>
                                                    <span className="text-gray-500">({vm.name})</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <ContainerResources container={c} />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
