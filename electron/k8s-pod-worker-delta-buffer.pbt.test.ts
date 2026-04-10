/**
 * Property-based tests for DeltaBatchBuffer coalescing.
 * Uses fast-check to validate correctness properties from the design document.
 *
 * **Validates: Requirements 3.2, 3.3, 3.4**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { DeltaBatchBuffer } from './k8s-pod-worker';
import type { PodDelta, LightweightPod } from '../src/types/pod-worker';

// --- Helpers ---

const STATUSES: LightweightPod['status'][] = [
  'Running', 'Pending', 'Succeeded', 'Failed', 'Terminating', 'Unknown',
];

function makePod(uid: string, overrides?: Partial<LightweightPod>): LightweightPod {
  return {
    uid,
    name: `pod-${uid}`,
    namespace: 'default',
    status: 'Running',
    restarts: 0,
    age: new Date().toISOString(),
    node: 'node-1',
    containers: [],
    ...overrides,
  };
}

// --- Arbitraries ---

const arbStatus = fc.constantFrom(...STATUSES);

const arbPodForUid = (uid: string): fc.Arbitrary<LightweightPod> =>
  fc.record({
    status: arbStatus,
    restarts: fc.nat({ max: 100 }),
    node: fc.constantFrom('node-1', 'node-2', 'node-3'),
  }).map(({ status, restarts, node }) =>
    makePod(uid, { status, restarts, node }),
  );

const arbDeltaForUid = (uid: string): fc.Arbitrary<PodDelta> =>
  fc.oneof(
    arbPodForUid(uid).map(pod => ({ action: 'add' as const, pod })),
    arbPodForUid(uid).map(pod => ({ action: 'update' as const, pod })),
    fc.constant({ action: 'delete' as const, uid }),
  );

const arbDeltaSequenceForUid = (uid: string): fc.Arbitrary<PodDelta[]> =>
  fc.array(arbDeltaForUid(uid), { minLength: 1, maxLength: 20 });

const arbUid = fc.stringMatching(/^[a-z0-9]{4,8}$/);

// --- Property 4: Batch Coalescing ---
// **Validates: Requirements 3.2, 3.3, 3.4**

describe('Property 4: Batch Coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushed output contains exactly one delta per UID for single-UID sequences', () => {
    fc.assert(
      fc.property(arbUid, fc.integer({ min: 1, max: 20 }), (uid, seqLen) => {
        const flushed: PodDelta[] = [];
        const buffer = new DeltaBatchBuffer({
          onFlush: (deltas) => flushed.push(...deltas),
        });

        // Generate a sequence of deltas for this UID
        const actions: PodDelta['action'][] = ['add', 'update', 'delete'];
        for (let i = 0; i < seqLen; i++) {
          const action = actions[i % actions.length];
          if (action === 'delete') {
            buffer.push({ action: 'delete', uid });
          } else {
            buffer.push({ action, pod: makePod(uid, { restarts: i }) });
          }
        }

        buffer.flush();
        buffer.destroy();

        // Exactly one delta for this UID
        const deltasForUid = flushed.filter(d =>
          d.action === 'delete' ? d.uid === uid : d.pod?.uid === uid,
        );
        expect(deltasForUid).toHaveLength(1);
      }),
      { numRuns: 200 },
    );
  });

  it('flushed output contains at most one delta per UID for multi-UID sequences', () => {
    const arbMultiUidDeltas = fc.array(arbUid, { minLength: 1, maxLength: 5 })
      .chain(uids => {
        const uniqueUids = [...new Set(uids)];
        return fc.tuple(
          ...uniqueUids.map(uid => arbDeltaSequenceForUid(uid)),
        ).map(sequences => sequences.flat());
      });

    fc.assert(
      fc.property(arbMultiUidDeltas, (deltas) => {
        const flushed: PodDelta[] = [];
        const buffer = new DeltaBatchBuffer({
          onFlush: (batch) => flushed.push(...batch),
        });

        for (const delta of deltas) {
          buffer.push(delta);
        }

        buffer.flush();
        buffer.destroy();

        // Count UIDs in flushed output
        const uidCounts = new Map<string, number>();
        for (const d of flushed) {
          const uid = d.action === 'delete' ? d.uid! : d.pod!.uid;
          uidCounts.set(uid, (uidCounts.get(uid) ?? 0) + 1);
        }

        // Each UID appears at most once
        for (const [uid, count] of uidCounts) {
          expect(count, `UID ${uid} appeared ${count} times`).toBe(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('if the last delta for a UID is a delete, the flushed output is a delete', () => {
    fc.assert(
      fc.property(
        arbUid,
        fc.array(arbStatus, { minLength: 0, maxLength: 10 }),
        (uid, priorStatuses) => {
          const flushed: PodDelta[] = [];
          const buffer = new DeltaBatchBuffer({
            onFlush: (batch) => flushed.push(...batch),
          });

          // Push some add/update deltas first
          for (const status of priorStatuses) {
            const action = Math.random() > 0.5 ? 'add' : 'update';
            buffer.push({ action, pod: makePod(uid, { status }) });
          }

          // End with a delete
          buffer.push({ action: 'delete', uid });

          buffer.flush();
          buffer.destroy();

          expect(flushed).toHaveLength(1);
          expect(flushed[0].action).toBe('delete');
          expect(flushed[0].uid).toBe(uid);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('if the last delta is add/update after a delete, the flushed output contains the latest pod data as an add', () => {
    fc.assert(
      fc.property(
        arbUid,
        arbStatus,
        arbStatus,
        (uid, intermediateStatus, finalStatus) => {
          const flushed: PodDelta[] = [];
          const buffer = new DeltaBatchBuffer({
            onFlush: (batch) => flushed.push(...batch),
          });

          // Add, then delete, then add again with final data
          buffer.push({ action: 'add', pod: makePod(uid, { status: intermediateStatus }) });
          buffer.push({ action: 'delete', uid });
          buffer.push({ action: 'update', pod: makePod(uid, { status: finalStatus }) });

          buffer.flush();
          buffer.destroy();

          expect(flushed).toHaveLength(1);
          expect(flushed[0].action).toBe('add');
          expect(flushed[0].pod!.uid).toBe(uid);
          expect(flushed[0].pod!.status).toBe(finalStatus);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('update after add preserves add action with latest pod data', () => {
    fc.assert(
      fc.property(
        arbUid,
        arbStatus,
        arbStatus,
        (uid, initialStatus, finalStatus) => {
          const flushed: PodDelta[] = [];
          const buffer = new DeltaBatchBuffer({
            onFlush: (batch) => flushed.push(...batch),
          });

          buffer.push({ action: 'add', pod: makePod(uid, { status: initialStatus }) });
          buffer.push({ action: 'update', pod: makePod(uid, { status: finalStatus }) });

          buffer.flush();
          buffer.destroy();

          expect(flushed).toHaveLength(1);
          expect(flushed[0].action).toBe('add');
          expect(flushed[0].pod!.status).toBe(finalStatus);
        },
      ),
      { numRuns: 200 },
    );
  });
});
