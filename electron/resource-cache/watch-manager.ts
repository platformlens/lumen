/**
 * WatchManager (design §3.7): one list+watch session per connected cluster for the six core kinds.
 * Owns session lifecycle, the subscriber + idle timer, auth rebuilds, freshness, and diagnostics.
 * No Electron import: every side effect is injected so it can be unit-tested.
 */
import { randomUUID } from 'node:crypto';
import { CoreV1Api, type KubeConfig } from '@kubernetes/client-node';
import type {
  CoreKind,
  KindStatus,
  ListedKind,
  ResourceCacheDiagnostics,
  ResourceSnapshot,
  StartSessionArgs,
} from '../../src/types/resource-cache';
import type { WorkerOutboundV2 } from '../../src/types/pod-worker';
import type { TransformRequest, TransformResponse } from '../resource-transform-worker';
import { Coalescer, type Subscriber } from './coalescer';
import { HelmIndex } from './helm-index';
import { CORE_KIND_DESCRIPTORS, LISTED_KINDS, UnknownContextError, toWireShape, type CoreKindDescriptor, type ListHooks, type RawObject } from './kinds';
import { ListWatchStream, type ListPageFn, type WatchFn } from './list-watch';
import { PodWorkerAdapter, type ContextEngineLike, type PodWorkerPort } from './pod-adapter';
import { KindScopes } from './scope-manager';

type Timer = ReturnType<typeof setTimeout>;

export interface WatchManagerDeps {
  createKubeConfig(ctx: string): KubeConfig;
  sendToTransformWorker(req: TransformRequest): Promise<TransformResponse>;
  podWorker: PodWorkerPort;
  contextEngine: ContextEngineLike;
  getKubeconfigPath?(): string | undefined;
  getLegacyMapSizes?(): ResourceCacheDiagnostics['legacyMaps'];
  pendingTransforms?(): number;
  /** Test seams; default to the real client-node calls. */
  listPage?: (kind: ListedKind, ...args: Parameters<ListPageFn>) => ReturnType<ListPageFn>;
  watch?: WatchFn;
  readSecret?(kc: KubeConfig, namespace: string, name: string): Promise<RawObject>;
  now?: () => number;
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => Timer;
  clearTimeout?: (t: Timer) => void;
  setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (t: ReturnType<typeof setInterval>) => void;
}

interface Session {
  id: string;
  context: string;
  kc: KubeConfig;
  kcEpoch: number;
  seq: number;
  stopped: boolean;
  coalescer: Coalescer;
  helm: HelmIndex;
  scopes: { [K in ListedKind]: KindScopes<K> };
  helmStatus: KindStatus;
  health: ReturnType<typeof setInterval> | null;
  lastAuthRebuildAt: number;
  authTimer: Timer | null;
}

export const IDLE_GRACE_MS = 60_000;
export const HEALTH_INTERVAL_MS = 60_000;
export const AUTH_REBUILD_MS = 10_000;

const contextErrorMessage = (err: unknown): string => (err instanceof UnknownContextError ? 'Unknown kube context' : 'Failed to load kubeconfig');
const loadingStatus = (): KindStatus => ({ phase: 'loading', error: null, lastSyncedAt: null, mode: 'cluster' });

export class WatchManager {
  lastNamespaces: string[] = ['all'];
  private session: Session | null = null;
  private subscriber: Subscriber | null = null;
  private bound = false;
  private idleTimer: Timer | null = null;
  private counter = 0;
  readonly pods: PodWorkerAdapter;
  private readonly now: () => number;
  private readonly setT: (fn: () => void, ms: number) => Timer;
  private readonly clearT: (t: Timer) => void;

  constructor(private readonly d: WatchManagerDeps) {
    this.now = d.now ?? Date.now;
    this.setT = d.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = d.clearTimeout ?? ((t) => clearTimeout(t));
    this.pods = new PodWorkerAdapter({
      port: d.podWorker,
      contextEngine: d.contextEngine,
      getSessionId: () => this.liveSession()?.id ?? null,
      getContext: () => this.liveSession()?.context ?? null,
      getKubeconfigPath: d.getKubeconfigPath,
      sink: {
        upsert: (i) => this.liveSession()?.coalescer.upsert('pods', i),
        delete: (id) => this.liveSession()?.coalescer.delete('pods', id),
        reset: (items) => this.liveSession()?.coalescer.resetKind('pods', items),
        status: (s) => this.liveSession()?.coalescer.setStatus('pods', s),
      },
      requestAuthRebuild: () => this.requestAuthRebuild(),
      onClusterForbidden: () => this.onPodsClusterForbidden(),
      now: d.now,
      random: d.random,
      setTimeout: d.setTimeout,
      clearTimeout: d.clearTimeout,
    });
  }

