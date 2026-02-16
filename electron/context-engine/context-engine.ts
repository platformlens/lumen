/**
 * ContextEngine — central orchestrator for the AI Context Engine.
 * Composes ContextStore, AnomalyDetector, ContextInjector, and summary cache.
 * Subscribes to K8s watcher events, manages state, and runs anomaly detection.
 * Requirements: 1.1, 1.2, 1.3, 4.4, 9.2
 */

import { EventEmitter } from 'events';
import { ContextStore } from './context-store';
import { AnomalyDetector } from './anomaly-detector';
import { ContextInjector } from './context-injector';
import { extractPodSnapshot, extractDeploymentSnapshot, extractNodeSnapshot } from './extractors';
import { ContextEngineConfig, ContextQuery, ResourceSnapshot, ViewSummaryData, SummaryStatBox } from './types';

interface SummaryCacheEntry {
    data: ViewSummaryData;
    hash: string;
    timestamp: number;
}

export class ContextEngine extends EventEmitter {
    private store: ContextStore;
    private anomalyDetector: AnomalyDetector;
    private injector: ContextInjector;
    private summaryCache: Map<string, SummaryCacheEntry>;
    private config: ContextEngineConfig;
    private lastUpdate: number;
    /** Tracks resource keys seen since last clearKind, per kind. Used for reconciliation. */
    private seenKeys: Map<string, Set<string>>;
    /** Debounce timers for reconciliation, per kind. */
    private reconcileTimers: Map<string, ReturnType<typeof setTimeout>>;
    /** Kinds that are in "reconciliation mode" (watcher just restarted via clearKind). */
    private reconcileActive: Set<string>;

    constructor(config: ContextEngineConfig) {
        super();
        this.config = config;
        this.store = new ContextStore();
        this.anomalyDetector = new AnomalyDetector();
        this.injector = new ContextInjector(this.store, config.tokenBudget);
        this.summaryCache = new Map();
        this.lastUpdate = 0;
        this.seenKeys = new Map();
        this.reconcileTimers = new Map();
        this.reconcileActive = new Set();
    }

    /**
     * Handle a resource event from K8s watchers.
     * Extracts a snapshot, upserts/deletes in store, runs anomaly detection,
     * and invalidates the summary cache for the affected kind.
     */
    handleResourceEvent(kind: string, eventType: 'ADDED' | 'MODIFIED' | 'DELETED', resource: any): void {
        if (eventType === 'DELETED') {
            const name = resource?.metadata?.name ?? '';
            const namespace = resource?.metadata?.namespace ?? null;
            this.store.delete(kind, namespace, name);
            this.anomalyDetector.clearForResource(kind, namespace, name);
            this.invalidateSummaryCache(kind);
            this.lastUpdate = Date.now();
            this.emit('storeUpdated', { kind });
            return;
        }

        // ADDED or MODIFIED — extract snapshot and upsert
        const snapshot = this.extractSnapshot(kind, resource);
        if (!snapshot) return;

        this.store.upsert(snapshot);
        this.lastUpdate = Date.now();

        // Track ADDED events for reconciliation.
        // When the K8s watch (re)connects after a clearKind, it replays all resources as ADDED.
        // We collect these keys and after the burst settles, prune anything
        // in the store that wasn't in the fresh ADDED set.
        // Only track when reconciliation is active (i.e., clearKind was just called).
        if (eventType === 'ADDED' && this.reconcileActive.has(kind)) {
            const key = (snapshot.namespace ?? '') + '/' + snapshot.name;
            // If no pending reconciliation, this is the start of a new burst — reset tracking
            if (!this.reconcileTimers.has(kind)) {
                this.seenKeys.set(kind, new Set());
            }
            this.seenKeys.get(kind)!.add(key);
            this.scheduleReconciliation(kind);
        }

        // Run anomaly detection if enabled
        if (this.config.anomalyDetectionEnabled) {
            // Clear previous anomalies for this resource so re-evaluation works
            this.anomalyDetector.clearForResource(kind, snapshot.namespace, snapshot.name);
            const newAnomalies = this.anomalyDetector.evaluate(snapshot);
            for (const anomaly of newAnomalies) {
                this.emit('anomaly', anomaly);
            }
        }

        this.invalidateSummaryCache(kind);
        this.emit('storeUpdated', { kind });
    }

