import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResourceSyncController, type ResourceSyncApi } from './resource-sync-controller';
import { useResourceStore } from '../stores/resourceStore';
import type { KindStatus, PodItem, ResourceBatch, ResourceSnapshot } from '../types/resource-cache';

const ready: KindStatus = { phase: 'ready', error: null, lastSyncedAt: 1, mode: 'cluster' };
const pod = (id: string): PodItem => ({ id, uid: id, name: id, namespace: 'ns', status: 'Running', restarts: 0, age: '', node: '', containers: [] });
function snap(sessionId: string, context: string, seq = 0, pods: PodItem[] = []): ResourceSnapshot {
  const e = { items: [], status: ready };
  return { sessionId, context, seq, kinds: { deployments: e, pods: { items: pods, status: ready }, secrets: e, configmaps: e, services: e, helmreleases: e } };
}
const podBatch = (sessionId: string, seq: number, ids: string[]): ResourceBatch => ({ sessionId, seq, kinds: { pods: { upserts: ids.map(pod), deletes: [] } } });

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function harness() {
  const listeners = new Set<(b: ResourceBatch) => void>();
  const starts: Array<{ args: { context: string }; d: Deferred<ResourceSnapshot> }> = [];
  const subs: Array<Deferred<ResourceSnapshot | null>> = [];
  const disposers: Array<ReturnType<typeof vi.fn>> = [];
  const fresh = { bound: true };
  const api: ResourceSyncApi = {
    startSession: vi.fn((args) => { const d = deferred<ResourceSnapshot>(); starts.push({ args, d }); return d.promise; }),
    subscribe: vi.fn(() => { const d = deferred<ResourceSnapshot | null>(); subs.push(d); return d.promise; }),
    stopSession: vi.fn(() => Promise.resolve(true)),
    ensureFresh: vi.fn(() => Promise.resolve({ bound: fresh.bound })),
    onBatch: vi.fn((cb) => {
      listeners.add(cb);
      const off = vi.fn(() => { listeners.delete(cb); });
      disposers.push(off);
      return off;
    }),
  };
  const toast = vi.fn();
  const c = createResourceSyncController(api, useResourceStore, { showToast: () => toast });
  const emit = (b: ResourceBatch) => { for (const l of [...listeners]) l(b); };
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { c, api, starts, subs, listeners, disposers, emit, flush, toast, fresh };
}

const pods = () => [...useResourceStore.getState().kinds.pods.byId.keys()];

