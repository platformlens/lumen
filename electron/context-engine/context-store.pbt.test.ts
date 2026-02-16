/**
 * Property-based tests for ContextStore.
 * Uses fast-check to validate correctness properties from the design document.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ContextStore } from './context-store';
import { ResourceSnapshot } from './types';

/** Arbitrary generator for ResourceSnapshot. */
const arbResourceSnapshot = (): fc.Arbitrary<ResourceSnapshot> =>
    fc.record({
        kind: fc.constantFrom('Pod', 'Deployment', 'Node'),
        name: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        namespace: fc.oneof(
            fc.string({ minLength: 1, maxLength: 15 }).filter(s => s.trim().length > 0),
            fc.constant(null as string | null)
        ),
        phase: fc.constantFrom('Running', 'Pending', 'Failed', 'Succeeded', 'NotReady'),
        conditions: fc.constant([]),
        restartCount: fc.nat({ max: 100 }),
        ready: fc.boolean(),
        age: fc.constant(new Date().toISOString()),
        warnings: fc.array(fc.string(), { maxLength: 3 }),
    });

type Op =
    | { type: 'upsert'; snapshot: ResourceSnapshot }
    | { type: 'delete'; kind: string; namespace: string | null; name: string };

const arbOp = (): fc.Arbitrary<Op> =>
    fc.oneof(
        arbResourceSnapshot().map(snapshot => ({ type: 'upsert' as const, snapshot })),
        fc.record({
            type: fc.constant('delete' as const),
            kind: fc.constantFrom('Pod', 'Deployment', 'Node'),
            namespace: fc.oneof(
                fc.string({ minLength: 1, maxLength: 15 }).filter(s => s.trim().length > 0),
                fc.constant(null as string | null)
            ),
            name: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        })
    );

// Feature: ai-context-engine, Property 1: ContextStore CRUD round-trip
// Validates: Requirements 1.1, 1.4, 1.5
describe('Property 1: ContextStore CRUD round-trip', () => {
    it('all non-deleted resources are retrievable and deleted ones are not', () => {
        fc.assert(
            fc.property(fc.array(arbOp(), { minLength: 1, maxLength: 50 }), (ops) => {
                const store = new ContextStore();
                // Track expected state: key -> snapshot
                const expected = new Map<string, ResourceSnapshot>();

                for (const op of ops) {
                    if (op.type === 'upsert') {
                        const key = `${op.snapshot.kind}/${op.snapshot.namespace}/${op.snapshot.name}`;
                        store.upsert(op.snapshot);
                        expected.set(key, op.snapshot);
                    } else {
                        const key = `${op.kind}/${op.namespace}/${op.name}`;
                        store.delete(op.kind, op.namespace, op.name);
                        expected.delete(key);
                    }
                }

                // Verify all expected resources are retrievable
                for (const [, snap] of expected) {
                    const result = store.get(snap.kind, snap.namespace, snap.name);
                    expect(result).toBeDefined();
                    expect(result?.name).toBe(snap.name);
                    expect(result?.kind).toBe(snap.kind);
                }

                // Verify count matches
                expect(store.count()).toBe(expected.size);
            }),
            { numRuns: 100 }
        );
    });
});


// Feature: ai-context-engine, Property 2: Cluster switch clears store
// Validates: Requirements 1.3
describe('Property 2: Cluster switch clears store', () => {
    it('clear() results in zero resources and empty queries', () => {
        fc.assert(
            fc.property(
                fc.array(arbResourceSnapshot(), { minLength: 1, maxLength: 30 }),
                (snapshots) => {
                    const store = new ContextStore();
                    for (const snap of snapshots) {
                        store.upsert(snap);
                    }
                    // Ensure store is non-empty (snapshots may overlap on keys, but at least 1)
                    expect(store.count()).toBeGreaterThanOrEqual(1);

                    store.clear();

                    expect(store.count()).toBe(0);
                    expect(store.getAll()).toEqual([]);
                    expect(store.getByKind('Pod')).toEqual([]);
                    expect(store.getByKind('Deployment')).toEqual([]);
                    expect(store.getByKind('Node')).toEqual([]);
                    expect(store.getUnhealthy()).toEqual([]);
                }
            ),
            { numRuns: 100 }
        );
    });
});


// Feature: ai-context-engine, Property 3: Store query returns exactly matching resources
// Validates: Requirements 1.6
describe('Property 3: Store query returns exactly matching resources', () => {
    it('getByFilter returns exactly the resources matching the predicate', () => {
        fc.assert(
            fc.property(
                fc.array(arbResourceSnapshot(), { minLength: 0, maxLength: 30 }),
                fc.nat({ max: 50 }), // restartCount threshold for filter
                (snapshots, threshold) => {
                    const store = new ContextStore();
                    for (const snap of snapshots) {
                        store.upsert(snap);
                    }

                    const predicate = (r: ResourceSnapshot) => r.restartCount > threshold;
                    const result = store.getByFilter(predicate);
                    const allResources = store.getAll();

                    // Every result must match the predicate
                    for (const r of result) {
                        expect(predicate(r)).toBe(true);
                    }

                    // Every resource in the store that matches must be in the result
                    const expectedMatching = allResources.filter(predicate);
                    expect(result.length).toBe(expectedMatching.length);

                    // Verify exact set equality by checking all expected are present
                    const resultKeys = new Set(result.map(r => `${r.kind}/${r.namespace}/${r.name}`));
                    for (const r of expectedMatching) {
                        expect(resultKeys.has(`${r.kind}/${r.namespace}/${r.name}`)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
