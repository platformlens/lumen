/**
 * Property-based tests for ContextEngine.
 * Uses fast-check to validate correctness properties from the design document.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ContextEngine } from './context-engine';
import { ContextEngineConfig } from './types';

/** Default config for tests. */
function defaultConfig(): ContextEngineConfig {
    return {
        tokenBudget: 2000,
        summariesEnabled: true,
        anomalyDetectionEnabled: false,
    };
}

/** Arbitrary generator for a raw K8s Pod object (minimal shape for extractors). */
const arbRawPod = () =>
    fc.record({
        metadata: fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
            namespace: fc.string({ minLength: 1, maxLength: 15 }).filter(s => s.trim().length > 0),
            creationTimestamp: fc.constant(new Date().toISOString()),
        }),
        status: fc.record({
            phase: fc.constantFrom('Running', 'Pending', 'Failed', 'Succeeded'),
            containerStatuses: fc.array(
                fc.record({
                    ready: fc.boolean(),
                    restartCount: fc.nat({ max: 20 }),
                    state: fc.constant({}),
                }),
                { minLength: 1, maxLength: 3 }
            ),
            conditions: fc.constant([]),
        }),
        spec: fc.record({
            containers: fc.constant([]),
        }),
    });

// Feature: ai-context-engine, Property 9: Summary cache invalidation on data change
// **Validates: Requirements 4.4**
describe('Property 9: Summary cache invalidation on data change', () => {
    it('cached summary is reused until store data changes, then invalidated', () => {
        fc.assert(
            fc.property(
                fc.array(arbRawPod(), { minLength: 1, maxLength: 10 }),
                arbRawPod(),
                (initialPods, newPod) => {
                    const engine = new ContextEngine(defaultConfig());

                    // Populate store with initial pods
                    for (const pod of initialPods) {
                        engine.handleResourceEvent('Pod', 'ADDED', pod);
                    }

                    // First summary request — cache miss
                    const first = engine.getSummary('Pod');
                    expect(first.fromCache).toBe(false);

                    // Second request without changes — cache hit
                    const second = engine.getSummary('Pod');
                    expect(second.fromCache).toBe(true);
                    expect(second.text).toBe(first.text);

                    // Modify store by adding a new pod
                    engine.handleResourceEvent('Pod', 'ADDED', newPod);

                    // Third request after change — cache miss
                    const third = engine.getSummary('Pod');
                    expect(third.fromCache).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });
});


// Feature: ai-context-engine, Property 18: Token budget config change applies immediately
// **Validates: Requirements 9.2**
describe('Property 18: Token budget config change applies immediately', () => {
    it('changing token budget via updateConfig is respected by the next buildChatContext call', () => {
        fc.assert(
            fc.property(
                fc.array(arbRawPod(), { minLength: 5, maxLength: 20 }),
                fc.integer({ min: 50, max: 500 }),
                fc.integer({ min: 501, max: 5000 }),
                (pods, smallBudget, largeBudget) => {
                    const engine = new ContextEngine({
                        tokenBudget: largeBudget,
                        summariesEnabled: true,
                        anomalyDetectionEnabled: false,
                    });

                    // Populate store
                    for (const pod of pods) {
                        engine.handleResourceEvent('Pod', 'ADDED', pod);
                    }

                    // Build context with large budget
                    const largeContext = engine.buildChatContext('show me all pods');
                    const largeTokens = Math.ceil(largeContext.length / 4);

                    // Now shrink the budget
                    engine.updateConfig({ tokenBudget: smallBudget });

                    // Build context again — should respect the smaller budget
                    const smallContext = engine.buildChatContext('show me all pods');
                    const smallTokens = Math.ceil(smallContext.length / 4);

                    // The small-budget context should be within the small budget
                    expect(smallTokens).toBeLessThanOrEqual(smallBudget);

                    // If the large context exceeded the small budget, the small context should be shorter
                    if (largeTokens > smallBudget) {
                        expect(smallContext.length).toBeLessThan(largeContext.length);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
