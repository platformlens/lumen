import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useResourceStore, applyKinds, type KindsState } from './resourceStore';
import type { PodItem, ResourceBatch, ResourceSnapshot, KindStatus } from '../types/resource-cache';
import type { ContainerStatus, LightweightPod } from '../types/pod-worker';

const ready: KindStatus = { phase: 'ready', error: null, lastSyncedAt: 1, mode: 'cluster' };
const pod = (id: string, name = id): PodItem => ({ id, uid: id, name, namespace: 'ns', status: 'Running', restarts: 0, age: '', node: '', containers: [] });

function snapshot(sessionId: string, seq: number, pods: PodItem[] = []): ResourceSnapshot {
  const empty = { items: [], status: ready };
  return {
    sessionId, context: 'ctx', seq,
    kinds: { deployments: empty, pods: { items: pods, status: ready }, secrets: empty, configmaps: empty, services: empty, helmreleases: empty },
  };
}
const batch = (sessionId: string, seq: number, kinds: ResourceBatch['kinds']): ResourceBatch => ({ sessionId, seq, kinds });

describe('resourceStore', () => {
  beforeEach(() => {
    useResourceStore.setState({ droppedBatches: 0 });
    useResourceStore.getState().reset(null);
  });

  it('drops batches before the first snapshot without counting them', () => {
    const s = useResourceStore.getState();
    s.reset('B');
    for (let i = 1; i <= 5; i++) expect(s.applyBatch(batch('A', i, {}))).toBe('dropped');
    expect(useResourceStore.getState().consecutiveMismatches).toBe(0);
    expect(useResourceStore.getState().droppedBatches).toBe(0);
  });

  it('drops mismatched sessions and asks to resubscribe after 5', () => {
    const s = useResourceStore.getState();
    s.applySnapshot(snapshot('S', 3));
    const results = [1, 2, 3, 4, 5].map((i) => s.applyBatch(batch('OTHER', 3 + i, {})));
    expect(results).toEqual(['dropped', 'dropped', 'dropped', 'dropped', 'resubscribe']);
    expect(useResourceStore.getState().droppedBatches).toBe(5);
    expect(s.applyBatch(batch('S', 4, {}))).toBe('applied');
    expect(useResourceStore.getState().consecutiveMismatches).toBe(0);
  });

  it('drops seq <= current and reports gaps (still applying them)', () => {
    const s = useResourceStore.getState();
    s.applySnapshot(snapshot('S', 10));
    expect(s.applyBatch(batch('S', 10, { pods: { upserts: [pod('x')], deletes: [] } }))).toBe('dropped');
    expect(useResourceStore.getState().kinds.pods.byId.size).toBe(0);
    expect(s.applyBatch(batch('S', 13, { pods: { upserts: [pod('x')], deletes: [] } }))).toBe('gap');
    expect(useResourceStore.getState().kinds.pods.byId.has('x')).toBe(true);
    expect(useResourceStore.getState().seq).toBe(13);
  });

  it('keeps untouched kinds by reference and replaces only touched ones', () => {
    const s = useResourceStore.getState();
    s.applySnapshot(snapshot('S', 1, [pod('a')]));
    const before = useResourceStore.getState().kinds;
    s.applyBatch(batch('S', 2, { pods: { upserts: [pod('b')], deletes: ['a'] } }));
    const after = useResourceStore.getState().kinds;
    expect(after.secrets.byId).toBe(before.secrets.byId);
    expect(after.secrets.status).toBe(before.secrets.status);
    expect(after.pods.byId).not.toBe(before.pods.byId);
    expect([...after.pods.byId.keys()]).toEqual(['b']);
  });

  it('a status-only delta keeps the byId reference', () => {
    const s = useResourceStore.getState();
    s.applySnapshot(snapshot('S', 1, [pod('a')]));
    const before = useResourceStore.getState().kinds.pods.byId;
    s.applyBatch(batch('S', 2, { pods: { upserts: [], deletes: [], status: { ...ready, phase: 'reconnecting' } } }));
    expect(useResourceStore.getState().kinds.pods.byId).toBe(before);
    expect(useResourceStore.getState().kinds.pods.status.phase).toBe('reconnecting');
  });

  it('reset replaces the map; reset() nulls the session', () => {
    const s = useResourceStore.getState();
    s.applySnapshot(snapshot('S', 1, [pod('a'), pod('b')]));
    s.applyBatch(batch('S', 2, { pods: { reset: true, upserts: [pod('c')], deletes: [] } }));
    expect([...useResourceStore.getState().kinds.pods.byId.keys()]).toEqual(['c']);
    s.reset('other');
    const st = useResourceStore.getState();
    expect(st.sessionId).toBeNull();
    expect(st.context).toBe('other');
    expect(st.kinds.pods.byId.size).toBe(0);
    expect(st.kinds.pods.status.phase).toBe('loading');
  });

  it('a snapshot replaces all state', () => {
    const s = useResourceStore.getState();
    s.applySnapshot(snapshot('S1', 5, [pod('a')]));
    s.applySnapshot(snapshot('S2', 2, [pod('z')]));
    const st = useResourceStore.getState();
    expect(st.sessionId).toBe('S2');
    expect(st.seq).toBe(2);
    expect([...st.kinds.pods.byId.keys()]).toEqual(['z']);
  });

  it('setAllStatus: new status objects, same byId, same session/seq', () => {
    const s = useResourceStore.getState();
    s.applySnapshot(snapshot('S', 7, [pod('a')]));
    const before = useResourceStore.getState();
    s.setAllStatus({ phase: 'error', error: 'Unknown kube context' });
    const after = useResourceStore.getState();
    for (const k of ['deployments', 'pods', 'secrets', 'configmaps', 'services', 'helmreleases'] as const) {
      expect(after.kinds[k].byId).toBe(before.kinds[k].byId);
      expect(after.kinds[k].status).not.toBe(before.kinds[k].status);
      expect(after.kinds[k].status).toMatchObject({ phase: 'error', error: 'Unknown kube context' });
    }
    expect(after.sessionId).toBe('S');
    expect(after.seq).toBe(7);
  });
});

