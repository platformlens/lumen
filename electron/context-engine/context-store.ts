/**
 * ContextStore — in-memory store for Kubernetes resource snapshots.
 * Nested Map<kind, Map<namespace, Map<name, ResourceSnapshot>>> for O(1) lookups.
 * Requirements: 1.1, 1.4, 1.5, 1.6
 */

import { ResourceSnapshot } from './types';

/** Normalize null namespace to empty string for Map key consistency. */
function nsKey(namespace: string | null): string {
    return namespace ?? '';
}

export class ContextStore {
    private resources: Map<string, Map<string, Map<string, ResourceSnapshot>>>;

    constructor() {
        this.resources = new Map();
    }

    /** Insert or update a resource snapshot. */
    upsert(snapshot: ResourceSnapshot): void {
        const ns = nsKey(snapshot.namespace);
        if (!this.resources.has(snapshot.kind)) {
            this.resources.set(snapshot.kind, new Map());
        }
        const kindMap = this.resources.get(snapshot.kind)!;
        if (!kindMap.has(ns)) {
            kindMap.set(ns, new Map());
        }
        kindMap.get(ns)!.set(snapshot.name, snapshot);
    }

    /** Remove a resource by key. */
    delete(kind: string, namespace: string | null, name: string): void {
        const ns = nsKey(namespace);
        const kindMap = this.resources.get(kind);
        if (!kindMap) return;
        const nsMap = kindMap.get(ns);
        if (!nsMap) return;
        nsMap.delete(name);
        // Clean up empty maps
        if (nsMap.size === 0) kindMap.delete(ns);
        if (kindMap.size === 0) this.resources.delete(kind);
    }

    /** Clear all resources from the store. */
    clear(): void {
        this.resources = new Map();
    }

    /** Clear all resources of a specific kind. */
    clearKind(kind: string): void {
        this.resources.delete(kind);
    }

    /**
     * Reconcile a kind by removing entries not present in the given set of keys.
     * Each key is `${namespace ?? ''}/${name}`.
     * Returns the number of stale entries removed.
     */
    reconcileKind(kind: string, activeKeys: Set<string>): number {
        const kindMap = this.resources.get(kind);
        if (!kindMap) return 0;
        let removed = 0;
        for (const [ns, nsMap] of kindMap) {
            for (const name of nsMap.keys()) {
                const key = `${ns}/${name}`;
                if (!activeKeys.has(key)) {
                    nsMap.delete(name);
                    removed++;
                }
            }
            if (nsMap.size === 0) kindMap.delete(ns);
        }
        if (kindMap.size === 0) this.resources.delete(kind);
        return removed;
    }



    /** Get a single resource by exact key. */
    get(kind: string, namespace: string | null, name: string): ResourceSnapshot | undefined {
        return this.resources.get(kind)?.get(nsKey(namespace))?.get(name);
    }

    /** Get all resources of a given kind. */
    getByKind(kind: string): ResourceSnapshot[] {
        const kindMap = this.resources.get(kind);
        if (!kindMap) return [];
        const results: ResourceSnapshot[] = [];
        for (const nsMap of kindMap.values()) {
            for (const snapshot of nsMap.values()) {
                results.push(snapshot);
            }
        }
        return results;
    }

    /** Get all resources of a given kind in a specific namespace. */
    getByNamespace(kind: string, namespace: string): ResourceSnapshot[] {
        const nsMap = this.resources.get(kind)?.get(namespace);
        if (!nsMap) return [];
        return Array.from(nsMap.values());
    }

    /** Get all resources across all kinds and namespaces. */
    getAll(): ResourceSnapshot[] {
        const results: ResourceSnapshot[] = [];
        for (const kindMap of this.resources.values()) {
            for (const nsMap of kindMap.values()) {
                for (const snapshot of nsMap.values()) {
                    results.push(snapshot);
                }
            }
        }
        return results;
    }

    /** Get all unhealthy resources (not ready, failed, crashloop, etc.). */
    getUnhealthy(): ResourceSnapshot[] {
        return this.getByFilter(r =>
            !r.ready ||
            r.phase === 'Failed' ||
            r.phase === 'CrashLoopBackOff' ||
            r.phase === 'NotReady' ||
            r.warnings.length > 0 ||
            (r.replicas !== undefined && r.replicas.unavailable > 0)
        );
    }

    /** Get resources matching a predicate. */
    getByFilter(predicate: (r: ResourceSnapshot) => boolean): ResourceSnapshot[] {
        return this.getAll().filter(predicate);
    }

    /** Total number of resources in the store. */
    count(): number {
        let total = 0;
        for (const kindMap of this.resources.values()) {
            for (const nsMap of kindMap.values()) {
                total += nsMap.size;
            }
        }
        return total;
    }

    /** Count of resources grouped by kind. */
    countByKind(): Map<string, number> {
        const counts = new Map<string, number>();
        for (const [kind, kindMap] of this.resources) {
            let kindTotal = 0;
            for (const nsMap of kindMap.values()) {
                kindTotal += nsMap.size;
            }
            counts.set(kind, kindTotal);
        }
        return counts;
    }

    /** Simple hash of resource names + phases for a given kind, used for cache invalidation. */
    hashByKind(kind: string): string {
        const kindMap = this.resources.get(kind);
        if (!kindMap) return '';
        const parts: string[] = [];
        for (const nsMap of kindMap.values()) {
            for (const snapshot of nsMap.values()) {
                parts.push(`${snapshot.name}:${snapshot.phase}`);
            }
        }
        parts.sort();
        // Simple string hash
        let hash = 0;
        const str = parts.join('|');
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }
}
