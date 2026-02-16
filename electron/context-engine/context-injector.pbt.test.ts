/**
 * Property-based tests for ContextInjector.
 * Uses fast-check to validate correctness properties from the design document.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ContextStore } from './context-store';
import { ContextInjector } from './context-injector';
import { ResourceSnapshot } from './types';

/** Alphanumeric name generator to avoid special characters in test assertions. */
const arbName = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}[a-z0-9]$/).filter(s => s.length >= 2);
const arbNamespace = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}[a-z0-9]$/).filter(s => s.length >= 2);

/** Arbitrary generator for ResourceSnapshot with controllable health. */
const arbResourceSnapshot = (forceHealthy?: boolean, forceUnhealthy?: boolean): fc.Arbitrary<ResourceSnapshot> =>
    fc.record({
        kind: fc.constantFrom('Pod', 'Deployment', 'Node'),
        name: arbName,
        namespace: fc.oneof(arbNamespace, fc.constant(null as string | null)),
        phase: forceHealthy
            ? fc.constant('Running')
            : forceUnhealthy
                ? fc.constantFrom('Failed', 'CrashLoopBackOff', 'NotReady')
                : fc.constantFrom('Running', 'Pending', 'Failed', 'Succeeded', 'NotReady'),
        conditions: fc.constant([] as Array<{ type: string; status: string }>),
        restartCount: forceUnhealthy ? fc.integer({ min: 1, max: 100 }) : fc.nat({ max: 100 }),
        ready: forceHealthy ? fc.constant(true) : forceUnhealthy ? fc.constant(false) : fc.boolean(),
        age: fc.constant(new Date().toISOString()),
        warnings: forceUnhealthy
            ? fc.array(fc.constantFrom('CrashLoopBackOff', 'OOMKilled', 'Error'), { minLength: 1, maxLength: 3 })
            : forceHealthy
                ? fc.constant([] as string[])
                : fc.array(fc.stringMatching(/^[a-z]{1,10}$/), { maxLength: 3 }),
    });

