import React, { useCallback, useMemo } from 'react';
import { ScrollText } from 'lucide-react';
import { VirtualizedTable, type IColumn } from '../../../shared/VirtualizedTable';
import { TimeAgo } from '../../../shared/TimeAgo';
import { useResourceSorting } from '../../../../hooks/useResourceSorting';
import type { DeploymentPodSummary, SectionResult } from '../../../../types/deployment-details';
import type { RevisionEntry } from '../../../../utils/deployment-history-utils';
import { SectionShell } from './SectionShell';
import { FOCUS_RING, STATUS_CLASSES, podStatusColor } from './status-classes';

interface DeploymentPodsTableProps {
    namespace: string;
    pods: SectionResult<DeploymentPodSummary[]>;
    podMetrics: SectionResult<Record<string, { cpu: string; memory: string }>>;
    revisionByHash: Map<string, RevisionEntry>;
    onOpenPod: (name: string) => void;
    onOpenPodLogs?: (pod: DeploymentPodSummary) => void;
    canOpenLogs: (pod: DeploymentPodSummary) => boolean;
}

/** Pre-mapped row: keys match useResourceSorting's comparators (status, age, restarts, cpu, memory). */
interface PodRow extends DeploymentPodSummary {
    status: string; age: string; cpu: string | undefined; memory: string | undefined;
    revision: string; lastTermination: string | null;
}

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 40;
const MAX_HEIGHT = 520;

/** VirtualizedTable doesn't read IColumn.sortable, so header clicks are filtered here. */
const SORTABLE_KEYS = new Set(['name', 'status', 'readyContainers', 'restarts', 'age', 'cpu', 'memory']);

const restartClass = (n: number) => (n >= 5 ? 'text-red-400' : n > 0 ? 'text-yellow-400' : 'text-gray-300');

interface PodsTableBodyProps extends Omit<DeploymentPodsTableProps, 'namespace' | 'pods' | 'podMetrics' | 'revisionByHash'> {
    rows: PodRow[];
    metricsNote: string | null;
}

