import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PodWorkerAdapter, type PodWorkerPort } from './pod-adapter';
import type { KindStatus, PodItem } from '../../src/types/resource-cache';
import type { LightweightPod, WorkerInboundV2 } from '../../src/types/pod-worker';

const lp = (uid: string, namespace = 'ns1'): LightweightPod => ({ uid, name: `p-${uid}`, namespace, status: 'Running', restarts: 0, age: '', node: '', containers: [] });

function harness(opts: { available?: boolean } = {}) {
  const posts: WorkerInboundV2[] = [];
  let available = opts.available ?? true;
  const port: PodWorkerPort = { post: (m) => { if (!available) return false; posts.push(m); return true; }, isAvailable: () => available };
  let sessionId: string | null = 'S';
  const resets: PodItem[][] = [];
  const upserts: string[] = [];
  const deletes: string[] = [];
  const statuses: KindStatus[] = [];
  const ce: Array<[string, string]> = [];
  const authRebuild = vi.fn();
  const clusterForbidden = vi.fn();
  const a = new PodWorkerAdapter({
    port,
    contextEngine: { handleResourceEvent: (_k, t, raw) => ce.push([t, (raw as { metadata: { uid: string } }).metadata.uid]), clearKind: () => {} },
    getSessionId: () => sessionId,
    getContext: () => 'ctx',
    sink: { upsert: (i) => upserts.push(i.id), delete: (id) => deletes.push(id), reset: (items) => resets.push(items), status: (s) => statuses.push(s) },
    requestAuthRebuild: authRebuild,
    onClusterForbidden: clusterForbidden,
    random: () => 0.5,
  });
  const lastChunkReq = () => [...posts].reverse().find((p) => p.type === 'get-pods-chunk') as Extract<WorkerInboundV2, { type: 'get-pods-chunk' }>;
  const reply = (pods: LightweightPod[], o: { sessionId?: string | null; synced?: boolean } = {}) => {
    const r = lastChunkReq();
    a.onMessage({ type: 'pods-chunk-reply', requestId: r.requestId, sessionId: o.sessionId === undefined ? 'S' : o.sessionId, synced: o.synced ?? true, pods });
  };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const starts = () => posts.filter((p) => p.type === 'start-informer');
  return { a, posts, resets, upserts, deletes, statuses, ce, authRebuild, clusterForbidden, reply, flush, starts, lastChunkReq,
    setSession: (s: string | null) => { sessionId = s; }, setAvailable: (v: boolean) => { available = v; } };
}

