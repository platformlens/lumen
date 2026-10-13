/**
 * PodWorkerAdapter (design §3.6, main side). Drives the k8s-pod-worker utilityProcess through
 * session-tagged protocol v2, forwards deltas to the coalescer and the context engine, and
 * resets the pods kind from a fresh chunk after every informer (re)sync.
 */
import type { KindPhase, KindStatus, PodItem, PodWorkerDiagnostics } from '../../src/types/resource-cache';
import type { LightweightPod, PodWorkerDiagnosticsReply, WorkerInboundV2, WorkerOutboundV2 } from '../../src/types/pod-worker';
import { AUTH_FAILED_MESSAGE, clusterForbiddenMessage } from './kinds';
import { backoffDelay } from './list-watch';

export interface PodWorkerPort {
  /** False when no live worker (respawn pending or quitting). */
  post(msg: WorkerInboundV2): boolean;
  isAvailable(): boolean;
}

export interface ContextEngineLike {
  handleResourceEvent(kind: string, type: 'ADDED' | 'MODIFIED' | 'DELETED', raw: unknown): void;
  clearKind(kind: string): void;
}

export interface PodSink {
  upsert(item: PodItem): void;
  delete(id: string): void;
  reset(items: PodItem[]): void;
  status(status: KindStatus): void;
}

export interface PodAdapterDeps {
  port: PodWorkerPort;
  contextEngine: ContextEngineLike;
  /** Current live session id, or null. */
  getSessionId(): string | null;
  getContext(): string | null;
  sink: PodSink;
  requestAuthRebuild(): void;
  /** Cluster-mode 403: the manager switches pods to namespaced mode (or forbidden). */
  onClusterForbidden(): void;
  getKubeconfigPath?(): string | undefined;
  now?: () => number;
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
  chunkTimeoutMs?: number;
  diagnosticsTimeoutMs?: number;
}

type ChunkReply = Extract<WorkerOutboundV2, { type: 'pods-chunk-reply' }>;

export const withId = (p: LightweightPod): PodItem => ({ ...p, id: p.uid });

const initialStatus = (): KindStatus => ({ phase: 'loading', error: null, lastSyncedAt: null, mode: 'cluster' });

export function toPseudoRaw(p: LightweightPod): Record<string, unknown> {
  return {
    metadata: { uid: p.uid, name: p.name, namespace: p.namespace, creationTimestamp: p.age },
    status: {
      phase: p.status === 'Terminating' ? 'Running' : p.status,
      containerStatuses: p.containers.filter((c) => c.name !== '').map((c) => ({
        name: c.name,
        ready: c.ready,
        restartCount: c.restartCount,
        state: c.state === 'running' ? { running: {} } : c.state === 'waiting' ? { waiting: { reason: 'Waiting' } } : { terminated: { reason: 'Terminated' } },
      })),
      conditions: [],
    },
    spec: { containers: [] },
  };
}

export class PodWorkerAdapter {
  status: KindStatus = initialStatus();
  mode: 'cluster' | 'namespaced' = 'cluster';
  namespaces: string[] = [];
  private forbiddenNamespaces = new Set<string>();
  private pod401Count = 0;
  private startsPosted = 0;
  private last401Start = -1;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, { resolve(r: ChunkReply | null): void; timer: ReturnType<typeof setTimeout> }>();
  private pendingDiag = new Map<string, { resolve(r: PodWorkerDiagnosticsReply | null): void; timer: ReturnType<typeof setTimeout> }>();
  private podUidMap = new Map<string, { name: string; namespace: string }>();
  private reqCounter = 0;
  private stoppedByAuth = false;
  private readonly setT: NonNullable<PodAdapterDeps['setTimeout']>;
  private readonly clearT: NonNullable<PodAdapterDeps['clearTimeout']>;
  private readonly now: () => number;

  constructor(private readonly d: PodAdapterDeps) {
    this.setT = d.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = d.clearTimeout ?? ((t) => clearTimeout(t));
    this.now = d.now ?? Date.now;
  }

  // --- lifecycle (called by WatchManager) ---------------------------------------------

