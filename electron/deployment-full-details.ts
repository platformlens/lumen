/**
 * Aggregated, RBAC-tolerant data fetch for the Deployment Full View.
 *
 * Takes injected API clients so it can be unit tested with mocks; K8sService owns kubeconfig/context
 * and is the only caller. Every section settles independently: a 403/404/timeout only marks its own
 * section. 401s are rethrown so K8sService.withAuthRetry can refresh credentials.
 *
 * Invariant: no Secret API is ever called here, and object contents are never logged.
 */
import type {
    AppsV1Api, CoreV1Api, NetworkingV1Api, AutoscalingV2Api, PolicyV1Api,
    V1Pod, V2HorizontalPodAutoscaler, V2HorizontalPodAutoscalerList, CoreV1Event, V1OwnerReference, V1ContainerStatus,
} from '@kubernetes/client-node';
import { withTimeout } from '../src/lib/with-timeout';
import { LAST_APPLIED } from '../src/utils/sensitive-value-utils';
import { selectorToQueryString, matchesLabelSelector, matchesServiceSelector } from '../src/utils/label-selector-utils';
import type {
    Jsonified, SectionResult, DeploymentPodSummary, DeploymentPodContainerStatus, NodeSummary,
    DeploymentEvent, NamespaceSummary, DeploymentFullDetails, DeploymentFullDetailsResponse, ReplicaSetObj,
} from '../src/types/deployment-details';
import { LOG_PREFIX, classifyK8sError, settle, toSaSummary, fetchPvcs, fetchNodes } from './deployment-full-details-fetchers';

export {
    classifyK8sError, settle, mapWithConcurrency, summarizeNode, toSaSummary, toPvcSummary,
} from './deployment-full-details-fetchers';
export type { SettleOptions } from './deployment-full-details-fetchers';

export interface DeploymentDetailsClients {
    apps: AppsV1Api; core: CoreV1Api; networking: NetworkingV1Api;
    autoscaling: AutoscalingV2Api; policy: PolicyV1Api;
    /** existing K8sService.getPodMetrics(context, [namespace]); Map keyed `${namespace}/${podName}` */
    getPodMetrics: () => Promise<Map<string, { cpu: string; memory: string }>>;
}

type Metrics = { cpu: string; memory: string };
const DEPLOYMENT_TIMEOUT_MS = 20000;
const MAX_EVENTS = 300;

// --- Pure helpers ---

/** JSON round-trip (Date -> ISO string) and delete metadata.managedFields (also on list items). */
export function toPlain<T>(obj: T): Jsonified<T> {
    if (obj === undefined) return obj as Jsonified<T>;
    const plain = JSON.parse(JSON.stringify(obj)) as unknown;
    stripManagedFields(plain);
    return plain as Jsonified<T>;
}

function stripManagedFields(o: unknown): void {
    if (!o || typeof o !== 'object') return;
    const r = o as { metadata?: { managedFields?: unknown }; items?: unknown };
    if (r.metadata && typeof r.metadata === 'object') delete r.metadata.managedFields;
    if (Array.isArray(r.items)) r.items.forEach(stripManagedFields);
}

function toIso(v: unknown): string | null {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    if (typeof v === 'string' && v) return v;
    return null;
}

function containerState(s: V1ContainerStatus | undefined): DeploymentPodContainerStatus['state'] {
    return s?.state?.running ? 'running' : s?.state?.waiting ? 'waiting' : s?.state?.terminated ? 'terminated' : 'unknown';
}

