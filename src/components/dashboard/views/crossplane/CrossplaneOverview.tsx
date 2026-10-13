import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, FlaskConical, Loader2 } from 'lucide-react';
import { GenericResourceView } from '../GenericResourceView';
import type { IColumn } from '../../../shared/VirtualizedTable';
import { TimeAgo } from '../../../shared/TimeAgo';
import { useCrossplaneQuery } from '../../../../hooks/useCrossplaneQuery';
import { collectNeedsAttention, countHealth, emptyHealthCounts, isValidCrossplaneRef, toCrossplaneRef } from '../../../../utils/crossplane-utils';
import { CrossplaneHealthBadge } from './CrossplaneHealthBadge';
import { CrossplaneSectionErrors } from './CrossplaneSectionErrors';
import { healthColumn, textColumn, timeColumn } from './crossplane-columns';
import {
    MANAGED_SELECTION_KEY, MANAGED_SELECTION_UNHEALTHY, crossplaneTabKey, useRefreshSignal, useReportStatus, writeSession,
    type CrossplaneSubViewProps,
} from './crossplane-view-state';
import type {
    CrossplaneEvent, CrossplaneScanProgress, HealthCounts, NeedsAttentionRow, PackageRow,
} from '../../../../types/crossplane';

const NEEDS_ATTENTION_COLUMNS: IColumn[] = [
    healthColumn<NeedsAttentionRow>(),
    textColumn<NeedsAttentionRow>('Kind', 'kind', 160),
    textColumn<NeedsAttentionRow>('Name', 'name', 220),
    textColumn<NeedsAttentionRow>('Namespace', 'namespace', 140),
    textColumn<NeedsAttentionRow>('Reason', 'healthReason', 160),
    textColumn<NeedsAttentionRow>('Message', 'healthMessage', 320, { flexGrow: 1 }),
    timeColumn<NeedsAttentionRow>('Since', 'healthSince', 100),
];

/** Newest events fetched (IPC schema max is 200), paged client-side. */
const EVENTS_FETCH_LIMIT = 200;
const EVENTS_PAGE_SIZE = 10;
const SCAN_INTERVAL_MS = 300_000;
const cardStyles = 'bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between hover:bg-white/[0.07] transition-colors text-left';

interface StatCardProps {
    title: string;
    counts: HealthCounts;
    onClick?: () => void;
    pending?: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ title, counts, onClick, pending }) => (
    <button type="button" onClick={onClick} className={cardStyles} aria-label={`${title}: open list`}>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</span>
        {pending ?? (
            <>
                <div className="text-2xl font-bold text-white tabular-nums">{counts.total}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-1 tabular-nums">
                    <span className="text-green-400">{counts.healthy} healthy</span>
                    {counts.progressing > 0 && <span className="text-yellow-400">{counts.progressing} progressing</span>}
                    {counts.unhealthy > 0 && <span className="text-red-400">{counts.unhealthy} unhealthy</span>}
                </div>
            </>
        )}
    </button>
);

function packageTag(p: PackageRow): string {
    const ref = p.packageRef;
    const at = ref.lastIndexOf('@');
    if (at !== -1) return ref.slice(at + 1, at + 20);
    const colon = ref.lastIndexOf(':');
    return colon > ref.lastIndexOf('/') ? ref.slice(colon + 1) : '—';
}

interface EventCardProps { event: CrossplaneEvent; onOpen?: (e: CrossplaneEvent) => void; }