// Feature: ai-context-engine, Property 4: Token budget enforcement with priority truncation
// **Validates: Requirements 2.2, 4.3**
describe('Property 4: Token budget enforcement with priority truncation', () => {
    it('output is within budget and unhealthy resources are preserved over healthy ones', () => {
        fc.assert(
            fc.property(
                fc.array(arbResourceSnapshot(true), { minLength: 1, maxLength: 10 }),
                fc.array(arbResourceSnapshot(false, true), { minLength: 1, maxLength: 10 }),
                fc.integer({ min: 100, max: 5000 }),
                (healthyResources, unhealthyResources, budget) => {
                    const store = new ContextStore();
                    for (const r of [...healthyResources, ...unhealthyResources]) {
                        store.upsert(r);
                    }

                    const injector = new ContextInjector(store, budget);
                    const context = injector.buildChatContext('show me everything');

                    // Token budget enforcement
                    const tokens = injector.estimateTokens(context);
                    expect(tokens).toBeLessThanOrEqual(budget);

                    if (context.length === 0) return;

                    // Verify ordering: all unhealthy lines come before healthy lines
                    const lines = context.split('\n');
                    let seenHealthy = false;
                    for (const line of lines) {
                        // Check if line contains unhealthy markers
                        const looksUnhealthy = line.includes('ready=false') ||
                            line.includes('phase=Failed') ||
                            line.includes('phase=CrashLoopBackOff') ||
                            line.includes('phase=NotReady') ||
                            line.includes('warn=');
                        const looksHealthy = !looksUnhealthy;

                        if (looksHealthy) {
                            seenHealthy = true;
                        }
                        if (looksUnhealthy && seenHealthy) {
                            // Unhealthy resource appeared after a healthy one — violation
                            expect(seenHealthy).toBe(false);
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// Feature: ai-context-engine, Property 5: Context injection filters by inferred resource type
// **Validates: Requirements 2.3**
describe('Property 5: Context injection filters by inferred resource type', () => {
    it('output contains only resources of the inferred type', () => {
        const resourceTypeMessages: [string, string][] = [
            ['show me the pods', 'Pod'],
            ['list all deployments', 'Deployment'],
            ['what nodes are available', 'Node'],
        ];

        fc.assert(
            fc.property(
                fc.array(arbResourceSnapshot(), { minLength: 1, maxLength: 20 }),
                fc.constantFrom(...resourceTypeMessages),
                (resources, [message, expectedKind]) => {
                    const store = new ContextStore();
                    for (const r of resources) {
                        store.upsert(r);
                    }

                    const injector = new ContextInjector(store, 5000);
                    const context = injector.buildChatContext(message);

                    if (context.length === 0) return;

                    const lines = context.split('\n');
                    for (const line of lines) {
                        // Each line should start with [ExpectedKind]
                        expect(line).toMatch(new RegExp(`^\\[${expectedKind}\\]`));
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// Feature: ai-context-engine, Property 6: Problem queries prioritize unhealthy resources
// **Validates: Requirements 2.4**
describe('Property 6: Problem queries prioritize unhealthy resources', () => {
    it('unhealthy resources appear before healthy ones for problem-related messages', () => {
        fc.assert(
            fc.property(
                fc.array(arbResourceSnapshot(true), { minLength: 1, maxLength: 5 }),
                fc.array(arbResourceSnapshot(false, true), { minLength: 1, maxLength: 5 }),
                fc.constantFrom(
                    'what is failing in my cluster',
                    'show me crashing pods',
                    'are there any issues',
                    'which pods have problems',
                    'show me errors'
                ),
                (healthyResources, unhealthyResources, message) => {
                    const store = new ContextStore();
                    for (const r of [...healthyResources, ...unhealthyResources]) {
                        store.upsert(r);
                    }

                    const injector = new ContextInjector(store, 10000);
                    const context = injector.buildChatContext(message);

                    if (context.length === 0) return;

                    const lines = context.split('\n');
                    let seenHealthy = false;

                    for (const line of lines) {
                        const looksUnhealthy = line.includes('ready=false') ||
                            line.includes('phase=Failed') ||
                            line.includes('phase=CrashLoopBackOff') ||
                            line.includes('phase=NotReady') ||
                            line.includes('warn=');

                        if (!looksUnhealthy) {
                            seenHealthy = true;
                        }
                        if (looksUnhealthy && seenHealthy) {
                            // Unhealthy appeared after healthy — ordering violation
                            expect(seenHealthy).toBe(false);
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// Feature: ai-context-engine, Property 8: Resource compression extracts only status-relevant fields
// **Validates: Requirements 4.1**
describe('Property 8: Resource compression extracts only status-relevant fields', () => {
    it('compressed output contains name, namespace, phase, and ready status', () => {
        fc.assert(
            fc.property(
                arbResourceSnapshot(),
                (snapshot) => {
                    const store = new ContextStore();
                    const injector = new ContextInjector(store, 2000);
                    const compressed = injector.compressResource(snapshot);

                    // Must contain name
                    expect(compressed).toContain(snapshot.name);

                    // Must contain namespace if present
                    if (snapshot.namespace) {
                        expect(compressed).toContain(`ns=${snapshot.namespace}`);
                    }

                    // Must contain phase
                    expect(compressed).toContain(`phase=${snapshot.phase}`);

                    // Must contain ready status
                    expect(compressed).toContain(`ready=${snapshot.ready}`);

                    // Must contain kind
                    expect(compressed).toContain(`[${snapshot.kind}]`);

                    // Must NOT contain raw JSON
                    expect(compressed).not.toContain('{');
                    expect(compressed).not.toContain('}');

                    // Must be a single line
                    expect(compressed.split('\n')).toHaveLength(1);
                }
            ),
            { numRuns: 100 }
        );
    });
});
