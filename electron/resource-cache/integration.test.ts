/**
 * In-process integration: WatchManager + PodWorkerAdapter talking protocol v2 to the REAL
 * pod-worker core (fake informers, async message delivery like a utilityProcess port).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { KubeConfig } from '@kubernetes/client-node';
import { WatchManager } from './watch-manager';
import { createPodWorkerCore, type InformerLike } from '../pod-worker-core';
import type { Subscriber } from './coalescer';
import type { ListPageResult } from './kinds';
import type { ResourceBatch } from '../../src/types/resource-cache';
import type { LightweightPod, PodDelta, WorkerInboundV2 } from '../../src/types/pod-worker';

interface RawPod { uid: string; name: string; namespace: string }

class FakeInformer implements InformerLike<RawPod> {
  handlers = new Map<string, Array<(x?: unknown) => void>>();
  connected = false;
  constructor(public ctx: string) {}
  on(verb: string, cb: (x: never) => void) {
    const l = this.handlers.get(verb) ?? [];
    l.push(cb as (x?: unknown) => void);
    this.handlers.set(verb, l);
  }
  emit(verb: string, x?: unknown) { for (const cb of this.handlers.get(verb) ?? []) cb(x); }
  async start() {
    this.connected = true;
    for (const p of PODS[this.ctx] ?? []) this.emit('add', p); // initial LIST
  }
  async stop() {
    if (!this.connected) return;
    this.connected = false;
    const e = new Error('aborted'); e.name = 'AbortError';
    this.emit('error', e);
  }
}

const PODS: Record<string, RawPod[]> = {
  A: [{ uid: 'a1', name: 'pa1', namespace: 'ns' }, { uid: 'a2', name: 'pa2', namespace: 'ns' }],
  B: [{ uid: 'b1', name: 'pb1', namespace: 'ns' }],
};

function setup() {
  const informers: FakeInformer[] = [];
  let mgr: WatchManager | null = null;
  let buffered: PodDelta[] = [];
  let flushCb: (d: PodDelta[]) => void = () => {};
  const core = createPodWorkerCore<{ ctx: string }, RawPod>({
    makeInformer: (kc) => { const i = new FakeInformer(kc.ctx); informers.push(i); return i; },
    buildKc: (ctx) => ({ ctx }),
    post: (msg) => queueMicrotask(() => mgr?.onPodWorkerMessage(msg)),
    mapPod: (r): LightweightPod => ({ uid: r.uid, name: r.name, namespace: r.namespace, status: 'Running', restarts: 0, age: '', node: '', containers: [] }),
    uidOf: (r) => r.uid,
    createDeltaBuffer: (cb) => { flushCb = cb; return { push: (d) => buffered.push(d), flush: () => { const d = buffered; buffered = []; if (d.length) flushCb(d); }, clear: () => { buffered = []; } }; },
  });
  const lists: Array<{ resolve(r: ListPageResult): void }> = [];
  const sent: ResourceBatch[] = [];
  mgr = new WatchManager({
    createKubeConfig: () => ({}) as KubeConfig,
    sendToTransformWorker: async (req) => ({ id: req.id, resourceType: 'helmrelease', events: [] }),
    podWorker: { isAvailable: () => true, post: (m: WorkerInboundV2) => { queueMicrotask(() => core.handle(m)); return true; } },
    contextEngine: { handleResourceEvent: () => {}, clearKind: () => {} },
    listPage: () => new Promise((resolve) => lists.push({ resolve })),
    watch: async () => new AbortController(),
  });
  const sub: Subscriber = { id: 1, isDestroyed: () => false, send: (_c, b) => sent.push(b) };
  const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); await core.idle(); } };
  return { mgr, core, informers, lists, sent, sub, settle };
}

describe('WatchManager × pod worker core (protocol v2)', () => {
  beforeEach(() => { vi.useFakeTimers(); for (const m of ['info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('a cluster switch stops A informers and never shows A pods under B', async () => {
    const h = setup();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.settle();
    vi.advanceTimersByTime(650);
    const aPods = h.sent.flatMap((b) => b.kinds.pods?.upserts ?? []).map((p) => p.id);
    expect(aPods).toEqual(expect.arrayContaining(['a1', 'a2']));

    const snapB = await h.mgr.startSession({ context: 'B' }, h.sub);
    expect(snapB.kinds.pods.items.map((p) => p.id)).not.toContain('a1');
    await h.settle();
    expect(h.informers[0].connected).toBe(false); // A's informer was stopped
    h.sent.length = 0;
    vi.advanceTimersByTime(650);
    const bBatches = h.sent.filter((b) => b.sessionId === snapB.sessionId);
    const reset = bBatches.map((b) => b.kinds.pods).find((d) => d?.reset);
    expect(reset?.upserts.map((p) => p.id)).toEqual(['b1']);
    expect(h.sent.every((b) => b.sessionId === snapB.sessionId)).toBe(true);
    const d = await (async () => { const p = h.mgr.getDiagnostics(); await h.settle(); return p; })();
    expect(d.podWorker).toMatchObject({ informers: 1, sessionId: snapB.sessionId, retryTimers: 0 });
  });

  it('repeated subscribe (Dashboard remount / tab switch) starts no informer and no LIST', async () => {
    const h = setup();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.settle();
    const informersBefore = h.informers.length;
    const listsBefore = h.lists.length;
    for (let i = 0; i < 25; i++) {
      const p = h.mgr.subscribe(h.sub);
      await h.settle();
      const snap = await p;
      expect(snap?.kinds.pods.items.map((x) => x.id).sort()).toEqual(['a1', 'a2']);
    }
    expect(h.informers.length).toBe(informersBefore);
    expect(h.lists.length).toBe(listsBefore);
  });

  it('stopSession leaves the worker with no informers and no session', async () => {
    const h = setup();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.settle();
    h.mgr.stopSession('test');
    await h.settle();
    expect(h.informers.every((i) => !i.connected)).toBe(true);
    const diagP = h.mgr.getDiagnostics();
    await h.settle();
    const diag = await diagP;
    expect(diag.podWorker).toMatchObject({ informers: 0, sessionId: null, podCacheSize: 0 });
    expect(diag.streams).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
