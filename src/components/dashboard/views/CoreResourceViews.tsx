import React from 'react';
import { Loader2, ShieldAlert, AlertTriangle } from 'lucide-react';
import { DeploymentsView } from './DeploymentsView';
import { PodsView } from './PodsView';
import { OverviewView } from './OverviewView';
import { GenericResourceView } from './GenericResourceView';
import { HelmReleasesView } from './HelmReleasesView';
import { DeploymentFullView } from './deployment-details/DeploymentFullView';
import { TimeAgo } from '../../shared/TimeAgo';
import type { IColumn } from '../../shared/VirtualizedTable';
import { useResourceList, useResourceMap, useResourceStatus } from '../../../hooks/useResourceList';
import { useResourceSorting } from '../../../hooks/useResourceSorting';
import { useResourceStore } from '../../../stores/resourceStore';
import { computePodStatusStats } from '../../../utils/resource-utils';
import type { PodStatusStats } from '../OverviewCharts';
import type { DeploymentItem, KindStatus } from '../../../types/resource-cache';

/**
 * Connected wrappers for the six always-loaded core kinds (design §7). Each subscribes to ONE kind
 * in the resource store, so a batch for another kind never re-renders it, and switching tabs is a
 * pure re-render with no IPC.
 */

type RowClick = (item: unknown) => void;
type Toast = (message: string, type: 'success' | 'error' | 'info') => void;

const isLoadingFor = (status: KindStatus, size: number) => status.phase === 'loading' && size === 0;

/** Glass status card for reconnecting / error / forbidden phases. Stale rows stay visible below it. */
export const CoreKindStatusBanner: React.FC<{ status: KindStatus }> = React.memo(({ status }) => {
    if (status.phase === 'reconnecting') {
        return (
            <div role="status" aria-live="polite" className="mb-3 flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Reconnecting to the cluster. The list may be out of date.</span>
            </div>
        );
    }
    if (status.phase === 'forbidden' || (status.phase === 'ready' && status.error)) {
        return (
            <div role="status" aria-live="polite" className="mb-3 flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm">
                <ShieldAlert className="w-4 h-4" aria-hidden="true" />
                <span>{status.error ?? 'No permission to list these resources.'}</span>
            </div>
        );
    }
    if (status.phase === 'error') {
        return (
            <div role="status" aria-live="polite" className="mb-3 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                <span>{status.error ?? 'Unexpected error'}</span>
            </div>
        );
    }
    return null;
});
CoreKindStatusBanner.displayName = 'CoreKindStatusBanner';

const nameCol: IColumn = { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> };
const nsCol: IColumn = { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> };
const ageCol: IColumn = { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> };

const SERVICE_COLUMNS: IColumn[] = [
    nameCol, nsCol,
    { label: 'Type', dataKey: 'type', width: 120, flexGrow: 0, cellRenderer: (t) => <span className="text-gray-400">{t}</span> },
    { label: 'Cluster IP', dataKey: 'clusterIP', width: 120, flexGrow: 0, cellRenderer: (ip) => <span className="text-gray-400 font-mono text-xs">{ip}</span> },
    { label: 'Ports', dataKey: 'ports', flexGrow: 1, cellRenderer: (p) => <span className="text-gray-400 font-mono text-xs">{p}</span> },
    ageCol,
];
const CONFIGMAP_COLUMNS: IColumn[] = [
    nameCol, nsCol,
    { label: 'Data', dataKey: 'data', width: 80, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d} keys</span> },
    ageCol,
];
const SECRET_COLUMNS: IColumn[] = [
    nameCol, nsCol,
    { label: 'Type', dataKey: 'type', flexGrow: 1, cellRenderer: (t) => <span className="text-gray-400 text-xs">{t}</span> },
    { label: 'Data', dataKey: 'data', width: 80, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d} keys</span> },
    ageCol,
];

interface ListProps {
    selectedNamespaces: string[];
    searchQuery: string;
    onRowClick: RowClick;
}