    /** Clear store, caches, and active anomalies on cluster switch. */
    onClusterSwitch(): void {
        this.store.clear();
        this.summaryCache.clear();
        // Reset anomaly detector by creating a new one
        this.anomalyDetector = new AnomalyDetector();
        // Clear reconciliation state
        this.seenKeys.clear();
        this.reconcileActive.clear();
        for (const timer of this.reconcileTimers.values()) {
            clearTimeout(timer);
        }
        this.reconcileTimers.clear();
        this.lastUpdate = 0;
        this.emit('storeUpdated', { kind: '*' });
    }

    /** Clear all resources of a specific kind (used when watchers restart, e.g. namespace change). */
    clearKind(kind: string): void {
        this.store.clearKind(kind);
        this.anomalyDetector.clearForKind(kind);
        this.invalidateSummaryCache(kind);
        // Reset reconciliation state for this kind
        this.seenKeys.delete(kind);
        const timer = this.reconcileTimers.get(kind);
        if (timer) {
            clearTimeout(timer);
            this.reconcileTimers.delete(kind);
        }
        // Enable reconciliation mode — the next burst of ADDED events will be tracked
        this.reconcileActive.add(kind);
        this.lastUpdate = Date.now();
        this.emit('storeUpdated', { kind });
    }


    /** Get current engine status. */
    getStatus(): { resourceCount: number; lastUpdate: number } {
        return {
            resourceCount: this.store.count(),
            lastUpdate: this.lastUpdate,
        };
    }

    /** Update config and apply immediately. */
    updateConfig(partial: Partial<ContextEngineConfig>): void {
        if (partial.tokenBudget !== undefined) {
            this.config.tokenBudget = partial.tokenBudget;
            this.injector.setTokenBudget(partial.tokenBudget);
        }
        if (partial.summariesEnabled !== undefined) {
            this.config.summariesEnabled = partial.summariesEnabled;
        }
        if (partial.anomalyDetectionEnabled !== undefined) {
            this.config.anomalyDetectionEnabled = partial.anomalyDetectionEnabled;
        }
    }

    /** Build chat context string for AI prompts. */
    buildChatContext(userMessage: string, query?: ContextQuery): string {
        return this.injector.buildChatContext(userMessage, query);
    }

    /**
     * Get a summary for a resource type + namespace.
     * Uses cache keyed by `${kind}:${namespace}` — invalidated when hashByKind changes.
     * Returns structured summary data with stats, text, and issues.
     */
    getSummary(resourceType: string, namespace?: string): ViewSummaryData {
        const cacheKey = `${resourceType}:${namespace ?? ''}`;
        const currentHash = this.store.hashByKind(resourceType);
        const cached = this.summaryCache.get(cacheKey);

        if (cached && cached.hash === currentHash) {
            return { ...cached.data, fromCache: true };
        }

        // Cache miss — build structured summary from resource snapshots
        const resources = namespace
            ? this.store.getByNamespace(resourceType, namespace)
            : this.store.getByKind(resourceType);

        const data = this.buildStructuredSummary(resourceType, resources);
        this.summaryCache.set(cacheKey, {
            data,
            hash: currentHash,
            timestamp: Date.now(),
        });

        return data;
    }

