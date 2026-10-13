import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ToggleGroup, type ToggleOption } from '../../../shared/ToggleGroup';
import { TimeAgo } from '../../../shared/TimeAgo';
import type { DeploymentEvent, SectionResult } from '../../../../types/deployment-details';
import { SectionShell } from './SectionShell';
import { FOCUS_RING } from './status-classes';

interface EventsSectionProps {
    namespace: string;
    events: SectionResult<DeploymentEvent[]>;
}

type EventFilter = 'all' | 'warnings';
const PAGE_SIZE = 20;

const EventList: React.FC<{ events: DeploymentEvent[] }> = ({ events }) => {
    const [filter, setFilter] = useState<EventFilter>('all');
    const [page, setPage] = useState(1);
    const warnings = useMemo(() => events.filter(e => e.type === 'Warning'), [events]);
    const shown = filter === 'warnings' ? warnings : events;
    const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const pageItems = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
    useEffect(() => setPage(1), [filter]);

    const options = useMemo<ToggleOption<EventFilter>[]>(() => [
        { value: 'all', label: `All (${events.length})` },
        { value: 'warnings', label: `Warnings (${warnings.length})` },
    ], [events.length, warnings.length]);

    return (
        <div className="space-y-3">
            <ToggleGroup options={options} value={filter} onChange={setFilter} className="w-fit" />
            {pageItems.length === 0 ? (
                <div className="bg-white/5 rounded-xl p-4 border border-white/10 text-gray-500 italic text-center text-xs">
                    {filter === 'warnings' ? 'No warning events.' : 'No events found.'}
                </div>
            ) : (
                <ul className="space-y-2">
                    {pageItems.map((e, i) => (
                        <li key={`${e.involvedUid}-${e.reason}-${e.lastTimestamp}-${i}`} className="bg-white/5 border border-white/10 rounded-md p-3 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    <span className={`font-bold ${e.type === 'Warning' ? 'text-yellow-400' : 'text-blue-400'}`}>{e.reason}</span>
                                    <span className="font-mono text-[10px] text-gray-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded break-all">
                                        {e.involvedKind}/{e.involvedName}
                                    </span>
                                    {e.type === 'Warning' && <span className="text-[10px] text-yellow-400">Warning</span>}
                                </div>
                                <div className="flex items-center gap-2 text-gray-500">
                                    {e.count > 1 && <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-gray-400">{e.count}x</span>}
                                    {e.source && <span className="text-[10px]">{e.source}</span>}
                                    <TimeAgo timestamp={e.lastTimestamp} />
                                </div>
                            </div>
                            <div className="text-gray-300 break-words leading-relaxed">{e.message}</div>
                        </li>
                    ))}
                </ul>
            )}
            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2">
                    <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={current === 1} aria-label="Previous page"
                        className={`p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 ${FOCUS_RING}`}>
                        <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <span className="text-xs text-gray-400">Page {current} of {totalPages}</span>
                    <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={current === totalPages} aria-label="Next page"
                        className={`p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 ${FOCUS_RING}`}>
                        <ChevronRight size={16} aria-hidden="true" />
                    </button>
                </div>
            )}
        </div>
    );
};

const renderEvents = (data: DeploymentEvent[]) => <EventList events={data} />;

const EventsSectionInner: React.FC<EventsSectionProps> = ({ namespace, events }) => (
    <SectionShell id="events" title="Events" namespace={namespace} result={events} unavailableLabel="list events">
        {renderEvents}
    </SectionShell>
);

export const EventsSection = React.memo(EventsSectionInner);
