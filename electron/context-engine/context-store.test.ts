import { describe, it, expect, beforeEach } from 'vitest';
import { ContextStore } from './context-store';
import { ResourceSnapshot } from './types';

function makeSnapshot(overrides: Partial<ResourceSnapshot> = {}): ResourceSnapshot {
    return {
        kind: 'Pod',
        name: 'test-pod',
        namespace: 'default',
        phase: 'Running',
        conditions: [],
        restartCount: 0,
        ready: true,
        age: new Date().toISOString(),
        warnings: [],
        ...overrides,
    };
}

describe('ContextStore', () => {
    let store: ContextStore;

    beforeEach(() => {
        store = new ContextStore();
    });

    it('starts empty', () => {
        expect(store.count()).toBe(0);
        expect(store.getAll()).toEqual([]);
    });

    it('upserts and retrieves a resource', () => {
        const snap = makeSnapshot();
        store.upsert(snap);
        expect(store.get('Pod', 'default', 'test-pod')).toEqual(snap);
        expect(store.count()).toBe(1);
    });

    it('updates existing resource on upsert', () => {
        store.upsert(makeSnapshot({ phase: 'Pending' }));
        store.upsert(makeSnapshot({ phase: 'Running' }));
        expect(store.get('Pod', 'default', 'test-pod')?.phase).toBe('Running');
        expect(store.count()).toBe(1);
    });

    it('deletes a resource', () => {
        store.upsert(makeSnapshot());
        store.delete('Pod', 'default', 'test-pod');
        expect(store.get('Pod', 'default', 'test-pod')).toBeUndefined();
        expect(store.count()).toBe(0);
    });

    it('clears all resources', () => {
        store.upsert(makeSnapshot({ name: 'a' }));
        store.upsert(makeSnapshot({ name: 'b' }));
        store.clear();
        expect(store.count()).toBe(0);
        expect(store.getAll()).toEqual([]);
    });

    it('getByKind returns all resources of a kind', () => {
        store.upsert(makeSnapshot({ name: 'pod-1', namespace: 'ns-a' }));
        store.upsert(makeSnapshot({ name: 'pod-2', namespace: 'ns-b' }));
        store.upsert(makeSnapshot({ kind: 'Deployment', name: 'dep-1', namespace: 'ns-a' }));
        const pods = store.getByKind('Pod');
        expect(pods).toHaveLength(2);
        expect(store.getByKind('Deployment')).toHaveLength(1);
        expect(store.getByKind('Node')).toHaveLength(0);
    });

    it('getByNamespace filters by kind and namespace', () => {
        store.upsert(makeSnapshot({ name: 'pod-1', namespace: 'ns-a' }));
        store.upsert(makeSnapshot({ name: 'pod-2', namespace: 'ns-b' }));
        expect(store.getByNamespace('Pod', 'ns-a')).toHaveLength(1);
        expect(store.getByNamespace('Pod', 'ns-c')).toHaveLength(0);
    });

    it('handles null namespace for cluster-scoped resources', () => {
        const node = makeSnapshot({ kind: 'Node', name: 'node-1', namespace: null });
        store.upsert(node);
        expect(store.get('Node', null, 'node-1')).toEqual(node);
        store.delete('Node', null, 'node-1');
        expect(store.get('Node', null, 'node-1')).toBeUndefined();
    });

    it('getUnhealthy returns resources with issues', () => {
        store.upsert(makeSnapshot({ name: 'healthy', ready: true, phase: 'Running' }));
        store.upsert(makeSnapshot({ name: 'not-ready', ready: false, phase: 'Running' }));
        store.upsert(makeSnapshot({ name: 'failed', ready: false, phase: 'Failed' }));
        const unhealthy = store.getUnhealthy();
        expect(unhealthy).toHaveLength(2);
        expect(unhealthy.map(r => r.name).sort()).toEqual(['failed', 'not-ready']);
    });

    it('getByFilter returns matching resources', () => {
        store.upsert(makeSnapshot({ name: 'a', restartCount: 0 }));
        store.upsert(makeSnapshot({ name: 'b', restartCount: 10 }));
        const highRestarts = store.getByFilter(r => r.restartCount > 5);
        expect(highRestarts).toHaveLength(1);
        expect(highRestarts[0].name).toBe('b');
    });

    it('countByKind returns correct counts', () => {
        store.upsert(makeSnapshot({ kind: 'Pod', name: 'p1' }));
        store.upsert(makeSnapshot({ kind: 'Pod', name: 'p2' }));
        store.upsert(makeSnapshot({ kind: 'Node', name: 'n1', namespace: null }));
        const counts = store.countByKind();
        expect(counts.get('Pod')).toBe(2);
        expect(counts.get('Node')).toBe(1);
    });

    it('hashByKind changes when resources change', () => {
        store.upsert(makeSnapshot({ name: 'pod-1', phase: 'Running' }));
        const hash1 = store.hashByKind('Pod');
        store.upsert(makeSnapshot({ name: 'pod-1', phase: 'Failed' }));
        const hash2 = store.hashByKind('Pod');
        expect(hash1).not.toBe(hash2);
    });

    it('hashByKind returns empty string for unknown kind', () => {
        expect(store.hashByKind('Unknown')).toBe('');
    });
});
