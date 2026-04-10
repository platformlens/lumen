/**
 * Property-based tests for applyDeltas function.
 * Uses fast-check to validate correctness properties from the design document.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyDeltas } from './usePodWorker';
import type { LightweightPod, PodDelta, ContainerStatus } from '../types/pod-worker';

// --- Reusable Arbitraries ---

const POD_STATUSES: LightweightPod['status'][] = [
  'Running', 'Pending', 'Succeeded', 'Failed', 'Terminating', 'Unknown',
];

const CONTAINER_STATES: ContainerStatus['state'][] = ['running', 'waiting', 'terminated'];

export const arbContainerStatus: fc.Arbitrary<ContainerStatus> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
  state: fc.constantFrom(...CONTAINER_STATES),
  ready: fc.boolean(),
  restartCount: fc.nat({ max: 50 }),
});

export const arbLightweightPod: fc.Arbitrary<LightweightPod> = fc.record({
  uid: fc.uuid(),
  name: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
  namespace: fc.constantFrom('default', 'kube-system', 'monitoring', 'app'),
  status: fc.constantFrom(...POD_STATUSES),
  restarts: fc.nat({ max: 500 }),
  age: fc.integer({ min: 1577836800000, max: 1767225600000 }).map(ts => new Date(ts).toISOString()),
  node: fc.constantFrom('node-1', 'node-2', 'node-3', 'node-4'),
  containers: fc.array(arbContainerStatus, { minLength: 0, maxLength: 5 }),
});

/** Generate an array of LightweightPods with unique UIDs */
export const arbUniquePodArray: fc.Arbitrary<LightweightPod[]> =
  fc.array(arbLightweightPod, { minLength: 0, maxLength: 30 })
    .map(pods => {
      const seen = new Set<string>();
      return pods.filter(p => {
        if (seen.has(p.uid)) return false;
        seen.add(p.uid);
        return true;
      });
    });

/** Generate a PodDelta that references UIDs from a given pod array (or introduces new ones) */
export function arbDeltaBatch(pods: LightweightPod[]): fc.Arbitrary<PodDelta[]> {
  const existingUids = pods.map(p => p.uid);

  const arbAddDelta: fc.Arbitrary<PodDelta> = arbLightweightPod.map(pod => ({
    action: 'add' as const,
    pod,
  }));

  const arbUpdateDelta: fc.Arbitrary<PodDelta> =
    existingUids.length > 0
      ? fc.constantFrom(...existingUids).chain(uid =>
          arbLightweightPod.map(pod => ({
            action: 'update' as const,
            pod: { ...pod, uid },
          })),
        )
      : arbLightweightPod.map(pod => ({ action: 'update' as const, pod }));

  const arbDeleteDelta: fc.Arbitrary<PodDelta> =
    existingUids.length > 0
      ? fc.oneof(
          fc.constantFrom(...existingUids).map(uid => ({ action: 'delete' as const, uid })),
          fc.uuid().map(uid => ({ action: 'delete' as const, uid })),
        )
      : fc.uuid().map(uid => ({ action: 'delete' as const, uid }));

  return fc.array(
    fc.oneof(arbAddDelta, arbUpdateDelta, arbDeleteDelta),
    { minLength: 1, maxLength: 20 },
  );
}

// --- Property 2: Delta Idempotency ---
// **Validates: Requirement 4.2**

describe('Property 2: Delta Idempotency', () => {
  it('applying the same delta batch twice produces the same result as applying it once', () => {
    fc.assert(
      fc.property(
        arbUniquePodArray.chain(pods =>
          arbDeltaBatch(pods).map(deltas => ({ pods, deltas })),
        ),
        ({ pods, deltas }) => {
          const once = applyDeltas(pods, deltas);
          const twice = applyDeltas(once, deltas);

          // Sort both by uid for stable comparison
          const sortByUid = (a: LightweightPod, b: LightweightPod) =>
            a.uid.localeCompare(b.uid);

          const sortedOnce = [...once].sort(sortByUid);
          const sortedTwice = [...twice].sort(sortByUid);

          expect(sortedTwice).toEqual(sortedOnce);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// --- Property 3: No Duplicate UIDs ---
// **Validates: Requirement 4.5**

describe('Property 3: No Duplicate UIDs', () => {
  it('the result array contains zero duplicate UIDs after applying any sequence of deltas', () => {
    fc.assert(
      fc.property(
        arbUniquePodArray.chain(pods =>
          arbDeltaBatch(pods).map(deltas => ({ pods, deltas })),
        ),
        ({ pods, deltas }) => {
          const result = applyDeltas(pods, deltas);
          const uids = result.map(p => p.uid);
          const uniqueUids = new Set(uids);

          expect(uids.length).toBe(uniqueUids.size);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// --- Property 6: Delta Order Preservation ---
// **Validates: Requirement 4.6**

describe('Property 6: Delta Order Preservation', () => {
  it('pods whose UIDs are not in the delta batch appear in the same relative order in the result', () => {
    fc.assert(
      fc.property(
        arbUniquePodArray.chain(pods =>
          arbDeltaBatch(pods).map(deltas => ({ pods, deltas })),
        ),
        ({ pods, deltas }) => {
          const result = applyDeltas(pods, deltas);

          // Collect the set of UIDs referenced in the delta batch
          const deltaUids = new Set<string>();
          for (const delta of deltas) {
            if (delta.action === 'delete') {
              deltaUids.add(delta.uid!);
            } else {
              deltaUids.add(delta.pod!.uid);
            }
          }

          // Filter input to only pods NOT referenced in deltas
          const inputUnaffected = pods
            .filter(p => !deltaUids.has(p.uid))
            .map(p => p.uid);

          // Filter result to only pods NOT referenced in deltas
          const resultUnaffected = result
            .filter(p => !deltaUids.has(p.uid))
            .map(p => p.uid);

          // The two filtered UID sequences should be identical (same UIDs, same order)
          expect(resultUnaffected).toEqual(inputUnaffected);
        },
      ),
      { numRuns: 500 },
    );
  });
});