  startInformer(mode: 'cluster' | 'namespaced', namespaces: string[]): void {
    const sessionId = this.d.getSessionId();
    const context = this.d.getContext();
    if (!sessionId || !context) return;
    this.clearRetry();
    this.mode = mode;
    this.namespaces = mode === 'cluster' ? [] : namespaces.filter((n) => n !== 'all');
    this.forbiddenNamespaces.clear();
    this.stoppedByAuth = false;
    this.startsPosted++;
    const msg: WorkerInboundV2 = { type: 'start-informer', sessionId, context, mode, namespaces: this.namespaces };
    const path = this.d.getKubeconfigPath?.();
    if (path) msg.kubeconfigPath = path;
    const ok = this.d.port.post(msg);
    const keep = this.status.phase === 'ready' || this.status.phase === 'reconnecting';
    this.setStatus({ ...this.status, mode, phase: ok ? (keep ? this.status.phase : 'loading') : 'reconnecting', error: null });
  }

  /** Stop the informer for the current session; used by stopSession and the ['all']-while-namespaced path. */
  stopInformer(): void {
    const sessionId = this.d.getSessionId();
    this.clearRetry();
    if (sessionId) this.d.port.post({ type: 'stop-informer', sessionId });
  }

  /** Kubeconfig rebuild failed: stop retrying and show a fixed error until recovery. */
  halt(error: string): void {
    this.stopInformer();
    this.setStatus({ ...this.status, phase: 'error', error });
  }

  /** ['all'] selected while pods are namespaced: stop, empty the list, mark forbidden. */
  setForbiddenAll(): void {
    this.stopInformer();
    this.d.sink.reset([]);
    this.dropAllFromContextEngine();
    this.setStatus({ ...this.status, mode: 'namespaced', phase: 'forbidden', error: clusterForbiddenMessage('pods') });
  }

  /** Session stopped: drop everything (no emits). */
  endSession(): void {
    this.clearRetry();
    for (const p of this.pending.values()) { this.clearT(p.timer); p.resolve(null); }
    this.pending.clear();
    this.podUidMap.clear();
    this.forbiddenNamespaces.clear();
    this.pod401Count = 0;
    this.last401Start = -1;
    this.stoppedByAuth = false;
    this.status = initialStatus();
    this.mode = 'cluster';
    this.namespaces = [];
  }

  isErrored(): boolean {
    return this.status.phase === 'error';
  }

  /** True only after the 401 give-up (design §3.7: focus recovery is limited to this case). */
  isAuthFailed(): boolean {
    return this.stoppedByAuth;
  }

  /** onCredentialsChanged / ensureFresh / startSession recovery: reset the 401 counter and restart. */
  recover(mode: 'cluster' | 'namespaced' = this.mode, namespaces: string[] = this.namespaces): void {
    this.pod401Count = 0;
    this.startInformer(mode, namespaces);
  }

  refresh(maxSilenceMs: number): void {
    const sessionId = this.d.getSessionId();
    if (sessionId && !this.stoppedByAuth) this.d.port.post({ type: 'refresh', sessionId, maxSilenceMs });
  }

  onRespawned(): void {
    for (const p of this.pending.values()) { this.clearT(p.timer); p.resolve(null); }
    this.pending.clear();
    for (const p of this.pendingDiag.values()) { this.clearT(p.timer); p.resolve(null); }
    this.pendingDiag.clear();
    if (!this.d.getSessionId()) return;
    this.setStatus({ ...this.status, phase: 'reconnecting' });
    if (this.status.mode === 'namespaced' && this.namespaces.length === 0) return; // forbidden: waits for setNamespaces
    this.startInformer(this.mode, this.namespaces);
  }

  // --- worker messages -----------------------------------------------------------------

