/**
 * Pod worker lifecycle core (design §3.6). Runs inside the k8s-pod-worker utilityProcess;
 * all I/O is injected so the logic is unit-testable.
 *
 * - Lifecycle receipt is synchronous: podCache is REPLACED and currentGen bumped before any await,
 *   so a chunk request after start-informer(B) can never see A's pods.
 * - Every informer callback is guarded by live(rec); disposal sets `disposed` first, so the
 *   AbortError the library fires from our own stop() is ignored and never retried.
 * - Stopped informers are never restarted; every restart builds new informers (fresh LIST).
 */
import type {
  LightweightPod,
  PodDelta,
  RefreshMsg,
  StartInformerMsg,
  StopInformerMsg,
  WorkerInboundV2,
  WorkerOutboundV2,
} from '../src/types/pod-worker';
import { extractStatusCode } from './resource-cache/kinds';

export interface InformerLike<T> {
  on(verb: 'add' | 'update' | 'delete', cb: (obj: T) => void): void;
  on(verb: 'error' | 'connect', cb: (err?: unknown) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface DeltaBufferLike {
  push(delta: PodDelta): void;
  flush(): void;
  clear(): void;
}

export interface PodWorkerCoreDeps<Kc, Raw> {
  makeInformer(kc: Kc, path: string, namespace: string | null): InformerLike<Raw>;
  buildKc(context: string, kubeconfigPath?: string): Kc;
  post(msg: WorkerOutboundV2): void;
  mapPod(raw: Raw): LightweightPod;
  uidOf(raw: Raw): string | undefined;
  createDeltaBuffer(onFlush: (deltas: PodDelta[]) => void): DeltaBufferLike;
  now?: () => number;
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
}

interface InformerRec<Raw> {
  informer: InformerLike<Raw>;
  sid: string;
  gen: number;
  ns: string | null;
  disposed: boolean;
  synced: boolean;
  errored: boolean;
  auth401: boolean;
  forbidden: boolean;
  lastEventAt: number;
  lastConnectAt: number;
  eventsSinceConnect: number;
  attempts: number;
  fastCloses: number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

export const POD_FRESH_FLOOR_MS = 660_000;
const FAST_CLOSE_MS = 5000;
const FAST_CLOSE_LIMIT = 5;

export const podBackoff = (attempts: number, random: () => number = Math.random): number =>
  Math.min(1000 * 2 ** attempts, 30_000) * (0.8 + 0.4 * random());

export interface PodWorkerCore {
  handle(msg: WorkerInboundV2 | { type: string }): void;
  /** Resolves when the current lifecycle chain has settled (tests). */
  idle(): Promise<void>;
  needsRefresh(maxSilenceMs: number): boolean;
}

export function createPodWorkerCore<Kc, Raw>(deps: PodWorkerCoreDeps<Kc, Raw>): PodWorkerCore {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((t) => clearTimeout(t));

  let currentSessionId: string | null = null;
  let currentGen = 0;
  let podCache = new Map<string, LightweightPod>();
  let cacheSynced = false;
  let recs: InformerRec<Raw>[] = [];
  let sessionKc: Kc | null = null;
  let lastStart: StartInformerMsg | null = null;
  let lifecycle: Promise<void> = Promise.resolve();
  let informerStarts = 0;
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let rebuildAttempts = 0;

  const deltaBuffer = deps.createDeltaBuffer((deltas) => {
    deps.post({ type: 'pod-delta-batch', sessionId: currentSessionId, deltas });
  });

  const live = (r: InformerRec<Raw>) => !r.disposed && r.gen === currentGen;

  function needsRefresh(maxSilenceMs: number): boolean {
    if (maxSilenceMs === 0) return true;
    const threshold = Math.max(maxSilenceMs, POD_FRESH_FLOOR_MS);
    const t = now();
    return recs.some((r) => !r.forbidden && !r.auth401 && t - r.lastEventAt > threshold);
  }

  function clearRebuildTimer(): void {
    if (rebuildTimer !== null) {
      clearT(rebuildTimer);
      rebuildTimer = null;
    }
  }

  function onLifecycle(msg: StartInformerMsg | StopInformerMsg | RefreshMsg): void {
    if (msg.type !== 'start-informer' && msg.sessionId !== currentSessionId) return; // stale stop/refresh
    if (msg.type === 'refresh' && !needsRefresh(msg.maxSilenceMs)) return;
    const old = recs;
    recs = [];
    for (const r of old) {
      r.disposed = true;
      if (r.retryTimer) clearT(r.retryTimer);
      r.retryTimer = undefined;
    }
    clearRebuildTimer();
    currentGen++;
    currentSessionId = msg.type === 'stop-informer' ? null : msg.sessionId;
    podCache = new Map();
    cacheSynced = false;
    deltaBuffer.clear(); // D5: clear, never flush
    if (msg.type === 'start-informer') {
      lastStart = msg;
      sessionKc = null;
      informerStarts = 0;
      rebuildAttempts = 0;
    }
    if (msg.type === 'stop-informer') {
      lastStart = null;
      sessionKc = null;
    }
    const gen = currentGen;
    lifecycle = lifecycle
      .then(async () => {
        await Promise.allSettled(old.map((r) => r.informer.stop()));
        if (gen !== currentGen || !lastStart) return; // superseded while stopping
        if (!sessionKc) sessionKc = deps.buildKc(lastStart.context, lastStart.kubeconfigPath);
        await startInformers(lastStart, sessionKc, gen);
      })
      .catch((err: unknown) => {
        console.error('[pod-worker] lifecycle failed', (err as Error)?.name);
        if (gen === currentGen && currentSessionId) {
          deps.post({ type: 'informer-error', sessionId: currentSessionId, statusCode: null, recoverable: false });
        }
      });
  }

  function podPath(ns: string | null): string {
    const timeout = 300 + Math.floor(random() * 300);
    return ns === null ? `/api/v1/pods?timeoutSeconds=${timeout}` : `/api/v1/namespaces/${encodeURIComponent(ns)}/pods?timeoutSeconds=${timeout}`;
  }

  function createRec(kc: Kc, ns: string | null, sid: string, gen: number): InformerRec<Raw> {
    informerStarts++;
    const informer = deps.makeInformer(kc, podPath(ns), ns);
    const t = now();
    const rec: InformerRec<Raw> = {
      informer, sid, gen, ns, disposed: false, synced: false, errored: false, auth401: false, forbidden: false,
      lastEventAt: t, lastConnectAt: 0, eventsSinceConnect: 0, attempts: 0, fastCloses: 0,
    };
    const touch = () => {
      rec.lastEventAt = now();
      rec.eventsSinceConnect++;
      rec.fastCloses = 0;
      rebuildAttempts = 0;
    };
    informer.on('add', (obj: Raw) => {
      if (!live(rec)) return;
      touch();
      const pod = deps.mapPod(obj);
      podCache.set(pod.uid, pod);
      deltaBuffer.push({ action: 'add', pod });
    });
    informer.on('update', (obj: Raw) => {
      if (!live(rec)) return;
      touch();
      const pod = deps.mapPod(obj);
      podCache.set(pod.uid, pod);
      deltaBuffer.push({ action: 'update', pod });
    });
    informer.on('delete', (obj: Raw) => {
      if (!live(rec)) return;
      touch();
      const uid = deps.uidOf(obj);
      if (!uid) return;
      podCache.delete(uid);
      deltaBuffer.push({ action: 'delete', uid });
    });
    informer.on('connect', () => {
      if (!live(rec)) return;
      const t2 = now();
      if (rec.lastConnectAt > 0 && t2 - rec.lastConnectAt < FAST_CLOSE_MS && rec.eventsSinceConnect === 0) rec.fastCloses++;
      else rec.fastCloses = 0;
      rec.lastConnectAt = t2;
      rec.eventsSinceConnect = 0;
      rec.lastEventAt = t2;
      if (rec.fastCloses >= FAST_CLOSE_LIMIT) scheduleRebuild(rec);
    });
    informer.on('error', (err?: unknown) => onError(rec, err));
    return rec;
  }

  /** Five fast closes: dispose the rec and rebuild the whole generation after backoff. */
  function scheduleRebuild(rec: InformerRec<Raw>): void {
    console.warn('[pod-worker] informer closing fast, rebuilding');
    rec.disposed = true;
    if (rec.retryTimer) clearT(rec.retryTimer);
    rec.retryTimer = undefined;
    void rec.informer.stop();
    if (rebuildTimer !== null) return;
    const gen = currentGen;
    const sid = currentSessionId;
    rebuildTimer = setT(() => {
      rebuildTimer = null;
      if (gen !== currentGen || !sid || sid !== currentSessionId) return;
      onLifecycle({ type: 'refresh', sessionId: sid, maxSilenceMs: 0 });
    }, podBackoff(rebuildAttempts++, random));
  }

  function onError(rec: InformerRec<Raw>, err: unknown): void {
    if (!live(rec)) return;
    if ((err as Error)?.name === 'AbortError') return; // only our own stop() aborts
    rec.errored = true;
    rec.synced = false;
    const code = extractStatusCode(err);
    if (rec.retryTimer) clearT(rec.retryTimer);
    rec.retryTimer = undefined;
    if (code === 403 && lastStart?.mode === 'cluster') {
      deps.post({ type: 'informer-error', sessionId: rec.sid, statusCode: 403, recoverable: false });
      return;
    }
    if (code === 403) {
      rec.forbidden = true;
      deps.post({ type: 'informer-error', sessionId: rec.sid, statusCode: 403, namespace: rec.ns ?? undefined, recoverable: false });
      maybePostSynced();
      return;
    }
    if (code === 401) {
      rec.auth401 = true;
      deps.post({ type: 'informer-error', sessionId: rec.sid, statusCode: 401, recoverable: false });
      return;
    }
    console.warn('[pod-worker] informer error', code ?? 'network');
    deps.post({ type: 'informer-error', sessionId: rec.sid, statusCode: code ?? null, recoverable: true });
    rec.retryTimer = setT(() => {
      rec.retryTimer = undefined;
      if (!live(rec)) return;
      rec.errored = false;
      void rec.informer.start().then(() => afterStart(rec), (e: unknown) => onError(rec, e));
    }, podBackoff(rec.attempts++, random));
  }

  function afterStart(rec: InformerRec<Raw>): void {
    if (!live(rec)) {
      void rec.informer.stop(); // connect race: request is set by now, so this aborts the socket
      return;
    }
    rec.lastEventAt = now();
    if (rec.errored || rec.forbidden) return;
    rec.synced = true;
    rec.attempts = 0;
    maybePostSynced();
  }

  function maybePostSynced(): void {
    if (cacheSynced || !currentSessionId) return;
    const active = recs.filter((r) => !r.forbidden);
    if (active.length === 0 || !active.every((r) => r.synced)) return;
    deltaBuffer.flush();
    cacheSynced = true;
    deps.post({ type: 'informer-synced', sessionId: currentSessionId, count: podCache.size });
  }

  async function startInformers(start: StartInformerMsg, kc: Kc, gen: number): Promise<void> {
    const scopes: Array<string | null> = start.mode === 'cluster' ? [null] : start.namespaces.filter((n) => n !== 'all');
    const created = scopes.map((ns) => createRec(kc, ns, start.sessionId, gen));
    if (gen !== currentGen) return;
    recs = created;
    await Promise.all(
      created.map(async (rec) => {
        try {
          await rec.informer.start();
        } catch (err) {
          onError(rec, err);
        }
        afterStart(rec);
      }),
    );
  }

  function handle(msg: WorkerInboundV2 | { type: string }): void {
    const m = msg as WorkerInboundV2;
    switch (m.type) {
      case 'start-informer':
      case 'stop-informer':
      case 'refresh':
        onLifecycle(m);
        return;
      case 'get-pods-chunk':
        deps.post({
          type: 'pods-chunk-reply',
          requestId: m.requestId,
          sessionId: currentSessionId,
          synced: cacheSynced,
          pods: m.sessionId === currentSessionId && cacheSynced ? Array.from(podCache.values()) : [],
        });
        return;
      case 'get-diagnostics':
        deps.post({
          type: 'diagnostics-reply',
          requestId: m.requestId,
          informers: recs.length,
          podCacheSize: podCache.size,
          sessionId: currentSessionId,
          gen: currentGen,
          retryTimers: recs.filter((r) => r.retryTimer !== undefined).length + (rebuildTimer !== null ? 1 : 0),
          informerStarts,
        });
        return;
      default:
        return; // removed protocol messages (get-pod-count, ...) are ignored
    }
  }

  return { handle, idle: () => lifecycle, needsRefresh };
}
