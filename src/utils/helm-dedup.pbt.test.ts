/**
 * Property-based tests for Helm release deduplication logic.
 * Uses fast-check to validate correctness properties from the design document.
 *
 * Properties covered:
 *   5. Latest-revision deduplication
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { applyHelmReleaseEvents, HelmRelease, HelmReleaseEvent } from './helm-release-utils';

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const arbNamespaceString = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}[a-z0-9]$/).filter(s => s.length >= 2);

const arbReleaseName = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}[a-z0-9]$/).filter(s => s.length >= 2);

const arbEventType = fc.constantFrom('ADDED', 'MODIFIED', 'DELETED');

const arbHelmRelease = (name: string, namespace: string, revision: number): HelmRelease => ({
    name,
    namespace,
    revision,
    status: 'deployed',
    chart: 'my-chart',
    chartVersion: '1.0.0',
    appVersion: '1.0.0',
    lastUpdated: new Date().toISOString(),
    description: 'A release',
});

/**
 * Generates a sequence of HelmReleaseEvents for a small set of release identities
 * (name/namespace pairs) with varying event types and revision numbers.
 */
const arbEventSequence = fc.tuple(
    fc.array(arbReleaseName, { minLength: 1, maxLength: 3 }),
    fc.array(arbNamespaceString, { minLength: 1, maxLength: 2 }),
).chain(([names, namespaces]) => {
    const arbEvent: fc.Arbitrary<HelmReleaseEvent> = fc.tuple(
        arbEventType,
        fc.constantFrom(...names),
        fc.constantFrom(...namespaces),
        fc.integer({ min: 1, max: 20 }),
    ).map(([type, name, namespace, revision]) => ({
        type,
        resource: arbHelmRelease(name, namespace, revision),
    }));

    return fc.array(arbEvent, { minLength: 1, maxLength: 50 });
});

// ---------------------------------------------------------------------------
// Property 5: Latest-revision deduplication
// ---------------------------------------------------------------------------

// Feature: helm-releases-optimization, Property 5: Latest-revision deduplication
// **Validates: Requirements 5.2, 8.1, 8.2, 8.3**
describe('Property 5: Latest-revision deduplication', () => {
    it('applying events incrementally produces a map where each key holds the highest revision, respecting ADDED/MODIFIED/DELETED semantics', () => {
        fc.assert(
            fc.property(
                arbEventSequence,
                (events) => {
                    // Apply all events incrementally starting from an empty map
                    const finalMap = applyHelmReleaseEvents(new Map(), events);

                    // (c) No key appears more than once — Map guarantees this by construction,
                    // but verify the size matches the number of unique keys
                    const keys = Array.from(finalMap.keys());
                    expect(keys.length).toBe(new Set(keys).size);

                    // Simulate the expected state by replaying events with the same rules
                    const expectedMap = new Map<string, HelmRelease>();
                    for (const { type, resource } of events) {
                        const key = `${resource.namespace}/${resource.name}`;
                        const existing = expectedMap.get(key);

                        if (type === 'ADDED' || type === 'MODIFIED') {
                            // (a) update only if revision >= stored revision
                            if (!existing || resource.revision >= existing.revision) {
                                expectedMap.set(key, resource);
                            }
                        } else if (type === 'DELETED') {
                            // (b) remove only if deleted revision equals stored revision
                            if (existing && existing.revision === resource.revision) {
                                expectedMap.delete(key);
                            }
                        }
                    }

                    // Verify the final map matches the expected state
                    expect(finalMap.size).toBe(expectedMap.size);

                    for (const [key, expectedRelease] of expectedMap) {
                        const actual = finalMap.get(key);
                        expect(actual).toBeDefined();
                        expect(actual!.name).toBe(expectedRelease.name);
                        expect(actual!.namespace).toBe(expectedRelease.namespace);
                        expect(actual!.revision).toBe(expectedRelease.revision);
                    }

                    // Verify no extra keys exist in the final map
                    for (const key of finalMap.keys()) {
                        expect(expectedMap.has(key)).toBe(true);
                    }
                }
            ),
            { numRuns: 200 }
        );
    });
});
