import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { KubeConfig } from '@kubernetes/client-node';
import { WatchManager } from './watch-manager';
import { KubeconfigLoadError, UnknownContextError, type ListPageResult, type RawObject } from './kinds';
import type { Subscriber } from './coalescer';
import type { ListedKind, ResourceBatch } from '../../src/types/resource-cache';
import type { LightweightPod, WorkerInboundV2 } from '../../src/types/pod-worker';
import type { WatchParams } from './list-watch';

const obj = (uid: string, ns = 'ns1', rv = '1', extra: Record<string, unknown> = {}) =>
  ({ metadata: { uid, name: `o-${uid}`, namespace: ns, resourceVersion: rv }, ...extra }) as unknown as RawObject;
const helm = (rel: string, rev: number, ns = 'ns1') =>
  obj(`${rel}-v${rev}`, ns, '1', { type: 'helm.sh/release.v1', metadata: { uid: `${rel}-v${rev}`, name: `sh.helm.release.v1.${rel}.v${rev}`, namespace: ns, resourceVersion: '1', labels: { name: rel, version: String(rev), status: 'deployed' } }, data: { release: 'x' } });
const lp = (uid: string, namespace = 'ns1'): LightweightPod => ({ uid, name: `p-${uid}`, namespace, status: 'Running', restarts: 0, age: '', node: '', containers: [] });

interface ListCall { kind: ListedKind; scope: string; resolve(r: ListPageResult): void; reject(e: unknown): void }
interface WatchCall { path: string; params: WatchParams; onEvent(t: string, o: unknown): void; onDone(e: unknown): void; ctrl: AbortController }

function harness() {
  const lists: ListCall[] = [];
  const watches: WatchCall[] = [];
  const sent: ResourceBatch[] = [];
  const ce: Array<[string, string]> = [];
  const createKubeConfig = vi.fn((): KubeConfig => ({}) as KubeConfig);

  // Fake pod worker: answers chunk requests from its current generation, like the real one.
  const worker = { sessionId: null as string | null, synced: false, pods: [] as LightweightPod[], posts: [] as WorkerInboundV2[], holdChunks: false, held: [] as Array<() => void> };
  const podWorker = {
    isAvailable: () => true,
    post(msg: WorkerInboundV2) {
      worker.posts.push(msg);
      if (msg.type === 'start-informer') { worker.sessionId = msg.sessionId; worker.synced = false; worker.pods = []; }
      if (msg.type === 'stop-informer' && msg.sessionId === worker.sessionId) { worker.sessionId = null; worker.synced = false; worker.pods = []; }
      if (msg.type === 'get-pods-chunk') {
        const reply = () => mgr.onPodWorkerMessage({ type: 'pods-chunk-reply', requestId: msg.requestId, sessionId: worker.sessionId, synced: worker.synced, pods: msg.sessionId === worker.sessionId && worker.synced ? [...worker.pods] : [] });
        if (worker.holdChunks) worker.held.push(reply); else queueMicrotask(reply);
      }
      if (msg.type === 'get-diagnostics') {
        queueMicrotask(() => mgr.onPodWorkerMessage({ type: 'diagnostics-reply', requestId: msg.requestId, informers: worker.sessionId ? 1 : 0, podCacheSize: worker.pods.length, sessionId: worker.sessionId, gen: 0, retryTimers: 0, informerStarts: 0 }));
      }
      return true;
    },
  };
  // `mgr` is only read inside podWorker.post, which runs after construction
  const mgr: WatchManager = new WatchManager({
    createKubeConfig,
    sendToTransformWorker: async (req) => ({ id: req.id, resourceType: 'helmrelease', events: [] }),
    podWorker,
    contextEngine: { handleResourceEvent: (k, t) => ce.push([k, t]), clearKind: (k) => ce.push([k, 'CLEAR']) },
    listPage: (kind, _kc, scope) => new Promise((resolve, reject) => lists.push({ kind, scope, resolve, reject })),
    watch: (_kc, path, params, onEvent, onDone) => { const ctrl = new AbortController(); watches.push({ path, params, onEvent, onDone, ctrl }); return Promise.resolve(ctrl); },
    random: () => 0.5,
  });
  const sub: Subscriber = { id: 1, isDestroyed: () => false, send: (_c, b) => sent.push(b) };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const pending = (kind: ListedKind, scope = '*') => lists.filter((l) => l.kind === kind && l.scope === scope);
  async function listAll(items: Partial<Record<ListedKind, RawObject[]>> = {}, scope = '*') {
    for (const kind of ['deployments', 'services', 'configmaps', 'secrets'] as ListedKind[]) {
      const call = pending(kind, scope).pop();
      call?.resolve({ items: items[kind] ?? [], resourceVersion: '10' });
    }
    await flush();
  }
  function syncPods(pods: LightweightPod[]) {
    worker.synced = true;
    worker.pods = pods;
    mgr.onPodWorkerMessage({ type: 'informer-synced', sessionId: worker.sessionId!, count: pods.length });
  }
  const watchFor = (kind: ListedKind) => watches.filter((w) => w.path.endsWith(`/${kind}`));
  return { mgr, lists, watches, sent, ce, createKubeConfig, worker, sub, flush, listAll, syncPods, pending, watchFor };
}

