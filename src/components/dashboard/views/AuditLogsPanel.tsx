import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
    Search, Filter, AlertCircle, RefreshCw,
    ChevronDown, ChevronRight, Clock, AlertTriangle, X
} from 'lucide-react';
import { TableVirtuoso } from 'react-virtuoso';
import { IColumn } from '../../shared/VirtualizedTable';
import { GlassButton } from '../../shared/GlassButton';
import {
    AuditLogEntry, KUBERNETES_VERBS,
    filterByUsername, sortAuditEntries,
} from '../../../utils/audit-log-utils';

const tableStyles = `
  .audit-logs-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .audit-logs-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .audit-logs-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .audit-logs-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .audit-logs-table-container th {
    padding: 0.75rem 1.5rem;
    outline: none;
    position: relative;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: #6b7280;
    text-transform: uppercase;
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-align: left;
    white-space: nowrap;
  }
  .audit-logs-table-container th:first-child {
    border-top-left-radius: 0;
  }
  .audit-logs-table-container th:last-child {
    border-top-right-radius: 0;
  }
  .audit-logs-table-container th.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .audit-logs-table-container td {
    padding: 0.75rem 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    font-size: var(--lumen-table-font-size, 14px);
  }
  .audit-logs-table-container td.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .audit-logs-table-container td.no-truncate {
    overflow: visible;
    text-overflow: clip;
  }
  .column-resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .column-resize-handle:hover::after,
  .column-resize-handle.resizing::after {
    content: '';
    width: 2px;
    height: 100%;
    background-color: rgba(59, 130, 246, 0.5);
  }
  .column-resize-handle.resizing::after {
    background-color: rgba(59, 130, 246, 0.8);
  }
`;

