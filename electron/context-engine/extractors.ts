/**
 * Extraction functions that convert raw Kubernetes API objects into ResourceSnapshots.
 * These work with the raw apiObj from K8s watchers (not the transformed objects).
 * Requirements: 1.1
 */

import { ResourceSnapshot, ConditionSummary } from './types';

/** Extract a ResourceSnapshot from a raw Kubernetes Pod object. */
export function extractPodSnapshot(rawPod: any): ResourceSnapshot {
    const metadata = rawPod.metadata ?? {};
    const status = rawPod.status ?? {};
    const spec = rawPod.spec ?? {};

    const containerStatuses: any[] = status.containerStatuses ?? [];
    const initContainerStatuses: any[] = status.initContainerStatuses ?? [];

    const restartCount = containerStatuses.reduce(
        (sum: number, c: any) => sum + (c.restartCount ?? 0),
        0
    );

    const ready = containerStatuses.length > 0 &&
        containerStatuses.every((c: any) => c.ready === true);

    const conditions: ConditionSummary[] = (status.conditions ?? []).map((c: any) => ({
        type: c.type ?? '',
        status: c.status ?? '',
        reason: c.reason,
        message: c.message,
    }));

    // Collect warnings from container waiting states
    const warnings: string[] = [];
    for (const c of [...initContainerStatuses, ...containerStatuses]) {
        const waitingReason = c.state?.waiting?.reason;
        if (waitingReason) warnings.push(waitingReason);
        const terminatedReason = c.state?.terminated?.reason;
        if (terminatedReason && terminatedReason !== 'Completed') warnings.push(terminatedReason);
        const lastTerminatedReason = c.lastState?.terminated?.reason;
        if (lastTerminatedReason && lastTerminatedReason !== 'Completed') warnings.push(lastTerminatedReason);
    }

    // Extract resource requests/limits from spec containers
    const resourceUsage = extractContainerResources(spec.containers ?? []);

    return {
        kind: 'Pod',
        name: metadata.name ?? '',
        namespace: metadata.namespace ?? null,
        phase: status.phase ?? 'Unknown',
        conditions,
        restartCount,
        ready,
        age: metadata.creationTimestamp ?? new Date().toISOString(),
        resourceUsage: resourceUsage ?? undefined,
        warnings,
    };
}

/** Extract a ResourceSnapshot from a raw Kubernetes Deployment object. */
export function extractDeploymentSnapshot(rawDeployment: any): ResourceSnapshot {
    const metadata = rawDeployment.metadata ?? {};
    const status = rawDeployment.status ?? {};
    const spec = rawDeployment.spec ?? {};

    const desired = spec.replicas ?? 0;
    const readyReplicas = status.readyReplicas ?? 0;
    const unavailable = status.unavailableReplicas ?? 0;

    const conditions: ConditionSummary[] = (status.conditions ?? []).map((c: any) => ({
        type: c.type ?? '',
        status: c.status ?? '',
        reason: c.reason,
        message: c.message,
    }));

    // Derive phase from conditions
    const availableCondition = conditions.find(c => c.type === 'Available');
    const progressingCondition = conditions.find(c => c.type === 'Progressing');
    let phase = 'Unknown';
    if (availableCondition?.status === 'True') {
        phase = unavailable > 0 ? 'Degraded' : 'Available';
    } else if (progressingCondition?.status === 'True') {
        phase = 'Progressing';
    } else if (availableCondition?.status === 'False') {
        phase = 'Unavailable';
    }

    const warnings: string[] = [];
    if (unavailable > 0) {
        warnings.push(`${unavailable} unavailable replica(s)`);
    }

    return {
        kind: 'Deployment',
        name: metadata.name ?? '',
        namespace: metadata.namespace ?? null,
        phase,
        conditions,
        restartCount: 0,
        ready: unavailable === 0 && readyReplicas >= desired,
        age: metadata.creationTimestamp ?? new Date().toISOString(),
        replicas: { desired, ready: readyReplicas, unavailable },
        warnings,
    };
}

/** Extract a ResourceSnapshot from a raw Kubernetes Node object. */
export function extractNodeSnapshot(rawNode: any): ResourceSnapshot {
    const metadata = rawNode.metadata ?? {};
    const status = rawNode.status ?? {};

    const conditions: ConditionSummary[] = (status.conditions ?? []).map((c: any) => ({
        type: c.type ?? '',
        status: c.status ?? '',
        reason: c.reason,
        message: c.message,
    }));

    const readyCondition = conditions.find(c => c.type === 'Ready');
    const isReady = readyCondition?.status === 'True';
    const phase = isReady ? 'Ready' : 'NotReady';

    const warnings: string[] = [];
    // Flag pressure conditions
    for (const c of conditions) {
        if (c.type !== 'Ready' && c.status === 'True') {
            warnings.push(c.type);
        }
    }
    if (!isReady && readyCondition?.message) {
        warnings.push(readyCondition.message);
    }

    // Extract allocatable resources
    const allocatable = status.allocatable ?? {};
    const resourceUsage = (allocatable.cpu || allocatable.memory)
        ? {
            cpuRequests: allocatable.cpu ?? '',
            memoryRequests: allocatable.memory ?? '',
            cpuLimits: status.capacity?.cpu ?? '',
            memoryLimits: status.capacity?.memory ?? '',
        }
        : undefined;

    return {
        kind: 'Node',
        name: metadata.name ?? '',
        namespace: null,
        phase,
        conditions,
        restartCount: 0,
        ready: isReady,
        age: metadata.creationTimestamp ?? new Date().toISOString(),
        resourceUsage,
        warnings,
    };
}

/** Sum resource requests/limits across all containers in a pod spec. */
function extractContainerResources(
    containers: any[]
): ResourceSnapshot['resourceUsage'] | null {
    let hasSome = false;
    let cpuReq = '', memReq = '', cpuLim = '', memLim = '';

    for (const c of containers) {
        const res = c.resources ?? {};
        if (res.requests?.cpu) { cpuReq = cpuReq || res.requests.cpu; hasSome = true; }
        if (res.requests?.memory) { memReq = memReq || res.requests.memory; hasSome = true; }
        if (res.limits?.cpu) { cpuLim = cpuLim || res.limits.cpu; hasSome = true; }
        if (res.limits?.memory) { memLim = memLim || res.limits.memory; hasSome = true; }
    }

    if (!hasSome) return null;
    return {
        cpuRequests: cpuReq,
        memoryRequests: memReq,
        cpuLimits: cpuLim,
        memoryLimits: memLim,
    };
}
