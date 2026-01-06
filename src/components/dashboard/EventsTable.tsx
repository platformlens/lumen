import React, { useState, useEffect } from 'react';
import { AlertTriangle, Info, ChevronLeft, ChevronRight, List, AlertCircle, ShieldAlert } from 'lucide-react';
import { ToggleGroup } from '../shared/ToggleGroup';

interface Event {
    type: string;
    reason: string;
    message: string;
    count: number;
    lastTimestamp: string;
    object: string;
    namespace: string;
}

interface EventsTableProps {
    events: Event[];
}

// Duplicate TimeAgo here if cannot export from Dashboard easily, or refactor TimeAgo to shared util.
// For now, let's assume TimeAgo is exported or simply duplicate logic for speed.
const SimpleTimeAgo = ({ timestamp }: { timestamp: string }) => {
    if (!timestamp) return <span className="text-gray-500">-</span>;
    const date = new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return <span>{diff}s</span>;
    if (diff < 3600) return <span>{Math.floor(diff / 60)}m</span>;
    if (diff < 86400) return <span>{Math.floor(diff / 3600)}h</span>;
    return <span>{Math.floor(diff / 86400)}d</span>;
};


export const EventsTable: React.FC<EventsTableProps> = ({ events }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [activeTab, setActiveTab] = useState<'all' | 'unhealthy' | 'policy' | 'generic'>('all');
    const ITEMS_PER_PAGE = 10;

    // Reset pagination when tab changes
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab]);

    const filteredEvents = events.filter(e => {
        if (activeTab === 'all') return true;
        if (activeTab === 'policy') return e.reason === 'PolicyViolation' || e.reason === 'Forbidden';
        if (activeTab === 'unhealthy') return e.type === 'Warning' && e.reason !== 'PolicyViolation' && e.reason !== 'Forbidden';
        if (activeTab === 'generic') return e.type !== 'Warning';
        return true;
    });

    const totalPages = Math.ceil(filteredEvents.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const currentEvents = filteredEvents.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const handlePrev = () => {
        setCurrentPage(p => Math.max(1, p - 1));
    };

    const handleNext = () => {
        setCurrentPage(p => Math.min(totalPages, p + 1));
    };

    return (
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <AlertTriangle size={20} className="text-yellow-400" /> Cluster Events
                </h3>
                <div className="flex items-center gap-4">
                    <ToggleGroup
                        value={activeTab}
                        onChange={(v) => setActiveTab(v as any)}
                        options={[
                            { value: 'all', label: 'All', icon: List },
                            { value: 'unhealthy', label: 'Warnings', icon: AlertCircle },
                            { value: 'policy', label: 'Policy', icon: ShieldAlert },
                            { value: 'generic', label: 'Info', icon: Info },
                        ]}
                    />
                    <span className="text-xs text-gray-500 bg-white/5 px-2 py-1 rounded-full border border-white/5">
                        {filteredEvents.length} events
                    </span>
                </div>
            </div>

            {filteredEvents.length === 0 ? (
                <div className="p-8 text-center text-gray-500 italic">
                    {events.length === 0 ? "No recent events found." : "No events match this filter."}
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-white/5 text-gray-400 font-medium border-b border-white/10">
                            <tr>
                                <th className="px-6 py-3 w-12">Type</th>
                                <th className="px-6 py-3 w-32">Reason</th>
                                <th className="px-6 py-3">Message</th>
                                <th className="px-6 py-3 w-48">Object</th>
                                <th className="px-6 py-3 w-24 text-right">Count</th>
                                <th className="px-6 py-3 w-24 text-right">Age</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {currentEvents.map((evt, idx) => (
                                <tr key={idx} className="hover:bg-white/5 transition-colors group">
                                    <td className="px-6 py-3">
                                        {evt.type === 'Warning' ? (
                                            <AlertTriangle size={16} className="text-red-400" />
                                        ) : (
                                            <Info size={16} className="text-blue-400" />
                                        )}
                                    </td>
                                    <td className="px-6 py-3 font-medium text-gray-300">
                                        {evt.reason}
                                    </td>
                                    <td className="px-6 py-3 text-gray-400 max-w-md truncate group-hover:whitespace-normal group-hover:break-words text-xs font-mono">
                                        {evt.message}
                                    </td>
                                    <td className="px-6 py-3 text-gray-400 text-xs">
                                        {evt.object}
                                        <div className="text-[10px] text-gray-600">{evt.namespace}</div>
                                    </td>
                                    <td className="px-6 py-3 text-right text-gray-500">
                                        {evt.count > 1 && <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white">{evt.count}</span>}
                                    </td>
                                    <td className="px-6 py-3 text-right text-gray-400 whitespace-nowrap">
                                        <SimpleTimeAgo timestamp={evt.lastTimestamp} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination Footer */}
            {filteredEvents.length > ITEMS_PER_PAGE && (
                <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between bg-white/5">
                    <div className="text-xs text-gray-500">
                        Showing {startIndex + 1} to {Math.min(startIndex + ITEMS_PER_PAGE, filteredEvents.length)} of {filteredEvents.length} events
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handlePrev}
                            disabled={currentPage === 1}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="text-xs text-gray-400 font-medium px-2">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            onClick={handleNext}
                            disabled={currentPage === totalPages}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