describe('resource sync controller', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useResourceStore.setState({ droppedBatches: 0 });
    useResourceStore.getState().reset(null);
  });

  it('applies the snapshot and following batches', async () => {
    const h = harness();
    h.c.onSync('A', 0);
    h.starts[0].d.resolve(snap('S', 'A', 1));
    await h.flush();
    h.emit(podBatch('S', 2, ['p1']));
    expect(pods()).toEqual(['p1']);
    expect(h.listeners.size).toBe(1);
  });

  it('ignores a late snapshot under an old token', async () => {
    const h = harness();
    const cleanupA = h.c.onSync('A', 0);
    cleanupA();
    h.c.onSync('B', 0);
    h.starts[0].d.resolve(snap('SA', 'A', 1, [pod('a-pod')]));
    await h.flush();
    expect(useResourceStore.getState().sessionId).toBeNull();
    h.starts[1].d.resolve(snap('SB', 'B', 1));
    await h.flush();
    expect(useResourceStore.getState().sessionId).toBe('SB');
    expect(pods()).toEqual([]);
  });

  it('batches before the snapshot are not counted and trigger no subscribe', async () => {
    const h = harness();
    h.c.onSync('B', 0);
    for (let i = 1; i <= 5; i++) h.emit(podBatch('A', i, ['x']));
    expect(useResourceStore.getState().consecutiveMismatches).toBe(0);
    expect(h.api.subscribe).not.toHaveBeenCalled();
  });

  it('resubscribe keeps delivery working under the same token', async () => {
    const h = harness();
    h.c.onSync('A', 0);
    h.starts[0].d.resolve(snap('S1', 'A', 1));
    await h.flush();
    for (let i = 0; i < 5; i++) h.emit(podBatch('S2', 10 + i, ['x']));
    expect(h.api.subscribe).toHaveBeenCalledTimes(1);
    h.subs[0].resolve(snap('S2', 'A', 20));
    await h.flush();
    h.emit(podBatch('S2', 21, ['after']));
    expect(pods()).toEqual(['after']);
  });

  it('resubscribe is single-flight and never runs during the initial start', async () => {
    const h = harness();
    useResourceStore.getState().applySnapshot(snap('S1', 'A', 1));
    h.c.onSync('A', 0); // store context is A: no reset, start pending
    for (let i = 0; i < 10; i++) h.emit(podBatch('S1', 5 + i * 2, ['g'])); // gaps
    expect(h.api.subscribe).not.toHaveBeenCalled();
    h.starts[0].d.resolve(snap('S1', 'A', 1));
    await h.flush();
    for (let i = 0; i < 10; i++) h.emit(podBatch('S9', 100 + i, ['m']));
    expect(h.api.subscribe).toHaveBeenCalledTimes(1);
  });

  it('non-null → null stops the session; an initial null does not', async () => {
    const h = harness();
    h.c.onSync(null, 0);
    expect(h.api.stopSession).not.toHaveBeenCalled();
    const cleanup = h.c.onSync('A', 0);
    cleanup();
    h.c.onSync(null, 0);
    expect(h.api.stopSession).toHaveBeenCalledTimes(1);
    expect(useResourceStore.getState().context).toBeNull();
  });

  it("'connecting' (no onSync call) keeps the listener and A's batches apply", async () => {
    const h = harness();
    h.c.onSync('A', 0);
    h.starts[0].d.resolve(snap('S', 'A', 1));
    await h.flush();
    // App sets connectionStatus='connecting' — nothing changes for the controller
    expect(h.disposers[0]).not.toHaveBeenCalled();
    h.emit(podBatch('S', 2, ['still']));
    expect(pods()).toEqual(['still']);
  });

  it('a failed switch (epoch bump, same cluster) re-runs startSession without reset', async () => {
    const h = harness();
    const c1 = h.c.onSync('A', 1);
    h.starts[0].d.resolve(snap('S', 'A', 1));
    await h.flush();
    c1();
    h.c.onSync('A', 2);
    expect(h.disposers[0]).toHaveBeenCalledTimes(1);
    expect(h.listeners.size).toBe(1);
    expect(h.starts[1].args.context).toBe('A');
    expect(useResourceStore.getState().sessionId).toBe('S'); // no reset (it would null the session)
    h.starts[1].d.resolve(snap('S', 'A', 5, [pod('fresh')]));
    await h.flush();
    expect(pods()).toEqual(['fresh']);
    // successful re-select (epoch 3) is the same idempotent path
    h.c.onSync('A', 3);
    expect(h.starts[2].args.context).toBe('A');
    expect(useResourceStore.getState().sessionId).toBe('S');
    expect(pods()).toEqual(['fresh']);
    expect(h.listeners.size).toBe(1);
  });

  it('listener count stays flat across repeated switches', async () => {
    const h = harness();
    let cleanup = h.c.onSync('A', 0);
    for (let i = 0; i < 20; i++) {
      cleanup();
      cleanup = h.c.onSync(i % 2 ? 'A' : 'B', i);
      expect(h.listeners.size).toBe(1);
    }
    cleanup();
    expect(h.listeners.size).toBe(0);
  });

  it('handleStartError maps fixed strings via setAllStatus and keeps byId', async () => {
    const h = harness();
    h.c.onSync('A', 0);
    const before = useResourceStore.getState().kinds.pods.byId;
    h.starts[0].d.reject(new Error("Error invoking remote method 'resources:startSession': Error: Unknown kube context"));
    await h.flush();
    const st = useResourceStore.getState();
    expect(st.kinds.pods.status).toMatchObject({ phase: 'error', error: 'Unknown kube context' });
    expect(st.kinds.pods.byId).toBe(before);
    expect(h.toast).toHaveBeenCalledWith('Unknown kube context', 'error');
    const h2 = harness();
    h2.c.onSync('B', 0);
    h2.starts[0].d.reject(new Error('ENOENT /Users/me/.kube/config token=abc'));
    await h2.flush();
    expect(useResourceStore.getState().kinds.secrets.status.error).toBe('Failed to start resource sync');
  });
  it('focus rebinds only when main reports this renderer unbound', async () => {
    const h = harness();
    h.c.onSync('A', 0);
    h.starts[0].d.resolve(snap('S', 'A', 1));
    await h.flush();
    h.c.onFocus();
    await h.flush();
    expect(h.api.ensureFresh).toHaveBeenCalledTimes(1);
    expect(h.api.subscribe).not.toHaveBeenCalled();
    h.fresh.bound = false; // e.g. main unbound us on a navigation that never replaced the page
    h.c.onFocus();
    await h.flush();
    expect(h.api.subscribe).toHaveBeenCalledTimes(1);
    h.subs[0].resolve(snap('S', 'A', 5, [pod('rebound')]));
    await h.flush();
    expect(pods()).toEqual(['rebound']);
    h.emit(podBatch('S', 6, ['next']));
    expect(pods()).toContain('next');
    expect(h.listeners.size).toBe(1);
  });
  it('focus with no cluster selected never resubscribes', async () => {
    const h = harness();
    h.fresh.bound = false;
    h.c.onSync(null, 0);
    h.c.onFocus();
    await h.flush();
    expect(h.api.subscribe).not.toHaveBeenCalled();
    expect(h.api.startSession).not.toHaveBeenCalled();
  });
});