// --- Property tests migrated from usePodWorker.pbt.test.ts, now against applyBatch's reducer ---

const arbContainer: fc.Arbitrary<ContainerStatus> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
  state: fc.constantFrom<ContainerStatus['state']>('running', 'waiting', 'terminated'),
  ready: fc.boolean(),
  restartCount: fc.nat({ max: 50 }),
});
const arbPod: fc.Arbitrary<PodItem> = fc.record({
  uid: fc.constantFrom('u1', 'u2', 'u3', 'u4', 'u5', 'u6'),
  name: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
  namespace: fc.constantFrom('default', 'kube-system', 'app'),
  status: fc.constantFrom<LightweightPod['status']>('Running', 'Pending', 'Succeeded', 'Failed', 'Terminating', 'Unknown'),
  restarts: fc.nat({ max: 500 }),
  age: fc.constant('2024-01-01T00:00:00.000Z'),
  node: fc.constantFrom('node-1', 'node-2'),
  containers: fc.array(arbContainer, { maxLength: 3 }),
}).map((p) => ({ ...p, id: p.uid }));
const arbDelta = fc.record({
  upserts: fc.uniqueArray(arbPod, { selector: (p) => p.id, maxLength: 6 }),
  deletes: fc.uniqueArray(fc.constantFrom('u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'missing'), { maxLength: 4 }),
});
const arbInitial = fc.uniqueArray(arbPod, { selector: (p) => p.id, maxLength: 6 });

function kindsWith(pods: PodItem[]): KindsState {
  useResourceStore.getState().reset(null);
  const k = useResourceStore.getState().kinds;
  return { ...k, pods: { byId: new Map(pods.map((p) => [p.id, p])), status: ready } };
}
const toObj = (k: KindsState) => Object.fromEntries([...k.pods.byId.entries()].sort(([a], [b]) => a.localeCompare(b)));

describe('applyBatch properties', () => {
  it('applying the same batch twice equals applying it once (idempotent add/update/delete)', () => {
    fc.assert(fc.property(arbInitial, arbDelta, (initial, d) => {
      const b = batch('S', 1, { pods: { upserts: d.upserts, deletes: d.deletes.filter((id) => !d.upserts.some((u) => u.id === id)) } });
      const once = applyKinds(kindsWith(initial), b);
      const twice = applyKinds(once, b);
      expect(toObj(twice)).toEqual(toObj(once));
    }), { numRuns: 300 });
  });

  it('deleting a missing id is a no-op', () => {
    fc.assert(fc.property(arbInitial, (initial) => {
      const next = applyKinds(kindsWith(initial), batch('S', 1, { pods: { upserts: [], deletes: ['missing'] } }));
      expect(toObj(next)).toEqual(toObj(kindsWith(initial)));
    }), { numRuns: 200 });
  });

  it('result never contains duplicate ids and equals the order-independent last-write-wins model', () => {
    fc.assert(fc.property(arbInitial, arbDelta, (initial, d) => {
      const deletes = d.deletes.filter((id) => !d.upserts.some((u) => u.id === id));
      const forward = applyKinds(kindsWith(initial), batch('S', 1, { pods: { upserts: d.upserts, deletes } }));
      const reversed = applyKinds(kindsWith(initial), batch('S', 1, { pods: { upserts: [...d.upserts].reverse(), deletes: [...deletes].reverse() } }));
      expect(toObj(forward)).toEqual(toObj(reversed));
      const model = new Map(initial.map((p) => [p.id, p]));
      for (const id of deletes) model.delete(id);
      for (const u of d.upserts) model.set(u.id, u);
      expect(forward.pods.byId.size).toBe(model.size);
      expect(toObj(forward)).toEqual(Object.fromEntries([...model.entries()].sort(([a], [b]) => a.localeCompare(b))));
    }), { numRuns: 300 });
  });

  it('a reset batch replaces the map with exactly its upserts', () => {
    fc.assert(fc.property(arbInitial, arbInitial, (initial, resetItems) => {
      const next = applyKinds(kindsWith(initial), batch('S', 1, { pods: { reset: true, upserts: resetItems, deletes: [] } }));
      expect([...next.pods.byId.keys()].sort()).toEqual(resetItems.map((p) => p.id).sort());
    }), { numRuns: 200 });
  });
});