export function summarizePod(pod: V1Pod): DeploymentPodSummary {
    const spec = pod.spec;
    const status = pod.status;
    const initStatuses = new Map((status?.initContainerStatuses ?? []).map(s => [s.name, s]));
    const mainStatuses = new Map((status?.containerStatuses ?? []).map(s => [s.name, s]));

    const build = (name: string, image: string | undefined, kind: DeploymentPodContainerStatus['kind'],
        s: V1ContainerStatus | undefined): DeploymentPodContainerStatus => ({
        name, kind,
        ready: s?.ready ?? false,
        started: s?.started ?? null,
        restartCount: s?.restartCount ?? 0,
        state: containerState(s),
        reason: s?.state?.waiting?.reason ?? s?.state?.terminated?.reason ?? null,
        lastTerminationReason: s?.lastState?.terminated?.reason ?? null,
        image: s?.image ?? image ?? '',
        imageID: s?.imageID ?? '',
    });

    const containers: DeploymentPodContainerStatus[] = [
        ...(spec?.initContainers ?? []).map(c =>
            build(c.name, c.image, c.restartPolicy === 'Always' ? 'sidecar' : 'init', initStatuses.get(c.name))),
        ...(spec?.containers ?? []).map(c => build(c.name, c.image, 'main', mainStatuses.get(c.name))),
    ];
    const counted = containers.filter(c => c.kind !== 'init');
    const deletionTimestamp = toIso(pod.metadata?.deletionTimestamp);

    // Terminating | main waiting reason | main terminated reason | Init:<init/sidecar waiting reason> | phase
    const main = containers.filter(c => c.kind === 'main');
    const initWaiting = containers.find(c => c.kind !== 'main' && c.state === 'waiting' && c.reason && c.reason !== 'PodInitializing');
    const displayStatus = deletionTimestamp ? 'Terminating'
        : main.find(c => c.state === 'waiting' && c.reason)?.reason
        ?? main.find(c => c.state === 'terminated' && c.reason)?.reason
        ?? (initWaiting?.reason ? `Init:${initWaiting.reason}` : status?.phase ?? 'Unknown');

    const scheduled = status?.conditions?.find(c => c.type === 'PodScheduled');
    return {
        name: pod.metadata?.name ?? '',
        uid: pod.metadata?.uid ?? '',
        namespace: pod.metadata?.namespace ?? '',
        phase: status?.phase ?? 'Unknown',
        displayStatus,
        readyContainers: counted.filter(c => c.ready).length,
        totalContainers: counted.length,
        restarts: containers.reduce((sum, c) => sum + c.restartCount, 0),
        nodeName: spec?.nodeName ?? null,
        podIP: status?.podIP ?? null,
        hostIP: status?.hostIP ?? null,
        createdAt: toIso(pod.metadata?.creationTimestamp) ?? '',
        startTime: toIso(status?.startTime),
        deletionTimestamp,
        qosClass: status?.qosClass ?? null,
        podTemplateHash: pod.metadata?.labels?.['pod-template-hash'] ?? null,
        ownerReplicaSet: pod.metadata?.ownerReferences?.find(r => r.kind === 'ReplicaSet')?.name ?? null,
        unschedulableMessage: scheduled?.status === 'False' ? (scheduled.message ?? scheduled.reason ?? null) : null,
        containers,
    };
}

export function filterHpa(list: V2HorizontalPodAutoscalerList, deploymentName: string): Jsonified<V2HorizontalPodAutoscaler>[] {
    return (list.items ?? [])
        .filter(h => h.spec?.scaleTargetRef?.kind === 'Deployment' && h.spec.scaleTargetRef.name === deploymentName)
        .map(h => toPlain(h));
}

export function toDeploymentEvent(e: CoreV1Event, fetchedAt: string = new Date().toISOString()): DeploymentEvent {
    return {
        type: e.type ?? '',
        reason: e.reason ?? '',
        message: e.message ?? '',
        count: e.count ?? e.series?.count ?? 1,
        firstTimestamp: toIso(e.firstTimestamp) ?? toIso(e.eventTime),
        lastTimestamp: toIso(e.lastTimestamp) ?? toIso(e.series?.lastObservedTime) ?? toIso(e.eventTime)
            ?? toIso(e.metadata?.creationTimestamp) ?? fetchedAt,
        involvedKind: e.involvedObject?.kind ?? '',
        involvedName: e.involvedObject?.name ?? '',
        involvedUid: e.involvedObject?.uid ?? '',
        // core/v1 names the reporting controller `reportingComponent` (events.k8s.io: reportingController)
        source: e.source?.component ?? e.reportingComponent ?? null,
    };
}

export function filterOwned<T extends { metadata?: { ownerReferences?: V1OwnerReference[] } }>(
    items: T[], ownerUids: Set<string>,
): T[] {
    return items.filter(i => i.metadata?.ownerReferences?.some(r => ownerUids.has(r.uid)) ?? false);
}

export function pickPodMetrics(map: Map<string, Metrics>, namespace: string, podNames: string[]): Record<string, Metrics> {
    const out: Record<string, Metrics> = {};
    for (const n of podNames) {
        const m = map.get(`${namespace}/${n}`);
        if (m) out[n] = m;
    }
    return out;
}

function stripLastApplied(annotations: Record<string, string> | undefined): number | null {
    const raw = annotations?.[LAST_APPLIED];
    if (raw == null || !annotations) return null;
    delete annotations[LAST_APPLIED];
    return Buffer.byteLength(raw, 'utf8');
}

