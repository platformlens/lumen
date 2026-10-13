import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPodWorkerCore, type InformerLike, type DeltaBufferLike } from './pod-worker-core';
import type { LightweightPod, PodDelta, WorkerOutboundV2 } from '../src/types/pod-worker';

interface RawPod { uid: string; name: string; namespace: string }

class FakeInformer implements InformerLike<RawPod> {
  handlers = new Map<string, Array<(x?: unknown) => void>>();
  starts = 0;
  stops = 0;
  connected = false;
  disposedStartCalls = 0;
  constructor(public path: string, public ns: string | null) {}
  on(verb: string, cb: (x: never) => void): void {
    const list = this.handlers.get(verb) ?? [];
    list.push(cb as (x?: unknown) => void);
    this.handlers.set(verb, list);
  }
  emit(verb: string, x?: unknown) { for (const cb of this.handlers.get(verb) ?? []) cb(x); }
  start(): Promise<void> { this.starts++; this.connected = true; return Promise.resolve(); }
  stop(): Promise<void> {
    this.stops++;
    if (this.connected) {
      this.connected = false;
      const e = new Error('aborted');
      e.name = 'AbortError';
      this.emit('error', e); // the real client fires ERROR callbacks before its stopped check
    }
    return Promise.resolve();
  }
}

const pod = (uid: string, namespace = 'ns1'): RawPod => ({ uid, name: `p-${uid}`, namespace });