  onMessage(msg: WorkerOutboundV2): void {
    if (msg.type === 'diagnostics-reply') {
      const p = this.pendingDiag.get(msg.requestId);
      if (p) { this.pendingDiag.delete(msg.requestId); this.clearT(p.timer); p.resolve(msg); }
      return;
    }
    if (msg.type === 'pods-chunk-reply') {
      const p = this.pending.get(msg.requestId);
      if (p) { this.pending.delete(msg.requestId); this.clearT(p.timer); p.resolve(msg); }
      return;
    }
    const sessionId = this.d.getSessionId();
    if (!sessionId || msg.sessionId !== sessionId) return;
    switch (msg.type) {
      case 'pod-delta-batch':
        for (const delta of msg.deltas) {
          if (delta.action === 'delete' && delta.uid) {
            this.d.sink.delete(delta.uid);
            this.ceDelete(delta.uid);
          } else if (delta.pod) {
            this.d.sink.upsert(withId(delta.pod));
            this.ceUpsert(delta.pod, delta.action === 'add' ? 'ADDED' : 'MODIFIED');
          }
        }
        return;
      case 'informer-synced':
        this.pod401Count = 0;
        void this.requestChunk().then((reply) => {
          if (!reply || !this.accepted(reply)) return; // a later informer-synced requests again
          this.applyReset(reply.pods);
        });
        return;
      case 'informer-error':
        this.onInformerError(msg);
        return;
    }
  }

  private onInformerError(msg: Extract<WorkerOutboundV2, { type: 'informer-error' }>): void {
    if (msg.statusCode === 403 && msg.namespace === undefined && this.mode === 'cluster') {
      console.info('[PodAdapter] cluster-wide 403, switching mode');
      this.d.onClusterForbidden();
      return;
    }
    if (msg.statusCode === 403 && msg.namespace !== undefined) {
      this.forbiddenNamespaces.add(msg.namespace);
      const error = `No permission to list Pods in: ${[...this.forbiddenNamespaces].join(', ')}`;
      const all = this.forbiddenNamespaces.size >= this.namespaces.length;
      this.setStatus({ ...this.status, phase: all ? 'forbidden' : this.status.phase, error });
      return;
    }
    if (msg.statusCode === 401) {
      if (this.last401Start === this.startsPosted) return; // count once per start
      this.last401Start = this.startsPosted;
      this.pod401Count++;
      console.warn('[PodAdapter] 401');
      if (this.pod401Count >= 3) {
        console.error('[PodAdapter] auth failed 3 times, giving up');
        this.stoppedByAuth = true;
        this.setStatus({ ...this.status, phase: 'error', error: AUTH_FAILED_MESSAGE });
        this.stopInformer();
        return;
      }
      this.setStatus({ ...this.status, phase: 'reconnecting' });
      this.d.requestAuthRebuild();
      this.clearRetry();
      this.retryTimer = this.setT(() => {
        this.retryTimer = null;
        this.startInformer(this.mode, this.namespaces);
      }, backoffDelay(this.pod401Count - 1, this.d.random));
      return;
    }
    if (!msg.recoverable) {
      this.setStatus({ ...this.status, phase: 'error', error: 'Failed to start pod watch' });
      return;
    }
    this.setStatus({ ...this.status, phase: 'reconnecting' });
  }

  // --- snapshots / resync -------------------------------------------------------------

  /** Pods for a snapshot. `phase` overrides the status phase when the chunk was not usable. */
  async getSnapshotPods(): Promise<{ pods: PodItem[]; phase: KindPhase | null }> {
    const reply = await this.requestChunk();
    if (reply === undefined) return { pods: [], phase: 'reconnecting' };
    if (reply === null) {
      console.warn('[PodAdapter] pod chunk timeout');
      return { pods: [], phase: 'reconnecting' };
    }
    if (!this.accepted(reply)) return { pods: [], phase: 'loading' };
    return { pods: reply.pods.map(withId), phase: null };
  }

  /** Replays a FRESH chunk into the context engine (after context:clusterSwitch cleared it). */
  async resyncContextEngine(): Promise<void> {
    const reply = await this.requestChunk();
    if (!reply || !this.accepted(reply)) return;
    this.podUidMap.clear();
    for (const p of reply.pods) this.ceUpsert(p, 'ADDED');
  }

