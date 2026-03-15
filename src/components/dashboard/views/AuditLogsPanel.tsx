import React, { useState, useMemo, useCallback } from 'react';
import {
    Search, Filter, AlertCircle, RefreshCw,
    ChevronDown, ChevronRight, Clock, AlertTriangle, X
} from 'lucide-react';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { GlassButton } from '../../shared/GlassButton';
import {
    AuditLogEntry, KUBERNETES_VERBS,
    filterByUsername, sortAuditEntries,
} from '../../../utils/audit-log-utils';

interface AuditLogsPanelProps {
    region: string;
    clusterName: string;
}

const TIME_RANGE_OPTIONS = [
    { value: '1h', label: '1h' },
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: 'custom', label: 'Custom' },
] as const;

function computeTimeRange(range: '1h' | '24h' | '7d'): { startTime: Date; endTime: Date } {
    const now = new Date();
    const ms = range === '1h' ? 3600000 : range === '24h' ? 86400000 : 604800000;
    return { startTime: new Date(now.getTime() - ms), endTime: now };
}

function isAuthError(error: string): boolean {
    return /expired|invalid|credentials/i.test(error);
}

function isPermissionsError(error: string): boolean {
    return /permission|AccessDenied|StartQuery|GetQueryResults/i.test(error);
}

function isMissingLogGroupError(error: string): boolean {
    return /not enabled|log group/i.test(error);
}

/**
 * Build a CloudWatch Logs Insights query string from the current filter state.
 */
function buildInsightsQuery(opts: {
    eventSource: 'user' | 'all';
    namespace: string;
    verbs: string[];
    limit: number;
}): string {
    const lines: string[] = [
        'fields @timestamp, @message',
        '| filter @logStream like /^kube-apiserver-audit/',
    ];

    // Event source filter — exclude system accounts and internal user agents
    if (opts.eventSource === 'user') {
        lines.push('| filter user.username not like /^system:/');
        lines.push('| filter userAgent not like /kubelet/');
        lines.push('| filter userAgent not like /kube-controller/');
        lines.push('| filter userAgent not like /kube-scheduler/');
    }

    // Namespace — wildcarded both sides
    if (opts.namespace.trim()) {
        lines.push(`| filter objectRef.namespace like /${opts.namespace.trim()}/`);
    }

    // Verb filter
    if (opts.verbs.length === 1) {
        lines.push(`| filter verb = "${opts.verbs[0]}"`);
    } else if (opts.verbs.length > 1) {
        const verbList = opts.verbs.map(v => `"${v}"`).join(', ');
        lines.push(`| filter verb in [${verbList}]`);
    }

    lines.push('| sort @timestamp desc');
    lines.push(`| limit ${opts.limit}`);

    return lines.join('\n');
}

