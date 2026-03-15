import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, ArrowLeft, RotateCcw } from 'lucide-react';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { GlassButton } from '../../shared/GlassButton';
import { ConfirmModal } from '../../shared/ConfirmModal';
import { TimeAgo } from '../../shared/TimeAgo';
import { HelmReleaseTopology } from '../../resources/visualizers/HelmReleaseTopology';

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

// --- Tabs ---

const TABS: { id: TabId; label: string }[] = [
    { id: 'resources', label: 'Resources' },
    { id: 'topology', label: 'Topology' },
    { id: 'revisions', label: 'Revisions' },
    { id: 'changes', label: 'Changes' },
];

// --- Sub-components ---

const ResourcesTab: React.FC<{ resources: ManifestResource[] }> = ({ resources }) => {
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

    if (resources.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-400">
                No resources found
            </div>
        );
    }

    return <VirtualizedTable columns={columns} data={resources} tableId="helm-detail-resources" />;
};

const RevisionsTab: React.FC<{
    history: HelmRelease[];
    latestRevision: number;
    onRollback: (revision: number) => void;
}> = ({ history, latestRevision, onRollback }) => {
    const sorted = useMemo(() =>
        [...history].sort((a, b) => b.revision - a.revision),
        [history]
    );

    const columns: IColumn[] = useMemo(() => [
        {
            label: 'Revision', dataKey: 'revision', sortable: true, width: 90,
            cellRenderer: (cellData: any) => <span className="text-gray-200 text-sm font-mono">{cellData}</span>,
        },
        {
            label: 'Status', dataKey: 'status', sortable: true, width: 130,
            cellRenderer: (cellData: any) => (
                <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadgeClasses(cellData)}`}>
                    {cellData}
                </span>
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
                <span className="text-gray-400 text-sm">
                    {cellData ? <TimeAgo timestamp={cellData} /> : '-'}
                </span>
            ),
        },
        {
            label: 'Actions', dataKey: 'actions', sortable: false, width: 80,
            cellRenderer: (_cellData: any, rowData: any) => {
                if (rowData.revision === latestRevision) return null;
                return (
                    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                        <GlassButton
                            variant="secondary"
                            className="!px-2 !py-1 !rounded-lg"
                            icon={<RotateCcw size={14} />}
                            onClick={() => onRollback(rowData.revision)}
                        />
                    </div>
                );
            },
        },
    ], [latestRevision, onRollback]);

    return <VirtualizedTable columns={columns} data={sorted} tableId="helm-detail-revisions" />;
};

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

    // Loading state
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
                <span className="text-gray-400 text-sm">Loading release details...</span>
            </div>
        );
    }

    // Not found state
    if (!release) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <span className="text-gray-400 text-sm">Release "{releaseName}" not found</span>
                <button
                    onClick={onBack}
                    className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
                >
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
                <span
                    className="text-blue-400 hover:text-blue-300 cursor-pointer"
                    onClick={onBack}
                >
                    Helm Releases
                </span>
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
                        <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadgeClasses(release.status)}`}>
                            {release.status}
                        </span>
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
                    <HelmReleaseTopology
                        clusterName={clusterName}
                        releaseName={releaseName}
                        namespace={namespace}
                        resources={resources}
                    />
                )}
                {activeTab === 'revisions' && (
                    <RevisionsTab
                        history={history}
                        latestRevision={latestRevision}
                        onRollback={setRollbackTarget}
                    />
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
