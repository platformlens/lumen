/**
 * Rollout, HPA and PDB summaries for the Deployment Full View.
 */
import type { V2HorizontalPodAutoscaler, V1PodDisruptionBudget } from '@kubernetes/client-node';
import type { DeploymentObj, Jsonified } from '../types/deployment-details';

export interface RolloutSummary {
    desired: number; current: number; updated: number; ready: number; available: number;
    unavailable: number; progressPercent: number; isPaused: boolean; isComplete: boolean; isStalled: boolean;
    observedGenerationStale: boolean;
    strategy: { type: 'RollingUpdate' | 'Recreate'; maxSurge: string | null; maxUnavailable: string | null };
    conditions: { type: string; status: string; reason: string | null; message: string | null; lastTransitionTime: string | null }[];
    minReadySeconds: number; progressDeadlineSeconds: number; revisionHistoryLimit: number;
}

export interface HpaSummary {
    name: string; min: number; max: number; current: number; desired: number;
    metrics: { label: string; target: string; current: string | null }[]; atMax: boolean; conditions: RolloutSummary['conditions'];
}

export interface PdbSummary {
    name: string; minAvailable: string | null; maxUnavailable: string | null;
    currentHealthy: number; desiredHealthy: number; disruptionsAllowed: number; blocksEviction: boolean;
}

interface RawCondition {
    type?: string; status?: string; reason?: string; message?: string; lastTransitionTime?: string;
}

const DEFAULT_SURGE = '25%';

function mapConditions(conds: RawCondition[] | undefined): RolloutSummary['conditions'] {
    return (conds ?? []).map(c => ({
        type: c.type ?? '',
        status: c.status ?? 'Unknown',
        reason: c.reason ?? null,
        message: c.message ?? null,
        lastTransitionTime: c.lastTransitionTime ?? null,
    }));
}

function intOrStringToString(v: string | number | undefined | null): string | null {
    return v === undefined || v === null ? null : String(v);
}

export function getRolloutSummary(d: DeploymentObj): RolloutSummary {
    const spec = d.spec;
    const status = d.status;
    const desired = spec?.replicas ?? 1;
    const updated = status?.updatedReplicas ?? 0;
    const available = status?.availableReplicas ?? 0;
    const conditions = mapConditions(status?.conditions);
    const progressing = conditions.find(c => c.type === 'Progressing');

    const strategyType = spec?.strategy?.type === 'Recreate' ? 'Recreate' : 'RollingUpdate';
    const ru = spec?.strategy?.rollingUpdate;
    const strategy: RolloutSummary['strategy'] = strategyType === 'Recreate'
        ? { type: 'Recreate', maxSurge: null, maxUnavailable: null }
        : {
            type: 'RollingUpdate',
            maxSurge: intOrStringToString(ru?.maxSurge) ?? DEFAULT_SURGE,
            maxUnavailable: intOrStringToString(ru?.maxUnavailable) ?? DEFAULT_SURGE,
        };

    const progressPercent = desired === 0 ? 100 : Math.round(Math.min(updated, available) / desired * 100);
    const isStalled = progressing?.status === 'False' && progressing.reason === 'ProgressDeadlineExceeded';
    const isComplete = progressing?.status === 'True' && progressing.reason === 'NewReplicaSetAvailable'
        && updated === desired && available === desired;
    const generation = d.metadata?.generation;
    const observed = status?.observedGeneration;
    const observedGenerationStale = generation !== undefined && (observed ?? 0) < generation;

    return {
        desired,
        current: status?.replicas ?? 0,
        updated,
        ready: status?.readyReplicas ?? 0,
        available,
        unavailable: status?.unavailableReplicas ?? 0,
        progressPercent,
        isPaused: spec?.paused === true,
        isComplete,
        isStalled,
        observedGenerationStale,
        strategy,
        conditions,
        minReadySeconds: spec?.minReadySeconds ?? 0,
        progressDeadlineSeconds: spec?.progressDeadlineSeconds ?? 600,
        revisionHistoryLimit: spec?.revisionHistoryLimit ?? 10,
    };
}

