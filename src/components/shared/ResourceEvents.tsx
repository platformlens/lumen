import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { TimeAgo } from './TimeAgo';

interface ResourceEventsProps {
    clusterName: string;
    resource: any;
}

const EVENTS_PER_PAGE = 10;

/**
 * Reusable events section for any Kubernetes resource drawer.
 * Fetches events by involvedObject.uid and auto-refreshes every 5 seconds.
 */
const ResourceEventsInner: React.FC<ResourceEventsProps> = ({ clusterName, resource }) => {
    const [events, setEvents] = useState<any[]>([]);
    const [page, setPage] = useState(1);

    const uid = resource?.metadata?.uid;
    const namespace = resource?.metadata?.namespace;

    useEffect(() => {
        if (!clusterName || !uid) return;

        let isMounted = true;

        const fetchEvents = async () => {
            try {
                const selector = `involvedObject.uid=${uid}`;
                const ns = namespace ? [namespace] : ['all'];
                const evts = await (window.k8s as any).getEvents(clusterName, ns, selector);
                if (isMounted) {
                    setEvents(evts);
                }
            } catch (e) {
                // Silently ignore — events are supplementary
            }
        };

        fetchEvents();
        const interval = setInterval(fetchEvents, 5000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [clusterName, uid, namespace]);

    // Reset page when resource changes
    useEffect(() => {
        setPage(1);
    }, [uid]);

    const totalPages = Math.ceil(events.length / EVENTS_PER_PAGE);
    const paginatedEvents = useMemo(
        () => events.slice((page - 1) * EVENTS_PER_PAGE, page * EVENTS_PER_PAGE),
        [events, page]
    );

    // Don't render the section at all if there's no UID to query
    if (!uid) return null;

    return (
        <div className="mt-6">
            <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider flex items-center gap-2 mb-3">
                <AlertCircle size={14} /> Events
                {events.length > 0 && (
                    <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-gray-400 normal-case font-normal">
                        {events.length}
                    </span>
                )}
            </h3>

            {events.length === 0 ? (
                <div className="bg-white/5 rounded-md p-4 border border-white/10 text-gray-500 italic text-center text-xs">
                    No events found for this resource.
                </div>
            ) : (
                <div className="space-y-2">
                    {paginatedEvents.map((event, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 rounded-md p-3 text-xs">
                            <div className="flex items-center justify-between mb-1">
                                <span className={`font-bold ${
                                    event.type === 'Warning' ? 'text-yellow-400' : 'text-blue-400'
                                }`}>
                                    {event.reason}
                                </span>
                                <div className="flex items-center gap-2 text-gray-500">
                                    {event.count > 1 && (
                                        <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-gray-400">
                                            {event.count}x
                                        </span>
                                    )}
                                    <TimeAgo timestamp={event.lastTimestamp} />
                                </div>
                            </div>
                            <div className="text-gray-300 break-words leading-relaxed">
                                {event.message}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-4">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span className="text-xs text-gray-400">
                        Page {page} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </div>
    );
};

export const ResourceEvents = React.memo(ResourceEventsInner);
