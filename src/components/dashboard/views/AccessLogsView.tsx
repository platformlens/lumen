import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    ArrowLeft, Search, Filter, AlertCircle, RefreshCw,
    ChevronDown, ChevronRight, Clock, AlertTriangle, X
} from 'lucide-react';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { GlassButton } from '../../shared/GlassButton';
import { TimeAgo } from '../../shared/TimeAgo';
import {
    AuditEvent, AccessLogsFilterState,
    filterByIdentity, filterByEventType,
    computeTimeRange, isDateRangeExceeding90Days, sortEvents
} from '../../../utils/cloudtrail-utils';

interface AccessLogsViewProps {
    region: string;
    clusterName: string;
    onBack: () => void;
}

const IDENTITY_TYPE_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'iam-user', label: 'IAM User' },
    { value: 'iam-role', label: 'IAM Role' },
    { value: 'service-account', label: 'Service Account' },
] as const;

const EVENT_TYPE_OPTIONS = [
    'CreateCluster',
    'DeleteNodegroup',
    'UpdateClusterConfig',
    'AccessKubernetesApi',
    'DescribeCluster',
    'CreateNodegroup',
    'UpdateNodegroupConfig',
    'ListClusters',
];

const TIME_RANGE_OPTIONS = [
    { value: '1h', label: 'Last 1 hour' },
    { value: '24h', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' },
    { value: 'custom', label: 'Custom Range' },
] as const;

function isAuthError(error: string): boolean {
    return /expired\s*token|security\s*token|unrecognized\s*client/i.test(error);
}

function isPermissionsError(error: string): boolean {
    return /access\s*denied|not\s*authorized|authorization/i.test(error);
}

export const AccessLogsView: React.FC<AccessLogsViewProps> = ({ region, clusterName, onBack }) => {
    // --- Filter state ---
    const [filters, setFilters] = useState<AccessLogsFilterState>({
        identityText: '',
        identityType: 'all',
        eventTypes: [],
        timeRange: '24h',
    });
    const [debouncedIdentityText, setDebouncedIdentityText] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Data state ---
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [nextToken, setNextToken] = useState<string | undefined>();
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // --- UI state ---
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [eventTypeDropdownOpen, setEventTypeDropdownOpen] = useState(false);

    // --- Debounce identity text ---
    const handleIdentityTextChange = useCallback((text: string) => {
        setFilters(prev => ({ ...prev, identityText: text }));
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebouncedIdentityText(text), 300);
    }, []);

    useEffect(() => {
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, []);

    // --- Compute time params ---
    const timeParams = useMemo(() => {
        if (filters.timeRange === 'custom') {
            return {
                startTime: filters.customStartDate?.toISOString() ?? new Date().toISOString(),
                endTime: filters.customEndDate?.toISOString() ?? new Date().toISOString(),
            };
        }
        const { startTime, endTime } = computeTimeRange(filters.timeRange);
        return { startTime: startTime.toISOString(), endTime: endTime.toISOString() };
    }, [filters.timeRange, filters.customStartDate, filters.customEndDate]);

    // --- 90-day warning ---
    const show90DayWarning = useMemo(() => {
        if (filters.timeRange !== 'custom' || !filters.customStartDate || !filters.customEndDate) return false;
        return isDateRangeExceeding90Days(filters.customStartDate, filters.customEndDate);
    }, [filters.timeRange, filters.customStartDate, filters.customEndDate]);

    // --- Fetch events ---
    const fetchEvents = useCallback(async (append = false) => {
        if (append) setLoadingMore(true);
        else setLoading(true);
        setError(null);

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (window as any).k8s.aws.lookupCloudTrailEvents({
                region,
                clusterName,
                startTime: timeParams.startTime,
                endTime: timeParams.endTime,
                nextToken: append ? nextToken : undefined,
                maxResults: 50,
            });

            if (append) {
                setEvents(prev => [...prev, ...result.events]);
            } else {
                setEvents(result.events);
            }
            setNextToken(result.nextToken);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err?.message || String(err));
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [region, clusterName, timeParams, nextToken]);

    // --- Fetch on mount and time range change ---
    useEffect(() => {
        fetchEvents(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [region, clusterName, timeParams.startTime, timeParams.endTime]);

    // --- Client-side filtering ---
    const filteredEvents = useMemo(() => {
        let result = filterByIdentity(events, debouncedIdentityText, filters.identityType);
        result = filterByEventType(result, filters.eventTypes);
        return result;
    }, [events, debouncedIdentityText, filters.identityType, filters.eventTypes]);

    // --- Sorting ---
    const sortedEvents = useMemo(() => {
        if (!sortConfig) return filteredEvents;
        return sortEvents(filteredEvents, sortConfig.key as keyof AuditEvent, sortConfig.direction);
    }, [filteredEvents, sortConfig]);

    const handleSort = useCallback((key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) {
                return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
            }
            return { key, direction: 'asc' };
        });
    }, []);

    // --- Row click expand ---
    const handleRowClick = useCallback((row: AuditEvent) => {
        setExpandedEventId(prev => prev === row.eventId ? null : row.eventId);
    }, []);

    // --- Toggle event type filter ---
    const toggleEventType = useCallback((eventType: string) => {
        setFilters(prev => {
            const has = prev.eventTypes.includes(eventType);
            return {
                ...prev,
                eventTypes: has
                    ? prev.eventTypes.filter(t => t !== eventType)
                    : [...prev.eventTypes, eventType],
            };
        });
    }, []);

    // --- Table columns ---
    const columns: IColumn[] = useMemo(() => [
        {
            label: 'Time',
            dataKey: 'eventTime',
            width: 160,
            sortable: true,
            cellRenderer: (val: string) => (
                <span title={new Date(val).toLocaleString()}>
                    <TimeAgo timestamp={val} />
                </span>
            ),
        },
        { label: 'Event Name', dataKey: 'eventName', width: 200, sortable: true, flexGrow: 1 },
        { label: 'Username', dataKey: 'username', width: 250, sortable: true, flexGrow: 1 },
        { label: 'Source IP', dataKey: 'sourceIpAddress', width: 140, sortable: true },
        { label: 'User Agent', dataKey: 'userAgent', width: 200, sortable: true, flexGrow: 1 },
    ], []);

    // --- Format date for native input ---
    const toDateInputValue = (d?: Date) => d ? d.toISOString().split('T')[0] : '';

    // --- Render ---
    return (
        <div className="flex flex-col h-full gap-4 p-1">
            {/* Header */}
            <div className="flex items-center gap-3">
                <GlassButton variant="secondary" icon={<ArrowLeft size={16} />} onClick={onBack}>
                    Back
                </GlassButton>
                <h2 className="text-lg font-semibold text-white">EKS Access Logs</h2>
                <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-xs font-mono">
                    {clusterName}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-gray-400 text-xs font-mono">
                    {region}
                </span>
            </div>

            {/* Filter Panel */}
            <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                {/* Identity text */}
                <div className="flex flex-col gap-1 min-w-[200px]">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Search size={12} /> Identity</label>
                    <input
                        type="text"
                        placeholder="Filter by username..."
                        value={filters.identityText}
                        onChange={e => handleIdentityTextChange(e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                    />
                </div>

                {/* Identity type */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Type</label>
                    <select
                        value={filters.identityType}
                        onChange={e => setFilters(prev => ({ ...prev, identityType: e.target.value as AccessLogsFilterState['identityType'] }))}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                    >
                        {IDENTITY_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value} className="bg-gray-900">{opt.label}</option>
                        ))}
                    </select>
                </div>

                {/* Event type multi-select */}
                <div className="flex flex-col gap-1 relative">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Event Types</label>
                    <button
                        onClick={() => setEventTypeDropdownOpen(prev => !prev)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50 flex items-center gap-2 min-w-[180px]"
                    >
                        <span className="flex-1 text-left truncate">
                            {filters.eventTypes.length === 0 ? 'All Events' : `${filters.eventTypes.length} selected`}
                        </span>
                        <ChevronDown size={14} className={`transition-transform ${eventTypeDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {eventTypeDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-lg bg-gray-900 border border-white/10 shadow-xl py-1 max-h-60 overflow-y-auto">
                            {EVENT_TYPE_OPTIONS.map(evt => (
                                <label key={evt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-sm text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={filters.eventTypes.includes(evt)}
                                        onChange={() => toggleEventType(evt)}
                                        className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/50"
                                    />
                                    {evt}
                                </label>
                            ))}
                            {filters.eventTypes.length > 0 && (
                                <button
                                    onClick={() => setFilters(prev => ({ ...prev, eventTypes: [] }))}
                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 border-t border-white/5 mt-1"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Time range segmented control */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Clock size={12} /> Time Range</label>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                        {TIME_RANGE_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setFilters(prev => ({ ...prev, timeRange: opt.value }))}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${filters.timeRange === opt.value
                                    ? 'bg-blue-600/30 text-blue-300 border-blue-500/30'
                                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                    } ${opt.value !== '1h' ? 'border-l border-white/10' : ''}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Custom date pickers */}
                {filters.timeRange === 'custom' && (
                    <div className="flex items-end gap-2">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">Start</label>
                            <input
                                type="date"
                                value={toDateInputValue(filters.customStartDate)}
                                onChange={e => {
                                    const d = e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined;
                                    setFilters(prev => ({ ...prev, customStartDate: d }));
                                }}
                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">End</label>
                            <input
                                type="date"
                                value={toDateInputValue(filters.customEndDate)}
                                onChange={e => {
                                    const d = e.target.value ? new Date(e.target.value + 'T23:59:59') : undefined;
                                    setFilters(prev => ({ ...prev, customEndDate: d }));
                                }}
                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                    </div>
                )}

                {/* Refresh button */}
                <button
                    onClick={() => fetchEvents(false)}
                    disabled={loading}
                    className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 self-end"
                    title="Refresh"
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* 90-day warning */}
            {show90DayWarning && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
                    <AlertTriangle size={16} className="flex-shrink-0" />
                    CloudTrail event history is limited to 90 days. Results may be incomplete for the selected range.
                </div>
            )}

            {/* Error states */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-400">
                    <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="font-semibold mb-1">
                            {isAuthError(error) ? 'Authentication Error' : isPermissionsError(error) ? 'Permissions Error' : 'Error Loading Events'}
                        </p>
                        <p className="text-sm">
                            {isPermissionsError(error)
                                ? 'Missing required permission: cloudtrail:LookupEvents. Ensure your AWS credentials have CloudTrail read access.'
                                : error}
                        </p>
                    </div>
                    <button onClick={() => fetchEvents(false)} className="p-2 hover:bg-red-500/20 rounded-lg flex-shrink-0" title="Retry">
                        <RefreshCw size={16} />
                    </button>
                </div>
            )}

            {/* Loading state */}
            {loading && !error && (
                <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                </div>
            )}

            {/* Event table */}
            {!loading && !error && (
                <div className="flex-1 flex flex-col min-h-0">
                    {sortedEvents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
                            <Search size={32} />
                            <p className="text-sm">No audit events found for the selected filters.</p>
                        </div>
                    ) : (
                        <>
                            <div className="text-xs text-gray-500 mb-2">
                                {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
                                {events.length !== filteredEvents.length && ` (filtered from ${events.length})`}
                            </div>
                            <div className="flex-1 min-h-0">
                                <VirtualizedTable
                                    data={sortedEvents}
                                    columns={columns}
                                    onRowClick={handleRowClick}
                                    sortConfig={sortConfig}
                                    onSort={handleSort}
                                    tableId="access-logs"
                                />
                            </div>

                            {/* Expanded event detail */}
                            {expandedEventId && (() => {
                                const evt = sortedEvents.find(e => e.eventId === expandedEventId);
                                if (!evt) return null;
                                let formattedJson = evt.rawEvent;
                                try { formattedJson = JSON.stringify(JSON.parse(evt.rawEvent), null, 2); } catch { /* raw event not valid JSON, use as-is */ }
                                return (
                                    <div className="mt-2 rounded-xl bg-white/5 border border-white/10 p-4 max-h-80 overflow-auto">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-white flex items-center gap-2">
                                                <ChevronRight size={14} className="rotate-90" />
                                                Event Detail — {evt.eventName}
                                            </span>
                                            <button
                                                onClick={() => setExpandedEventId(null)}
                                                className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                        <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                                            {formattedJson}
                                        </pre>
                                    </div>
                                );
                            })()}

                            {/* Load More */}
                            {nextToken && (
                                <div className="flex justify-center mt-3 pb-2">
                                    <GlassButton
                                        variant="secondary"
                                        onClick={() => fetchEvents(true)}
                                        isLoading={loadingMore}
                                        icon={loadingMore ? undefined : <ChevronDown size={16} />}
                                    >
                                        {loadingMore ? 'Loading...' : 'Load More'}
                                    </GlassButton>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
