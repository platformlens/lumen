import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Box, Activity, Tag, List, Edit, History, GitCompare, ChevronDown, ChevronUp, Clock, Image as ImageIcon } from 'lucide-react';
import { ResourceTopology } from '../visualizers/ResourceTopology';
import { ContainerResources } from './ContainerResources';
import { RevisionDiffModal } from './RevisionDiffModal';
import { motion, AnimatePresence } from 'framer-motion';

interface DeploymentDetailsProps {
    deployment: any;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
    onShowTopology?: () => void;
    onOpenYaml?: () => void;
    clusterName?: string;
}

export const DeploymentDetails: React.FC<DeploymentDetailsProps> = ({ deployment, explanation, onExplain, isExplaining, onShowTopology, onOpenYaml, clusterName }) => {
    const [showTopology, setShowTopology] = useState(false);
    const [revisions, setRevisions] = useState<any[]>([]);
    const [revisionsLoading, setRevisionsLoading] = useState(false);
    const [revisionsExpanded, setRevisionsExpanded] = useState(false);
    const [selectedRevisions, setSelectedRevisions] = useState<Set<string>>(new Set());
    const [diffModalOpen, setDiffModalOpen] = useState(false);
    const [diffPair, setDiffPair] = useState<{ left: any; right: any } | null>(null);

    const loadRevisions = useCallback(async () => {
        if (!clusterName || !deployment?.metadata?.namespace || !deployment?.metadata?.name) return;
        setRevisionsLoading(true);
        try {
            const result = await (window as any).k8s.getDeploymentRevisions(
                clusterName,
                deployment.metadata.namespace,
                deployment.metadata.name
            );
            setRevisions(result || []);
        } catch (err) {
            console.error('Failed to load revisions:', err);
            setRevisions([]);
        } finally {
            setRevisionsLoading(false);
        }
    }, [clusterName, deployment?.metadata?.namespace, deployment?.metadata?.name]);

    useEffect(() => {
        if (revisionsExpanded && revisions.length === 0 && !revisionsLoading) {
            loadRevisions();
        }
    }, [revisionsExpanded, revisions.length, revisionsLoading, loadRevisions]);

    if (!deployment) return null;

    const { metadata, spec, status } = deployment;

    const toggleRevisionSelection = (revisionId: string) => {
        setSelectedRevisions(prev => {
            const next = new Set(prev);
            if (next.has(revisionId)) {
                next.delete(revisionId);
            } else {
                if (next.size >= 2) {
                    // Replace the oldest selection
                    const first = next.values().next().value;
                    if (first !== undefined) next.delete(first);
                }
                next.add(revisionId);
            }
            return next;
        });
    };

    const handleCompare = () => {
        const selected = Array.from(selectedRevisions);
        if (selected.length !== 2) return;

        const left = revisions.find(r => r.name === selected[0]);
        const right = revisions.find(r => r.name === selected[1]);
        if (!left || !right) return;

        // Ensure older revision is on the left
        const leftRev = parseInt(left.revision, 10);
        const rightRev = parseInt(right.revision, 10);

        if (leftRev > rightRev) {
            setDiffPair({ left: right, right: left });
        } else {
            setDiffPair({ left, right });
        }
        setDiffModalOpen(true);
    };

    const timeAgo = (timestamp: string) => {
        const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

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
                        {onOpenYaml && (
                            <button
                                onClick={onOpenYaml}
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border bg-gradient-to-r from-green-600/80 to-emerald-600/80 hover:from-green-500 hover:to-emerald-500 text-white border-transparent hover:shadow-lg hover:scale-105 active:scale-95"
                            >
                                <Edit size={12} /> Edit YAML
                            </button>
                        )}
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
                    <ResourceTopology clusterName={clusterName} resource={deployment} />
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
                    <Activity size={14} /> Spec
                </h3>
                <div className="bg-white/5 rounded-md overflow-hidden border border-white/10">
                    {/* Replicas */}
                    <div className="p-3 border-b border-white/10 flex justify-between">
                        <span className="text-gray-400">Replicas</span>
                        <span className="text-white">{status.availableReplicas || 0} / {spec.replicas}</span>
                    </div>

                    {/* Selector */}
                    <div className="p-3 border-b border-white/10">
                        <span className="text-gray-400 block mb-1">Selector</span>
                        <div className="flex flex-wrap gap-1">
                            {spec.selector?.matchLabels && Object.entries(spec.selector.matchLabels).map(([k, v]) => (
                                <span key={k} className="bg-white/10 text-gray-300 px-1.5 py-0.5 rounded text-xs font-mono">{k}={String(v)}</span>
                            ))}
                        </div>
                    </div>

                    {/* Strategy */}
                    <div className="p-3">
                        <span className="text-gray-400 block mb-1">Strategy</span>
                        <span className="text-white bg-white/10 px-2 py-0.5 rounded text-xs">{spec.strategy?.type}</span>
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
                        {spec.template.spec?.containers.map((c: any) => (
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

            {/* Revision History */}
            <div>
                <button
                    onClick={() => setRevisionsExpanded(!revisionsExpanded)}
                    className="w-full flex items-center justify-between group"
                >
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider flex items-center gap-2">
                        <History size={14} /> Revision History
                    </h3>
                    <div className="flex items-center gap-2">
                        {revisions.length > 0 && (
                            <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white">
                                {revisions.length}
                            </span>
                        )}
                        {revisionsExpanded ? (
                            <ChevronUp size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                        ) : (
                            <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                        )}
                    </div>
                </button>

                <AnimatePresence>
                    {revisionsExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            <div className="mt-3 space-y-2">
                                {/* Compare button */}
                                {selectedRevisions.size === 2 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="flex justify-end"
                                    >
                                        <button
                                            onClick={handleCompare}
                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 transition-all hover:shadow-lg hover:shadow-blue-900/20"
                                        >
                                            <GitCompare size={14} />
                                            Compare Selected
                                        </button>
                                    </motion.div>
                                )}

                                {revisionsLoading ? (
                                    <div className="flex items-center justify-center py-8">
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                    </div>
                                ) : revisions.length === 0 ? (
                                    <div className="text-gray-500 text-xs italic py-4 text-center">
                                        No revisions found
                                    </div>
                                ) : (
                                    <div className="space-y-1.5">
                                        {revisions.map((rev, index) => {
                                            const isSelected = selectedRevisions.has(rev.name);
                                            const isCurrent = index === 0;

                                            return (
                                                <motion.div
                                                    key={rev.name}
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: index * 0.03 }}
                                                    onClick={() => toggleRevisionSelection(rev.name)}
                                                    className={`
                                                        relative rounded-lg p-3 cursor-pointer transition-all border
                                                        ${isSelected
                                                            ? 'bg-blue-500/10 border-blue-500/30 shadow-lg shadow-blue-900/10'
                                                            : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                                                        }
                                                    `}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            {/* Selection indicator */}
                                                            <div className={`
                                                                w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all
                                                                ${isSelected
                                                                    ? 'border-blue-400 bg-blue-500/30'
                                                                    : 'border-white/20 bg-transparent'
                                                                }
                                                            `}>
                                                                {isSelected && (
                                                                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                                                                )}
                                                            </div>

                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-white font-mono text-sm font-medium">
                                                                        Rev {rev.revision}
                                                                    </span>
                                                                    {isCurrent && (
                                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-green-500/20 text-green-400 border border-green-500/20">
                                                                            Current
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-3 mt-1">
                                                                    <span className="flex items-center gap-1 text-xs text-gray-500">
                                                                        <Clock size={10} />
                                                                        {timeAgo(rev.creationTimestamp)}
                                                                    </span>
                                                                    <span className="text-xs text-gray-600">
                                                                        {new Date(rev.creationTimestamp).toLocaleDateString()}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-3">
                                                            {/* Replica count */}
                                                            <div className="text-right">
                                                                <div className="text-xs text-gray-400">
                                                                    {rev.readyReplicas ?? 0}/{rev.replicas ?? 0} pods
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Images */}
                                                    {rev.images && rev.images.length > 0 && (
                                                        <div className="mt-2 ml-7 flex flex-wrap gap-1">
                                                            {rev.images.map((img: string, i: number) => (
                                                                <span
                                                                    key={i}
                                                                    className="flex items-center gap-1 text-[11px] font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded border border-white/5 truncate max-w-[300px]"
                                                                    title={img}
                                                                >
                                                                    <ImageIcon size={10} className="text-gray-500 flex-shrink-0" />
                                                                    {img}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </motion.div>
                                            );
                                        })}
                                    </div>
                                )}

                                {selectedRevisions.size === 1 && (
                                    <p className="text-xs text-gray-500 text-center py-1">
                                        Select one more revision to compare
                                    </p>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Revision Diff Modal */}
            {diffPair && (
                <RevisionDiffModal
                    isOpen={diffModalOpen}
                    onClose={() => {
                        setDiffModalOpen(false);
                        setDiffPair(null);
                    }}
                    leftRevision={diffPair.left}
                    rightRevision={diffPair.right}
                />
            )}
        </div>
    );
};