function harness() {
  const posted: WorkerOutboundV2[] = [];
  const informers: FakeInformer[] = [];
  const buildKc = vi.fn(() => ({ kc: true }));
  const buffered: PodDelta[] = [];
  let onFlush: (d: PodDelta[]) => void = () => {};
  const buffer: DeltaBufferLike = {
    push: (d) => buffered.push(d),
    flush: () => { if (buffered.length) onFlush(buffered.splice(0)); },
    clear: () => { buffered.length = 0; },
  };
  const core = createPodWorkerCore<{ kc: boolean }, RawPod>({
    makeInformer: (_kc, path, ns) => { const i = new FakeInformer(path, ns); informers.push(i); return i; },
    buildKc,
    post: (m) => posted.push(m),
    mapPod: (r): LightweightPod => ({ uid: r.uid, name: r.name, namespace: r.namespace, status: 'Running', restarts: 0, age: '', node: '', containers: [] }),
    uidOf: (r) => r.uid,
    createDeltaBuffer: (cb) => { onFlush = cb; return buffer; },
    random: () => 0.5,
  });
  const ofType = <T extends WorkerOutboundV2['type']>(t: T) => posted.filter((m) => m.type === t) as Extract<WorkerOutboundV2, { type: T }>[];
  const chunk = (sessionId: string) => {
    core.handle({ type: 'get-pods-chunk', requestId: `r${posted.length}`, sessionId });
    return posted[posted.length - 1] as Extract<WorkerOutboundV2, { type: 'pods-chunk-reply' }>;
  };
  const diag = () => {
    core.handle({ type: 'get-diagnostics', requestId: 'd' });
    return posted[posted.length - 1] as Extract<WorkerOutboundV2, { type: 'diagnostics-reply' }>;
  };
  const settle = async () => { await core.idle(); for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { core, posted, informers, buildKc, ofType, chunk, diag, settle, buffered };
}

const start = (sessionId: string, mode: 'cluster' | 'namespaced' = 'cluster', namespaces: string[] = ['all']) =>
  ({ type: 'start-informer' as const, sessionId, context: 'ctx', mode, namespaces });

describe('pod worker core', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('posts informer-synced and replies to chunks for the current session', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    expect(h.informers[0].path).toMatch(/^\/api\/v1\/pods\?timeoutSeconds=\d+$/);
    h.informers[0].emit('add', pod('1'));
    expect(h.ofType('informer-synced')).toHaveLength(1);
    const reply = h.chunk('A');
    expect(reply).toMatchObject({ sessionId: 'A', synced: true });
    expect(reply.pods.map((p) => p.uid)).toEqual(['1']);
    expect(h.chunk('B').pods).toEqual([]);
  });

  it('stop of a connected informer triggers no retry and no informer-error', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    h.core.handle({ type: 'stop-informer', sessionId: 'A' });
    await h.settle();
    vi.advanceTimersByTime(60_000);
    expect(h.informers[0].stops).toBe(1);
    expect(h.informers[0].starts).toBe(1);
    expect(h.ofType('informer-error')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.diag()).toMatchObject({ informers: 0, sessionId: null, retryTimers: 0 });
  });

  it('same-session restart builds new informers; disposed ones are never started again', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    h.core.handle({ type: 'refresh', sessionId: 'A', maxSilenceMs: 0 });
    await h.settle();
    expect(h.informers).toHaveLength(2);
    expect(h.informers[0].starts).toBe(1);
    expect(h.informers[1].starts).toBe(1);
    expect(h.buildKc).toHaveBeenCalledTimes(1); // refresh reuses the session kc
  });

  it('receipt-time replacement: a chunk right after start(B) never contains A pods', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    h.informers[0].emit('add', pod('a1'));
    h.core.handle(start('B'));
    const reply = h.chunk('B');
    expect(reply).toEqual(expect.objectContaining({ sessionId: 'B', synced: false, pods: [] }));
  });

  it('late add callbacks from a disposed rec do not change the cache', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    const old = h.informers[0];
    h.core.handle(start('B'));
    await h.settle();
    old.emit('add', pod('stale'));
    expect(h.diag().podCacheSize).toBe(0);
    expect(h.buffered).toEqual([]);
  });

  it('cluster-mode 403 is unrecoverable with no timer; a 500 schedules exactly one retry', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    h.informers[0].emit('error', { code: 403 });
    expect(h.ofType('informer-error')[0]).toMatchObject({ statusCode: 403, recoverable: false });
    expect(vi.getTimerCount()).toBe(0);
    const h2 = harness();
    h2.core.handle(start('A'));
    await h2.settle();
    h2.informers[0].emit('error', { statusCode: 500 });
    expect(h2.ofType('informer-error')[0]).toMatchObject({ statusCode: 500, recoverable: true });
    expect(h2.diag().retryTimers).toBe(1);
    vi.advanceTimersByTime(30_000);
    await h2.settle();
    expect(h2.informers[0].starts).toBe(2);
    expect(h2.diag().retryTimers).toBe(0);
  });

  it('namespaced: one ns 403 still posts informer-synced; all 403 posts none', async () => {
    // Informers are built when the lifecycle chain runs, so patching start() before settling applies to them.
    const h2 = harness();
    h2.core.handle(start('A', 'namespaced', ['ns1', 'ns2', 'ns3']));
    const origStart = FakeInformer.prototype.start;
    FakeInformer.prototype.start = function (this: FakeInformer) {
      this.starts++;
      if (this.ns === 'ns2') this.emit('error', { code: 403 });
      return Promise.resolve();
    };
    try {
      await h2.settle();
    } finally {
      FakeInformer.prototype.start = origStart;
    }
    expect(h2.ofType('informer-error')).toEqual([expect.objectContaining({ statusCode: 403, namespace: 'ns2', recoverable: false })]);
    expect(h2.ofType('informer-synced')).toHaveLength(1);
    expect(h2.diag().retryTimers).toBe(0);

    const h3 = harness();
    FakeInformer.prototype.start = function (this: FakeInformer) { this.starts++; this.emit('error', { code: 403 }); return Promise.resolve(); };
    try {
      h3.core.handle(start('A', 'namespaced', ['ns1', 'ns2', 'ns3']));
      await h3.settle();
    } finally {
      FakeInformer.prototype.start = origStart;
    }
    expect(h3.ofType('informer-error')).toHaveLength(3);
    expect(h3.ofType('informer-synced')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('401 schedules no retry and is ignored by needsRefresh', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    h.informers[0].emit('error', { statusCode: 401 });
    expect(h.ofType('informer-error')[0]).toMatchObject({ statusCode: 401, recoverable: false });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20 * 60_000);
    expect(h.core.needsRefresh(300_000)).toBe(false);
  });

  it('ignores removed protocol messages and never posts their replies', async () => {
    const h = harness();
    h.core.handle({ type: 'get-pod-count' });
    h.core.handle(start('A'));
    await h.settle();
    h.core.handle({ type: 'stop-informer', sessionId: 'A' });
    await h.settle();
    const types = h.posted.map((m) => m.type as string);
    expect(types).not.toContain('pod-count-reply');
    expect(types).not.toContain('informer-stopped');
  });

  it('five fast closes rebuild after backoff; an event resets the counter', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    const inf = h.informers[0];
    inf.emit('connect');
    for (let i = 0; i < 4; i++) { vi.advanceTimersByTime(100); inf.emit('connect'); }
    inf.emit('add', pod('1')); // resets: the next connect is not a fast close
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(100); inf.emit('connect'); }
    expect(h.informers).toHaveLength(1);
    expect(h.diag().retryTimers).toBe(0);
    vi.advanceTimersByTime(100);
    inf.emit('connect');
    expect(h.diag().retryTimers).toBe(1);
    vi.advanceTimersByTime(30_000);
    await h.settle();
    expect(h.informers).toHaveLength(2);
    expect(h.ofType('informer-synced')).toHaveLength(2);
  });

  it('needsRefresh thresholds use the 660 s floor', async () => {
    const h = harness();
    h.core.handle(start('A'));
    await h.settle();
    vi.advanceTimersByTime(3 * 60_000);
    expect(h.core.needsRefresh(120_000)).toBe(false);
    expect(h.core.needsRefresh(300_000)).toBe(false);
    expect(h.core.needsRefresh(0)).toBe(true);
    vi.advanceTimersByTime(8 * 60_000 + 1);
    expect(h.core.needsRefresh(300_000)).toBe(true);
    h.core.handle({ type: 'refresh', sessionId: 'A', maxSilenceMs: 120_000 });
    await h.settle();
    expect(h.informers).toHaveLength(2);
  });

  it('one buildKc per start-informer regardless of namespace count', async () => {
    const h = harness();
    h.core.handle(start('A', 'namespaced', ['a', 'b', 'c', 'd']));
    await h.settle();
    expect(h.informers).toHaveLength(4);
    expect(h.buildKc).toHaveBeenCalledTimes(1);
    expect(h.diag().informerStarts).toBe(4);
    h.core.handle(start('A', 'namespaced', ['a']));
    await h.settle();
    expect(h.buildKc).toHaveBeenCalledTimes(2);
  });

  it('a buildKc failure posts an unrecoverable informer-error', async () => {
    const h = harness();
    h.buildKc.mockImplementationOnce(() => { throw new Error('ctx missing'); });
    h.core.handle(start('A'));
    await h.settle();
    expect(h.ofType('informer-error')[0]).toMatchObject({ sessionId: 'A', statusCode: null, recoverable: false });
  });
});
