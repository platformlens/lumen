import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    ArrowLeft, Search, Filter, AlertCircle, RefreshCw,
    ChevronDown, ChevronRight, Clock, AlertTriangle, X
} from 'lucide-react';
import { TableVirtuoso } from 'react-virtuoso';
import { IColumn } from '../../shared/VirtualizedTable';
import { GlassButton } from '../../shared/GlassButton';
import { TimeAgo } from '../../shared/TimeAgo';
import {
    AuditEvent, AccessLogsFilterState,
    filterByIdentity, filterByEventType,
    computeTimeRange, isDateRangeExceeding90Days, sortEvents
} from '../../../utils/cloudtrail-utils';
import { AuditLogsPanel } from './AuditLogsPanel';

const tableStyles = `
  .access-logs-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .access-logs-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .access-logs-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .access-logs-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .access-logs-table-container th {
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
  .access-logs-table-container th:first-child {
    border-top-left-radius: 0;
  }
  .access-logs-table-container th:last-child {
    border-top-right-radius: 0;
  }
  .access-logs-table-container th.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .access-logs-table-container td {
    padding: 0.75rem 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    font-size: var(--lumen-table-font-size, 14px);
  }
  .access-logs-table-container td.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .access-logs-table-container td.no-truncate {
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
    // --- Tab state ---
    const [activeTab, setActiveTab] = useState<'access' | 'audit'>('access');

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

    // --- TableVirtuoso state ---
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

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
            label: 'Time', dataKey: 'eventTime', width: 160, sortable: true,
            cellRenderer: (val: string) => (
                <span title={new Date(val).toLocaleString()}><TimeAgo timestamp={val} /></span>
            ),
        },
        { label: 'Event Name', dataKey: 'eventName', width: 200, sortable: true, flexGrow: 1 },
        { label: 'Username', dataKey: 'username', width: 250, sortable: true, flexGrow: 1 },
        { label: 'Source IP', dataKey: 'sourceIpAddress', width: 140, sortable: true },
        { label: 'User Agent', dataKey: 'userAgent', width: 200, sortable: true, flexGrow: 1 },
    ], []);

    // --- Initialize column widths after columns are defined ---
    useEffect(() => {
        setColumnWidths(loadColumnWidths('access-logs', columns));
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
            setColumnWidths(prev => { saveColumnWidths('access-logs', prev); return prev; });
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

    // --- Format date for native input ---
    const toDateInputValue = (d?: Date) => d ? d.toISOString().split('T')[0] : '';

    // --- Render ---
    return (
        <div className="flex flex-col h-full gap-4 p-1">
            {/* Header */}
            <div className="flex items-center gap-3">
                <GlassButton variant="secondary" icon={<ArrowLeft size={16} />} onClick={onBack}>Back</GlassButton>
                <h2 className="text-lg font-semibold text-white">EKS Access Logs</h2>
                <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-xs font-mono">{clusterName}</span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-gray-400 text-xs font-mono">{region}</span>
            </div>

            {/* Tab Switcher */}
            <div className="flex rounded-lg overflow-hidden border border-white/10 self-start">
                <button
                    onClick={() => setActiveTab('access')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${activeTab === 'access' ? 'bg-blue-600/30 text-blue-300' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                >
                    Access Logs
                </button>
                <button
                    onClick={() => setActiveTab('audit')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors border-l border-white/10 ${activeTab === 'audit' ? 'bg-blue-600/30 text-blue-300' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                >
                    Audit Logs
                </button>
            </div>

            {/* Audit Logs Tab */}
            {activeTab === 'audit' && (
                <AuditLogsPanel region={region} clusterName={clusterName} />
            )}

            {/* Access Logs Tab */}
            {activeTab === 'access' && (<>
                {/* Filter Panel */}
                <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex flex-col gap-1 min-w-[200px]">
                        <label className="text-xs text-gray-400 flex items-center gap-1"><Search size={12} /> Identity</label>
                        <input type="text" placeholder="Filter by username..." value={filters.identityText} onChange={e => handleIdentityTextChange(e.target.value)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Type</label>
                        <select value={filters.identityType} onChange={e => setFilters(prev => ({ ...prev, identityType: e.target.value as AccessLogsFilterState['identityType'] }))} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer">
                            {IDENTITY_TYPE_OPTIONS.map(opt => (<option key={opt.value} value={opt.value} className="bg-gray-900">{opt.label}</option>))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1 relative">
                        <label className="text-xs text-gray-400 flex items-center gap-1"><Filter size={12} /> Event Types</label>
                        <button onClick={() => setEventTypeDropdownOpen(prev => !prev)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50 flex items-center gap-2 min-w-[180px]">
                            <span className="flex-1 text-left truncate">{filters.eventTypes.length === 0 ? 'All Events' : `${filters.eventTypes.length} selected`}</span>
                            <ChevronDown size={14} className={`transition-transform ${eventTypeDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {eventTypeDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-lg bg-gray-900 border border-white/10 shadow-xl py-1 max-h-60 overflow-y-auto">
                                {EVENT_TYPE_OPTIONS.map(evt => (
                                    <label key={evt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-sm text-gray-300">
                                        <input type="checkbox" checked={filters.eventTypes.includes(evt)} onChange={() => toggleEventType(evt)} className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/50" />
                                        {evt}
                                    </label>
                                ))}
                                {filters.eventTypes.length > 0 && (
                                    <button onClick={() => setFilters(prev => ({ ...prev, eventTypes: [] }))} className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 border-t border-white/5 mt-1">Clear all</button>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400 flex items-center gap-1"><Clock size={12} /> Time Range</label>
                        <div className="flex rounded-lg overflow-hidden border border-white/10">
                            {TIME_RANGE_OPTIONS.map(opt => (
                                <button key={opt.value} onClick={() => setFilters(prev => ({ ...prev, timeRange: opt.value }))} className={`px-3 py-1.5 text-xs font-medium transition-colors ${filters.timeRange === opt.value ? 'bg-blue-600/30 text-blue-300 border-blue-500/30' : 'bg-white/5 text-gray-400 hover:bg-white/10'} ${opt.value !== '1h' ? 'border-l border-white/10' : ''}`}>
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {filters.timeRange === 'custom' && (
                        <div className="flex items-end gap-2">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-400">Start</label>
                                <input type="date" value={toDateInputValue(filters.customStartDate)} onChange={e => { const d = e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined; setFilters(prev => ({ ...prev, customStartDate: d })); }} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-400">End</label>
                                <input type="date" value={toDateInputValue(filters.customEndDate)} onChange={e => { const d = e.target.value ? new Date(e.target.value + 'T23:59:59') : undefined; setFilters(prev => ({ ...prev, customEndDate: d })); }} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500/50" />
                            </div>
                        </div>
                    )}
                    <button onClick={() => fetchEvents(false)} disabled={loading} className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 self-end" title="Refresh">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {show90DayWarning && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
                        <AlertTriangle size={16} className="flex-shrink-0" />
                        CloudTrail event history is limited to 90 days. Results may be incomplete for the selected range.
                    </div>
                )}

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-400">
                        <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-semibold mb-1">
                                {isAuthError(error) ? 'Authentication Error' : isPermissionsError(error) ? 'Permissions Error' : 'Error Loading Events'}
                            </p>
                            <p className="text-sm">
                                {isPermissionsError(error) ? 'Missing required permission: cloudtrail:LookupEvents. Ensure your AWS credentials have CloudTrail read access.' : error}
                            </p>
                        </div>
                        <button onClick={() => fetchEvents(false)} className="p-2 hover:bg-red-500/20 rounded-lg flex-shrink-0" title="Retry"><RefreshCw size={16} /></button>
                    </div>
                )}

                {loading && !error && (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                    </div>
                )}

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
                                    <div ref={containerRef} className="relative flex-1 h-full w-full min-h-[400px] access-logs-table-container rounded-t-lg" style={{ overflowClipMargin: 0, overflow: 'clip' }}>
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
                                                <button onClick={() => setExpandedEventId(null)} className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"><X size={14} /></button>
                                            </div>
                                            <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all leading-relaxed">{formattedJson}</pre>
                                        </div>
                                    );
                                })()}

                                {nextToken && (
                                    <div className="flex justify-center mt-3 pb-2">
                                        <GlassButton variant="secondary" onClick={() => fetchEvents(true)} isLoading={loadingMore} icon={loadingMore ? undefined : <ChevronDown size={16} />}>
                                            {loadingMore ? 'Loading...' : 'Load More'}
                                        </GlassButton>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </>)}
        </div>
    );
};