interface MetricValue { averageUtilization?: number; averageValue?: string; value?: string }

function formatMetricValue(v: MetricValue | undefined): string | null {
    if (!v) return null;
    if (v.averageUtilization !== undefined) return `${v.averageUtilization}%`;
    if (v.averageValue !== undefined) return `${v.averageValue} (avg)`;
    if (v.value !== undefined) return v.value;
    return null;
}

type HpaObj = Jsonified<V2HorizontalPodAutoscaler>;
type MetricSpec = NonNullable<NonNullable<HpaObj['spec']>['metrics']>[number];
type MetricStatus = NonNullable<NonNullable<HpaObj['status']>['currentMetrics']>[number];

/** Identity used to pair a metric spec with its current status. */
function metricKey(m: MetricSpec | MetricStatus): string {
    if (m.resource) return `Resource|${m.resource.name}`;
    if (m.containerResource) return `ContainerResource|${m.containerResource.name}|${m.containerResource.container}`;
    if (m.pods) return `Pods|${m.pods.metric?.name}`;
    if (m.object) return `Object|${m.object.describedObject?.kind}/${m.object.describedObject?.name}|${m.object.metric?.name}`;
    if (m.external) return `External|${m.external.metric?.name}`;
    return `Unknown|${(m as { type?: string }).type ?? ''}`;
}

function metricLabel(m: MetricSpec): string {
    if (m.resource) return m.resource.name;
    if (m.containerResource) return `${m.containerResource.name} (${m.containerResource.container})`;
    if (m.pods) return `pods ${m.pods.metric?.name ?? ''}`.trim();
    if (m.object) return `${m.object.describedObject?.kind ?? ''}/${m.object.describedObject?.name ?? ''} ${m.object.metric?.name ?? ''}`.trim();
    if (m.external) return `external ${m.external.metric?.name ?? ''}`.trim();
    return m.type ?? 'unknown';
}

function metricTarget(m: MetricSpec): MetricValue | undefined {
    return m.resource?.target ?? m.containerResource?.target ?? m.pods?.target ?? m.object?.target ?? m.external?.target;
}

function metricCurrent(m: MetricStatus): MetricValue | undefined {
    return m.resource?.current ?? m.containerResource?.current ?? m.pods?.current ?? m.object?.current ?? m.external?.current;
}

export function summarizeHpa(hpa: HpaObj): HpaSummary {
    const min = hpa.spec?.minReplicas ?? 1;
    const max = hpa.spec?.maxReplicas ?? 0;
    const current = hpa.status?.currentReplicas ?? 0;
    const currentByKey = new Map<string, MetricStatus>();
    for (const cm of hpa.status?.currentMetrics ?? []) currentByKey.set(metricKey(cm), cm);
    const metrics = (hpa.spec?.metrics ?? []).map(m => {
        const cur = currentByKey.get(metricKey(m));
        return {
            label: metricLabel(m),
            target: formatMetricValue(metricTarget(m)) ?? '—',
            current: cur ? formatMetricValue(metricCurrent(cur)) : null,
        };
    });
    return {
        name: hpa.metadata?.name ?? '',
        min,
        max,
        current,
        desired: hpa.status?.desiredReplicas ?? 0,
        metrics,
        atMax: max > 0 && current >= max,
        conditions: mapConditions(hpa.status?.conditions),
    };
}

export function summarizePdb(pdb: Jsonified<V1PodDisruptionBudget>): PdbSummary {
    const disruptionsAllowed = pdb.status?.disruptionsAllowed ?? 0;
    return {
        name: pdb.metadata?.name ?? '',
        minAvailable: intOrStringToString(pdb.spec?.minAvailable),
        maxUnavailable: intOrStringToString(pdb.spec?.maxUnavailable),
        currentHealthy: pdb.status?.currentHealthy ?? 0,
        desiredHealthy: pdb.status?.desiredHealthy ?? 0,
        disruptionsAllowed,
        blocksEviction: disruptionsAllowed === 0,
    };
}