const GENERIC: Record<'services' | 'configmaps' | 'secrets', { description: string; columns: IColumn[] }> = {
    services: { description: 'Network services for your application components.', columns: SERVICE_COLUMNS },
    configmaps: { description: 'Store non-confidential configuration data in key-value pairs.', columns: CONFIGMAP_COLUMNS },
    secrets: { description: 'Store sensitive information such as passwords, tokens, or keys.', columns: SECRET_COLUMNS },
};

const ConnectedGenericView: React.FC<ListProps & { kind: 'services' | 'configmaps' | 'secrets' }> = ({ kind, selectedNamespaces, searchQuery, onRowClick }) => {
    const items = useResourceList(kind, selectedNamespaces);
    const status = useResourceStatus(kind);
    const cfg = GENERIC[kind];
    return (
        <>
            <CoreKindStatusBanner status={status} />
            <GenericResourceView
                viewKey={kind}
                description={cfg.description}
                columns={cfg.columns}
                data={items}
                onRowClick={onRowClick}
                searchQuery={searchQuery}
                selectedNamespaces={selectedNamespaces}
                isLoading={isLoadingFor(status, items.length)}
                isUpdating={status.phase === 'reconnecting'}
            />
        </>
    );
};

export const ConnectedServicesView: React.FC<ListProps> = React.memo((p) => <ConnectedGenericView kind="services" {...p} />);
export const ConnectedConfigMapsView: React.FC<ListProps> = React.memo((p) => <ConnectedGenericView kind="configmaps" {...p} />);
export const ConnectedSecretsView: React.FC<ListProps> = React.memo((p) => <ConnectedGenericView kind="secrets" {...p} />);
ConnectedServicesView.displayName = 'ConnectedServicesView';
ConnectedConfigMapsView.displayName = 'ConnectedConfigMapsView';
ConnectedSecretsView.displayName = 'ConnectedSecretsView';

export const ConnectedDeploymentsView: React.FC<ListProps & { clusterName: string; onOpenFullView?: (ns: string, name: string) => void }> = React.memo(
    ({ selectedNamespaces, searchQuery, onRowClick, clusterName, onOpenFullView }) => {
        const deployments = useResourceList('deployments', selectedNamespaces);
        const status = useResourceStatus('deployments');
        return (
            <>
                <CoreKindStatusBanner status={status} />
                <DeploymentsView
                    deployments={deployments}
                    isLoading={isLoadingFor(status, deployments.length)}
                    clusterName={clusterName}
                    selectedNamespaces={selectedNamespaces}
                    searchQuery={searchQuery}
                    onRowClick={onRowClick}
                    isUpdating={status.phase === 'reconnecting'}
                    onOpenFullView={onOpenFullView}
                />
            </>
        );
    });
ConnectedDeploymentsView.displayName = 'ConnectedDeploymentsView';

interface PodsProps extends ListProps {
    viewMode: 'list' | 'visual';
    nodes: Array<{ name?: string }>;
    podMetrics: Record<string, { cpu: string; memory: string }>;
    onNodeClick: (nodeName: string) => void;
    onExec?: (pod: unknown, containerName: string) => void;
    onOpenLogs?: (pod: unknown, containerName: string) => void;
    clusterName: string;
}

export const ConnectedPodsView: React.FC<PodsProps> = React.memo((props) => {
    const { selectedNamespaces, podMetrics, clusterName } = props;
    const pods = useResourceList('pods', selectedNamespaces);
    const status = useResourceStatus('pods');
    const { sortConfig, handleSort, getSortedData } = useResourceSorting();
    // Enrich with metrics BEFORE sorting so cpu/memory columns sort correctly
    const enriched = React.useMemo(() => pods.map((pod) => {
        const m = podMetrics[`${pod.namespace}/${pod.name}`];
        return { ...pod, cpu: m?.cpu || '', memory: m?.memory || '' };
    }), [pods, podMetrics]);
    const sorted = React.useMemo(() => getSortedData(enriched), [getSortedData, enriched]);
    const onDeletePods = React.useCallback(async (list: Array<{ namespace: string; name: string }>) => {
        await Promise.all(list.map((p) => window.k8s.deletePod(clusterName, p.namespace, p.name)));
    }, [clusterName]);
    return (
        <>
            <CoreKindStatusBanner status={status} />
            <PodsView
                viewMode={props.viewMode}
                pods={enriched}
                sortedPods={sorted}
                nodes={props.nodes}
                sortConfig={sortConfig}
                onSort={handleSort}
                onRowClick={props.onRowClick}
                onNodeClick={props.onNodeClick}
                searchQuery={props.searchQuery}
                selectedNamespaces={selectedNamespaces}
                isLoading={isLoadingFor(status, pods.length)}
                isSynced={status.phase === 'ready'}
                error={status.error}
                podMetrics={podMetrics}
                onExec={props.onExec}
                onOpenLogs={props.onOpenLogs}
                clusterName={clusterName}
                isUpdating={status.phase === 'reconnecting'}
                onDeletePods={onDeletePods}
            />
        </>
    );
});
ConnectedPodsView.displayName = 'ConnectedPodsView';

