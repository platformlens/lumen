/**
 * Property-based tests for mapLightweightPod.
 * Uses fast-check to validate correctness properties from the design document.
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { V1Pod, V1ContainerStatus, V1ContainerState } from '@kubernetes/client-node';
import { mapLightweightPod } from './k8s-pod-worker';

// --- Arbitraries ---

const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0);

const arbContainerState = (): fc.Arbitrary<V1ContainerState> =>
  fc.oneof(
    fc.record({ running: fc.record({ startedAt: fc.constant(new Date()) }) }),
    fc.record({ waiting: fc.record({ reason: fc.constant('ContainerCreating') }) }),
    fc.record({ terminated: fc.record({ exitCode: fc.integer({ min: 0, max: 255 }) }) }),
  );

const arbContainerStatus = (): fc.Arbitrary<V1ContainerStatus> =>
  fc.record({
    name: arbNonEmptyString,
    state: arbContainerState(),
    ready: fc.boolean(),
    restartCount: fc.nat({ max: 500 }),
    image: fc.constant('nginx:latest'),
    imageID: fc.constant('docker://sha256:abc'),
    containerID: fc.constant('containerd://xyz'),
    started: fc.boolean(),
    lastState: fc.constant({}),
  });

const arbPhase = fc.oneof(
  fc.constant('Running'),
  fc.constant('Pending'),
  fc.constant('Succeeded'),
  fc.constant('Failed'),
  fc.constant('SomeUnknownPhase'),
  fc.constant(undefined as string | undefined),
);

const arbV1Pod = (): fc.Arbitrary<V1Pod> =>
  fc.record({
    metadata: fc.record({
      uid: arbNonEmptyString,
      name: arbNonEmptyString,
      namespace: arbNonEmptyString,
      deletionTimestamp: fc.option(fc.date(), { nil: undefined }),
      creationTimestamp: fc.option(fc.date(), { nil: undefined }),
    }),
    status: fc.record({
      phase: arbPhase,
      containerStatuses: fc.array(arbContainerStatus(), { minLength: 0, maxLength: 5 }),
      initContainerStatuses: fc.array(arbContainerStatus(), { minLength: 0, maxLength: 3 }),
    }),
    spec: fc.record({
      nodeName: fc.option(arbNonEmptyString, { nil: undefined }),
    }),
  }) as fc.Arbitrary<V1Pod>;

// --- Property 1: Pod Mapping Correctness ---
// **Validates: Requirements 2.2, 2.3, 2.4, 2.5**

describe('Property 1: Pod Mapping Correctness', () => {
  it('status is "Terminating" if and only if deletionTimestamp is set', () => {
    fc.assert(
      fc.property(arbV1Pod(), (pod) => {
        const result = mapLightweightPod(pod);
        const hasDeletionTimestamp = pod.metadata?.deletionTimestamp != null;

        if (hasDeletionTimestamp) {
          expect(result.status).toBe('Terminating');
        } else {
          expect(result.status).not.toBe('Terminating');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('restarts equals sum of containerStatuses restartCount values (not initContainerStatuses)', () => {
    fc.assert(
      fc.property(arbV1Pod(), (pod) => {
        const result = mapLightweightPod(pod);
        const containerStatuses = pod.status?.containerStatuses ?? [];
        const expectedRestarts = containerStatuses.reduce(
          (sum, c) => sum + (c.restartCount ?? 0),
          0,
        );

        expect(result.restarts).toBe(expectedRestarts);
      }),
      { numRuns: 200 },
    );
  });

  it('containers array length equals initContainerStatuses + containerStatuses count', () => {
    fc.assert(
      fc.property(arbV1Pod(), (pod) => {
        const result = mapLightweightPod(pod);
        const initCount = (pod.status?.initContainerStatuses ?? []).length;
        const regularCount = (pod.status?.containerStatuses ?? []).length;

        expect(result.containers.length).toBe(initCount + regularCount);
      }),
      { numRuns: 200 },
    );
  });
});