  // --- session lifecycle ------------------------------------------------------------------

  async startSession(args: StartSessionArgs, sender: Subscriber): Promise<ResourceSnapshot> {
    this.cancelIdle();
    if (args.namespaces) this.lastNamespaces = [...args.namespaces];
    const s = this.liveSession();
    if (s && s.context === args.context) {
      this.bind(sender);
      this.resyncContextEngine(s);
      if (args.namespaces) this.applyNamespaces(s);
      this.recoverSession(s); // throws a fixed-string Error when the kubeconfig is still broken
      return this.buildSnapshot(s);
    }
    let kc: KubeConfig;
    try {
      kc = this.d.createKubeConfig(args.context);
    } catch (err) {
      console.warn('[WatchManager] createKubeConfig failed', (err as Error)?.name);
      throw new Error(contextErrorMessage(err));
    }
    this.stopSession('switch');
    const session = this.createSession(args.context, kc);
    this.session = session;
    this.bind(sender);
    for (const kind of LISTED_KINDS) session.scopes[kind].start();
    this.pods.startInformer('cluster', []);
    const setI = this.d.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    session.health = setI(() => this.checkHealth(), HEALTH_INTERVAL_MS);
    console.info('[WatchManager] start session', session.id);
    return this.buildSnapshot(session);
  }

  async subscribe(sender: Subscriber): Promise<ResourceSnapshot | null> {
    this.cancelIdle();
    const s = this.liveSession();
    if (!s) return null;
    this.bind(sender);
    try {
      return await this.buildSnapshot(s);
    } catch {
      return null;
    }
  }

  stopSession(reason: string): void {
    const s = this.session;
    if (!s) {
      this.cancelIdle();
      return;
    }
    this.pods.stopInformer(); // needs the live session id, so it runs before `stopped`
    s.stopped = true;
    for (const kind of LISTED_KINDS) s.scopes[kind].stopAll();
    this.pods.endSession();
    s.coalescer.clear();
    s.helm.clear({ emit: false });
    const clearI = this.d.clearInterval ?? ((t) => clearInterval(t));
    if (s.health !== null) clearI(s.health);
    s.health = null;
    if (s.authTimer !== null) this.clearT(s.authTimer);
    s.authTimer = null;
    this.cancelIdle();
    this.d.contextEngine.clearKind('Deployment');
    this.d.contextEngine.clearKind('Pod');
    this.session = null;
    console.info('[WatchManager] stop session', s.id, reason);
  }

  setNamespaces(namespaces: string[]): void {
    this.lastNamespaces = [...namespaces];
    const s = this.liveSession();
    if (s) this.applyNamespaces(s);
  }

  /** True when `senderId` is the bound, live subscriber of a live session (renderer rebind backstop). */
  isBoundTo(senderId: number): boolean {
    return !!this.liveSession() && this.bound && !!this.subscriber && this.subscriber.id === senderId && !this.subscriber.isDestroyed();
  }

  ensureFresh(maxSilenceMs: number): void {
    const s = this.liveSession();
    if (!s) return;
    for (const kind of LISTED_KINDS) {
      s.scopes[kind].restartAuthFailed();
      s.scopes[kind].ensureFresh(maxSilenceMs);
    }
    // Only the 401 give-up is recovered on focus; other terminal pod errors wait for a re-select.
    if (this.pods.isAuthFailed()) this.pods.recover();
    else if (!this.pods.isErrored()) this.pods.refresh(maxSilenceMs);
  }

  onCredentialsChanged(): void {
    const s = this.liveSession();
    if (!s) return;
    if (!this.rebuildKc(s)) return;
    for (const kind of LISTED_KINDS) {
      s.scopes[kind].restartAll();
      s.scopes[kind].retryCluster();
    }
    if (this.pods.mode === 'namespaced') this.pods.recover('cluster', []);
    else this.pods.recover();
  }