  async getDiagnostics(): Promise<PodWorkerDiagnostics | null> {
    const requestId = `diag-${++this.reqCounter}`;
    const reply = await new Promise<PodWorkerDiagnosticsReply | null>((resolve) => {
      const timer = this.setT(() => { this.pendingDiag.delete(requestId); resolve(null); }, this.d.diagnosticsTimeoutMs ?? 2000);
      this.pendingDiag.set(requestId, { resolve, timer });
      if (!this.d.port.isAvailable() || !this.d.port.post({ type: 'get-diagnostics', requestId })) {
        this.clearT(timer);
        this.pendingDiag.delete(requestId);
        resolve(null);
      }
    });
    if (!reply) return null;
    return {
      informers: reply.informers,
      podCacheSize: reply.podCacheSize,
      sessionId: reply.sessionId,
      gen: reply.gen,
      retryTimers: reply.retryTimers,
      informerStarts: reply.informerStarts,
      pendingChunkRequests: this.pending.size,
      available: this.d.port.isAvailable(),
    };
  }

  pendingChunkRequests(): number {
    return this.pending.size;
  }

  hasRetryTimer(): boolean {
    return this.retryTimer !== null;
  }

  // --- internals ----------------------------------------------------------------------

  /** null = timeout, undefined = port unavailable. */
  private requestChunk(): Promise<ChunkReply | null | undefined> {
    const sessionId = this.d.getSessionId();
    if (!sessionId) return Promise.resolve(undefined);
    const requestId = `chunk-${++this.reqCounter}`;
    return new Promise((resolve) => {
      const timer = this.setT(() => { this.pending.delete(requestId); resolve(null); }, this.d.chunkTimeoutMs ?? 10_000);
      this.pending.set(requestId, { resolve, timer });
      if (!this.d.port.post({ type: 'get-pods-chunk', requestId, sessionId })) {
        this.clearT(timer);
        this.pending.delete(requestId);
        resolve(undefined);
      }
    });
  }

  private accepted(reply: ChunkReply): boolean {
    const sid = this.d.getSessionId();
    return sid !== null && reply.sessionId === sid && reply.synced;
  }

  private applyReset(pods: LightweightPod[]): void {
    this.d.sink.reset(pods.map(withId));
    const next = new Map<string, { name: string; namespace: string }>();
    for (const p of pods) next.set(p.uid, { name: p.name, namespace: p.namespace });
    for (const [uid, info] of this.podUidMap) {
      if (!next.has(uid)) this.safeCe('DELETED', { metadata: { uid, name: info.name, namespace: info.namespace } });
    }
    for (const p of pods) if (!this.podUidMap.has(p.uid)) this.safeCe('ADDED', toPseudoRaw(p));
    this.podUidMap = next;
    const error = this.forbiddenNamespaces.size > 0 ? `No permission to list Pods in: ${[...this.forbiddenNamespaces].join(', ')}` : null;
    this.setStatus({ ...this.status, phase: 'ready', error, lastSyncedAt: this.now() });
  }

  private ceUpsert(p: LightweightPod, type: 'ADDED' | 'MODIFIED'): void {
    this.podUidMap.set(p.uid, { name: p.name, namespace: p.namespace });
    this.safeCe(type, toPseudoRaw(p));
  }

  private ceDelete(uid: string): void {
    const info = this.podUidMap.get(uid);
    if (!info) return;
    this.podUidMap.delete(uid);
    this.safeCe('DELETED', { metadata: { uid, name: info.name, namespace: info.namespace } });
  }

  private dropAllFromContextEngine(): void {
    for (const uid of [...this.podUidMap.keys()]) this.ceDelete(uid);
  }

  private safeCe(type: 'ADDED' | 'MODIFIED' | 'DELETED', raw: unknown): void {
    try {
      this.d.contextEngine.handleResourceEvent('Pod', type, raw);
    } catch {
      console.error('[ContextEngine] Error processing pod event');
    }
  }

  private setStatus(next: KindStatus): void {
    const s = this.status;
    if (s.phase === next.phase && s.error === next.error && s.mode === next.mode && s.lastSyncedAt === next.lastSyncedAt) return;
    this.status = next;
    this.d.sink.status(next);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      this.clearT(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
