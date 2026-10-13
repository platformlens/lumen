import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Lock, RefreshCw, SearchX, XCircle } from 'lucide-react';
import { ErrorBoundary } from '../../../shared/ErrorBoundary';
import { GlassButton } from '../../../shared/GlassButton';
import { ScaleModal } from '../../../shared/ScaleModal';
import { ConfirmModal } from '../../../shared/ConfirmModal';
import { SkeletonLoader } from '../../../shared/SkeletonLoader';
import type { RevisionDiffSide } from '../../../resources/details/RevisionDiffModal';
import { useDeploymentFullDetails } from '../../../../hooks/useDeploymentFullDetails';
import {
    getCurrentRevision, getPreviousRevision, revisionEntryToYamlInput, revisionToYaml, type RevisionEntry,
} from '../../../../utils/deployment-history-utils';
import { diffPodTemplates } from '../../../../utils/pod-template-diff-utils';
import { MASK } from '../../../../utils/sensitive-value-utils';
import type { LogTarget } from '../../../../utils/deployment-log-utils';
import { DeploymentHeader } from './DeploymentHeader';
import { SectionNav, type SectionNavItem } from './SectionNav';
import { SectionShell } from './SectionShell';
import { OverviewSection } from './OverviewSection';
import { RolloutSection } from './RolloutSection';
import { RevisionTimeline } from './RevisionTimeline';
import { RevisionDetailPanel, type CompareMode } from './RevisionDetailPanel';
import { revisionKey } from './revision-format';
import { useDeploymentDerivedData, usePodLogsHandler } from './useDeploymentDerivedData';
import { PodDistribution } from './PodDistribution';
import { SchedulingConstraints } from './SchedulingConstraints';
import { DeploymentPodsTable } from './DeploymentPodsTable';
import { ContainersSection } from './ContainersSection';
import { SecurityPosture } from './SecurityPosture';
import { NetworkingSection } from './NetworkingSection';
import { ConfigStorageSection } from './ConfigStorageSection';
import { EventsSection } from './EventsSection';
import { Disclosure } from './Disclosure';
import { ResourceTopology } from '../../../resources/visualizers/ResourceTopology';
import type { PodTemplate } from '../../../../types/deployment-details';

export type FullViewResourceType = 'pod' | 'node' | 'replicaset' | 'service' | 'ingress' | 'networkpolicy'
    | 'horizontalpodautoscaler' | 'poddisruptionbudget' | 'persistentvolumeclaim' | 'configmap' | 'serviceaccount';

interface DeploymentFullViewProps {
    clusterName: string;
    namespace: string;
    name: string;
    liveDeployment: { metadata?: { resourceVersion?: string } } | undefined;
    onBack: () => void;
    onResourceClick: (resource: { name: string; namespace?: string }, type: FullViewResourceType) => void;
    onOpenLogs?: (pod: LogTarget, containerName: string) => void;
    onOpenYaml?: (resource: unknown) => void;
    showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

/** Section order per design §6.2 (ids must match the SectionShell ids rendered below). */
const NAV_SECTIONS: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'rollout', label: 'Rollout' },
    { id: 'revisions', label: 'Revisions' },
    { id: 'distribution', label: 'Distribution' },
    { id: 'scheduling', label: 'Scheduling' },
    { id: 'pods', label: 'Pods' },
    { id: 'containers', label: 'Containers' },
    { id: 'security', label: 'Security' },
    { id: 'networking', label: 'Networking' },
    { id: 'config-storage', label: 'Config & Storage' },
    { id: 'events', label: 'Events' },
    { id: 'topology', label: 'Topology' },
];

const EMPTY_TEMPLATE: PodTemplate = {};

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const toSide = (e: RevisionEntry): RevisionDiffSide => ({
    label: `Revision ${e.revisionLabel}`, createdAt: e.createdAt, yaml: revisionToYaml(revisionEntryToYamlInput(e)),
});

const StateCard: React.FC<{ tone: 'red' | 'gray'; icon: React.ReactNode; children: React.ReactNode; actions: React.ReactNode }> = ({ tone, icon, children, actions }) => (
    <div className={`rounded-xl p-6 flex flex-col items-start gap-4 ${tone === 'red' ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-white/5 border border-white/10 text-gray-300'}`}>
        <div className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 shrink-0" aria-hidden="true">{icon}</span>
            <div className="min-w-0 break-words">{children}</div>
        </div>
        <div className="flex gap-2">{actions}</div>
    </div>
);

