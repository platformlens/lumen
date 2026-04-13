import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronRight, ArrowLeft, RotateCcw } from 'lucide-react';
import { TableVirtuoso } from 'react-virtuoso';
import { IColumn } from '../../shared/VirtualizedTable';
import { GlassButton } from '../../shared/GlassButton';
import { ConfirmModal } from '../../shared/ConfirmModal';
import { TimeAgo } from '../../shared/TimeAgo';
import { HelmReleaseTopology } from '../../resources/visualizers/HelmReleaseTopology';

// --- CSS Styles ---

const tableStyles = `
  .helm-detail-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .helm-detail-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .helm-detail-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .helm-detail-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .helm-detail-table-container th {
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
  .helm-detail-table-container th:first-child {
    border-top-left-radius: 0;
  }
  .helm-detail-table-container th:last-child {
    border-top-right-radius: 0;
  }
  .helm-detail-table-container th.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .helm-detail-table-container td {
    padding: 0.75rem 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    font-size: var(--lumen-table-font-size, 14px);
  }
  .helm-detail-table-container td.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .helm-detail-table-container td.no-truncate {
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

// --- Interfaces ---

interface HelmRelease {
    name: string;
    namespace: string;
    revision: number;
    status: string;
    chart: string;
    chartVersion: string;
    appVersion: string;
    lastUpdated: string;
    description: string;
    manifest?: string;
}

interface ManifestResource {
    apiVersion: string;
    kind: string;
    name: string;
    namespace?: string;
}

interface DiffLine {
    type: 'added' | 'removed' | 'unchanged';
    content: string;
}

interface HelmReleaseDetailProps {
    clusterName: string;
    namespace: string;
    releaseName: string;
    onBack: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

type TabId = 'resources' | 'topology' | 'revisions' | 'changes';

// --- Helpers ---

function getStatusBadgeClasses(status: string): string {
    if (status === 'deployed') return 'bg-green-500/10 text-green-400';
    if (status.startsWith('pending-')) return 'bg-yellow-500/10 text-yellow-400';
    if (status === 'failed' || status === 'superseded') return 'bg-red-500/10 text-red-400';
    return 'bg-gray-500/20 text-gray-300';
}

function parseManifest(manifest: string): ManifestResource[] {
    if (!manifest) return [];
    const docs = manifest.split(/^---$/m).filter(d => d.trim());
    return docs.map(doc => {
        const apiVersion = doc.match(/apiVersion:\s*(.+)/)?.[1]?.trim() ?? '';
        const kind = doc.match(/kind:\s*(.+)/)?.[1]?.trim() ?? '';
        const name = doc.match(/name:\s*(.+)/)?.[1]?.trim() ?? '';
        const namespace = doc.match(/namespace:\s*(.+)/)?.[1]?.trim();
        return { apiVersion, kind, name, namespace };
    }).filter(r => r.kind && r.name);
}

function computeDiff(manifestA: string, manifestB: string): DiffLine[] {
    const linesA = new Set(manifestA.split('\n'));
    const linesB = manifestB.split('\n');
    const linesAArr = manifestA.split('\n');
    const linesBSet = new Set(manifestB.split('\n'));

    const result: DiffLine[] = [];
    for (const line of linesAArr) {
        if (!linesBSet.has(line)) {
            result.push({ type: 'removed', content: line });
        }
    }
    for (const line of linesB) {
        if (!linesA.has(line)) {
            result.push({ type: 'added', content: line });
        } else {
            result.push({ type: 'unchanged', content: line });
        }
    }
    return result;
}

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

// --- Stable TableVirtuoso sub-component ---
const VirtuosoTableHead = React.forwardRef<HTMLTableSectionElement>((props, ref) => (
    <thead {...props} ref={ref} style={{ ...(props as any).style, position: 'sticky', top: 0, zIndex: 2 }} />
));

// --- Tabs ---

const TABS: { id: TabId; label: string }[] = [
    { id: 'resources', label: 'Resources' },
    { id: 'topology', label: 'Topology' },
    { id: 'revisions', label: 'Revisions' },
    { id: 'changes', label: 'Changes' },
];

// --- Sub-components ---

const ResourcesTab: React.FC<{ resources: ManifestResource[] }> = React.memo(({ resources }) => {
    const columns: IColumn[] = useMemo(() => [
        {
            label: 'Kind', dataKey: 'kind', sortable: true, width: 160, flexGrow: 1,
            cellRenderer: (cellData: any) => <span className="text-gray-200 text-sm">{cellData}</span>,
        },
        {
            label: 'Name', dataKey: 'name', sortable: true, width: 200, flexGrow: 2,
            cellRenderer: (cellData: any) => <span className="font-medium text-gray-200 text-sm truncate">{cellData}</span>,
        },
        {
            label: 'Namespace', dataKey: 'namespace', sortable: true, width: 140,
            cellRenderer: (cellData: any) => <span className="text-gray-400 text-sm">{cellData || '-'}</span>,
        },
        {
            label: 'API Version', dataKey: 'apiVersion', sortable: true, width: 180,
            cellRenderer: (cellData: any) => <span className="text-gray-400 font-mono text-xs">{cellData}</span>,
        },
    ], []);

    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadColumnWidths('helm-detail-resources', columns));
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

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

    useEffect(() => {
        if (!resizing) return;
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX;
            const newW = Math.max(50, resizing.startW + delta);
            setColumnWidths(prev => ({ ...prev, [resizing.key]: newW }));
        };
        const onUp = () => {
            setColumnWidths(prev => { saveColumnWidths('helm-detail-resources', prev); return prev; });
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

    const handleSort = useCallback((key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
            return { key, direction: 'asc' };
        });
    }, []);

    const sortedData = useMemo(() => {
        if (!sortConfig) return resources;
        return [...resources].sort((a, b) => {
            const aVal = (a as any)[sortConfig.key] ?? '';
            const bVal = (b as any)[sortConfig.key] ?? '';
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [resources, sortConfig]);

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
    const dataRef = useRef(sortedData);
    dataRef.current = sortedData;

    const virtuosoComponents = useMemo(() => ({
        Table: ({ style, ...props }: any) => (
            <table {...props} style={{ ...style, width: '100%', minWidth: effectiveTotalWidthRef.current, tableLayout: 'fixed' as const, borderCollapse: 'separate' as const, borderSpacing: 0 }} />
        ),
        TableHead: VirtuosoTableHead,
        TableRow: ({ style, ...props }: any) => {
            return (
                <tr {...props} style={{ ...style, height: 52 }} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]" />
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
        const rowData = sortedData[index];
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
    }, [sortedData, columns, effectiveWidths, columnWidths]);

    if (resources.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-400">
                No resources found
            </div>
        );
    }

    return (
        <div ref={containerRef} className="relative flex-1 h-full w-full min-h-[400px] helm-detail-table-container rounded-t-lg" style={{ overflowClipMargin: 0, overflow: 'clip' }}>
            <style>{tableStyles}</style>
            <TableVirtuoso
                totalCount={sortedData.length}
                fixedHeaderContent={fixedHeaderContent}
                itemContent={rowContent}
                style={{ height: '100%' }}
                overscan={200}
                components={virtuosoComponents}
            />
        </div>
    );
});

const RevisionsTab: React.FC<{
    history: HelmRelease[];
    latestRevision: number;
    onRollback: (revision: number) => void;
}> = React.memo(({ history, latestRevision, onRollback }) => {
    const columns: IColumn[] = useMemo(() => [
        {
            label: 'Revision', dataKey: 'revision', sortable: true, width: 90,
            cellRenderer: (cellData: any) => <span className="text-gray-200 text-sm font-mono">{cellData}</span>,
        },
        {
            label: 'Status', dataKey: 'status', sortable: true, width: 130,
            cellRenderer: (cellData: any) => (
                <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadgeClasses(cellData)}`}>{cellData}</span>
            ),
        },
        {
            label: 'Chart Version', dataKey: 'chartVersion', sortable: true, width: 130,
            cellRenderer: (cellData: any) => <span className="text-gray-400 font-mono text-xs">{cellData}</span>,
        },
        {
            label: 'App Version', dataKey: 'appVersion', sortable: true, width: 130,
            cellRenderer: (cellData: any) => <span className="text-gray-400 font-mono text-xs">{cellData}</span>,
        },
        {
            label: 'Description', dataKey: 'description', sortable: false, width: 200, flexGrow: 1,
            cellRenderer: (cellData: any) => <span className="text-gray-400 text-sm truncate">{cellData || '-'}</span>,
        },
        {
            label: 'Updated', dataKey: 'lastUpdated', sortable: true, width: 120,
            cellRenderer: (cellData: any) => (
                <span className="text-gray-400 text-sm">{cellData ? <TimeAgo timestamp={cellData} /> : '-'}</span>
            ),
        },
        {
            label: 'Actions', dataKey: 'actions', sortable: false, width: 80,
            cellRenderer: (_cellData: any, rowData: any) => {
                if (rowData.revision === latestRevision) return null;
                return (
                    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                        <GlassButton variant="secondary" className="!px-2 !py-1 !rounded-lg" icon={<RotateCcw size={14} />} onClick={() => onRollback(rowData.revision)} />
                    </div>
                );
            },
        },
    ], [latestRevision, onRollback]);

    const sorted = useMemo(() => [...history].sort((a, b) => b.revision - a.revision), [history]);

    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadColumnWidths('helm-detail-revisions', columns));
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

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

    useEffect(() => {
        if (!resizing) return;
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX;
            const newW = Math.max(50, resizing.startW + delta);
            setColumnWidths(prev => ({ ...prev, [resizing.key]: newW }));
        };
        const onUp = () => {
            setColumnWidths(prev => { saveColumnWidths('helm-detail-revisions', prev); return prev; });
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

    const handleSort = useCallback((key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
            return { key, direction: 'asc' };
        });
    }, []);

    const sortedData = useMemo(() => {
        if (!sortConfig) return sorted;
        return [...sorted].sort((a, b) => {
            const aVal = (a as any)[sortConfig.key] ?? '';
            const bVal = (b as any)[sortConfig.key] ?? '';
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [sorted, sortConfig]);

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
    const dataRef = useRef(sortedData);
    dataRef.current = sortedData;
    const onRollbackRef = useRef(onRollback);
    onRollbackRef.current = onRollback;

    const virtuosoComponents = useMemo(() => ({
        Table: ({ style, ...props }: any) => (
            <table {...props} style={{ ...style, width: '100%', minWidth: effectiveTotalWidthRef.current, tableLayout: 'fixed' as const, borderCollapse: 'separate' as const, borderSpacing: 0 }} />
        ),
        TableHead: VirtuosoTableHead,
        TableRow: ({ style, ...props }: any) => (
            <tr {...props} style={{ ...style, height: 52 }} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]" />
        ),
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
        const rowData = sortedData[index];
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
    }, [sortedData, columns, effectiveWidths, columnWidths]);

    return (
        <div ref={containerRef} className="relative flex-1 h-full w-full min-h-[400px] helm-detail-table-container rounded-t-lg" style={{ overflowClipMargin: 0, overflow: 'clip' }}>
            <style>{tableStyles}</style>
            <TableVirtuoso
                totalCount={sortedData.length}
                fixedHeaderContent={fixedHeaderContent}
                itemContent={rowContent}
                style={{ height: '100%' }}
                overscan={200}
                components={virtuosoComponents}
            />
        </div>
    );
});

const ChangesTab: React.FC<{ history: HelmRelease[] }> = ({ history }) => {
    const diffLines = useMemo(() => {
        const sorted = [...history].sort((a, b) => b.revision - a.revision);
        if (sorted.length < 2) return null;
        const latest = sorted[0]?.manifest ?? '';
        const previous = sorted[1]?.manifest ?? '';
        return computeDiff(previous, latest);
    }, [history]);

    if (history.length < 2) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-400">
                No previous revision to compare
            </div>
        );
    }

    if (!diffLines || diffLines.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-400">
                No changes detected
            </div>
        );
    }

    return (
        <div className="overflow-auto max-h-[calc(100vh-320px)] bg-white/5 border border-white/10 rounded-xl p-4">
            <pre className="font-mono text-xs leading-5">
                {diffLines.map((line, i) => {
                    let className = 'text-gray-400';
                    let prefix = ' ';
                    if (line.type === 'added') {
                        className = 'bg-green-500/10 text-green-400';
                        prefix = '+';
                    } else if (line.type === 'removed') {
                        className = 'bg-red-500/10 text-red-400';
                        prefix = '-';
                    }
                    return (
                        <div key={i} className={`${className} px-2 py-0.5`}>
                            {prefix} {line.content}
                        </div>
                    );
                })}
            </pre>
        </div>
    );
};