function loadColumnWidths(tableId: string, columns: IColumn[]): Record<string, number> {
    const defaults: Record<string, number> = {};
    columns.forEach(c => { defaults[c.dataKey] = c.width ?? 150; });
    try {
        const saved = localStorage.getItem(`table-column-widths-${tableId}`);
        if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaults;
}

function saveColumnWidths(tableId: string, widths: Record<string, number>) {
    try {
        localStorage.setItem(`table-column-widths-${tableId}`, JSON.stringify(widths));
    } catch { /* ignore */ }
}

const VirtuosoTableHead = React.forwardRef<HTMLTableSectionElement>((props, ref) => (
    <thead {...props} ref={ref} style={{ ...(props as any).style, position: 'sticky', top: 0, zIndex: 2 }} />
));

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
    if (opts.eventSource === 'user') {
        lines.push('| filter user.username not like /^system:/');
        lines.push('| filter userAgent not like /kubelet/');
        lines.push('| filter userAgent not like /kube-controller/');
        lines.push('| filter userAgent not like /kube-scheduler/');
    }
    if (opts.namespace.trim()) {
        lines.push(`| filter objectRef.namespace like /${opts.namespace.trim()}/`);
    }
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

    // --- TableVirtuoso state ---
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // --- Build time params ---
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

    // --- Fetch events ---
    const fetchEvents = useCallback(async () => {
        setLoading(true);
        setError(null);
        setHasSearched(true);
        try {
            const tp = getTimeParams();
            const query = buildInsightsQuery({ eventSource, namespace: namespaceText, verbs: selectedVerbs, limit: resultLimit });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (window as any).k8s.aws.queryAuditLogs({ region, clusterName, startTime: tp.startTime, endTime: tp.endTime, query });
            if (result.error) { setError(result.error); return; }
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

    const handleSearch = useCallback(() => { fetchEvents(); }, [fetchEvents]);
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSearch(); }, [handleSearch]);

    // --- Client-side username filter ---
    const filteredEvents = useMemo(() => filterByUsername(events, usernameText), [events, usernameText]);

    // --- Sorting ---
    const sortedEvents = useMemo(() => {
        if (!sortConfig) return filteredEvents;
        return sortAuditEntries(filteredEvents, sortConfig.key as keyof AuditLogEntry, sortConfig.direction);
    }, [filteredEvents, sortConfig]);

    const handleSort = useCallback((key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
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
            label: 'Time', dataKey: 'timestamp', width: 180, sortable: true,
            cellRenderer: (val: string) => {
                const d = new Date(val);
                const formatted = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                return <span className="font-mono text-xs text-gray-300" title={d.toISOString()}>{formatted}</span>;
            },
        },
        {
            label: 'Verb', dataKey: 'verb', width: 100, sortable: true,
            cellRenderer: (val: string) => (<span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/10 text-blue-300 font-mono">{val}</span>),
        },
        { label: 'User', dataKey: 'username', width: 220, sortable: true, flexGrow: 1 },
        { label: 'Namespace', dataKey: 'namespace', width: 140, sortable: true },
        { label: 'Resource', dataKey: 'resource', width: 140, sortable: true },
        { label: 'Name', dataKey: 'resourceName', width: 180, sortable: true, flexGrow: 1 },
        {
            label: 'Status', dataKey: 'statusCode', width: 80, sortable: true,
            cellRenderer: (val: number) => {
                const color = val >= 400 ? 'text-red-400' : val >= 300 ? 'text-yellow-400' : 'text-green-400';
                return <span className={`font-mono text-xs ${color}`}>{val}</span>;
            },
        },
    ], []);

    // --- Initialize column widths ---
    useEffect(() => {
        setColumnWidths(loadColumnWidths('audit-logs', columns));
    }, []);

    // --- Container resize observer ---
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) setContainerWidth(entry.contentRect.width);
        });
        observer.observe(el);
        setContainerWidth(el.clientWidth);
        return () => observer.disconnect();
    }, []);

    // --- Column resize logic ---
    useEffect(() => {
        if (!resizing) return;
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX;
            const newW = Math.max(50, resizing.startW + delta);
            setColumnWidths(prev => ({ ...prev, [resizing.key]: newW }));
        };
        const onUp = () => {
            setColumnWidths(prev => { saveColumnWidths('audit-logs', prev); return prev; });
            setResizing(null);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [resizing]);

    const effectiveWidths = useMemo(() => {
        const baseTotal = Object.values(columnWidths).reduce((a, b) => a + b, 0);
        if (containerWidth <= baseTotal || containerWidth === 0) return columnWidths;
        const extraSpace = containerWidth - baseTotal;
        const totalGrow = columns.reduce((sum, col) => sum + (col.flexGrow ?? 0), 0);
        if (totalGrow === 0) return columnWidths;
        const result: Record<string, number> = {};
        for (const col of columns) {
            const base = columnWidths[col.dataKey] ?? (col.width ?? 150);
            const grow = col.flexGrow ?? 0;
            result[col.dataKey] = base + (grow > 0 ? Math.floor(extraSpace * grow / totalGrow) : 0);
        }
        return result;
    }, [columnWidths, containerWidth, columns]);

    const effectiveTotalWidth = useMemo(
        () => Object.values(effectiveWidths).reduce((a, b) => a + b, 0),
        [effectiveWidths]
    );

    const effectiveTotalWidthRef = useRef(effectiveTotalWidth);
    effectiveTotalWidthRef.current = effectiveTotalWidth;
    const dataRef = useRef(sortedEvents);
    dataRef.current = sortedEvents;
    const onRowClickRef = useRef(handleRowClick);
    onRowClickRef.current = handleRowClick;

    const virtuosoComponents = useMemo(() => ({
        Table: ({ style, ...props }: any) => (
            <table {...props} style={{ ...style, width: '100%', minWidth: effectiveTotalWidthRef.current, tableLayout: 'fixed' as const, borderCollapse: 'separate' as const, borderSpacing: 0 }} />
        ),
        TableHead: VirtuosoTableHead,
        TableRow: ({ style, ...props }: any) => {
            const index = props['data-index'] as number;
            const rowData = dataRef.current[index];
            return (
                <tr
                    {...props}
                    style={{ ...style, height: 52, cursor: 'pointer' }}
                    className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]"
                    onClick={() => rowData && onRowClickRef.current?.(rowData)}
                />
            );
        },
    }), []);

    const fixedHeaderContent = useCallback(() => (
        <tr>
            {columns.map(col => (
                <th
                    key={col.dataKey}
                    style={{ width: effectiveWidths[col.dataKey], minWidth: columnWidths[col.dataKey] }}
                    className={col.compact ? 'compact-column' : ''}
                    onClick={col.sortable ? () => handleSort(col.dataKey) : undefined}
                >
                    <div className="flex items-center gap-1 cursor-pointer select-none group w-full">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                            {col.label}
                            {col.sortable && sortConfig?.key === col.dataKey && (
                                <span className="text-xs text-blue-400">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                            )}
                        </div>
                        <div
                            className={`column-resize-handle ${resizing?.key === col.dataKey ? 'resizing' : ''}`}
                            onMouseDown={(e) => { e.stopPropagation(); setResizing({ key: col.dataKey, startX: e.clientX, startW: columnWidths[col.dataKey] }); }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </th>
            ))}
        </tr>
    ), [columns, effectiveWidths, columnWidths, handleSort, sortConfig, resizing]);

    const rowContent = useCallback((index: number) => {
        const rowData = sortedEvents[index];
        if (!rowData) return null;
        return (
            <>
                {columns.map(col => {
                    const cellData = (rowData as any)[col.dataKey];
                    return (
                        <td key={col.dataKey} style={{ width: effectiveWidths[col.dataKey], minWidth: columnWidths[col.dataKey] }} className={col.compact ? 'compact-column' : ''}>
                            {col.cellRenderer ? col.cellRenderer(cellData, rowData) : <span className="text-gray-300 text-sm truncate">{cellData}</span>}
                        </td>
                    );
                })}
            </>
        );
    }, [sortedEvents, columns, effectiveWidths, columnWidths]);

    const toDateInputValue = (d?: Date) => d ? d.toISOString().split('T')[0] : '';

    return (
        <div className="flex flex-col flex-1 gap-4 min-h-0">
            {/* Search Panel */}
            <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex flex-col gap-1 min-w-[180px]">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Search size={12} /> Namespace</label>
                    <input type="text" placeholder="e.g. kube-system" value={namespaceText} onChange={e => setNamespaceText(e.target.value)} onKeyDown={handleKeyDown} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50" />
                </div>
                <div className="flex flex-col gap-1 min-w-[180px]">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Search size={12} /> Username</label>
                    <input type="text" placeholder="Filter by username..." value={usernameText} onChange={e => setUsernameText(e.target.value)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50" />
                </div>
                <div className="flex flex-col gap-1 relative">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Verbs</label>
                    <button onClick={() => setVerbDropdownOpen(prev => !prev)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50 flex items-center gap-2 min-w-[160px]">
                        <span className="flex-1 text-left truncate">{selectedVerbs.length === 0 ? 'All Verbs' : `${selectedVerbs.length} selected`}</span>
                        <ChevronDown size={14} className={`transition-transform ${verbDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {verbDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 z-50 w-52 rounded-lg bg-gray-900 border border-white/10 shadow-xl py-1 max-h-60 overflow-y-auto">
                            {KUBERNETES_VERBS.map(verb => (
                                <label key={verb} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-sm text-gray-300">
                                    <input type="checkbox" checked={selectedVerbs.includes(verb)} onChange={() => toggleVerb(verb)} className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/50" />
                                    {verb}
                                </label>
                            ))}
                            {selectedVerbs.length > 0 && (
                                <button onClick={() => setSelectedVerbs([])} className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 border-t border-white/5 mt-1">Clear all</button>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Source</label>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                        <button onClick={() => setEventSource('user')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${eventSource === 'user' ? 'bg-blue-600/30 text-blue-300' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>User Events</button>
                        <button onClick={() => setEventSource('all')} className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-white/10 ${eventSource === 'all' ? 'bg-blue-600/30 text-blue-300' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>All Events</button>
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Clock size={12} /> Time Range</label>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                        {TIME_RANGE_OPTIONS.map(opt => (
                            <button key={opt.value} onClick={() => setTimeRange(opt.value)} className={`px-3 py-1.5 text-xs font-medium transition-colors ${timeRange === opt.value ? 'bg-blue-600/30 text-blue-300' : 'bg-white/5 text-gray-400 hover:bg-white/10'} ${opt.value !== '1h' ? 'border-l border-white/10' : ''}`}>{opt.label}</button>
                        ))}
                    </div>
                </div>
                {timeRange === 'custom' && (
                    <div className="flex items-end gap-2">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">Start</label>
                            <input type="date" value={toDateInputValue(customStartDate)} onChange={e => setCustomStartDate(e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">End</label>
                            <input type="date" value={toDateInputValue(customEndDate)} onChange={e => setCustomEndDate(e.target.value ? new Date(e.target.value + 'T23:59:59') : undefined)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50" />
                        </div>
                    </div>
                )}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Limit</label>
                    <select value={resultLimit} onChange={e => setResultLimit(Number(e.target.value))} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer min-w-[90px]">
                        <option value={200} className="bg-gray-900">200</option>
                        <option value={500} className="bg-gray-900">500</option>
                        <option value={1000} className="bg-gray-900">1000</option>
                    </select>
                </div>
                <GlassButton variant="primary" onClick={handleSearch} isLoading={loading} icon={<Search size={14} />} className="self-end">Search</GlassButton>
            </div>

            {/* Error states */}
            {error && !loading && (
                isMissingLogGroupError(error) ? (
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-start gap-3 text-yellow-400">
                        <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-semibold mb-1">Control Plane Logging Not Enabled</p>
                            <p className="text-sm">CloudWatch log group not found for this cluster. Enable audit logging in the EKS console under <span className="font-mono text-yellow-300">Logging → Audit</span>.</p>
                        </div>
                        <button onClick={handleSearch} className="p-2 hover:bg-yellow-500/20 rounded-lg flex-shrink-0" title="Retry"><RefreshCw size={16} /></button>
                    </div>
                ) : (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-400">
                        <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-semibold mb-1">{isAuthError(error) ? 'Authentication Error' : isPermissionsError(error) ? 'Permissions Error' : 'Error Loading Audit Logs'}</p>
                            <p className="text-sm">{isAuthError(error) ? 'Your AWS credentials have expired or are invalid. Please refresh your credentials and try again.' : isPermissionsError(error) ? 'Missing required permissions: logs:StartQuery and logs:GetQueryResults. Ensure your IAM role/user has CloudWatch Logs Insights access.' : error}</p>
                        </div>
                        <button onClick={handleSearch} className="p-2 hover:bg-red-500/20 rounded-lg flex-shrink-0" title="Retry"><RefreshCw size={16} /></button>
                    </div>
                )
            )}

            {loading && !error && (
                <div className="flex items-center justify-center flex-1">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                </div>
            )}

            {!loading && !error && !hasSearched && (
                <div className="flex flex-col items-center justify-center flex-1 text-gray-500 gap-2">
                    <Search size={32} />
                    <p className="text-sm">Set your filters and click Search to query audit logs.</p>
                </div>
            )}

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
                                <div ref={containerRef} className="relative flex-1 h-full w-full min-h-[400px] audit-logs-table-container rounded-t-lg" style={{ overflowClipMargin: 0, overflow: 'clip' }}>
                                    <style>{tableStyles}</style>
                                    <TableVirtuoso
                                        totalCount={sortedEvents.length}
                                        fixedHeaderContent={fixedHeaderContent}
                                        itemContent={rowContent}
                                        style={{ height: '100%' }}
                                        overscan={200}
                                        components={virtuosoComponents}
                                    />
                                </div>
                            </div>

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
                                            <button onClick={() => setExpandedEventId(null)} className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"><X size={14} /></button>
                                        </div>
                                        <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all leading-relaxed">{formattedJson}</pre>
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
