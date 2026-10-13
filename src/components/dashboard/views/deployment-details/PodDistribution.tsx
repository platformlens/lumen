import React, { useCallback, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Info, RotateCcw, ScrollText, Server, XCircle } from 'lucide-react';
import type { DeploymentPodSummary, NodeSummary, SectionResult } from '../../../../types/deployment-details';
import type { DistributionRisk, NodeGroup } from '../../../../utils/pod-distribution-utils';
import type { DistributionData } from './useDeploymentDerivedData';
import { SectionNote, SectionShell } from './SectionShell';
import {
    FOCUS_RING, STATUS_BANNER_CLASSES, STATUS_CLASSES, STATUS_DOT_CLASSES, podStatusColor, type StatusColor,
} from './status-classes';

interface PodDistributionProps {
    namespace: string;
    /** Section is driven by the pods read; `distribution` is derived from it. */
    pods: SectionResult<DeploymentPodSummary[]>;
    nodes: SectionResult<NodeSummary[]>;
    distribution: DistributionData;
    onOpenNode: (name: string) => void;
    onOpenPod: (name: string) => void;
    onOpenPodLogs?: (pod: DeploymentPodSummary) => void;
    canOpenLogs: (pod: DeploymentPodSummary) => boolean;
}

const RISK_COLOR: Record<DistributionRisk['level'], StatusColor> = { fail: 'red', warn: 'yellow', info: 'blue' };
const RISK_ICON: Record<DistributionRisk['level'], typeof Info> = { fail: XCircle, warn: AlertTriangle, info: Info };

const ShareBar: React.FC<{ value: number; total: number; label: string }> = ({ value, total, label }) => {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden" role="meter" aria-label={label}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
    );
};

interface PodDotProps {
    pod: DeploymentPodSummary;
    isActive: boolean;
    onActivate: (name: string | null) => void;
    onOpenPod: (name: string) => void;
    onOpenPodLogs?: (pod: DeploymentPodSummary) => void;
    canOpenLogs: boolean;
}

