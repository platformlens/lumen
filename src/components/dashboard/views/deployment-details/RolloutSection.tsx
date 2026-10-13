import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Info, Pause, XCircle } from 'lucide-react';
import type { SectionResult } from '../../../../types/deployment-details';
import type { HpaSummary, PdbSummary, RolloutSummary } from '../../../../utils/deployment-rollout-utils';
import { SectionNote, SectionShell, SectionUnavailable } from './SectionShell';
import { FOCUS_RING, STATUS_BANNER_CLASSES, type StatusColor } from './status-classes';

interface RolloutSectionProps {
    namespace: string;
    rollout: RolloutSummary;
    hpas: SectionResult<HpaSummary[]>;
    pdbs: SectionResult<PdbSummary[]>;
    onOpenHpa: (name: string) => void;
    onOpenPdb: (name: string) => void;
}

const Tile: React.FC<{ label: string; value: number; warn?: boolean }> = ({ label, value, warn }) => (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
        <div className={`text-2xl font-bold ${warn ? 'text-yellow-400' : 'text-white'}`}>{value}</div>
        <div className="text-xs text-gray-400">{label}</div>
    </div>
);

const Banner: React.FC<{ color: StatusColor; icon: React.ReactNode; children: React.ReactNode }> = ({ color, icon, children }) => (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${STATUS_BANNER_CLASSES[color]}`}>
        <span className="mt-px shrink-0" aria-hidden="true">{icon}</span>
        <span className="min-w-0 break-words">{children}</span>
    </div>
);

const NameLink: React.FC<{ name: string; onClick: () => void; label: string }> = ({ name, onClick, label }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={`Open ${label} ${name}`}
        className={`font-mono text-sm text-blue-400 hover:underline rounded break-all text-left ${FOCUS_RING}`}
    >
        {name}
    </button>
);

const HpaCard: React.FC<{ hpa: HpaSummary; onOpen: (name: string) => void }> = ({ hpa, onOpen }) => (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-400">HorizontalPodAutoscaler</div>
            {hpa.atMax && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-yellow-500/10 text-yellow-400">
                    <AlertTriangle size={12} aria-hidden="true" /> At max replicas
                </span>
            )}
        </div>
        <NameLink name={hpa.name} onClick={() => onOpen(hpa.name)} label="HPA" />
        <div className="grid grid-cols-4 gap-2 text-sm text-gray-300">
            <div><div className="text-xs text-gray-400">Min</div>{hpa.min}</div>
            <div><div className="text-xs text-gray-400">Max</div>{hpa.max}</div>
            <div><div className="text-xs text-gray-400">Current</div>{hpa.current}</div>
            <div><div className="text-xs text-gray-400">Desired</div>{hpa.desired}</div>
        </div>
        {hpa.metrics.length > 0 && (
            <ul className="divide-y divide-white/5 text-xs">
                {hpa.metrics.map((m, i) => (
                    <li key={`${m.label}-${i}`} className="py-1.5 flex justify-between gap-2">
                        <span className="text-gray-400">{m.label}</span>
                        <span className="font-mono text-gray-300">{m.current ?? '–'} / {m.target}</span>
                    </li>
                ))}
            </ul>
        )}
    </div>
);

const PdbCard: React.FC<{ pdb: PdbSummary; onOpen: (name: string) => void }> = ({ pdb, onOpen }) => (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
        <div className="text-xs text-gray-400">PodDisruptionBudget</div>
        <NameLink name={pdb.name} onClick={() => onOpen(pdb.name)} label="PodDisruptionBudget" />
        <div className="grid grid-cols-3 gap-2 text-sm text-gray-300">
            <div><div className="text-xs text-gray-400">Min available</div><span className="font-mono">{pdb.minAvailable ?? '–'}</span></div>
            <div><div className="text-xs text-gray-400">Max unavailable</div><span className="font-mono">{pdb.maxUnavailable ?? '–'}</span></div>
            <div><div className="text-xs text-gray-400">Disruptions allowed</div>{pdb.disruptionsAllowed}</div>
        </div>
        <div className="text-xs text-gray-400">Healthy {pdb.currentHealthy} / desired {pdb.desiredHealthy}</div>
        {pdb.blocksEviction && (
            <Banner color="yellow" icon={<AlertTriangle size={14} />}>
                Node drains will block while 0 disruptions are allowed
            </Banner>
        )}
    </div>
);

const RolloutSectionInner: React.FC<RolloutSectionProps> = ({ namespace, rollout, hpas, pdbs, onOpenHpa, onOpenPdb }) => {
    const reduceMotion = useReducedMotion();
    const stalled = rollout.conditions.find(c => c.type === 'Progressing');
    const pct = Math.max(0, Math.min(100, rollout.progressPercent));

    return (
        <SectionShell id="rollout" title="Rollout & Replicas" namespace={namespace}>
            <div className="space-y-4">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    <Tile label="Desired" value={rollout.desired} />
                    <Tile label="Current" value={rollout.current} />
                    <Tile label="Updated" value={rollout.updated} />
                    <Tile label="Ready" value={rollout.ready} />
                    <Tile label="Available" value={rollout.available} />
                    <Tile label="Unavailable" value={rollout.unavailable} warn={rollout.unavailable > 0} />
                </div>

                <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Rollout progress</span>
                        <span>{rollout.isComplete ? 'Complete' : `${pct}%`}</span>
                    </div>
                    <div
                        className="h-2 bg-white/10 rounded-full overflow-hidden"
                        role="progressbar"
                        aria-label="Rollout progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                    >
                        <motion.div
                            className={`h-full rounded-full ${rollout.isComplete ? 'bg-green-500' : 'bg-blue-500'}`}
                            initial={reduceMotion ? false : { width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: reduceMotion ? 0 : 0.4 }}
                        />
                    </div>
                </div>

                {rollout.isStalled && (
                    <Banner color="red" icon={<XCircle size={14} />}>
                        Rollout stalled (ProgressDeadlineExceeded){stalled?.message ? `: ${stalled.message}` : ''}
                    </Banner>
                )}
                {rollout.isPaused && (
                    <Banner color="yellow" icon={<Pause size={14} />}>Rollout is paused; new template changes won&apos;t roll out.</Banner>
                )}
                {rollout.observedGenerationStale && (
                    <Banner color="blue" icon={<Info size={14} />}>Controller hasn&apos;t observed latest spec yet</Banner>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                        {hpas.status === 'forbidden' && <SectionUnavailable kind="forbidden" label="list horizontalpodautoscalers" namespace={namespace} />}
                        {hpas.status === 'error' && <SectionUnavailable kind="error" message={hpas.message} />}
                        {hpas.status === 'ok' && (hpas.data.length === 0
                            ? <SectionNote>No HorizontalPodAutoscaler targets this deployment.</SectionNote>
                            : hpas.data.map(h => <HpaCard key={h.name} hpa={h} onOpen={onOpenHpa} />))}
                    </div>
                    <div className="space-y-2">
                        {pdbs.status === 'forbidden' && <SectionUnavailable kind="forbidden" label="list poddisruptionbudgets" namespace={namespace} />}
                        {pdbs.status === 'error' && <SectionUnavailable kind="error" message={pdbs.message} />}
                        {pdbs.status === 'ok' && (pdbs.data.length === 0
                            ? (rollout.desired > 1
                                ? <Banner color="blue" icon={<Info size={14} />}>No PodDisruptionBudget — voluntary disruptions can evict all replicas</Banner>
                                : <SectionNote>No PodDisruptionBudget selects these pods.</SectionNote>)
                            : pdbs.data.map(p => <PdbCard key={p.name} pdb={p} onOpen={onOpenPdb} />))}
                    </div>
                </div>
            </div>
        </SectionShell>
    );
};

export const RolloutSection = React.memo(RolloutSectionInner);