const DeploymentFullViewBody: React.FC<DeploymentFullViewProps> = ({
    clusterName, namespace, name, liveDeployment, onBack, onResourceClick, onOpenLogs, onOpenYaml, showToast,
}) => {
    const { state, details, error, isRefreshing, lastFetchedAt, liveUpdates, refresh, dismissError } = useDeploymentFullDetails({
        clusterName, namespace, name, liveResourceVersion: liveDeployment?.metadata?.resourceVersion,
    });
    const derived = useDeploymentDerivedData(details);
    const podLogs = usePodLogsHandler(onOpenLogs, derived?.template ?? EMPTY_TEMPLATE);

    // ---- Revision selection (local UI state; the component is keyed per cluster+deployment) ----
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [compareModeState, setCompareMode] = useState<CompareMode>('previous');
    const [isDiffOpen, setIsDiffOpen] = useState(false);
    const revisions = derived?.revisions;
    const selected = useMemo<RevisionEntry | null>(() => {
        if (!revisions || revisions.length === 0) return null;
        return revisions.find(e => revisionKey(e) === selectedKey) ?? getCurrentRevision(revisions) ?? revisions[revisions.length - 1];
    }, [revisions, selectedKey]);
    const compareMode: CompareMode = selected?.isCurrent ? 'previous' : compareModeState;
    useEffect(() => {
        if (selected?.isCurrent && compareModeState === 'current') setCompareMode('previous');
    }, [selected?.isCurrent, compareModeState]);

    const target = useMemo<RevisionEntry | null>(() => {
        if (!revisions || !selected) return null;
        if (compareMode === 'previous') return getPreviousRevision(revisions, selected);
        const current = getCurrentRevision(revisions);
        return current && current !== selected ? current : null;
    }, [revisions, selected, compareMode]);
    // Ordered older → newer: vs previous = target → selected; vs current = selected → current.
    const pair = useMemo(() => (selected && target
        ? (compareMode === 'previous' ? { older: target, newer: selected } : { older: selected, newer: target })
        : null), [selected, target, compareMode]);
    const changes = useMemo(() => (pair ? diffPodTemplates(pair.older.template, pair.newer.template) : []), [pair]);
    const hasHiddenValues = useMemo(() => changes.some(c => c.before === MASK || c.after === MASK), [changes]);
    const diffSides = useMemo(() => (isDiffOpen && pair ? { left: toSide(pair.older), right: toSide(pair.newer) } : null), [isDiffOpen, pair]);

    const handleSelectRevision = useCallback((e: RevisionEntry) => setSelectedKey(revisionKey(e)), []);
    const handleToggleDiff = useCallback(() => setIsDiffOpen(o => !o), []);

    // ---- Resource links (open the normal drawer above the page) ----
    // latest-ref: Dashboard's handleResourceClick is re-created every render; keep section callbacks stable.
    const onResourceClickRef = useRef(onResourceClick);
    onResourceClickRef.current = onResourceClick;
    const openResource = useCallback((resourceName: string, type: FullViewResourceType) =>
        onResourceClickRef.current({ name: resourceName, namespace }, type), [namespace]);
    const openReplicaSet = useCallback((rs: string) => openResource(rs, 'replicaset'), [openResource]);
    const openHpa = useCallback((n: string) => openResource(n, 'horizontalpodautoscaler'), [openResource]);
    const openPdb = useCallback((n: string) => openResource(n, 'poddisruptionbudget'), [openResource]);
    const openPod = useCallback((n: string) => openResource(n, 'pod'), [openResource]);
    const openNode = useCallback((n: string) => onResourceClickRef.current({ name: n }, 'node'), []);
    const openService = useCallback((n: string) => openResource(n, 'service'), [openResource]);
    const openIngress = useCallback((n: string) => openResource(n, 'ingress'), [openResource]);
    const openNetworkPolicy = useCallback((n: string) => openResource(n, 'networkpolicy'), [openResource]);
    const openConfigMap = useCallback((n: string) => openResource(n, 'configmap'), [openResource]);
    const openPvc = useCallback((n: string) => openResource(n, 'persistentvolumeclaim'), [openResource]);

    // ---- Actions (existing IPC; Safe Mode enforced in main) ----
    const [isScaleOpen, setIsScaleOpen] = useState(false);
    const [isRestartOpen, setIsRestartOpen] = useState(false);
    const openScale = useCallback(() => setIsScaleOpen(true), []);
    const closeScale = useCallback(() => setIsScaleOpen(false), []);
    const openRestart = useCallback(() => setIsRestartOpen(true), []);
    const closeRestart = useCallback(() => setIsRestartOpen(false), []);

    const handleScale = useCallback(async (replicas: number) => {
        try {
            await window.k8s.scaleDeployment(clusterName, namespace, name, replicas);
            showToast?.(`Scaled to ${replicas}`, 'success');
            refresh();
        } catch (err) {
            showToast?.(errMessage(err), 'error');
            throw err; // keeps ScaleModal open
        }
    }, [clusterName, namespace, name, showToast, refresh]);

    const handleRestart = useCallback(async () => {
        try {
            await window.k8s.restartDeployment(clusterName, namespace, name);
            showToast?.(`Rolling restart triggered for ${name}`, 'success');
            refresh();
        } catch (err) {
            showToast?.(errMessage(err), 'error'); // swallowed so the modal closes
        }
    }, [clusterName, namespace, name, showToast, refresh]);

    const deployment = details?.deployment;
    const handleEditYaml = useMemo(
        () => (onOpenYaml && deployment ? () => onOpenYaml({ ...deployment, type: 'deployment' }) : undefined),
        [onOpenYaml, deployment]);

    // ---- Page states ----
    const backButton = <GlassButton variant="secondary" onClick={onBack} icon={<ArrowLeft size={16} />}>Back to Deployments</GlassButton>;

    if (state === 'not-found') {
        return (
            <StateCard tone="gray" icon={<SearchX size={18} />} actions={backButton}>
                Deployment <span className="font-mono">{namespace}/{name}</span> no longer exists in {clusterName}.
            </StateCard>
        );
    }
    if (state === 'forbidden') {
        return (
            <StateCard tone="red" icon={<Lock size={18} />} actions={backButton}>
                You don&apos;t have permission to read this deployment.
            </StateCard>
        );
    }
    if (state === 'error' && !details) {
        return (
            <StateCard
                tone="red"
                icon={<XCircle size={18} />}
                actions={<>{backButton}<GlassButton variant="primary" onClick={refresh} icon={<RefreshCw size={16} />}>Retry</GlassButton></>}
            >
                Failed to load deployment <span className="font-mono">{namespace}/{name}</span>: {error}
            </StateCard>
        );
    }
    if (!details || !derived || !deployment) {
        return (
            <div className="space-y-6" aria-busy="true" aria-label="Loading deployment details">
                <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl p-6 animate-pulse">
                    <div className="h-7 w-64 bg-white/10 rounded mb-3" />
                    <div className="h-4 w-96 max-w-full bg-white/5 rounded" />
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl"><SkeletonLoader /></div>
            </div>
        );
    }

    const replicaSetAnnotations = details.replicaSets.status === 'ok' && selected
        ? details.replicaSets.data.find(rs => rs.metadata?.uid === selected.replicaSetUid)?.metadata?.annotations
        : undefined;

    return (
        <div className="space-y-6 pb-6">
            <DeploymentHeader
                name={name}
                namespace={namespace}
                clusterName={clusterName}
                deployment={deployment}
                liveUpdates={liveUpdates}
                isRefreshing={isRefreshing}
                lastFetchedAt={lastFetchedAt}
                refreshError={state === 'ready' ? error : null}
                hpa={derived.targetingHpa}
                onBack={onBack}
                onRefresh={refresh}
                onScale={openScale}
                onRestart={openRestart}
                onEditYaml={handleEditYaml}
                onDismissError={dismissError}
            />

            <SectionNav sections={NAV_SECTIONS} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <OverviewSection namespace={namespace} deployment={deployment} rollout={derived.rollout} lastAppliedBytes={details.lastAppliedBytes} />
                <RolloutSection namespace={namespace} rollout={derived.rollout} hpas={derived.hpas} pdbs={derived.pdbs} onOpenHpa={openHpa} onOpenPdb={openPdb} />
            </div>

            <SectionShell id="revisions" title="Revision History" namespace={namespace} result={details.replicaSets} unavailableLabel="list replicasets">
                {derived.revisions.length === 0 || !selected ? (
                    <p className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-4">
                        No ReplicaSets retained (revisionHistoryLimit = 0?)
                    </p>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                            <RevisionTimeline entries={derived.revisions} selectedKey={revisionKey(selected)} meta={derived.revisionMeta} onSelect={handleSelectRevision} />
                        </div>
                        <RevisionDetailPanel
                            entry={selected}
                            target={target}
                            compareMode={compareMode}
                            onCompareModeChange={setCompareMode}
                            changes={changes}
                            events={derived.revisionEvents.get(revisionKey(selected)) ?? []}
                            totalRevisions={derived.revisions.length}
                            revisionHistoryLimit={derived.rollout.revisionHistoryLimit}
                            replicaSetAnnotations={replicaSetAnnotations}
                            onOpenReplicaSet={openReplicaSet}
                            isDiffOpen={isDiffOpen}
                            onToggleDiff={handleToggleDiff}
                            diffSides={diffSides}
                            hasHiddenValues={hasHiddenValues}
                        />
                    </div>
                )}
            </SectionShell>

            <PodDistribution
                namespace={namespace}
                pods={details.pods}
                nodes={details.nodes}
                distribution={derived.distribution}
                onOpenNode={openNode}
                onOpenPod={openPod}
                onOpenPodLogs={podLogs.onOpenPodLogs}
                canOpenLogs={podLogs.canOpen}
            />
            <SchedulingConstraints namespace={namespace} template={derived.template} />
            <DeploymentPodsTable
                namespace={namespace}
                pods={details.pods}
                podMetrics={details.podMetrics}
                revisionByHash={derived.revisionByHash}
                onOpenPod={openPod}
                onOpenPodLogs={podLogs.onOpenPodLogs}
                canOpenLogs={podLogs.canOpen}
            />

            <ContainersSection namespace={namespace} insights={derived.containers} onOpenConfigMap={openConfigMap} />

            <SecurityPosture namespace={namespace} report={derived.security} namespaceInfo={details.namespace} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <NetworkingSection
                    namespace={namespace}
                    services={derived.services}
                    ingressRoutes={derived.ingressRoutes}
                    networkPolicies={derived.networkPolicies}
                    onOpenService={openService}
                    onOpenIngress={openIngress}
                    onOpenNetworkPolicy={openNetworkPolicy}
                />
                <ConfigStorageSection namespace={namespace} refs={derived.configRefs} pvcs={details.pvcs} onOpenConfigMap={openConfigMap} onOpenPvc={openPvc} />
            </div>

            <EventsSection namespace={namespace} events={details.events} />

            <SectionShell id="topology" title="Topology" namespace={namespace}>
                <Disclosure title="Show resource topology" className="bg-white/5 border border-white/10 rounded-xl p-4">
                    {/* Mounted only while expanded (Disclosure renders children lazily). */}
                    <ResourceTopology clusterName={clusterName} resource={deployment} />
                </Disclosure>
            </SectionShell>

            {isScaleOpen && (
                <ScaleModal isOpen onClose={closeScale} currentReplicas={deployment.spec?.replicas ?? 1} resourceName={name} onScale={handleScale} />
            )}
            <ConfirmModal
                isOpen={isRestartOpen}
                onClose={closeRestart}
                onConfirm={handleRestart}
                title="Rolling restart"
                message={`Rolling restart deployment ${name}?`}
                confirmText="Restart"
                variant="warning"
            />
        </div>
    );
};

/** Full-page Deployment view (tab `deployment-detail/<ns>/<name>`). Mount with key `${clusterName}|${activeView}`. */
export const DeploymentFullView: React.FC<DeploymentFullViewProps> = (props) => (
    <ErrorBoundary name="DeploymentFullView" resetKey={`${props.clusterName}/${props.namespace}/${props.name}`}>
        <DeploymentFullViewBody {...props} />
    </ErrorBoundary>
);