export const AuditLogsPanel: React.FC<AuditLogsPanelProps> = ({ region, clusterName }) => {
    // --- Search/filter state ---
    const [namespaceText, setNamespaceText] = useState('');
    const [usernameText, setUsernameText] = useState('');
    const [selectedVerbs, setSelectedVerbs] = useState<string[]>([]);
    const [eventSource, setEventSource] = useState<'user' | 'all'>('user');
    const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | 'custom'>('24h');
    const [customStartDate, setCustomStartDate] = useState<Date | undefined>();
    const [customEndDate, setCustomEndDate] = useState<Date | undefined>();

    // --- Data state ---
    const [events, setEvents] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(false);

    // --- UI state ---
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'timestamp', direction: 'desc' });
    const [verbDropdownOpen, setVerbDropdownOpen] = useState(false);
    const [resultLimit, setResultLimit] = useState<number>(200);

    // --- Build time params from current state ---
    const getTimeParams = useCallback(() => {
        if (timeRange === 'custom') {
            return {
                startTime: customStartDate?.toISOString() ?? new Date().toISOString(),
                endTime: customEndDate?.toISOString() ?? new Date().toISOString(),
            };
        }
        const { startTime, endTime } = computeTimeRange(timeRange);
        return { startTime: startTime.toISOString(), endTime: endTime.toISOString() };
    }, [timeRange, customStartDate, customEndDate]);

    // --- Fetch events via Logs Insights ---
    const fetchEvents = useCallback(async () => {
        setLoading(true);
        setError(null);
        setHasSearched(true);

        try {
            const tp = getTimeParams();
            const query = buildInsightsQuery({
                eventSource,
                namespace: namespaceText,
                verbs: selectedVerbs,
                limit: resultLimit,
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (window as any).k8s.aws.queryAuditLogs({
                region,
                clusterName,
                startTime: tp.startTime,
                endTime: tp.endTime,
                query,
            });

            if (result.error) {
                setError(result.error);
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parsed: AuditLogEntry[] = (result.events ?? []).map((e: any) => ({
                ...e,
                id: e.id || `${e.timestamp}-${e.verb}-${e.resource}-${e.resourceName}`,
            }));

            setEvents(parsed);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err?.message || String(err));
        } finally {
            setLoading(false);
        }
    }, [region, clusterName, getTimeParams, eventSource, namespaceText, selectedVerbs, resultLimit]);

    // --- Handle search ---
    const handleSearch = useCallback(() => {
        fetchEvents();
    }, [fetchEvents]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    }, [handleSearch]);

    // --- Client-side username filter ---
    const filteredEvents = useMemo(() => {
        return filterByUsername(events, usernameText);
    }, [events, usernameText]);

    // --- Sorting ---
    const sortedEvents = useMemo(() => {
        if (!sortConfig) return filteredEvents;
        return sortAuditEntries(filteredEvents, sortConfig.key as keyof AuditLogEntry, sortConfig.direction);
    }, [filteredEvents, sortConfig]);

    const handleSort = useCallback((key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) {
                return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
            }
            return { key, direction: 'asc' };
        });
    }, []);

    const handleRowClick = useCallback((row: AuditLogEntry) => {
        setExpandedEventId(prev => prev === row.id ? null : row.id);
    }, []);

    const toggleVerb = useCallback((verb: string) => {
        setSelectedVerbs(prev => prev.includes(verb) ? prev.filter(v => v !== verb) : [...prev, verb]);
    }, []);

    // --- Table columns ---
    const columns: IColumn[] = useMemo(() => [
        {
            label: 'Time',
            dataKey: 'timestamp',
            width: 180,
            sortable: true,
            cellRenderer: (val: string) => {
                const d = new Date(val);
                const formatted = d.toLocaleString(undefined, {
                    month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                });
                return <span className="font-mono text-xs text-gray-300" title={d.toISOString()}>{formatted}</span>;
            },
        },
        {
            label: 'Verb',
            dataKey: 'verb',
            width: 100,
            sortable: true,
            cellRenderer: (val: string) => (
                <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/10 text-blue-300 font-mono">{val}</span>
            ),
        },
        { label: 'User', dataKey: 'username', width: 220, sortable: true, flexGrow: 1 },
        { label: 'Namespace', dataKey: 'namespace', width: 140, sortable: true },
        { label: 'Resource', dataKey: 'resource', width: 140, sortable: true },
        { label: 'Name', dataKey: 'resourceName', width: 180, sortable: true, flexGrow: 1 },
        {
            label: 'Status',
            dataKey: 'statusCode',
            width: 80,
            sortable: true,
            cellRenderer: (val: number) => {
                const color = val >= 400 ? 'text-red-400' : val >= 300 ? 'text-yellow-400' : 'text-green-400';
                return <span className={`font-mono text-xs ${color}`}>{val}</span>;
            },
        },
    ], []);

    const toDateInputValue = (d?: Date) => d ? d.toISOString().split('T')[0] : '';

    // --- Render ---
    return (
        <div className="flex flex-col flex-1 gap-4 min-h-0">
            {/* Search Panel */}
            <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                {/* Namespace (server-side wildcard) */}
                <div className="flex flex-col gap-1 min-w-[180px]">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Search size={12} /> Namespace</label>
                    <input
                        type="text"
                        placeholder="e.g. kube-system"
                        value={namespaceText}
                        onChange={e => setNamespaceText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                    />
                </div>

                {/* Username (client-side) */}
                <div className="flex flex-col gap-1 min-w-[180px]">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Search size={12} /> Username</label>
                    <input
                        type="text"
                        placeholder="Filter by username..."
                        value={usernameText}
                        onChange={e => setUsernameText(e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                    />
                </div>

                {/* Verb multi-select */}
                <div className="flex flex-col gap-1 relative">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Verbs</label>
                    <button
                        onClick={() => setVerbDropdownOpen(prev => !prev)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50 flex items-center gap-2 min-w-[160px]"
                    >
                        <span className="flex-1 text-left truncate">
                            {selectedVerbs.length === 0 ? 'All Verbs' : `${selectedVerbs.length} selected`}
                        </span>
                        <ChevronDown size={14} className={`transition-transform ${verbDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {verbDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 z-50 w-52 rounded-lg bg-gray-900 border border-white/10 shadow-xl py-1 max-h-60 overflow-y-auto">
                            {KUBERNETES_VERBS.map(verb => (
                                <label key={verb} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-sm text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={selectedVerbs.includes(verb)}
                                        onChange={() => toggleVerb(verb)}
                                        className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/50"
                                    />
                                    {verb}
                                </label>
                            ))}
                            {selectedVerbs.length > 0 && (
                                <button
                                    onClick={() => setSelectedVerbs([])}
                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 border-t border-white/5 mt-1"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Event source toggle */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Source</label>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                        <button
                            onClick={() => setEventSource('user')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${eventSource === 'user'
                                ? 'bg-blue-600/30 text-blue-300'
                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                }`}
                        >
                            User Events
                        </button>
                        <button
                            onClick={() => setEventSource('all')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-white/10 ${eventSource === 'all'
                                ? 'bg-blue-600/30 text-blue-300'
                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                }`}
                        >
                            All Events
                        </button>
                    </div>
                </div>

                {/* Time range */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Clock size={12} /> Time Range</label>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                        {TIME_RANGE_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setTimeRange(opt.value)}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${timeRange === opt.value
                                    ? 'bg-blue-600/30 text-blue-300'
                                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                    } ${opt.value !== '1h' ? 'border-l border-white/10' : ''}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Custom date pickers */}
                {timeRange === 'custom' && (
                    <div className="flex items-end gap-2">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">Start</label>
                            <input
                                type="date"
                                value={toDateInputValue(customStartDate)}
                                onChange={e => setCustomStartDate(e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined)}
                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">End</label>
                            <input
                                type="date"
                                value={toDateInputValue(customEndDate)}
                                onChange={e => setCustomEndDate(e.target.value ? new Date(e.target.value + 'T23:59:59') : undefined)}
                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50"
                            />
                        </div>
                    </div>
                )}

                {/* Result limit */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Limit</label>
                    <select
                        value={resultLimit}
                        onChange={e => setResultLimit(Number(e.target.value))}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer min-w-[90px]"
                    >
                        <option value={200} className="bg-gray-900">200</option>
                        <option value={500} className="bg-gray-900">500</option>
                        <option value={1000} className="bg-gray-900">1000</option>
                    </select>
                </div>

                {/* Search button */}
                <GlassButton
                    variant="primary"
                    onClick={handleSearch}
                    isLoading={loading}
                    icon={<Search size={14} />}
                    className="self-end"
                >
                    Search
                </GlassButton>
            </div>

            {/* Error states */}
            {error && !loading && (
                isMissingLogGroupError(error) ? (
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-start gap-3 text-yellow-400">
                        <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-semibold mb-1">Control Plane Logging Not Enabled</p>
                            <p className="text-sm">
                                CloudWatch log group not found for this cluster. Enable audit logging in the EKS console under <span className="font-mono text-yellow-300">Logging → Audit</span>.
                            </p>
                        </div>
                        <button onClick={handleSearch} className="p-2 hover:bg-yellow-500/20 rounded-lg flex-shrink-0" title="Retry">
                            <RefreshCw size={16} />
                        </button>
                    </div>
                ) : (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-400">
                        <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-semibold mb-1">
                                {isAuthError(error) ? 'Authentication Error' : isPermissionsError(error) ? 'Permissions Error' : 'Error Loading Audit Logs'}
                            </p>
                            <p className="text-sm">
                                {isAuthError(error)
                                    ? 'Your AWS credentials have expired or are invalid. Please refresh your credentials and try again.'
                                    : isPermissionsError(error)
                                        ? 'Missing required permissions: logs:StartQuery and logs:GetQueryResults. Ensure your IAM role/user has CloudWatch Logs Insights access.'
                                        : error}
                            </p>
                        </div>
                        <button onClick={handleSearch} className="p-2 hover:bg-red-500/20 rounded-lg flex-shrink-0" title="Retry">
                            <RefreshCw size={16} />
                        </button>
                    </div>
                )
            )}

            {/* Loading state */}
            {loading && !error && (
                <div className="flex items-center justify-center flex-1">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                </div>
            )}

            {/* Initial state — no search yet */}
            {!loading && !error && !hasSearched && (
                <div className="flex flex-col items-center justify-center flex-1 text-gray-500 gap-2">
                    <Search size={32} />
                    <p className="text-sm">Set your filters and click Search to query audit logs.</p>
                </div>
            )}

            {/* Event table */}
            {!loading && !error && hasSearched && (
                <div className="flex-1 flex flex-col min-h-0">
                    {sortedEvents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center flex-1 text-gray-500 gap-2">
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
                                    tableId="audit-logs"
                                />
                            </div>

                            {/* Expanded event detail */}
                            {expandedEventId && (() => {
                                const evt = sortedEvents.find(e => e.id === expandedEventId);
                                if (!evt) return null;
                                let formattedJson = evt.rawEvent;
                                try { formattedJson = JSON.stringify(JSON.parse(evt.rawEvent), null, 2); } catch { /* use as-is */ }
                                return (
                                    <div className="mt-2 rounded-xl bg-white/5 border border-white/10 p-4 max-h-80 overflow-auto">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-white flex items-center gap-2">
                                                <ChevronRight size={14} className="rotate-90" />
                                                Event Detail — {evt.verb} {evt.resource}/{evt.resourceName}
                                            </span>
                                            <button onClick={() => setExpandedEventId(null)} className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white">
                                                <X size={14} />
                                            </button>
                                        </div>
                                        <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                                            {formattedJson}
                                        </pre>
                                    </div>
                                );
                            })()}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
