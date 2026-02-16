/**
 * Property-based tests for AnomalyDetector.
 * Uses fast-check to validate correctness properties from the design document.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AnomalyDetector } from './anomaly-detector';
import { ConditionSummary, ResourceSnapshot } from './types';

const arbName = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}[a-z0-9]$/).filter(s => s.length >= 2);
const arbNamespace = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}[a-z0-9]$/).filter(s => s.length >= 2);

/** Generate a ResourceSnapshot with a known anomalous condition. */
const arbAnomalousSnapshot = (): fc.Arbitrary<ResourceSnapshot> =>
    fc.oneof(
        // CrashLoopBackOff pod
        fc.record({
            kind: fc.constant('Pod'),
            name: arbName,
            namespace: fc.oneof(arbNamespace, fc.constant(null as string | null)),
            phase: fc.constant('Running'),
            conditions: fc.constant([] as ConditionSummary[]),
            restartCount: fc.nat({ max: 100 }),
            ready: fc.constant(false),
            age: fc.constant(new Date().toISOString()),
            warnings: fc.constant(['CrashLoopBackOff'] as string[]),
        }),
        // OOMKilled pod
        fc.record({
            kind: fc.constant('Pod'),
            name: arbName,
            namespace: fc.oneof(arbNamespace, fc.constant(null as string | null)),
            phase: fc.constant('Failed'),
            conditions: fc.constant([] as ConditionSummary[]),
            restartCount: fc.nat({ max: 100 }),
            ready: fc.constant(false),
            age: fc.constant(new Date().toISOString()),
            warnings: fc.constant(['OOMKilled'] as string[]),
        }),
        // NodeNotReady
        fc.record({
            kind: fc.constant('Node'),
            name: arbName,
            namespace: fc.constant(null as string | null),
            phase: fc.constant('NotReady'),
            conditions: fc.constant([{ type: 'Ready', status: 'False' }] as ConditionSummary[]),
            restartCount: fc.constant(0),
            ready: fc.constant(false),
            age: fc.constant(new Date().toISOString()),
            warnings: fc.constant([] as string[]),
        }),
        // DeploymentUnavailable
        fc.record({
            kind: fc.constant('Deployment'),
            name: arbName,
            namespace: fc.oneof(arbNamespace, fc.constant(null as string | null)),
            phase: fc.constant('Available'),
            conditions: fc.constant([] as ConditionSummary[]),
            restartCount: fc.constant(0),
            ready: fc.constant(false),
            age: fc.constant(new Date().toISOString()),
            warnings: fc.constant([] as string[]),
            replicas: fc.record({
                desired: fc.integer({ min: 1, max: 10 }),
                ready: fc.integer({ min: 0, max: 9 }),
                unavailable: fc.integer({ min: 1, max: 5 }),
            }),
        }),
        // HighRestartCount pod
        fc.record({
            kind: fc.constant('Pod'),
            name: arbName,
            namespace: fc.oneof(arbNamespace, fc.constant(null as string | null)),
            phase: fc.constant('Running'),
            conditions: fc.constant([] as ConditionSummary[]),
            restartCount: fc.integer({ min: 6, max: 200 }),
            ready: fc.constant(true),
            age: fc.constant(new Date().toISOString()),
            warnings: fc.constant([] as string[]),
        }),
    );

/** Map from anomalous condition to expected anomaly type(s). */
function expectedAnomalyTypes(snapshot: ResourceSnapshot): string[] {
    const types: string[] = [];
    if (snapshot.kind === 'Pod' && snapshot.warnings.some(w => w.includes('CrashLoopBackOff'))) {
        types.push('CrashLoopBackOff');
    }
    if (snapshot.kind === 'Pod' && snapshot.warnings.some(w => w.includes('OOMKilled'))) {
        types.push('OOMKilled');
    }
    if (snapshot.kind === 'Node' && snapshot.phase === 'NotReady') {
        types.push('NodeNotReady');
    }
    if (snapshot.kind === 'Deployment' && snapshot.replicas && snapshot.replicas.unavailable > 0) {
        types.push('DeploymentUnavailable');
    }
    if (snapshot.kind === 'Pod' && snapshot.restartCount > 5) {
        types.push('HighRestartCount');
    }
    return types;
}

// Feature: ai-context-engine, Property 15: Anomaly detection identifies known anomalous conditions
// **Validates: Requirements 7.1**
describe('Property 15: Anomaly detection identifies known anomalous conditions', () => {
    it('returns at least one anomaly with correct type for anomalous resources', () => {
        fc.assert(
            fc.property(arbAnomalousSnapshot(), (snapshot) => {
                const detector = new AnomalyDetector();
                const anomalies = detector.evaluate(snapshot);

                const expected = expectedAnomalyTypes(snapshot);
                expect(expected.length).toBeGreaterThan(0);
                expect(anomalies.length).toBeGreaterThan(0);

                // At least one expected type should be present in the results
                const detectedTypes = anomalies.map(a => a.type);
                const hasExpected = expected.some(t => detectedTypes.includes(t));
                expect(hasExpected).toBe(true);

                // All anomalies should have non-empty messages
                for (const a of anomalies) {
                    expect(a.message.length).toBeGreaterThan(0);
                }
            }),
            { numRuns: 100 }
        );
    });
});

// Feature: ai-context-engine, Property 16: Anomaly deduplication (idempotence)
// **Validates: Requirements 7.4**
describe('Property 16: Anomaly deduplication (idempotence)', () => {
    it('second evaluation returns empty for the same resource', () => {
        fc.assert(
            fc.property(arbAnomalousSnapshot(), (snapshot) => {
                const detector = new AnomalyDetector();

                const first = detector.evaluate(snapshot);
                expect(first.length).toBeGreaterThan(0);

                const second = detector.evaluate(snapshot);
                expect(second).toEqual([]);
            }),
            { numRuns: 100 }
        );
    });
});