// --- Orchestration ---

export async function fetchDeploymentFullDetails(
    clients: DeploymentDetailsClients, context: string, namespace: string, name: string,
): Promise<DeploymentFullDetailsResponse> {
    const { apps, core, networking, autoscaling, policy } = clients;
    const fetchedAt = new Date().toISOString();

    // Phase 1: the deployment itself (fatal on failure).
    let raw;
    try {
        raw = await withTimeout(apps.readNamespacedDeployment({ name, namespace }), DEPLOYMENT_TIMEOUT_MS, 'deployment');
    } catch (err) {
        const cls = classifyK8sError(err);
        if (cls === 'not-found') {
            console.log(`${LOG_PREFIX} deployment ${namespace}/${name}: not found`);
            return { found: false, reason: 'not-found', message: `Deployment ${namespace}/${name} not found` };
        }
        if (cls === 'forbidden') {
            console.warn(`${LOG_PREFIX} deployment ${namespace}/${name}: forbidden`);
            return { found: false, reason: 'forbidden', message: `No permission to read deployment ${namespace}/${name}` };
        }
        if (cls !== 'unauthorized') console.error(`${LOG_PREFIX} deployment ${namespace}/${name}: ${cls}`);
        throw err;
    }

    const deployment = toPlain(raw);
    deployment.kind ??= 'Deployment';
    deployment.apiVersion ??= 'apps/v1';
    const lastAppliedBytes = stripLastApplied(deployment.metadata?.annotations);

    const uid = deployment.metadata?.uid ?? '';
    const templateLabels = deployment.spec?.template?.metadata?.labels;
    const templateSpec = deployment.spec?.template?.spec;
    const labelSelector = selectorToQueryString(deployment.spec?.selector);
    const noSelector = { status: 'error', message: 'Deployment has no selector' } as const;

    // Phase 2: independent sections in parallel; dependent filters are promise chains.
    const replicaSetsP: Promise<SectionResult<ReplicaSetObj[]>> = labelSelector
        ? settle(apps.listNamespacedReplicaSet({ namespace, labelSelector }).then(list =>
            filterOwned(list.items, new Set([uid])).map(rs => {
                const plain = toPlain(rs);
                stripLastApplied(plain.metadata?.annotations);
                return plain;
            })), 'replicasets')
        : Promise.resolve(noSelector);

    const podsP: Promise<SectionResult<DeploymentPodSummary[]>> = replicaSetsP.then(async rs => {
        if (!labelSelector) return noSelector;
        const rsUids = rs.status === 'ok'
            ? new Set(rs.data.map(r => r.metadata?.uid).filter((u): u is string => !!u)) : null;
        const res = await settle(core.listNamespacedPod({ namespace, labelSelector }).then(list =>
            (rsUids ? filterOwned(list.items, rsUids) : list.items).map(summarizePod)), 'pods');
        if (res.status === 'ok' && !rsUids) {
            return { ...res, note: 'Ownership approximate: ReplicaSets unavailable, matched by selector only' };
        }
        return res;
    });

    const eventsP: Promise<SectionResult<DeploymentEvent[]>> = Promise.all([replicaSetsP, podsP]).then(async ([rs, pods]) => {
        const allowed = new Set<string>([uid]);
        if (rs.status === 'ok') rs.data.forEach(r => { if (r.metadata?.uid) allowed.add(r.metadata.uid); });
        if (pods.status === 'ok') pods.data.forEach(p => { if (p.uid) allowed.add(p.uid); });
        const res = await settle(core.listNamespacedEvent({ namespace }).then(list => list.items
            .filter(e => !!e.involvedObject?.uid && allowed.has(e.involvedObject.uid))
            .map(e => toDeploymentEvent(e, fetchedAt))
            .sort((a, b) => Date.parse(b.lastTimestamp) - Date.parse(a.lastTimestamp))
            .slice(0, MAX_EVENTS)), 'events');
        if (res.status === 'ok' && (rs.status !== 'ok' || pods.status !== 'ok')) {
            return { ...res, note: 'Some related events may be missing' };
        }
        return res;
    });

    const servicesP = settle(core.listNamespacedService({ namespace }).then(list => list.items
        .filter(s => matchesServiceSelector(s.spec?.selector, templateLabels))
        .map(s => toPlain(s))), 'services');

    const ingressesP: Promise<DeploymentFullDetails['ingresses']> = servicesP.then(svcs => {
        if (svcs.status !== 'ok') return { status: 'error', message: 'Requires Services' };
        const names = new Set(svcs.data.map(s => s.metadata?.name).filter((n): n is string => !!n));
        return settle(networking.listNamespacedIngress({ namespace }).then(list => list.items
            .filter(ing => {
                const def = ing.spec?.defaultBackend?.service?.name;
                if (def && names.has(def)) return true;
                return (ing.spec?.rules ?? []).some(r => (r.http?.paths ?? [])
                    .some(p => !!p.backend?.service?.name && names.has(p.backend.service.name)));
            })
            .map(i => toPlain(i))), 'ingresses');
    });

    const networkPoliciesP: Promise<DeploymentFullDetails['networkPolicies']> = labelSelector
        ? settle(networking.listNamespacedNetworkPolicy({ namespace }).then(list => list.items
            .filter(np => matchesLabelSelector(toPlain(np.spec?.podSelector), templateLabels, { emptyMatchesAll: true }))
            .map(np => toPlain(np))), 'networkpolicies')
        : Promise.resolve(noSelector);

    const hpasP = settle(autoscaling.listNamespacedHorizontalPodAutoscaler({ namespace }).then(list => filterHpa(list, name)), 'hpas',
        { onNotFound: () => ({ status: 'error', message: 'autoscaling/v2 API not available' }) });

    const pdbsP: Promise<DeploymentFullDetails['pdbs']> = labelSelector
        ? settle(policy.listNamespacedPodDisruptionBudget({ namespace }).then(list => list.items
            .filter(pdb => matchesLabelSelector(toPlain(pdb.spec?.selector), templateLabels, { emptyMatchesAll: true }))
            .map(pdb => toPlain(pdb))), 'pdbs')
        : Promise.resolve(noSelector);

    const saName = templateSpec?.serviceAccountName ?? 'default';
    const serviceAccountP = settle(core.readNamespacedServiceAccount({ name: saName, namespace }).then(toSaSummary), 'serviceaccount',
        { onNotFound: () => ({ status: 'ok', data: { name: saName, exists: false,
            automountServiceAccountToken: null, imagePullSecretNames: [], irsaRoleArn: null } }) });

    const namespaceP = settle(core.readNamespace({ name: namespace }).then((ns): NamespaceSummary => {
        const l = ns.metadata?.labels ?? {};
        return {
            name: ns.metadata?.name ?? namespace,
            podSecurity: {
                enforce: l['pod-security.kubernetes.io/enforce'] ?? null,
                enforceVersion: l['pod-security.kubernetes.io/enforce-version'] ?? null,
                audit: l['pod-security.kubernetes.io/audit'] ?? null,
                warn: l['pod-security.kubernetes.io/warn'] ?? null,
            },
        };
    }), 'namespace');

    const claims = (templateSpec?.volumes ?? [])
        .map(v => v.persistentVolumeClaim?.claimName).filter((c): c is string => !!c);
    const pvcsP = fetchPvcs(core, namespace, claims);

    const podMetricsP: Promise<DeploymentFullDetails['podMetrics']> = podsP.then(pods => pods.status === 'ok'
        ? settle(clients.getPodMetrics().then(m => pickPodMetrics(m, namespace, pods.data.map(p => p.name))), 'metrics')
        : { status: 'error', message: 'Requires Pods' });

    // Phase 3: reads of the individual nodes hosting this deployment's pods.
    const nodesP: Promise<SectionResult<NodeSummary[]>> = podsP.then(pods => pods.status === 'ok'
        ? fetchNodes(core, pods.data)
        : { status: 'error', message: 'Requires Pods' });

    const [replicaSets, pods, nodes, events, services, ingresses, networkPolicies, hpas, pdbs,
        serviceAccount, namespaceSummary, pvcs, podMetrics] = await Promise.all([
        replicaSetsP, podsP, nodesP, eventsP, servicesP, ingressesP, networkPoliciesP, hpasP, pdbsP,
        serviceAccountP, namespaceP, pvcsP, podMetricsP,
    ]);

    return {
        found: true,
        details: {
            context, fetchedAt, deployment, lastAppliedBytes,
            replicaSets, pods, nodes, events, services, ingresses, networkPolicies, hpas, pdbs,
            serviceAccount, namespace: namespaceSummary, pvcs, podMetrics,
        },
    };
}
