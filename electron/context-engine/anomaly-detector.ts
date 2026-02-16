/**
 * AnomalyDetector — evaluates resources against predefined anomaly rules.
 * Detects CrashLoopBackOff, OOMKilled, NodeNotReady, DeploymentUnavailable, HighRestartCount.
 * Deduplicates via activeAnomalies Map keyed by deterministic anomaly ID.
 * Caps active anomalies at 20 with a summary anomaly for overflow.
 * Requirements: 7.1, 7.2, 7.4
 */

import { ResourceSnapshot, Anomaly, AnomalyRule } from './types';

const MAX_ACTIVE_ANOMALIES = 20;

/** Build a deterministic anomaly ID from resource key + anomaly type. */
function buildAnomalyId(kind: string, namespace: string | null, name: string, type: string): string {
    return `${kind}/${namespace ?? ''}/${name}/${type}`;
}

// --- Built-in anomaly rules ---

const crashLoopBackOffRule: AnomalyRule = {
    name: 'CrashLoopBackOff',
    evaluate(resource: ResourceSnapshot): Anomaly | null {
        if (resource.kind !== 'Pod') return null;
        if (!resource.warnings.some(w => w.includes('CrashLoopBackOff'))) return null;
        return {
            id: buildAnomalyId(resource.kind, resource.namespace, resource.name, 'CrashLoopBackOff'),
            resource,
            type: 'CrashLoopBackOff',
            severity: 'critical',
            message: `Pod ${resource.name} is in CrashLoopBackOff`,
            detectedAt: Date.now(),
        };
    },
};

const oomKilledRule: AnomalyRule = {
    name: 'OOMKilled',
    evaluate(resource: ResourceSnapshot): Anomaly | null {
        if (resource.kind !== 'Pod') return null;
        if (!resource.warnings.some(w => w.includes('OOMKilled'))) return null;
        return {
            id: buildAnomalyId(resource.kind, resource.namespace, resource.name, 'OOMKilled'),
            resource,
            type: 'OOMKilled',
            severity: 'critical',
            message: `Pod ${resource.name} was OOMKilled`,
            detectedAt: Date.now(),
        };
    },
};


const nodeNotReadyRule: AnomalyRule = {
    name: 'NodeNotReady',
    evaluate(resource: ResourceSnapshot): Anomaly | null {
        if (resource.kind !== 'Node') return null;
        if (resource.phase !== 'NotReady') return null;
        return {
            id: buildAnomalyId(resource.kind, resource.namespace, resource.name, 'NodeNotReady'),
            resource,
            type: 'NodeNotReady',
            severity: 'critical',
            message: `Node ${resource.name} is NotReady`,
            detectedAt: Date.now(),
        };
    },
};

const deploymentUnavailableRule: AnomalyRule = {
    name: 'DeploymentUnavailable',
    evaluate(resource: ResourceSnapshot): Anomaly | null {
        if (resource.kind !== 'Deployment') return null;
        if (!resource.replicas || resource.replicas.unavailable <= 0) return null;
        return {
            id: buildAnomalyId(resource.kind, resource.namespace, resource.name, 'DeploymentUnavailable'),
            resource,
            type: 'DeploymentUnavailable',
            severity: 'warning',
            message: `Deployment ${resource.name} has ${resource.replicas.unavailable} unavailable replica(s)`,
            detectedAt: Date.now(),
        };
    },
};

const highRestartCountRule: AnomalyRule = {
    name: 'HighRestartCount',
    evaluate(resource: ResourceSnapshot): Anomaly | null {
        if (resource.kind !== 'Pod') return null;
        if (resource.restartCount <= 5) return null;
        return {
            id: buildAnomalyId(resource.kind, resource.namespace, resource.name, 'HighRestartCount'),
            resource,
            type: 'HighRestartCount',
            severity: 'warning',
            message: `Pod ${resource.name} has restarted ${resource.restartCount} times`,
            detectedAt: Date.now(),
        };
    },
};

const BUILT_IN_RULES: AnomalyRule[] = [
    crashLoopBackOffRule,
    oomKilledRule,
    nodeNotReadyRule,
    deploymentUnavailableRule,
    highRestartCountRule,
];

export class AnomalyDetector {
    private activeAnomalies: Map<string, Anomaly>;
    private rules: AnomalyRule[];

    constructor() {
        this.activeAnomalies = new Map();
        this.rules = BUILT_IN_RULES;
    }

    /**
     * Evaluate a resource against all rules.
     * Returns only newly detected anomalies (not already active).
     * Deduplicates by anomaly ID — same anomaly on same resource won't fire twice.
     */
    evaluate(snapshot: ResourceSnapshot): Anomaly[] {
        const newAnomalies: Anomaly[] = [];

        for (const rule of this.rules) {
            const anomaly = rule.evaluate(snapshot);
            if (anomaly && !this.activeAnomalies.has(anomaly.id)) {
                // Check cap before adding
                if (this.activeAnomalies.size >= MAX_ACTIVE_ANOMALIES) {
                    // Emit a summary anomaly and stop adding individual ones
                    const summaryId = '__overflow_summary__';
                    if (!this.activeAnomalies.has(summaryId)) {
                        const summaryAnomaly: Anomaly = {
                            id: summaryId,
                            resource: snapshot,
                            type: 'OverflowSummary',
                            severity: 'warning',
                            message: `${MAX_ACTIVE_ANOMALIES}+ resources affected — additional anomalies suppressed`,
                            detectedAt: Date.now(),
                        };
                        this.activeAnomalies.set(summaryId, summaryAnomaly);
                        newAnomalies.push(summaryAnomaly);
                    }
                    break;
                }
                this.activeAnomalies.set(anomaly.id, anomaly);
                newAnomalies.push(anomaly);
            }
        }

        return newAnomalies;
    }

    /** Clear all active anomalies for a specific resource. */
    clearForResource(kind: string, namespace: string | null, name: string): void {
        const prefix = `${kind}/${namespace ?? ''}/${name}/`;
        for (const key of this.activeAnomalies.keys()) {
            if (key.startsWith(prefix)) {
                this.activeAnomalies.delete(key);
            }
        }
    }

    /** Clear all active anomalies for a specific resource kind. */
    clearForKind(kind: string): void {
        const prefix = `${kind}/`;
        for (const key of this.activeAnomalies.keys()) {
            if (key.startsWith(prefix)) {
                this.activeAnomalies.delete(key);
            }
        }
    }


    /** Get all currently active anomalies. */
    getActive(): Anomaly[] {
        return Array.from(this.activeAnomalies.values());
    }
}