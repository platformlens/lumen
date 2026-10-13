import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight, Pause } from 'lucide-react';
import type { DeploymentObj, LabelSelector } from '../../../../types/deployment-details';
import type { RolloutSummary } from '../../../../utils/deployment-rollout-utils';
import { displayAnnotations, LAST_APPLIED } from '../../../../utils/sensitive-value-utils';
import { SectionShell } from './SectionShell';
import { FOCUS_RING, STATUS_CLASSES } from './status-classes';

interface OverviewSectionProps {
    namespace: string;
    deployment: DeploymentObj;
    rollout: RolloutSummary;
    /** UTF-8 bytes of the last-applied annotation main stripped (null when absent). */
    lastAppliedBytes: number | null;
}

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="min-w-0">
        <dt className="text-xs text-gray-400">{label}</dt>
        <dd className="text-sm text-gray-300 break-words">{children}</dd>
    </div>
);

function selectorText(selector: LabelSelector | undefined): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(selector?.matchLabels ?? {})) out.push(`${k}=${v}`);
    for (const e of selector?.matchExpressions ?? []) {
        out.push(e.values?.length ? `${e.key} ${e.operator} [${e.values.join(', ')}]` : `${e.key} ${e.operator}`);
    }
    return out;
}

const conditionColor = (status: string) => (status === 'True' ? 'green' : status === 'False' ? 'red' : 'gray') as 'green' | 'red' | 'gray';

const Collapsible: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) => {
    const [open, setOpen] = useState(false);
    const reduceMotion = useReducedMotion();
    return (
        <div className="border-t border-white/10 pt-3">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className={`flex items-center gap-2 text-sm font-medium text-gray-300 hover:text-white rounded ${FOCUS_RING}`}
            >
                {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                {title}
                <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white">{count}</span>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                    >
                        <div className="pt-2">{children}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const OverviewSectionInner: React.FC<OverviewSectionProps> = ({ namespace, deployment, rollout, lastAppliedBytes }) => {
    const spec = deployment.spec;
    const selector = useMemo(() => selectorText(spec?.selector), [spec?.selector]);
    const labels = useMemo(
        () => Object.entries(deployment.metadata?.labels ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        [deployment.metadata?.labels]);
    const annotations = useMemo(() => displayAnnotations(
        deployment.metadata?.annotations,
        lastAppliedBytes !== null ? { strippedBytes: { [LAST_APPLIED]: lastAppliedBytes } } : undefined,
    ), [deployment.metadata?.annotations, lastAppliedBytes]);

    const { strategy } = rollout;

    return (
        <SectionShell id="overview" title="Overview" namespace={namespace}>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
                {rollout.isPaused && (
                    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${STATUS_CLASSES.yellow}`}>
                        <Pause size={14} aria-hidden="true" /> Rollout paused (spec.paused = true)
                    </div>
                )}
                <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <Fact label="Strategy">{strategy.type}</Fact>
                    {strategy.type === 'RollingUpdate' && (
                        <>
                            <Fact label="Max surge"><span className="font-mono">{strategy.maxSurge}</span></Fact>
                            <Fact label="Max unavailable"><span className="font-mono">{strategy.maxUnavailable}</span></Fact>
                        </>
                    )}
                    <Fact label="Min ready seconds">{rollout.minReadySeconds}s</Fact>
                    <Fact label="Progress deadline">{rollout.progressDeadlineSeconds}s</Fact>
                    <Fact label="Revision history limit">{rollout.revisionHistoryLimit}</Fact>
                    <Fact label="Generation">
                        <span className="font-mono">
                            {deployment.metadata?.generation ?? '–'} / observed {deployment.status?.observedGeneration ?? '–'}
                        </span>
                    </Fact>
                    <Fact label="Paused">{rollout.isPaused ? 'Yes' : 'No'}</Fact>
                    <Fact label="UID"><span className="font-mono text-xs">{deployment.metadata?.uid ?? '–'}</span></Fact>
                </dl>

                <div>
                    <div className="text-xs text-gray-400 mb-1">Selector</div>
                    <div className="flex flex-wrap gap-1.5">
                        {selector.length === 0
                            ? <span className="text-sm text-gray-500">None</span>
                            : selector.map(s => (
                                <span key={s} className="font-mono text-xs text-gray-300 bg-white/5 border border-white/10 px-2 py-0.5 rounded-md">{s}</span>
                            ))}
                    </div>
                </div>

                <div>
                    <div className="text-xs text-gray-400 mb-1">Conditions</div>
                    {rollout.conditions.length === 0 ? (
                        <span className="text-sm text-gray-500">No conditions reported</span>
                    ) : (
                        <ul className="divide-y divide-white/5">
                            {rollout.conditions.map(c => (
                                <li key={c.type} className="py-2 flex flex-wrap items-start gap-2">
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASSES[conditionColor(c.status)]}`}>
                                        {c.type}: {c.status}
                                    </span>
                                    {c.reason && <span className="text-xs font-mono text-gray-400">{c.reason}</span>}
                                    {c.message && <span className="basis-full text-xs text-gray-400 break-words">{c.message}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <Collapsible title="Labels" count={labels.length}>
                    {labels.length === 0 ? <span className="text-sm text-gray-500">No labels</span> : (
                        <div className="flex flex-wrap gap-1.5">
                            {labels.map(([k, v]) => (
                                <span key={k} className="font-mono text-xs text-gray-300 bg-white/5 border border-white/10 px-2 py-0.5 rounded-md break-all">
                                    {k}={v}
                                </span>
                            ))}
                        </div>
                    )}
                </Collapsible>
                <Collapsible title="Annotations" count={annotations.length}>
                    {annotations.length === 0 ? <span className="text-sm text-gray-500">No annotations</span> : (
                        <dl className="space-y-2">
                            {annotations.map(a => (
                                <div key={a.key} className="min-w-0">
                                    <dt className="font-mono text-xs text-gray-400 break-all">{a.key}</dt>
                                    <dd className={`font-mono text-xs break-all ${a.hidden ? 'italic text-gray-500' : 'text-gray-300'}`}>{a.value}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </Collapsible>
            </div>
        </SectionShell>
    );
};

export const OverviewSection = React.memo(OverviewSectionInner);