/** Pod dot button (opens the pod drawer) with a hover/focus card carrying a Logs action. */
const PodDot: React.FC<PodDotProps> = ({ pod, isActive, onActivate, onOpenPod, onOpenPodLogs, canOpenLogs }) => {
    const reduceMotion = useReducedMotion();
    const color = podStatusColor(pod);
    const ready = `${pod.readyContainers}/${pod.totalContainers}`;
    return (
        <div
            className="relative"
            onMouseEnter={() => onActivate(pod.name)}
            onMouseLeave={() => onActivate(null)}
            onFocus={() => onActivate(pod.name)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onActivate(null); }}
        >
            <button
                type="button"
                onClick={() => onOpenPod(pod.name)}
                aria-label={`Pod ${pod.name}: ${pod.displayStatus}, ready ${ready}`}
                className={`block w-3.5 h-3.5 rounded-full ${STATUS_DOT_CLASSES[color]} hover:ring-2 hover:ring-white/40 ${FOCUS_RING}`}
            />
            <AnimatePresence>
                {isActive && (
                    <motion.div
                        initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.12 }}
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 w-64 bg-[#1e1e1e] border border-white/10 rounded-lg shadow-xl p-3 text-xs"
                    >
                        <div className="font-mono text-white break-all">{pod.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-gray-400">
                            <span className={`px-1.5 py-0.5 rounded ${STATUS_CLASSES[color]}`}>{pod.displayStatus}</span>
                            <span>Ready {ready}</span>
                            <span>Restarts {pod.restarts}</span>
                        </div>
                        {pod.podIP && <div className="mt-1 font-mono text-gray-400">{pod.podIP}</div>}
                        <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => onOpenPod(pod.name)}
                                className={`px-2 py-1 rounded-md bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 ${FOCUS_RING}`}>
                                Details
                            </button>
                            {onOpenPodLogs && canOpenLogs && (
                                <button type="button" onClick={() => onOpenPodLogs(pod)} aria-label={`Open logs for ${pod.name}`}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600/20 border border-blue-500/20 text-blue-400 hover:bg-blue-600/30 ${FOCUS_RING}`}>
                                    <ScrollText size={12} aria-hidden="true" /> Logs
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

interface NodeCardProps {
    group: NodeGroup;
    maxPods: number;
    onOpenNode: (name: string) => void;
    onOpenPod: (name: string) => void;
    onOpenPodLogs?: (pod: DeploymentPodSummary) => void;
    canOpenLogs: (pod: DeploymentPodSummary) => boolean;
}

const NodeCard: React.FC<NodeCardProps> = ({ group, maxPods, onOpenNode, onOpenPod, onOpenPodLogs, canOpenLogs }) => {
    const [activePod, setActivePod] = useState<string | null>(null);
    const { node } = group;
    const meta = [node?.instanceType, node?.capacityType, node?.nodePool].filter((v): v is string => !!v);
    return (
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2 hover:border-white/20 transition-colors">
            <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => onOpenNode(group.nodeName)} aria-label={`Open node ${group.nodeName}`}
                    className={`flex items-center gap-1.5 min-w-0 font-mono text-xs text-blue-400 hover:underline text-left break-all rounded ${FOCUS_RING}`}>
                    <Server size={12} className="shrink-0" aria-hidden="true" />
                    {group.nodeName}
                </button>
                {node && (
                    <div className="flex gap-1 shrink-0">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLASSES[node.ready ? 'green' : 'red']}`}>
                            {node.ready ? 'Ready' : 'NotReady'}
                        </span>
                        {node.unschedulable && <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLASSES.yellow}`}>Cordoned</span>}
                    </div>
                )}
            </div>
            {meta.length > 0 && <div className="text-[11px] text-gray-400 truncate" title={meta.join(' · ')}>{meta.join(' · ')}</div>}
            <div className="flex items-center gap-2">
                <div className="flex-1"><ShareBar value={group.pods.length} total={maxPods} label={`Pods on ${group.nodeName}`} /></div>
                <span className="text-xs text-gray-300">{group.pods.length} pod{group.pods.length === 1 ? '' : 's'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {group.pods.map(p => (
                    <PodDot key={p.uid || p.name} pod={p} isActive={activePod === p.name} onActivate={setActivePod}
                        onOpenPod={onOpenPod} onOpenPodLogs={onOpenPodLogs} canOpenLogs={canOpenLogs(p)} />
                ))}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-gray-400">
                <span>Ready {group.readyPods}/{group.pods.length}</span>
                <span className={`inline-flex items-center gap-1 ${group.restarts > 0 ? 'text-yellow-400' : ''}`}>
                    <RotateCcw size={11} aria-hidden="true" /> {group.restarts} restart{group.restarts === 1 ? '' : 's'}
                </span>
            </div>
        </div>
    );
};

function nodesNote(nodes: SectionResult<NodeSummary[]>): string | null {
    if (nodes.status === 'forbidden') return 'Node details unavailable: missing permission to read nodes (cluster-scoped). Pods are grouped by node name only.';
    if (nodes.status === 'error') return `Node details unavailable: ${nodes.message}. Pods are grouped by node name only.`;
    return nodes.note ?? null;
}

const PodDistributionInner: React.FC<PodDistributionProps> = ({
    namespace, pods, nodes, distribution, onOpenNode, onOpenPod, onOpenPodLogs, canOpenLogs,
}) => {
    const { zones, unscheduled, risks, totalPods } = distribution;
    const hasSingleNode = risks.some(r => r.id === 'single-node');
    const shownRisks = hasSingleNode ? risks.filter(r => r.id !== 'node-concentration') : risks;
    const maxPods = zones.reduce((m, z) => Math.max(m, ...z.nodes.map(n => n.pods.length)), 0);
    const note = nodesNote(nodes);
    const render = useCallback(() => (
        <div className="space-y-4">
            {shownRisks.length > 0 && (
                <div className="space-y-2">
                    {shownRisks.map((r, i) => {
                        const Icon = RISK_ICON[r.level];
                        return (
                            <div key={`${r.id}-${i}`} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${STATUS_BANNER_CLASSES[RISK_COLOR[r.level]]}`}>
                                <Icon size={14} className="mt-px shrink-0" aria-hidden="true" />
                                <span className="min-w-0 break-words">{r.message}</span>
                            </div>
                        );
                    })}
                </div>
            )}
            {note && <SectionNote>{note}</SectionNote>}
            {totalPods === 0 ? (
                <p className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-4">No pods found for this deployment.</p>
            ) : (
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                    {zones.map(z => (
                        <div key={z.zone ?? '__unknown'} className="space-y-3">
                            <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-sm">
                                    <span className={`font-semibold truncate ${z.zone ? 'text-white' : 'text-gray-400 italic'}`}>{z.zone ?? 'Unknown zone'}</span>
                                    <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white shrink-0">{z.podCount} pod{z.podCount === 1 ? '' : 's'}</span>
                                </div>
                                <ShareBar value={z.podCount} total={totalPods} label={`Share of pods in ${z.zone ?? 'unknown zone'}`} />
                            </div>
                            {z.nodes.map(g => (
                                <NodeCard key={g.nodeName} group={g} maxPods={maxPods} onOpenNode={onOpenNode} onOpenPod={onOpenPod}
                                    onOpenPodLogs={onOpenPodLogs} canOpenLogs={canOpenLogs} />
                            ))}
                        </div>
                    ))}
                    {unscheduled.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2 text-sm">
                                <span className="font-semibold text-yellow-400">Unscheduled</span>
                                <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white">{unscheduled.length}</span>
                            </div>
                            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 space-y-2">
                                {unscheduled.map(p => (
                                    <div key={p.uid || p.name} className="text-xs">
                                        <button type="button" onClick={() => onOpenPod(p.name)} aria-label={`Open pod ${p.name}`}
                                            className={`font-mono text-blue-400 hover:underline break-all text-left rounded ${FOCUS_RING}`}>
                                            {p.name}
                                        </button>
                                        <div className="text-gray-400">{p.displayStatus}</div>
                                        {p.unschedulableMessage && <div className="text-yellow-400 break-words">{p.unschedulableMessage}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    ), [shownRisks, note, totalPods, zones, unscheduled, maxPods, onOpenNode, onOpenPod, onOpenPodLogs, canOpenLogs]);

    return (
        <SectionShell id="distribution" title="Pod Distribution" namespace={namespace} result={pods} unavailableLabel="list pods">
            {render}
        </SectionShell>
    );
};

export const PodDistribution = React.memo(PodDistributionInner);