    /**
     * Build structured summary data from resource snapshots.
     * Returns stat boxes, a text summary, and individual issue descriptions.
     */
    private buildStructuredSummary(resourceType: string, resources: ResourceSnapshot[]): ViewSummaryData {
        const total = resources.length;
        if (total === 0) {
            return {
                text: `No ${resourceType.toLowerCase()}s found.`,
                stats: [{ label: 'Total', value: 0, color: 'gray' }],
                issues: [],
                fromCache: false,
            };
        }

        // Count by phase
        const phaseCounts = new Map<string, number>();
        for (const r of resources) {
            const phase = r.phase || 'Unknown';
            phaseCounts.set(phase, (phaseCounts.get(phase) || 0) + 1);
        }

        // Collect unhealthy
        const unhealthy = resources.filter(r =>
            !r.ready || r.phase === 'Failed' || r.phase === 'CrashLoopBackOff' ||
            r.phase === 'NotReady' || r.warnings.length > 0 ||
            (r.replicas !== undefined && r.replicas.unavailable > 0)
        );

        // Build stat boxes
        const stats: SummaryStatBox[] = [{ label: 'Total', value: total, color: 'blue' }];

        if (resourceType === 'Pod') {
            const running = phaseCounts.get('Running') ?? 0;
            const pending = phaseCounts.get('Pending') ?? 0;
            const failed = phaseCounts.get('Failed') ?? 0;
            const succeeded = phaseCounts.get('Succeeded') ?? 0;
            if (running > 0) stats.push({ label: 'Running', value: running, color: 'green' });
            if (pending > 0) stats.push({ label: 'Pending', value: pending, color: 'yellow' });
            if (failed > 0) stats.push({ label: 'Failed', value: failed, color: 'red' });
            if (succeeded > 0) stats.push({ label: 'Succeeded', value: succeeded, color: 'gray' });
        } else if (resourceType === 'Deployment') {
            const available = resources.filter(r => r.ready).length;
            const degraded = resources.filter(r => r.replicas && r.replicas.unavailable > 0).length;
            stats.push({ label: 'Available', value: available, color: 'green' });
            if (degraded > 0) stats.push({ label: 'Degraded', value: degraded, color: 'red' });
        } else if (resourceType === 'Node') {
            const ready = resources.filter(r => r.phase === 'Ready').length;
            const notReady = resources.filter(r => r.phase === 'NotReady').length;
            stats.push({ label: 'Ready', value: ready, color: 'green' });
            if (notReady > 0) stats.push({ label: 'Not Ready', value: notReady, color: 'red' });
        }

        // Warnings stat
        if (unhealthy.length > 0) {
            stats.push({ label: 'Warnings', value: unhealthy.length, color: 'yellow' });
        }

        // Build issues list
        const issues: string[] = [];

        // Warning-based issues
        const warningCounts = new Map<string, string[]>();
        for (const r of unhealthy) {
            for (const w of r.warnings) {
                if (!warningCounts.has(w)) warningCounts.set(w, []);
                warningCounts.get(w)!.push(r.name);
            }
        }
        for (const [warning, names] of warningCounts) {
            if (names.length === 1) {
                issues.push(`${names[0]} — ${warning}`);
            } else if (names.length <= 3) {
                issues.push(`${warning}: ${names.join(', ')}`);
            } else {
                issues.push(`${names.length} resources with ${warning}`);
            }
        }

        // High restarts (pods)
        if (resourceType === 'Pod') {
            const highRestarts = resources
                .filter(r => r.restartCount > 5)
                .sort((a, b) => b.restartCount - a.restartCount)
                .slice(0, 5);
            for (const r of highRestarts) {
                // Avoid duplicating if already in warnings
                const alreadyListed = issues.some(i => i.includes(r.name));
                if (!alreadyListed) {
                    issues.push(`${r.name} — ${r.restartCount} restarts`);
                }
            }
        }

        // Degraded deployments
        if (resourceType === 'Deployment') {
            const degraded = resources.filter(r => r.replicas && r.replicas.unavailable > 0);
            for (const r of degraded) {
                const alreadyListed = issues.some(i => i.includes(r.name));
                if (!alreadyListed) {
                    issues.push(`${r.name} — ${r.replicas!.ready}/${r.replicas!.desired} ready`);
                }
            }
        }

        // NotReady nodes
        if (resourceType === 'Node') {
            const notReady = resources.filter(r => r.phase === 'NotReady');
            for (const r of notReady) {
                const alreadyListed = issues.some(i => i.includes(r.name));
                if (!alreadyListed) {
                    issues.push(`${r.name} — NotReady`);
                }
            }
            const pressured = resources.filter(r => r.warnings.some(w => w.includes('Pressure')));
            for (const r of pressured) {
                const pressureWarnings = r.warnings.filter(w => w.includes('Pressure'));
                const alreadyListed = issues.some(i => i.includes(r.name) && i.includes('Pressure'));
                if (!alreadyListed) {
                    issues.push(`${r.name} — ${pressureWarnings.join(', ')}`);
                }
            }
        }

        // Build text summary
        const namespaces = new Set(resources.map(r => r.namespace).filter(Boolean));
        const textParts: string[] = [];

        if (namespaces.size > 1) {
            textParts.push(`${total} ${resourceType.toLowerCase()}s across ${namespaces.size} namespaces.`);
        } else if (namespaces.size === 1) {
            textParts.push(`${total} ${resourceType.toLowerCase()}s in ${[...namespaces][0]}.`);
        } else {
            textParts.push(`${total} ${resourceType.toLowerCase()}s.`);
        }

        if (unhealthy.length === 0) {
            if (resourceType === 'Pod') textParts.push('All running and healthy.');
            else if (resourceType === 'Deployment') textParts.push('All fully available.');
            else if (resourceType === 'Node') textParts.push('All nodes ready.');
        } else {
            textParts.push(`${unhealthy.length} with issues.`);
        }

        return {
            text: textParts.join(' '),
            stats,
            issues,
            fromCache: false,
        };
    }