// --- Main Component ---

export const HelmReleaseDetail: React.FC<HelmReleaseDetailProps> = ({
    clusterName,
    namespace,
    releaseName,
    onBack,
    showToast,
}) => {
    const [release, setRelease] = useState<HelmRelease | null>(null);
    const [history, setHistory] = useState<HelmRelease[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabId>('resources');
    const [rollbackTarget, setRollbackTarget] = useState<number | null>(null);

    const fetchData = useCallback(async () => {
        if (!clusterName || !namespace || !releaseName) return;
        try {
            setIsLoading(true);
            const [releaseData, historyData] = await Promise.all([
                (window as any).k8s.helm.getRelease(clusterName, namespace, releaseName),
                (window as any).k8s.helm.getReleaseHistory(clusterName, namespace, releaseName),
            ]);
            setRelease(releaseData ?? null);
            setHistory(historyData ?? []);
        } catch (err) {
            console.error('[HelmReleaseDetail] Failed to fetch release data:', err);
        } finally {
            setIsLoading(false);
        }
    }, [clusterName, namespace, releaseName]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const latestRevision = useMemo(() =>
        history.reduce((max, r) => r.revision > max ? r.revision : max, 0),
        [history]
    );

    const handleRollback = useCallback(async () => {
        if (rollbackTarget === null) return;
        try {
            await (window as any).k8s.helm.rollbackRelease(clusterName, namespace, releaseName, rollbackTarget);
            showToast(`Rolled back "${releaseName}" to revision ${rollbackTarget}`, 'success');
            fetchData();
        } catch (err) {
            console.error('[HelmReleaseDetail] Rollback failed:', err);
            showToast(`Failed to rollback "${releaseName}"`, 'error');
        } finally {
            setRollbackTarget(null);
        }
    }, [clusterName, namespace, releaseName, rollbackTarget, showToast, fetchData]);

    const resources = useMemo(() =>
        parseManifest(release?.manifest ?? ''),
        [release?.manifest]
    );

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
                <span className="text-gray-400 text-sm">Loading release details...</span>
            </div>
        );
    }

    if (!release) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <span className="text-gray-400 text-sm">Release "{releaseName}" not found</span>
                <button onClick={onBack} className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1">
                    <ArrowLeft size={14} />
                    Back to Helm Releases
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full gap-4 p-4 min-h-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-sm">
                <span className="text-blue-400 hover:text-blue-300 cursor-pointer" onClick={onBack}>Helm Releases</span>
                <ChevronRight size={14} className="text-gray-400" />
                <span className="text-gray-200">{release.name}</span>
            </div>

            {/* Header */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <div>
                        <div className="text-gray-400 text-xs">Name</div>
                        <div className="text-white text-sm font-medium">{release.name}</div>
                    </div>
                    <div>
                        <div className="text-gray-400 text-xs">Namespace</div>
                        <div className="text-white text-sm">{release.namespace}</div>
                    </div>
                    <div>
                        <div className="text-gray-400 text-xs">Chart</div>
                        <div className="text-white text-sm">{release.chart}</div>
                    </div>
                    <div>
                        <div className="text-gray-400 text-xs">Chart Version</div>
                        <div className="text-white text-sm font-mono">{release.chartVersion}</div>
                    </div>
                    <div>
                        <div className="text-gray-400 text-xs">App Version</div>
                        <div className="text-white text-sm font-mono">{release.appVersion}</div>
                    </div>
                    <div>
                        <div className="text-gray-400 text-xs">Status</div>
                        <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadgeClasses(release.status)}`}>{release.status}</span>
                    </div>
                    <div>
                        <div className="text-gray-400 text-xs">Revision</div>
                        <div className="text-white text-sm font-mono">{release.revision}</div>
                    </div>
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-white/10 pb-0">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${activeTab === tab.id
                            ? 'bg-white/10 text-blue-400'
                            : 'text-gray-400 hover:text-white'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 flex flex-col">
                {activeTab === 'resources' && <ResourcesTab resources={resources} />}
                {activeTab === 'topology' && (
                    <HelmReleaseTopology clusterName={clusterName} releaseName={releaseName} namespace={namespace} resources={resources} />
                )}
                {activeTab === 'revisions' && (
                    <RevisionsTab history={history} latestRevision={latestRevision} onRollback={setRollbackTarget} />
                )}
                {activeTab === 'changes' && <ChangesTab history={history} />}
            </div>

            <ConfirmModal
                isOpen={rollbackTarget !== null}
                onClose={() => setRollbackTarget(null)}
                onConfirm={handleRollback}
                title="Rollback Helm Release"
                message={`Are you sure you want to rollback "${releaseName}" to revision ${rollbackTarget}? This will create a new revision based on the selected one.`}
                confirmText="Rollback"
                cancelText="Cancel"
                variant="danger"
            />
        </div>
    );
};