const EventCard: React.FC<EventCardProps> = ({ event, onOpen }) => {
    const obj = event.involvedObject;
    const body = (
        <>
            <div className="flex items-center justify-between mb-1.5 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-yellow-400 truncate">{event.reason}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border bg-yellow-500/10 border-yellow-500/20 text-yellow-400">Warning</span>
                </div>
                <div className="flex items-center gap-2 text-gray-500 shrink-0">
                    {event.count > 1 && <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-gray-400">{event.count}x</span>}
                    {event.timestamp && <TimeAgo timestamp={event.timestamp} />}
                </div>
            </div>
            <div className="min-w-0 space-y-1">
                <div className="text-gray-500 font-mono [overflow-wrap:anywhere]">{obj.kind}/{obj.name}</div>
                {/* Messages often embed long unbroken JSON; allow breaks anywhere so they never overflow */}
                <p className="text-gray-300 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{event.message}</p>
            </div>
        </>
    );
    const base = 'block w-full min-w-0 overflow-hidden text-left bg-white/5 border border-white/10 rounded-lg p-3 text-xs transition-colors';
    if (!onOpen) return <div className={base}>{body}</div>;
    return (
        <button type="button" onClick={() => onOpen(event)} className={`${base} hover:bg-white/[0.07] cursor-pointer`}>
            {body}
        </button>
    );
};

/** B.4.1: cards per category, Needs attention, provider health, Warning events. */
export const CrossplaneOverview: React.FC<CrossplaneSubViewProps> = ({
    clusterName, detection, searchQuery, selectedNamespaces, onResourceClick, onNavigate, refreshSignal, onStatus,
}) => {
    const packages = useCrossplaneQuery(f => window.k8s.crossplane.getPackages(clusterName, { force: f }), `${clusterName}|packages`);
    const definitions = useCrossplaneQuery(f => window.k8s.crossplane.getDefinitions(clusterName, { force: f }), `${clusterName}|definitions`);
    const composites = useCrossplaneQuery(f => window.k8s.crossplane.getComposites(clusterName, { force: f }), `${clusterName}|composites`);
    const scan = useCrossplaneQuery(f => window.k8s.crossplane.scanManaged(clusterName, { force: f }), `${clusterName}|scan`,
        { minIntervalMs: SCAN_INTERVAL_MS });
    const events = useCrossplaneQuery(f => window.k8s.crossplane.getWarningEvents(clusterName, { force: f, limit: EVENTS_FETCH_LIMIT }), `${clusterName}|events`);

    useRefreshSignal(refreshSignal, () => {
        packages.refresh(); definitions.refresh(); composites.refresh(); scan.refresh(); events.refresh();
    });
    const queries = [packages, definitions, composites, scan, events];
    useReportStatus(onStatus,
        [packages.data?.fetchedAt, definitions.data?.fetchedAt, composites.data?.fetchedAt, events.data?.fetchedAt],
        queries.some(q => q.loading || q.refreshing));

    // Scan progress for this context only
    const [progress, setProgress] = useState<CrossplaneScanProgress | null>(null);
    useEffect(() => {
        setProgress(null);
        const unsubscribe = window.k8s.crossplane.onScanProgress(p => { if (p.context === clusterName) setProgress(p); });
        return unsubscribe;
    }, [clusterName]);
    const scanning = scan.loading || scan.refreshing;

    const pk = packages.data;
    const defs = definitions.data;
    const comp = composites.data;
    const summary = scan.data;

    const mrCounts = useMemo<HealthCounts>(() => {
        const c = emptyHealthCounts();
        for (const k of summary?.kinds ?? []) {
            for (const h of ['unhealthy', 'progressing', 'paused', 'unknown', 'healthy', 'none', 'total'] as const) c[h] += k.byHealth[h];
        }
        return c;
    }, [summary]);

    const mrCountByProvider = useMemo(() => {
        const m = new Map<string, number>();
        for (const k of summary?.kinds ?? []) if (k.providerName) m.set(k.providerName, (m.get(k.providerName) ?? 0) + k.count);
        return m;
    }, [summary]);

    const cards = useMemo(() => {
        const list: { title: string; counts: HealthCounts; view: string; ready: boolean }[] = [
            { title: 'Providers', counts: countHealth(pk?.providers ?? []), view: 'crossplane-packages', ready: !!pk },
            { title: 'Functions', counts: countHealth(pk?.functions ?? []), view: 'crossplane-packages', ready: !!pk },
            { title: 'Configurations', counts: countHealth(pk?.configurations ?? []), view: 'crossplane-packages', ready: !!pk },
            { title: 'XRDs', counts: countHealth(defs?.xrds ?? []), view: 'crossplane-definitions', ready: !!defs },
            { title: 'Composite Resources', counts: countHealth(comp?.composites ?? []), view: 'crossplane-composites', ready: !!comp },
        ];
        if (defs?.claimsSupported) {
            list.push({ title: 'Claims', counts: countHealth(comp?.claims ?? []), view: 'crossplane-composites', ready: !!comp });
        }
        return list;
    }, [pk, defs, comp]);
    const cardSpinner = <Loader2 size={16} className="animate-spin text-gray-400" aria-label="Loading" />;

    const needsAttention = useMemo(() => collectNeedsAttention(
        pk?.providers, pk?.functions, pk?.configurations, pk?.revisions, pk?.activationPolicies,
        defs?.xrds, comp?.composites, comp?.claims, comp?.usages, comp?.operations, summary?.unhealthy,
    ), [pk, defs, comp, summary]);

    const moreUnhealthyMrs = Math.max(0, mrCounts.unhealthy - (summary?.unhealthy.length ?? 0));

    const handleRowClick = useCallback((row: NeedsAttentionRow) => onResourceClick(row, 'crossplane'), [onResourceClick]);
    const openUnhealthyManaged = useCallback(() => {
        writeSession(MANAGED_SELECTION_KEY, MANAGED_SELECTION_UNHEALTHY);
        onNavigate?.('crossplane-managed');
    }, [onNavigate]);
    const openOperations = useCallback(() => {
        writeSession(crossplaneTabKey('composites'), 'operations');
        onNavigate?.('crossplane-composites');
    }, [onNavigate]);
    const openEvent = useCallback((e: CrossplaneEvent) => onResourceClick(toCrossplaneRef(e.involvedObject), 'crossplane'), [onResourceClick]);

    const allEvents = useMemo(() => events.data?.events ?? [], [events.data]);
    const eventPageCount = Math.max(1, Math.ceil(allEvents.length / EVENTS_PAGE_SIZE));
    const [eventPage, setEventPage] = useState(0);
    // Reset to the first page on cluster switch; clamp when a refresh shrinks the list
    useEffect(() => { setEventPage(0); }, [clusterName]);
    const currentEventPage = Math.min(eventPage, eventPageCount - 1);
    const shownEvents = useMemo(
        () => allEvents.slice(currentEventPage * EVENTS_PAGE_SIZE, (currentEventPage + 1) * EVENTS_PAGE_SIZE),
        [allEvents, currentEventPage],
    );
    const allErrors = useMemo(() => [
        ...(pk?.errors ?? []), ...(defs?.errors ?? []), ...(comp?.errors ?? []), ...(summary?.errors ?? []), ...(events.data?.errors ?? []),
    ], [pk, defs, comp, summary, events.data]);
    const queryError = queries.map(q => q.error).find(Boolean) ?? null;

    const mrPending = scanning && !summary ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 mt-1" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {progress ? `Scanning managed resources ${progress.scanned} / ${progress.total} kinds` : 'Scanning managed resources…'}
        </div>
    ) : undefined;

    return (
        <div className="space-y-6">
            {detection.coreRunning === false && (
                <div role="alert" className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 p-3 text-sm flex gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                    The Crossplane core Deployment was not found or has no available replicas. Packages and composites may not reconcile.
                </div>
            )}
            {detection.features.operations && (
                <button
                    type="button"
                    onClick={openOperations}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                >
                    <FlaskConical size={12} aria-hidden="true" /> Operations (alpha)
                </button>
            )}
            <CrossplaneSectionErrors errors={allErrors} queryError={queryError} />

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                {cards.map(c => (
                    <StatCard key={c.title} title={c.title} counts={c.counts} onClick={() => onNavigate?.(c.view)}
                        pending={c.ready ? undefined : cardSpinner} />
                ))}
                <StatCard title="Managed Resources" counts={mrCounts} onClick={() => onNavigate?.('crossplane-managed')} pending={mrPending} />
            </div>
            {scanning && summary && progress && (
                <p className="text-xs text-gray-500" role="status">Scanning managed resources {progress.scanned} / {progress.total} kinds</p>
            )}
            {summary?.status === 'cancelled' && (
                <p className="text-xs text-gray-500">The managed resource scan was interrupted by a cluster switch. Refresh to scan again.</p>
            )}

            <section className="space-y-3">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    Needs attention
                    <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white">{needsAttention.length}</span>
                </h3>
                <div className="h-[400px]">
                    <GenericResourceView
                        viewKey="crossplane-needs-attention"
                        columns={NEEDS_ATTENTION_COLUMNS}
                        data={needsAttention}
                        onRowClick={handleRowClick}
                        searchQuery={searchQuery}
                        selectedNamespaces={selectedNamespaces}
                        isLoading={!pk && packages.loading}
                        isUpdating={scanning}
                    />
                </div>
                {moreUnhealthyMrs > 0 && (
                    <button type="button" onClick={openUnhealthyManaged}
                        className="text-xs text-gray-400 hover:text-blue-400 transition-colors inline-flex items-center gap-1">
                        +{moreUnhealthyMrs} more unhealthy managed resources <ArrowRight size={12} aria-hidden="true" />
                    </button>
                )}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="space-y-3 min-w-0">
                    <h3 className="text-lg font-semibold text-white">Provider health</h3>
                    {(pk?.providers ?? []).length === 0 ? (
                        <div className="bg-white/5 rounded-xl p-6 border border-white/10 text-gray-500 italic text-center text-sm">
                            {packages.loading ? 'Loading providers…' : 'No providers installed.'}
                        </div>
                    ) : (
                        <ul className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
                            {(pk?.providers ?? []).map(p => (
                                <li key={p.key} className="flex items-center gap-3 px-4 py-3 text-sm">
                                    <button type="button" onClick={() => onResourceClick(p, 'crossplane')}
                                        className="text-white hover:text-blue-400 truncate text-left flex-1 min-w-0">{p.name}</button>
                                    <span className="font-mono text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded-md shrink-0">{packageTag(p)}</span>
                                    <CrossplaneHealthBadge health={p.health} reason={p.healthReason} />
                                    <span className="text-xs text-gray-400 tabular-nums w-20 text-right shrink-0">
                                        {summary ? `${mrCountByProvider.get(p.name) ?? 0} MRs` : '…'}
                                    </span>
                                    <button type="button" onClick={() => onNavigate?.('crossplane-managed')}
                                        className="text-xs text-blue-400 hover:text-blue-300 shrink-0">Open</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="space-y-3 min-w-0">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        Warning events
                        {allEvents.length > 0 && (
                            <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white tabular-nums">{allEvents.length}</span>
                        )}
                    </h3>
                    {shownEvents.length === 0 ? (
                        <div className="bg-white/5 rounded-xl p-6 border border-white/10 text-gray-500 italic text-center text-sm">
                            {events.loading ? 'Loading events…' : 'No Crossplane Warning events.'}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {shownEvents.map(e => (
                                <EventCard key={e.uid} event={e}
                                    onOpen={isValidCrossplaneRef(toCrossplaneRef(e.involvedObject)) ? openEvent : undefined} />
                            ))}
                        </div>
                    )}
                    {eventPageCount > 1 && (
                        <nav className="flex items-center justify-between text-xs text-gray-400" aria-label="Warning events pages">
                            <span className="tabular-nums">
                                {currentEventPage * EVENTS_PAGE_SIZE + 1}–{Math.min((currentEventPage + 1) * EVENTS_PAGE_SIZE, allEvents.length)} of {allEvents.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setEventPage(Math.max(0, currentEventPage - 1))}
                                    disabled={currentEventPage === 0} aria-label="Previous page"
                                    className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none">
                                    <ChevronLeft size={14} />
                                </button>
                                <span className="tabular-nums">Page {currentEventPage + 1} / {eventPageCount}</span>
                                <button type="button" onClick={() => setEventPage(Math.min(eventPageCount - 1, currentEventPage + 1))}
                                    disabled={currentEventPage >= eventPageCount - 1} aria-label="Next page"
                                    className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none">
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        </nav>
                    )}
                    {events.data?.truncatedScan && (
                        <p className="text-xs text-gray-500">Scanned the newest 5000 Warning events.</p>
                    )}
                </section>
            </div>
        </div>
    );
};