export const ConnectedHelmReleasesView: React.FC<{
    clusterName: string; selectedNamespaces: string[]; searchQuery: string;
    onNavigateToDetail: (namespace: string, name: string) => void; showToast: Toast;
}> = React.memo(({ clusterName, selectedNamespaces, searchQuery, onNavigateToDetail, showToast }) => {
    const releases = useResourceList('helmreleases', selectedNamespaces);
    const status = useResourceStatus('helmreleases');
    return (
        <>
            <CoreKindStatusBanner status={status} />
            <HelmReleasesView
                clusterName={clusterName}
                selectedNamespaces={selectedNamespaces}
                searchQuery={searchQuery}
                onNavigateToDetail={onNavigateToDetail}
                showToast={showToast}
                helmReleases={releases}
                isLoading={isLoadingFor(status, releases.length)}
            />
        </>
    );
});
ConnectedHelmReleasesView.displayName = 'ConnectedHelmReleasesView';

const ZERO_STATS: PodStatusStats = { Running: 0, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 0 };

/** Overview pod stats for the selected namespaces, with a stable reference while counts are unchanged. */
function useOverviewPodStats(selectedNamespaces: string[]): PodStatusStats {
    const byId = useResourceMap('pods');
    const prevRef = React.useRef<PodStatusStats>(ZERO_STATS);
    const nsKey = selectedNamespaces.join(',');
    return React.useMemo(() => {
        const next = computePodStatusStats(byId, nsKey.split(','), prevRef.current);
        prevRef.current = next;
        return next;
    }, [byId, nsKey]);
}

export const ConnectedOverviewView: React.FC<{
    selectedNamespaces: string[]; events: unknown[]; onNavigate?: (view: string) => void; onSwitchToVisualPods: () => void;
}> = React.memo(({ selectedNamespaces, events, onNavigate, onSwitchToVisualPods }) => {
    const podStatusStats = useOverviewPodStats(selectedNamespaces);
    const deployments = useResourceList('deployments', selectedNamespaces);
    const podStatus = useResourceStatus('pods');
    const podCount = useResourceStore((s) => s.kinds.pods.byId.size);
    return (
        <OverviewView
            podStatusStats={podStatusStats}
            deployments={deployments}
            events={events}
            isLoading={isLoadingFor(podStatus, podCount)}
            onNavigate={onNavigate}
            onSwitchToVisualPods={onSwitchToVisualPods}
        />
    );
});
ConnectedOverviewView.displayName = 'ConnectedOverviewView';

type FullViewProps = Omit<React.ComponentProps<typeof DeploymentFullView>, 'liveDeployment'>;

/** Deployment full view fed by the live store entry (selector returns a stored reference). */
export const ConnectedDeploymentFullView: React.FC<FullViewProps> = (props) => {
    const { namespace, name } = props;
    const live = useResourceStore(React.useCallback((s) => {
        for (const d of s.kinds.deployments.byId.values()) if (d.namespace === namespace && d.name === name) return d;
        return undefined;
    }, [namespace, name])) as DeploymentItem | undefined;
    return <DeploymentFullView {...props} liveDeployment={live} />;
};