describe('PodWorkerAdapter', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('drops messages for another session', () => {
    const h = harness();
    h.a.startInformer('cluster', []);
    h.a.onMessage({ type: 'pod-delta-batch', sessionId: 'OLD', deltas: [{ action: 'add', pod: lp('x') }] });
    h.a.onMessage({ type: 'informer-synced', sessionId: 'OLD', count: 1 });
    expect(h.upserts).toEqual([]);
    expect(h.posts.filter((p) => p.type === 'get-pods-chunk')).toHaveLength(0);
  });

  it('every informer-synced requests a chunk and resets', async () => {
    const h = harness();
    h.a.startInformer('cluster', []);
    h.a.onMessage({ type: 'pod-delta-batch', sessionId: 'S', deltas: [{ action: 'add', pod: lp('a') }] });
    expect(h.upserts).toEqual(['a']);
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 2 });
    h.reply([lp('a'), lp('b')]);
    await h.flush();
    expect(h.resets.map((r) => r.map((p) => p.id))).toEqual([['a', 'b']]);
    expect(h.a.status.phase).toBe('ready');
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 1 });
    h.reply([lp('b')]);
    await h.flush();
    expect(h.resets).toHaveLength(2);
  });

  it('respawn with a pod deleted during the outage: reset excludes it and the context engine gets DELETED', async () => {
    const h = harness();
    h.a.startInformer('cluster', []);
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 2 });
    h.reply([lp('a'), lp('b')]);
    await h.flush();
    h.a.onRespawned();
    expect(h.a.status.phase).toBe('reconnecting');
    expect(h.starts()).toHaveLength(2);
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 1 });
    h.reply([lp('a')]);
    await h.flush();
    expect(h.resets[1].map((p) => p.id)).toEqual(['a']);
    expect(h.ce).toContainEqual(['DELETED', 'b']);
  });

  it('namespaced restart without a namespace resets without its pods', async () => {
    const h = harness();
    h.a.startInformer('namespaced', ['ns1', 'ns2']);
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 2 });
    h.reply([lp('a', 'ns1'), lp('b', 'ns2')]);
    await h.flush();
    h.a.startInformer('namespaced', ['ns1']);
    expect(h.starts()[1]).toMatchObject({ mode: 'namespaced', namespaces: ['ns1'] });
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 1 });
    h.reply([lp('a', 'ns1')]);
    await h.flush();
    expect(h.resets[1].map((p) => p.id)).toEqual(['a']);
  });

  it('chunk timeout yields [] / reconnecting', async () => {
    const h = harness();
    const p = h.a.getSnapshotPods();
    vi.advanceTimersByTime(10_000);
    await expect(p).resolves.toEqual({ pods: [], phase: 'reconnecting' });
    expect(h.a.pendingChunkRequests()).toBe(0);
  });

  it('an unaccepted chunk yields [] / loading and does not reset', async () => {
    const h = harness();
    const p1 = h.a.getSnapshotPods();
    h.reply([lp('a')], { sessionId: 'OTHER' });
    await expect(p1).resolves.toEqual({ pods: [], phase: 'loading' });
    const p2 = h.a.getSnapshotPods();
    h.reply([lp('a')], { synced: false });
    await expect(p2).resolves.toEqual({ pods: [], phase: 'loading' });
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 1 });
    h.reply([lp('a')], { synced: false });
    await h.flush();
    expect(h.resets).toHaveLength(0);
  });

  it('port unavailable: snapshot resolves immediately with [] / reconnecting', async () => {
    const h = harness({ available: false });
    await expect(h.a.getSnapshotPods()).resolves.toEqual({ pods: [], phase: 'reconnecting' });
    expect(h.a.pendingChunkRequests()).toBe(0);
  });

  it('401: rebuild + backoff re-post; counted once per start; three set error and stop', async () => {
    const h = harness();
    h.a.startInformer('namespaced', ['a', 'b']);
    h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 401, recoverable: false });
    h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 401, recoverable: false }); // same start
    expect(h.authRebuild).toHaveBeenCalledTimes(1);
    expect(h.a.status.phase).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(h.starts()).toHaveLength(2);
    h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 401, recoverable: false });
    vi.advanceTimersByTime(2000);
    expect(h.starts()).toHaveLength(3);
    h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 401, recoverable: false });
    expect(h.a.status).toMatchObject({ phase: 'error', error: 'Authentication failed: refresh credentials' });
    expect(h.posts[h.posts.length - 1]).toEqual({ type: 'stop-informer', sessionId: 'S' });
    expect(h.a.hasRetryTimer()).toBe(false);
    h.a.recover();
    expect(h.starts()).toHaveLength(4);
    h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 401, recoverable: false });
    expect(h.a.status.phase).toBe('reconnecting'); // counter back at 1
  });

  it('informer-synced resets the 401 counter', async () => {
    const h = harness();
    h.a.startInformer('cluster', []);
    for (let i = 0; i < 2; i++) {
      h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 401, recoverable: false });
      vi.advanceTimersByTime(30_000);
    }
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 0 });
    h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 401, recoverable: false });
    expect(h.a.status.phase).toBe('reconnecting');
  });

  it('namespaced 403: one namespace → ready with error; all → forbidden', async () => {
    const h = harness();
    h.a.startInformer('namespaced', ['ns1', 'ns2', 'ns3']);
    h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 403, namespace: 'ns2', recoverable: false });
    h.a.onMessage({ type: 'informer-synced', sessionId: 'S', count: 0 });
    h.reply([]);
    await h.flush();
    expect(h.a.status).toMatchObject({ phase: 'ready', error: 'No permission to list Pods in: ns2' });
    const h2 = harness();
    h2.a.startInformer('namespaced', ['ns1', 'ns2', 'ns3']);
    for (const ns of ['ns1', 'ns2', 'ns3']) h2.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 403, namespace: ns, recoverable: false });
    expect(h2.a.status).toMatchObject({ phase: 'forbidden', error: 'No permission to list Pods in: ns1, ns2, ns3' });
  });

  it('cluster-mode 403 asks the manager to switch mode', () => {
    const h = harness();
    h.a.startInformer('cluster', []);
    h.a.onMessage({ type: 'informer-error', sessionId: 'S', statusCode: 403, recoverable: false });
    expect(h.clusterForbidden).toHaveBeenCalledTimes(1);
  });

  it('resyncContextEngine uses a fresh chunk and replays only an accepted reply', async () => {
    const h = harness();
    const p = h.a.resyncContextEngine();
    const first = h.lastChunkReq().requestId;
    h.reply([lp('a')]);
    await p;
    expect(h.ce).toEqual([['ADDED', 'a']]);
    const p2 = h.a.resyncContextEngine();
    expect(h.lastChunkReq().requestId).not.toBe(first);
    h.reply([lp('b')], { synced: false });
    await p2;
    expect(h.ce).toEqual([['ADDED', 'a']]);
  });
});
