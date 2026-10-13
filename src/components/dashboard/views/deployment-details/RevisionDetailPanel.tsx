import React, { useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileDiff, Info, Minus, PenLine, Plus } from 'lucide-react';
import { ToggleGroup, type ToggleOption } from '../../../shared/ToggleGroup';
import { TimeAgo } from '../../../shared/TimeAgo';
import type { DeploymentEvent } from '../../../../types/deployment-details';
import type { RevisionEntry } from '../../../../utils/deployment-history-utils';
import type { ChangeKind, TemplateChange } from '../../../../utils/pod-template-diff-utils';
import { displayAnnotations } from '../../../../utils/sensitive-value-utils';
import type { RevisionDiffSide } from '../../../resources/details/RevisionDiffModal';
import { RevisionDiffEditor } from './RevisionDiffEditor';
import { FOCUS_RING } from './status-classes';
import { formatAbsolute, isWithin48h } from './revision-format';

export type CompareMode = 'previous' | 'current';

interface RevisionDetailPanelProps {
    entry: RevisionEntry;
    /** Comparison target for the current mode (null: no previous retained / unnumbered). */
    target: RevisionEntry | null;
    compareMode: CompareMode;
    onCompareModeChange: (mode: CompareMode) => void;
    /** Template changes against `target` (ordered older → newer). */
    changes: TemplateChange[];
    /** eventsForRevision for `entry` (newest first). */
    events: DeploymentEvent[];
    totalRevisions: number;
    revisionHistoryLimit: number;
    replicaSetAnnotations: Record<string, string> | undefined;
    onOpenReplicaSet: (name: string) => void;
    isDiffOpen: boolean;
    onToggleDiff: () => void;
    /** Built by the container only while the diff is open. */
    diffSides: { left: RevisionDiffSide; right: RevisionDiffSide } | null;
    hasHiddenValues: boolean;
}

const MAX_EVENTS = 20;

const CHANGE_META: Record<ChangeKind, { Icon: typeof Plus; cls: string; text: string }> = {
    added: { Icon: Plus, cls: 'text-green-400', text: 'Added' },
    removed: { Icon: Minus, cls: 'text-red-400', text: 'Removed' },
    changed: { Icon: PenLine, cls: 'text-blue-400', text: 'Changed' },
};

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="min-w-0">
        <dt className="text-xs text-gray-400">{label}</dt>
        <dd className="text-sm text-gray-300 break-words">{children}</dd>
    </div>
);