describe('WatchManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    for (const m of ['info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('starts four streams + pods and returns a loading snapshot', async () => {
    const h = harness();
    const snap = await h.mgr.startSession({ context: 'A' }, h.sub);
    expect(h.lists.map((l) => l.kind).sort()).toEqual(['configmaps', 'deployments', 'secrets', 'services']);
    expect(h.worker.posts[0]).toMatchObject({ type: 'start-informer', mode: 'cluster', sessionId: snap.sessionId });
    expect(snap.kinds.pods).toEqual({ items: [], status: expect.objectContaining({ phase: 'loading' }) });
    expect(snap.kinds.secrets.status.phase).toBe('loading');
  });

  it('same-context startSession is idempotent and resyncs the context engine', async () => {
    const h = harness();
    const s1 = await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll({ deployments: [obj('d1')] });
    h.ce.length = 0;
    const s2 = await h.mgr.startSession({ context: 'A' }, h.sub);
    expect(s2.sessionId).toBe(s1.sessionId);
    expect(h.lists).toHaveLength(4);
    expect(h.ce).toContainEqual(['Deployment', 'ADDED']);
    expect(s2.kinds.deployments.items.map((d) => d.id)).toEqual(['d1']);
  });

  it('tab-switch style calls (subscribe, cluster-mode setNamespaces, ensureFresh on focus) issue no LIST', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll();
    const before = (await h.mgr.getDiagnostics()).listCalls;
    for (let i = 0; i < 50; i++) {
      await h.mgr.subscribe(h.sub);
      h.mgr.setNamespaces(i % 2 ? ['ns1'] : ['all']);
      h.mgr.ensureFresh(300_000);
    }
    const after = await h.mgr.getDiagnostics();
    expect(after.listCalls).toEqual(before);
    expect(before.secrets).toEqual({ runs: 1, pages: 1 });
    expect(h.lists).toHaveLength(4);
    expect(after.streams).toHaveLength(4);
  });

  it('a cluster switch stops old streams first, clears the old data and drops late events', async () => {
    const h = harness();
    const a = await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll({ secrets: [obj('sA')] });
    const oldWatches = [...h.watches];
    const b = await h.mgr.startSession({ context: 'B' }, h.sub);
    expect(oldWatches.every((w) => w.ctrl.signal.aborted)).toBe(true);
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(b.kinds.secrets.items).toEqual([]);
    expect(h.ce).toContainEqual(['Deployment', 'CLEAR']);
    h.sent.length = 0;
    oldWatches.forEach((w) => w.onEvent('ADDED', obj('late')));
    vi.advanceTimersByTime(1000);
    expect(h.sent.every((batch) => batch.sessionId === b.sessionId)).toBe(true);
    const d = await h.mgr.getDiagnostics();
    expect(d.streams).toHaveLength(4);
    expect(d.sessionId).toBe(b.sessionId);
  });

  it('A→B→A with a delayed pod chunk never returns a stopped session id', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    h.worker.holdChunks = true;
    const pB = h.mgr.startSession({ context: 'B' }, h.sub);
    const pA = h.mgr.startSession({ context: 'A' }, h.sub);
    h.worker.holdChunks = false;
    h.worker.held.splice(0).forEach((r) => r());
    await h.flush();
    const [sB, sA] = await Promise.all([pB, pA]);
    const live = (await h.mgr.getDiagnostics()).sessionId;
    expect(sB.sessionId).toBe(live);
    expect(sA.sessionId).toBe(live);
  });

  it('a snapshot during A→B never contains A pods', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    h.syncPods([lp('a1'), lp('a2')]);
    await h.flush();
    const b = await h.mgr.startSession({ context: 'B' }, h.sub);
    expect(b.kinds.pods.items).toEqual([]);
    expect(b.kinds.pods.status.phase).toBe('loading');
  });

  it('a batch flushed during the snapshot chunk await has seq ≤ snapshot.seq', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll();
    h.watchFor('secrets')[0].onEvent('ADDED', obj('s1'));
    h.worker.holdChunks = true;
    const p = h.mgr.subscribe(h.sub);
    vi.advanceTimersByTime(650); // coalescer flushes while the chunk is pending
    h.worker.held.splice(0).forEach((r) => r());
    const snap = (await p)!;
    expect(h.sent.length).toBeGreaterThan(0);
    for (const b of h.sent) expect(b.seq).toBeLessThanOrEqual(snap.seq);
    expect(snap.kinds.secrets.items.map((s) => s.id)).toEqual(['s1']);
  });

  it('setNamespaces before startSession is recorded and used on a 403 switch', async () => {
    const h = harness();
    h.mgr.setNamespaces(['ns1', 'ns2']);
    await h.mgr.startSession({ context: 'A' }, h.sub);
    h.pending('secrets')[0].reject({ code: 403 });
    await h.flush();
    expect(h.pending('secrets', 'ns1')).toHaveLength(1);
    expect(h.pending('secrets', 'ns2')).toHaveLength(1);
    const d = await h.mgr.getDiagnostics();
    expect(d.lastNamespaces).toEqual(['ns1', 'ns2']);
  });

  it('namespaced kinds add/remove streams with deletes; [all] makes them forbidden', async () => {
    const h = harness();
    h.mgr.setNamespaces(['ns1', 'ns2']);
    await h.mgr.startSession({ context: 'A' }, h.sub);
    h.pending('configmaps')[0].reject({ code: 403 });
    await h.flush();
    h.pending('configmaps', 'ns1')[0].resolve({ items: [obj('c1', 'ns1')], resourceVersion: '1' });
    h.pending('configmaps', 'ns2')[0].resolve({ items: [obj('c2', 'ns2')], resourceVersion: '1' });
    await h.flush();
    vi.advanceTimersByTime(650);
    h.sent.length = 0;
    h.mgr.setNamespaces(['ns1', 'ns3']);
    expect(h.pending('configmaps', 'ns3')).toHaveLength(1);
    vi.advanceTimersByTime(650);
    expect(h.sent.flatMap((b) => b.kinds.configmaps?.deletes ?? [])).toEqual(['c2']);
    h.sent.length = 0;
    h.mgr.setNamespaces(['all']);
    vi.advanceTimersByTime(650);
    const cm = h.sent.map((b) => b.kinds.configmaps).filter(Boolean);
    expect(cm.flatMap((d) => d!.deletes)).toEqual(['c1']);
    expect(cm[cm.length - 1]!.status).toMatchObject({ phase: 'forbidden', mode: 'namespaced' });
    expect((await h.mgr.getDiagnostics()).streams.filter((s) => s.kind === 'configmaps')).toHaveLength(0);
  });

  it('cluster retry on credentials change: adopts on success, stays namespaced on 403', async () => {
    const h = harness();
    h.mgr.setNamespaces(['ns1']);
    await h.mgr.startSession({ context: 'A' }, h.sub);
    h.pending('services')[0].reject({ code: 403 });
    await h.flush();
    h.pending('services', 'ns1')[0].resolve({ items: [obj('v1')], resourceVersion: '1' });
    await h.flush();
    h.mgr.onCredentialsChanged();
    await h.flush();
    let retry = h.pending('services', '*');
    expect(retry).toHaveLength(2);
    retry[1].reject({ code: 403 });
    await h.flush();
    let svc = (await h.mgr.getDiagnostics()).streams.filter((s) => s.kind === 'services');
    expect(svc.map((s) => s.scope)).toEqual(['ns1']);
    h.mgr.onCredentialsChanged();
    await h.flush();
    retry = h.pending('services', '*');
    retry[retry.length - 1].resolve({ items: [obj('v1')], resourceVersion: '2' });
    await h.flush();
    svc = (await h.mgr.getDiagnostics()).streams.filter((s) => s.kind === 'services');
    expect(svc.map((s) => s.scope)).toEqual(['*']);
  });

  it('auth rebuild is debounced across four streams', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    h.createKubeConfig.mockClear();
    for (const l of [...h.lists]) l.reject({ statusCode: 401 });
    await h.flush();
    expect(h.createKubeConfig).toHaveBeenCalledTimes(1);
  });

  it('idle: navigation + 60 s stops the session; a startSession within 60 s cancels it', async () => {
    const h = harness();
    const s = await h.mgr.startSession({ context: 'A' }, h.sub);
    h.mgr.onRendererNavigated();
    vi.advanceTimersByTime(30_000);
    const again = await h.mgr.startSession({ context: 'A' }, h.sub);
    expect(again.sessionId).toBe(s.sessionId);
    vi.advanceTimersByTime(60_000);
    expect((await h.mgr.getDiagnostics()).sessionId).toBe(s.sessionId);
    h.mgr.onRendererNavigated();
    vi.advanceTimersByTime(60_000);
    expect((await h.mgr.getDiagnostics()).sessionId).toBeNull();
  });

  it('onRendererNavigated without a session arms no timer', async () => {
    const h = harness();
    h.mgr.onRendererNavigated();
    expect((await h.mgr.getDiagnostics()).timers.idle).toBe(false);
  });

  it('deployment LIST items reach the context engine as ADDED', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll({ deployments: [obj('d1'), obj('d2')] });
    expect(h.ce.filter(([k, t]) => k === 'Deployment' && t === 'ADDED')).toHaveLength(2);
  });

  it('after stop: zero timers, zero controllers, zero streams', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll();
    h.watchFor('secrets')[0].onEvent('ADDED', obj('x'));
    h.mgr.stopSession('test');
    const d = await h.mgr.getDiagnostics();
    expect(d.streams).toEqual([]);
    expect(d.timers).toEqual({ health: false, idle: false, coalescer: false, authRebuild: false });
    expect(h.watches.every((w) => w.ctrl.signal.aborted)).toBe(true);
    expect(h.worker.posts.filter((m) => m.type !== 'get-diagnostics').pop()).toMatchObject({ type: 'stop-informer' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminal-error recovery via same-context startSession', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll();
    h.createKubeConfig.mockImplementation(() => { throw new UnknownContextError(); });
    h.watchFor('secrets')[0].onDone({ statusCode: 401 });
    await h.flush();
    const halted = (await h.mgr.getDiagnostics()).streams;
    expect(halted.map((x) => x.phase)).toEqual(['error', 'error', 'error', 'error']);
    // still broken: a re-select rejects with the fixed string and keeps the session
    await expect(h.mgr.startSession({ context: 'A' }, h.sub)).rejects.toThrow('Unknown kube context');
    h.createKubeConfig.mockImplementation(() => ({}) as KubeConfig);
    const listsBefore = h.lists.length;
    const snap = await h.mgr.startSession({ context: 'A' }, h.sub);
    expect(h.lists.length).toBe(listsBefore + 4); // every halted stream restarts
    expect(snap.sessionId).toBeTruthy();
  });

  it('kubeconfig load failure rejects with the fixed string and leaves the session untouched', async () => {
    const h = harness();
    const a = await h.mgr.startSession({ context: 'A' }, h.sub);
    h.createKubeConfig.mockImplementation(() => { throw new KubeconfigLoadError(); });
    await expect(h.mgr.startSession({ context: 'B' }, h.sub)).rejects.toThrow(/^Failed to load kubeconfig$/);
    const d = await h.mgr.getDiagnostics();
    expect(d.sessionId).toBe(a.sessionId);
    expect(d.streams).toHaveLength(4);
  });

  it('secrets re-list deletes reach HelmIndex', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll({ secrets: [helm('app', 1)] });
    vi.advanceTimersByTime(650);
    expect(h.sent.some((b) => b.kinds.helmreleases?.upserts.some((r) => r.id === 'ns1/app'))).toBe(true);
    h.sent.length = 0;
    h.watchFor('secrets')[0].onEvent('ERROR', { code: 410 });
    await h.flush();
    h.pending('secrets').pop()!.resolve({ items: [], resourceVersion: '20' });
    await h.flush();
    vi.advanceTimersByTime(650);
    expect(h.sent.flatMap((b) => b.kinds.helmreleases?.deletes ?? [])).toEqual(['ns1/app']);
    expect((await h.mgr.getDiagnostics()).listCalls.secrets.runs).toBe(2);
  });

  it('focus does not churn healthy streams', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll();
    vi.advanceTimersByTime(4 * 60_000);
    const before = (await h.mgr.getDiagnostics()).streams.map((s) => s.epoch);
    h.worker.posts.length = 0;
    for (let i = 0; i < 20; i++) h.mgr.ensureFresh(300_000);
    const after = (await h.mgr.getDiagnostics()).streams.map((s) => s.epoch);
    expect(after).toEqual(before);
    expect(h.watches).toHaveLength(4);
  });

  it('pods: sync triggers a reset batch; cluster 403 with [all] → forbidden', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    h.syncPods([lp('p1')]);
    await h.flush();
    vi.advanceTimersByTime(650);
    const pods = h.sent.map((b) => b.kinds.pods).filter(Boolean);
    expect(pods.some((d) => d!.reset && d!.upserts.map((p) => p.id).join() === 'p1')).toBe(true);
    h.mgr.onPodWorkerMessage({ type: 'informer-error', sessionId: h.worker.sessionId!, statusCode: 403, recoverable: false });
    vi.advanceTimersByTime(650);
    const last = h.sent.map((b) => b.kinds.pods).filter(Boolean).pop()!;
    expect(last.status).toMatchObject({ phase: 'forbidden', mode: 'namespaced' });
  });

  it('a WATCH-time cluster 403 deletes the rows the cluster stream owned (no ghost rows)', async () => {
    const h = harness();
    h.mgr.setNamespaces(['ns1']);
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll({ secrets: [helm('app', 1, 'ns2'), obj('s1', 'ns1')] });
    vi.advanceTimersByTime(650);
    h.sent.length = 0;
    h.watchFor('secrets')[0].onDone({ statusCode: 403 }); // RBAC revoked mid-session
    await h.flush();
    vi.advanceTimersByTime(650);
    expect(h.sent.flatMap((b) => b.kinds.secrets?.deletes ?? []).sort()).toEqual(['app-v1', 's1']);
    expect(h.sent.flatMap((b) => b.kinds.helmreleases?.deletes ?? [])).toEqual(['ns2/app']);
    expect(h.pending('secrets', 'ns1')).toHaveLength(1);
  });

  it('focus recovers pods only after the 401 give-up, not for other terminal errors', async () => {
    const h = harness();
    await h.mgr.startSession({ context: 'A' }, h.sub);
    await h.listAll();
    const starts = () => h.worker.posts.filter((m) => m.type === 'start-informer').length;
    h.mgr.onPodWorkerMessage({ type: 'informer-error', sessionId: h.worker.sessionId!, statusCode: 500, recoverable: false });
    const before = starts();
    for (let i = 0; i < 5; i++) h.mgr.ensureFresh(300_000);
    expect(starts()).toBe(before);
    // 401 give-up: three 401s, one per start
    for (let i = 0; i < 3; i++) {
      h.mgr.onPodWorkerMessage({ type: 'informer-error', sessionId: h.worker.sessionId!, statusCode: 401, recoverable: true });
      vi.advanceTimersByTime(30_000);
      await h.flush();
    }
    const afterGiveUp = starts();
    h.mgr.ensureFresh(300_000);
    expect(starts()).toBe(afterGiveUp + 1);
    h.mgr.ensureFresh(300_000); // the restart cleared the give-up flag
    expect(starts()).toBe(afterGiveUp + 1);
  });

  it('isBoundTo reflects navigation unbinds and resubscribes per sender', async () => {
    const h = harness();
    expect(h.mgr.isBoundTo(1)).toBe(false);
    await h.mgr.startSession({ context: 'A' }, h.sub);
    expect(h.mgr.isBoundTo(1)).toBe(true);
    expect(h.mgr.isBoundTo(2)).toBe(false);
    h.mgr.onRendererNavigated();
    expect(h.mgr.isBoundTo(1)).toBe(false);
    await h.mgr.subscribe(h.sub);
    expect(h.mgr.isBoundTo(1)).toBe(true);
    expect((await h.mgr.getDiagnostics()).timers.idle).toBe(false);
  });
});