  onPodWorkerMessage(msg: WorkerOutboundV2): void {
    this.pods.onMessage(msg);
  }

  onPodWorkerRespawned(): void {
    this.pods.onRespawned();
  }

  onRendererNavigated(): void {
    if (!this.session) return;
    this.bound = false;
    this.armIdle();
  }

  detachSubscriber(senderId: number): void {
    if (!this.session || (this.subscriber && this.subscriber.id !== senderId)) return;
    this.bound = false;
    this.armIdle();
  }

  async getDiagnostics(): Promise<Omit<ResourceCacheDiagnostics, 'invokeCounts' | 'handlersRegistered'>> {
    const s = this.liveSession();
    const counts = { deployments: 0, pods: 0, secrets: 0, configmaps: 0, services: 0, helmreleases: 0 } as Record<CoreKind, number>;
    const listCalls = { deployments: { runs: 0, pages: 0 }, services: { runs: 0, pages: 0 }, configmaps: { runs: 0, pages: 0 }, secrets: { runs: 0, pages: 0 } };
    const helmDiag = s?.helm.getDiagnostics() ?? { helmDecodeCacheSize: 0, helmFallbackFetchesInFlight: 0, hasTimer: false };
    if (s) {
      for (const kind of LISTED_KINDS) {
        counts[kind] = s.scopes[kind].count();
        listCalls[kind] = s.scopes[kind].listCalls();
      }
      counts.helmreleases = s.helm.releaseCount();
    }
    const podWorker = await this.pods.getDiagnostics();
    if (podWorker) counts.pods = podWorker.podCacheSize;
    const legacy = this.d.getLegacyMapSizes?.() ?? { activeWatchers: 0, watchGenerations: 0, watchResourceVersions: 0, genericWatchGenerations: 0 };
    return {
      sessionId: s?.id ?? null,
      context: s?.context ?? null,
      seq: s?.seq ?? 0,
      lastNamespaces: [...this.lastNamespaces],
      streams: s ? LISTED_KINDS.flatMap((k) => s.scopes[k].diagnostics()) : [],
      counts,
      timers: {
        health: !!s && s.health !== null,
        idle: this.idleTimer !== null,
        coalescer: !!s && s.coalescer.hasTimer(),
        authRebuild: !!s && s.authTimer !== null,
      },
      helmDecodeCacheSize: helmDiag.helmDecodeCacheSize,
      helmFallbackFetchesInFlight: helmDiag.helmFallbackFetchesInFlight,
      pendingTransforms: this.d.pendingTransforms?.() ?? 0,
      podWorker,
      listCalls,
      subscriberBound: this.bound && !!this.subscriber && !this.subscriber.isDestroyed(),
      legacyMaps: legacy,
    };
  }

  // --- internals --------------------------------------------------------------------------

  private liveSession(): Session | null {
    const s = this.session;
    return s && !s.stopped ? s : null;
  }

  private bind(sender: Subscriber): void {
    this.subscriber = sender;
    this.bound = true;
  }

  private armIdle(): void {
    this.cancelIdle();
    this.idleTimer = this.setT(() => {
      this.idleTimer = null;
      this.stopSession('no-subscriber');
    }, IDLE_GRACE_MS);
  }