const RevisionDetailPanelInner: React.FC<RevisionDetailPanelProps> = ({
    entry, target, compareMode, onCompareModeChange, changes, events, totalRevisions, revisionHistoryLimit,
    replicaSetAnnotations, onOpenReplicaSet, isDiffOpen, onToggleDiff, diffSides, hasHiddenValues,
}) => {
    const compareOptions = useMemo<ToggleOption<CompareMode>[]>(() => [
        { value: 'previous', label: 'vs previous' },
        { value: 'current', label: 'vs current', disabled: entry.isCurrent, title: entry.isCurrent ? 'Selected revision is current' : undefined },
    ], [entry.isCurrent]);
    const annotations = useMemo(() => displayAnnotations(replicaSetAnnotations), [replicaSetAnnotations]);
    const shownEvents = events.slice(0, MAX_EVENTS);

    let changeHeader: React.ReactNode = null;
    let emptyNote: string | null = null;
    if (totalRevisions <= 1) {
        emptyNote = 'No earlier revisions to compare';
    } else if (!target) {
        if (compareMode === 'previous') {
            emptyNote = entry.revision === null
                ? 'Revision number unknown; the previous revision can’t be determined'
                : entry.revision > 1
                    ? `Initial retained revision — older revisions pruned (revisionHistoryLimit = ${revisionHistoryLimit})`
                    : 'Initial revision';
        } else {
            emptyNote = 'No current revision to compare against';
        }
    } else {
        const [older, newer] = compareMode === 'previous' ? [target, entry] : [entry, target];
        changeHeader = <>Changes from <span className="font-mono">#{older.revisionLabel}</span> to <span className="font-mono">#{newer.revisionLabel}</span>{compareMode === 'current' ? ' (current)' : ''}</>;
    }

    return (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-white">Revision {entry.revisionLabel}</h3>
                        {entry.isCurrent && <span className="px-2 py-0.5 rounded text-xs bg-green-500/10 text-green-400">Current</span>}
                        {!entry.isCurrent && entry.isActive && <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/10 text-yellow-400">Rolling</span>}
                    </div>
                    {entry.previousRevisions.length > 0 && (
                        <p className="text-xs text-blue-400 mt-0.5">
                            Rolled back; previously revisions {entry.previousRevisions.join(', ')}
                        </p>
                    )}
                </div>
                <ToggleGroup options={compareOptions} value={compareMode} onChange={onCompareModeChange} />
            </div>

            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Fact label="ReplicaSet">
                    <button
                        type="button"
                        onClick={() => onOpenReplicaSet(entry.replicaSetName)}
                        aria-label={`Open ReplicaSet ${entry.replicaSetName}`}
                        className={`font-mono text-sm text-blue-400 hover:underline rounded break-all text-left ${FOCUS_RING}`}
                    >
                        {entry.replicaSetName}
                    </button>
                </Fact>
                <Fact label="Pod template hash"><span className="font-mono">{entry.podTemplateHash ?? '–'}</span></Fact>
                <Fact label="Created">
                    <span title={formatAbsolute(entry.createdAt)}>{formatAbsolute(entry.createdAt)}{isWithin48h(entry.createdAt) && <> (<TimeAgo timestamp={entry.createdAt} /> ago)</>}</span>
                </Fact>
                <Fact label="Replicas">
                    {entry.readyReplicas}/{entry.desiredReplicas} ready · {entry.availableReplicas} available · {entry.currentReplicas} current
                </Fact>
                <div className="col-span-2 lg:col-span-4">
                    <Fact label="Change cause">
                        {entry.changeCause ?? <span className="italic text-gray-500">No change-cause recorded</span>}
                    </Fact>
                </div>
                <div className="col-span-2 lg:col-span-4">
                    <Fact label="Images">
                        <ul className="space-y-0.5">
                            {entry.images.map(img => (
                                <li key={`${img.kind}-${img.container}`} className="font-mono text-xs break-all">
                                    <span className="text-gray-500">{img.container}{img.kind !== 'main' ? ` (${img.kind})` : ''}: </span>{img.image}
                                </li>
                            ))}
                        </ul>
                    </Fact>
                </div>
            </dl>

            <div>
                <div className="text-xs text-gray-400 mb-2">{changeHeader ?? 'Changes'}</div>
                {emptyNote ? (
                    <p className="flex items-center gap-1.5 text-sm text-gray-400"><Info size={14} aria-hidden="true" />{emptyNote}</p>
                ) : changes.length === 0 ? (
                    <p className="text-sm text-gray-400">No pod template changes</p>
                ) : (
                    <ul className="space-y-1">
                        {changes.map((ch, i) => {
                            const { Icon, cls, text } = CHANGE_META[ch.kind];
                            return (
                                <li key={`${ch.field}-${ch.container ?? ''}-${i}`} className={`flex items-start gap-2 text-sm ${cls}`}>
                                    <Icon size={14} className="mt-0.5 shrink-0" aria-label={text} />
                                    <span className="break-words min-w-0 font-mono text-xs leading-5">{ch.label}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {target && totalRevisions > 1 && (
                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={onToggleDiff}
                        aria-expanded={isDiffOpen}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 transition-colors ${FOCUS_RING}`}
                    >
                        {isDiffOpen ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                        <FileDiff size={12} aria-hidden="true" />
                        {isDiffOpen ? 'Hide YAML diff' : 'Show YAML diff'}
                    </button>
                    {isDiffOpen && diffSides && (
                        <RevisionDiffEditor left={diffSides.left} right={diffSides.right} hasHiddenValues={hasHiddenValues} />
                    )}
                </div>
            )}

            {annotations.length > 0 && (
                <details className="group">
                    <summary className={`cursor-pointer text-xs text-gray-400 hover:text-white rounded ${FOCUS_RING}`}>
                        ReplicaSet annotations ({annotations.length})
                    </summary>
                    <dl className="mt-2 space-y-1.5">
                        {annotations.map(a => (
                            <div key={a.key}>
                                <dt className="font-mono text-xs text-gray-400 break-all">{a.key}</dt>
                                <dd className={`font-mono text-xs break-all ${a.hidden ? 'italic text-gray-500' : 'text-gray-300'}`}>{a.value}</dd>
                            </div>
                        ))}
                    </dl>
                </details>
            )}

            <div>
                <div className="text-xs text-gray-400 mb-2">Events for this revision</div>
                {shownEvents.length === 0 ? (
                    <p className="text-sm text-gray-500">No events retained for this revision</p>
                ) : (
                    <ul className="divide-y divide-white/5">
                        {shownEvents.map((ev, i) => (
                            <li key={`${ev.involvedUid}-${ev.reason}-${ev.lastTimestamp}-${i}`} className="py-1.5 flex items-start gap-2 text-xs">
                                {ev.type === 'Warning'
                                    ? <AlertTriangle size={12} className="mt-0.5 shrink-0 text-yellow-400" aria-label="Warning" />
                                    : <Info size={12} className="mt-0.5 shrink-0 text-blue-400" aria-label="Normal" />}
                                <span className="font-medium text-gray-300 shrink-0">{ev.reason}</span>
                                <span className="text-gray-400 break-words min-w-0 flex-1">{ev.message}</span>
                                <span className="text-gray-500 shrink-0">
                                    {ev.count > 1 ? `×${ev.count} · ` : ''}<TimeAgo timestamp={ev.lastTimestamp} />
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                {events.length > MAX_EVENTS && (
                    <p className="text-xs text-gray-500 mt-1">Showing {MAX_EVENTS} of {events.length}; see the Events section for all.</p>
                )}
            </div>
        </div>
    );
};

export const RevisionDetailPanel = React.memo(RevisionDetailPanelInner);
