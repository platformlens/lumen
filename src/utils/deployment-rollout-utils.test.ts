import { describe, it, expect } from 'vitest';
import { getRolloutSummary, summarizeHpa, summarizePdb } from './deployment-rollout-utils';
import type { DeploymentObj } from '../types/deployment-details';

const progressing = (status: string, reason: string) => ({ type: 'Progressing', status, reason });

describe('getRolloutSummary', () => {
    it('applies defaults when spec fields are missing', () => {
        const s = getRolloutSummary({ metadata: { name: 'web' }, spec: { selector: {}, template: {} } } as DeploymentObj);
        expect(s.desired).toBe(1);
        expect(s.strategy).toEqual({ type: 'RollingUpdate', maxSurge: '25%', maxUnavailable: '25%' });
        expect(s.minReadySeconds).toBe(0);
        expect(s.progressDeadlineSeconds).toBe(600);
        expect(s.revisionHistoryLimit).toBe(10);
        expect(s.current).toBe(0);
        expect(s.conditions).toEqual([]);
    });

    it('reports Recreate without surge settings and stringifies int surge', () => {
        expect(getRolloutSummary({ spec: { selector: {}, template: {}, strategy: { type: 'Recreate' } } }).strategy)
            .toEqual({ type: 'Recreate', maxSurge: null, maxUnavailable: null });
        expect(getRolloutSummary({ spec: { selector: {}, template: {}, strategy: { rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } } } }).strategy)
            .toEqual({ type: 'RollingUpdate', maxSurge: '1', maxUnavailable: '0' });
    });

    it('computes progressPercent from min(updated, available)', () => {
        const d: DeploymentObj = { spec: { replicas: 4, selector: {}, template: {} }, status: { updatedReplicas: 3, availableReplicas: 2 } };
        expect(getRolloutSummary(d).progressPercent).toBe(50);
        expect(getRolloutSummary({ spec: { replicas: 0, selector: {}, template: {} } }).progressPercent).toBe(100);
    });

    it('detects stalled rollouts', () => {
        const d: DeploymentObj = {
            spec: { replicas: 2, selector: {}, template: {} },
            status: { conditions: [progressing('False', 'ProgressDeadlineExceeded')] },
        };
        const s = getRolloutSummary(d);
        expect(s.isStalled).toBe(true);
        expect(s.isComplete).toBe(false);
    });

    it('detects complete rollouts only when counts match', () => {
        const base: DeploymentObj = {
            spec: { replicas: 3, selector: {}, template: {} },
            status: { updatedReplicas: 3, availableReplicas: 3, conditions: [progressing('True', 'NewReplicaSetAvailable')] },
        };
        expect(getRolloutSummary(base).isComplete).toBe(true);
        expect(getRolloutSummary({ ...base, status: { ...base.status, availableReplicas: 2 } }).isComplete).toBe(false);
    });

    it('detects paused and stale observedGeneration', () => {
        const d: DeploymentObj = {
            metadata: { generation: 5 },
            spec: { paused: true, selector: {}, template: {} },
            status: { observedGeneration: 4 },
        };
        const s = getRolloutSummary(d);
        expect(s.isPaused).toBe(true);
        expect(s.observedGenerationStale).toBe(true);
        expect(getRolloutSummary({ ...d, status: { observedGeneration: 5 } }).observedGenerationStale).toBe(false);
    });
});

describe('summarizeHpa', () => {
    it('maps metrics with current values and atMax', () => {
        const s = summarizeHpa({
            metadata: { name: 'web' },
            spec: {
                minReplicas: 2, maxReplicas: 5,
                scaleTargetRef: { kind: 'Deployment', name: 'web' },
                metrics: [
                    { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 80 } } },
                    { type: 'Resource', resource: { name: 'memory', target: { type: 'AverageValue', averageValue: '500Mi' } } },
                ],
            },
            status: {
                currentReplicas: 5, desiredReplicas: 5,
                currentMetrics: [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: 95 } } }],
            },
        });
        expect(s).toMatchObject({ name: 'web', min: 2, max: 5, current: 5, desired: 5, atMax: true });
        expect(s.metrics).toEqual([
            { label: 'cpu', target: '80%', current: '95%' },
            { label: 'memory', target: '500Mi (avg)', current: null },
        ]);
    });

    it('is not atMax below the ceiling and defaults min to 1', () => {
        const s = summarizeHpa({ spec: { maxReplicas: 5, scaleTargetRef: { kind: 'Deployment', name: 'web' } }, status: { currentReplicas: 3, desiredReplicas: 3 } });
        expect(s.atMax).toBe(false);
        expect(s.min).toBe(1);
    });
});

describe('summarizePdb', () => {
    it('blocks eviction when disruptionsAllowed is 0', () => {
        const s = summarizePdb({
            metadata: { name: 'web-pdb' },
            spec: { minAvailable: 2 },
            status: { currentHealthy: 2, desiredHealthy: 2, disruptionsAllowed: 0, expectedPods: 2 },
        });
        expect(s).toEqual({ name: 'web-pdb', minAvailable: '2', maxUnavailable: null, currentHealthy: 2, desiredHealthy: 2, disruptionsAllowed: 0, blocksEviction: true });
    });

    it('allows eviction when disruptionsAllowed > 0', () => {
        const s = summarizePdb({
            metadata: { name: 'web-pdb' },
            spec: { maxUnavailable: '50%' },
            status: { currentHealthy: 4, desiredHealthy: 2, disruptionsAllowed: 2, expectedPods: 4 },
        });
        expect(s.blocksEviction).toBe(false);
        expect(s.maxUnavailable).toBe('50%');
    });
});