const PodsTableBody: React.FC<PodsTableBodyProps> = ({ rows, metricsNote, onOpenPod, onOpenPodLogs, canOpenLogs }) => {
    const { sortConfig, handleSort, getSortedData } = useResourceSorting();
    const sorted = getSortedData(rows);

    const columns = useMemo<IColumn[]>(() => {
        const cols: IColumn[] = [
            { label: 'Name', dataKey: 'name', width: 260, flexGrow: 1, sortable: true,
                cellRenderer: (_: unknown, r: PodRow) => <span className="font-mono text-sm text-white truncate" title={r.name}>{r.name}</span> },
            { label: 'Status', dataKey: 'status', width: 150, sortable: true,
                cellRenderer: (_: unknown, r: PodRow) => (
                    <span className={`px-2 py-0.5 rounded text-xs truncate ${STATUS_CLASSES[podStatusColor(r)]}`}>{r.status}</span>) },
            { label: 'Ready', dataKey: 'readyContainers', width: 80, sortable: true,
                cellRenderer: (_: unknown, r: PodRow) => <span className="text-sm text-gray-300">{r.readyContainers}/{r.totalContainers}</span> },
            { label: 'Restarts', dataKey: 'restarts', width: 100, sortable: true,
                cellRenderer: (_: unknown, r: PodRow) => (
                    <span className={`text-sm ${restartClass(r.restarts)}`} title={r.lastTermination ? `Last termination: ${r.lastTermination}` : undefined}>
                        {r.restarts}
                    </span>) },
            { label: 'Node', dataKey: 'nodeName', width: 200, sortable: false,
                cellRenderer: (_: unknown, r: PodRow) => <span className="font-mono text-xs text-gray-300 truncate" title={r.nodeName ?? undefined}>{r.nodeName ?? '–'}</span> },
            { label: 'Pod IP', dataKey: 'podIP', width: 130, sortable: false,
                cellRenderer: (_: unknown, r: PodRow) => <span className="font-mono text-xs text-gray-300">{r.podIP ?? '–'}</span> },
            { label: 'Age', dataKey: 'age', width: 90, sortable: true,
                cellRenderer: (_: unknown, r: PodRow) => <span className="text-sm text-gray-400"><TimeAgo timestamp={r.age} /></span> },
            { label: 'Revision', dataKey: 'revision', width: 90, sortable: false,
                cellRenderer: (_: unknown, r: PodRow) => <span className="font-mono text-xs text-gray-300">{r.revision}</span> },
            { label: 'QoS', dataKey: 'qosClass', width: 110, sortable: false,
                cellRenderer: (_: unknown, r: PodRow) => <span className="text-xs text-gray-400">{r.qosClass ?? '–'}</span> },
            { label: 'CPU', dataKey: 'cpu', width: 90, sortable: true,
                cellRenderer: (_: unknown, r: PodRow) => <span className="font-mono text-xs text-gray-300">{r.cpu ?? '–'}</span> },
            { label: 'Memory', dataKey: 'memory', width: 100, sortable: true,
                cellRenderer: (_: unknown, r: PodRow) => <span className="font-mono text-xs text-gray-300">{r.memory ?? '–'}</span> },
        ];
        if (onOpenPodLogs) {
            cols.push({ label: '', dataKey: 'actions', width: 60, sortable: false, compact: true,
                cellRenderer: (_: unknown, r: PodRow) => (canOpenLogs(r) ? (
                    <button
                        type="button"
                        aria-label={`Open logs for ${r.name}`}
                        title="Logs"
                        onClick={(e) => { e.stopPropagation(); onOpenPodLogs(r); }}
                        className={`p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-white/10 ${FOCUS_RING}`}
                    >
                        <ScrollText size={14} aria-hidden="true" />
                    </button>
                ) : null) });
        }
        return cols;
    }, [onOpenPodLogs, canOpenLogs]);

    const handleSortClick = useCallback((key: string) => { if (SORTABLE_KEYS.has(key)) handleSort(key); }, [handleSort]);
    const handleRowClick = useCallback((r: PodRow) => onOpenPod(r.name), [onOpenPod]);
    const height = Math.min(HEADER_HEIGHT + rows.length * ROW_HEIGHT, MAX_HEIGHT);

    return (
        <div className="space-y-2">
            {metricsNote && <p className="text-xs text-gray-400">{metricsNote}</p>}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden" style={{ height }}>
                <VirtualizedTable
                    data={sorted}
                    columns={columns}
                    onRowClick={handleRowClick}
                    sortConfig={sortConfig}
                    onSort={handleSortClick}
                    rowHeight={ROW_HEIGHT}
                    headerHeight={HEADER_HEIGHT}
                    tableId="deployment-full-view-pods"
                />
            </div>
        </div>
    );
};

function metricsNoteOf(m: DeploymentPodsTableProps['podMetrics']): string | null {
    if (m.status === 'forbidden') return 'CPU/memory unavailable: missing permission to read pod metrics.';
    if (m.status === 'error') return `CPU/memory unavailable: ${m.message}`;
    return m.note ?? null;
}

const DeploymentPodsTableInner: React.FC<DeploymentPodsTableProps> = ({
    namespace, pods, podMetrics, revisionByHash, onOpenPod, onOpenPodLogs, canOpenLogs,
}) => {
    const rows = useMemo<PodRow[]>(() => {
        if (pods.status !== 'ok') return [];
        const metrics = podMetrics.status === 'ok' ? podMetrics.data : {};
        return pods.data.map(p => {
            const rev = p.podTemplateHash ? revisionByHash.get(p.podTemplateHash) : undefined;
            return {
                ...p,
                status: p.displayStatus,
                age: p.createdAt,
                cpu: metrics[p.name]?.cpu,
                memory: metrics[p.name]?.memory,
                revision: rev ? `#${rev.revisionLabel}` : '?',
                lastTermination: p.containers.find(c => c.lastTerminationReason)?.lastTerminationReason ?? null,
            };
        });
    }, [pods, podMetrics, revisionByHash]);
    const metricsNote = metricsNoteOf(podMetrics);

    return (
        <SectionShell id="pods" title="Pods" namespace={namespace} result={pods} unavailableLabel="list pods"
            actions={pods.status === 'ok' ? <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white">{rows.length}</span> : undefined}>
            {rows.length === 0
                ? <p className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-4">No pods found for this deployment.</p>
                : <PodsTableBody rows={rows} metricsNote={metricsNote}
                    onOpenPod={onOpenPod} onOpenPodLogs={onOpenPodLogs} canOpenLogs={canOpenLogs} />}
        </SectionShell>
    );
};

export const DeploymentPodsTable = React.memo(DeploymentPodsTableInner);