  private cancelIdle(): void {
    if (this.idleTimer !== null) {
      this.clearT(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private createSession(context: string, kc: KubeConfig): Session {
    const id = `${++this.counter}-${randomUUID().slice(0, 8)}`;
    const partial = { id, context, kc, kcEpoch: 0, seq: 0, stopped: false, health: null, lastAuthRebuildAt: 0, authTimer: null, helmStatus: loadingStatus() } as Omit<Session, 'coalescer' | 'helm' | 'scopes'>;
    const s = partial as Session;
    const isLive = () => this.session === s && !s.stopped;
    s.coalescer = new Coalescer({
      sessionId: id,
      nextSeq: () => ++s.seq,
      getSubscriber: () => (this.bound ? this.subscriber : null),
      setTimeout: this.d.setTimeout,
      clearTimeout: this.d.clearTimeout,
    });
    s.helm = new HelmIndex({
      sendToTransformWorker: this.d.sendToTransformWorker,
      readSecret: async (ns, name) => {
        const raw = this.d.readSecret
          ? await this.d.readSecret(s.kc, ns, name)
          : ((await s.kc.makeApiClient(CoreV1Api).readNamespacedSecret({ name, namespace: ns })) as unknown as RawObject);
        return toWireShape(raw);
      },
      emitUpsert: (i) => { if (isLive()) s.coalescer.upsert('helmreleases', i); },
      emitDelete: (rid) => { if (isLive()) s.coalescer.delete('helmreleases', rid); },
      getSessionId: () => (isLive() ? id : null),
      onPhaseInputsChanged: () => this.updateHelmStatus(s),
      setTimeout: this.d.setTimeout,
      clearTimeout: this.d.clearTimeout,
    });
    const mk = <K extends ListedKind>(kind: K): KindScopes<K> =>
      new KindScopes<K>(kind, {
        create: (scope, onPhase) => {
          const stream: ListWatchStream<K> = new ListWatchStream<K>({
            descriptor: CORE_KIND_DESCRIPTORS[kind] as CoreKindDescriptor<K>,
            scope,
            getKc: () => s.kc,
            hooks: this.hooksFor(kind, s),
            requestAuthRebuild: () => this.requestAuthRebuild(),
            listPage: this.d.listPage ? (kc, sc, o) => this.d.listPage!(kind, kc, sc, o) : undefined,
            watch: this.d.watch,
            now: this.d.now,
            random: this.d.random,
            setTimeout: this.d.setTimeout,
            clearTimeout: this.d.clearTimeout,
            sink: {
              upsert: (item) => { if (isLive()) s.coalescer.upsert(kind, item); },
              delete: (id) => { if (isLive()) s.coalescer.delete(kind, id); },
              phaseChanged: (code) => onPhase(stream, code),
            },
          });
          return stream;
        },
        emitDelete: (id) => { if (isLive()) s.coalescer.delete(kind, id); },
        onIdsDropped: kind === 'secrets' ? (ids) => { for (const id of ids) s.helm.onSecretDeleted(id); } : undefined,
        onStatus: (status) => {
          if (!isLive()) return;
          s.coalescer.setStatus(kind, status);
          if (kind === 'secrets') this.updateHelmStatus(s);
        },
        getNamespaces: () => this.lastNamespaces,
      });
    s.scopes = { deployments: mk('deployments'), services: mk('services'), configmaps: mk('configmaps'), secrets: mk('secrets') };
    return s;
  }

  private hooksFor(kind: ListedKind, s: Session): ListHooks | undefined {
    const ce = this.d.contextEngine;
    const safe = (type: 'ADDED' | 'MODIFIED' | 'DELETED', raw: unknown) => {
      try {
        ce.handleResourceEvent('Deployment', type, raw);
      } catch {
        console.error('[ContextEngine] Error processing deployment event');
      }
    };
    if (kind === 'deployments') {
      return {
        onListPage: (raw) => { for (const r of raw) safe('ADDED', r); },
        onListComplete: (ids, meta) => { for (const id of ids) safe('DELETED', { metadata: { ...meta.get(id) } }); },
        onWatchEvent: (type, raw) => safe(type, raw),
      };
    }
    if (kind === 'secrets') {
      return {
        onListPage: (raw, ctx) => s.helm.onListPage(raw, ctx),
        onListComplete: (ids, _meta, ctx) => s.helm.onListComplete(ids, ctx.first),
        onWatchEvent: (type, raw) => s.helm.onWatchEvent(type, raw),
      };
    }
    return undefined;
  }

  private updateHelmStatus(s: Session): void {
    if (this.session !== s || s.stopped) return;
    const sec = s.scopes.secrets.status;
    const terminal = sec.phase === 'forbidden' || sec.phase === 'error';
    const next: KindStatus = terminal || s.helm.isInitialSettled() ? { ...sec } : { ...loadingStatus(), mode: sec.mode };
    const h = s.helmStatus;
    if (h.phase === next.phase && h.error === next.error && h.mode === next.mode && h.lastSyncedAt === next.lastSyncedAt) return;
    s.helmStatus = next;
    s.coalescer.setStatus('helmreleases', next);
  }

  private async buildSnapshot(session: Session): Promise<ResourceSnapshot> {
    const pods = await this.pods.getSnapshotPods();
    if (session !== this.session || session.stopped) {
      return this.session ? this.buildSnapshot(this.session) : Promise.reject(new Error('Session superseded'));
    }
    const seq = session.seq;
    const sc = session.scopes;
    const podStatus = pods.phase ? { ...this.pods.status, phase: pods.phase } : { ...this.pods.status };
    return {
      sessionId: session.id,
      context: session.context,
      seq,
      kinds: {
        deployments: { items: sc.deployments.items(), status: { ...sc.deployments.status } },
        services: { items: sc.services.items(), status: { ...sc.services.status } },
        configmaps: { items: sc.configmaps.items(), status: { ...sc.configmaps.status } },
        secrets: { items: sc.secrets.items(), status: { ...sc.secrets.status } },
        helmreleases: { items: session.helm.items(), status: { ...session.helmStatus } },
        pods: { items: pods.pods, status: podStatus },
      },
    };
  }

  private applyNamespaces(s: Session): void {
    for (const kind of LISTED_KINDS) s.scopes[kind].setNamespaces(this.lastNamespaces);
    if (this.pods.mode !== 'namespaced') return;
    if (this.lastNamespaces.includes('all')) this.pods.setForbiddenAll();
    else if (this.lastNamespaces.join(',') !== this.pods.namespaces.join(',') || this.pods.status.phase === 'forbidden') {
      this.pods.startInformer('namespaced', this.lastNamespaces);
    }
  }

  private onPodsClusterForbidden(): void {
    if (!this.liveSession()) return;
    if (this.lastNamespaces.includes('all')) this.pods.setForbiddenAll();
    else this.pods.startInformer('namespaced', this.lastNamespaces);
  }

  /** Same-context startSession: terminal-error recovery + one-shot cluster retry. */
  private recoverSession(s: Session): void {
    const errored = LISTED_KINDS.some((k) => s.scopes[k].hasError()) || this.pods.isErrored();
    if (errored) {
      let kc: KubeConfig;
      try {
        kc = this.d.createKubeConfig(s.context);
      } catch (err) {
        console.warn('[WatchManager] recovery createKubeConfig failed', (err as Error)?.name);
        throw new Error(contextErrorMessage(err));
      }
      s.kc = kc;
      s.kcEpoch++;
      for (const kind of LISTED_KINDS) s.scopes[kind].restartErrored();
      if (this.pods.isErrored()) this.pods.recover();
    }
    for (const kind of LISTED_KINDS) s.scopes[kind].retryCluster();
    if (this.pods.mode === 'namespaced') this.pods.recover('cluster', []);
  }

  private resyncContextEngine(s: Session): void {
    for (const d of s.scopes.deployments.items()) {
      try {
        this.d.contextEngine.handleResourceEvent('Deployment', 'ADDED', d);
      } catch {
        console.error('[ContextEngine] Error replaying deployment');
      }
    }
    void this.pods.resyncContextEngine();
  }

  /** At most one rebuild per 10 s per session, shared by every stream and the pod adapter. */
  private requestAuthRebuild(): void {
    const s = this.liveSession();
    if (!s || s.authTimer !== null) return;
    const wait = s.lastAuthRebuildAt + AUTH_REBUILD_MS - this.now();
    if (s.lastAuthRebuildAt === 0 || wait <= 0) {
      this.rebuildKc(s);
      return;
    }
    s.authTimer = this.setT(() => {
      s.authTimer = null;
      if (this.liveSession() === s) this.rebuildKc(s);
    }, wait);
  }

  private rebuildKc(s: Session): boolean {
    s.lastAuthRebuildAt = this.now();
    try {
      s.kc = this.d.createKubeConfig(s.context);
      s.kcEpoch++;
      return true;
    } catch (err) {
      const msg = contextErrorMessage(err);
      console.warn('[WatchManager] auth rebuild failed', (err as Error)?.name);
      for (const kind of LISTED_KINDS) s.scopes[kind].haltAll(msg);
      this.pods.halt(msg);
      return false;
    }
  }

  private checkHealth(): void {
    const s = this.liveSession();
    if (!s) return;
    const t = this.now();
    for (const kind of LISTED_KINDS) s.scopes[kind].checkHealth(t);
  }
}