    /** Get active anomalies. */
    getAnomalies() {
        return this.anomalyDetector.getActive();
    }

    /** Expose the store for direct queries (used by IPC handlers). */
    getStore(): ContextStore {
        return this.store;
    }

    /** Expose current config. */
    getConfig(): ContextEngineConfig {
        return { ...this.config };
    }

    /**
     * Schedule a debounced reconciliation for a resource kind.
     * After the K8s watch initial ADDED burst settles (2s of no new ADDED events),
     * remove any store entries not seen since the last clearKind/watch restart.
     * This handles the case where pods are deleted while the watcher is disconnected.
     */
    private scheduleReconciliation(kind: string): void {
        const existing = this.reconcileTimers.get(kind);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.reconcileTimers.delete(kind);
            const activeKeys = this.seenKeys.get(kind);
            if (!activeKeys || activeKeys.size === 0) return;

            const removed = this.store.reconcileKind(kind, activeKeys);
            if (removed > 0) {
                this.anomalyDetector.clearForKind(kind);
                this.invalidateSummaryCache(kind);
                this.lastUpdate = Date.now();
                this.emit('storeUpdated', { kind });
                console.log(`[ContextEngine] Reconciled ${kind}: removed ${removed} stale entries`);
            }
            // Reconciliation complete — exit reconciliation mode
            this.reconcileActive.delete(kind);
            this.seenKeys.delete(kind);
        }, 2000);

        this.reconcileTimers.set(kind, timer);
    }

    /** Extract a ResourceSnapshot from a raw K8s object based on kind. */
    private extractSnapshot(kind: string, resource: any): ResourceSnapshot | null {
        try {
            switch (kind) {
                case 'Pod': return extractPodSnapshot(resource);
                case 'Deployment': return extractDeploymentSnapshot(resource);
                case 'Node': return extractNodeSnapshot(resource);
                default: return null;
            }
        } catch (err) {
            // Malformed resource — log and skip
            console.error(`[ContextEngine] Failed to extract ${kind} snapshot:`, err);
            return null;
        }
    }

    /** Invalidate summary cache entries for a given kind. */
    private invalidateSummaryCache(kind: string): void {
        for (const key of this.summaryCache.keys()) {
            if (key.startsWith(`${kind}:`)) {
                this.summaryCache.delete(key);
            }
        }
    }
}
