/**
 * ListWatchStream (design §3.4): one (kind, scope) LIST + WATCH loop.
 *
 * - Paginated LIST, trimmed into a temp map, diffed against the owned map (emits deletes, fixes D2).
 * - WATCH from the list resourceVersion with bookmarks and a randomized timeoutSeconds.
 * - Attempt epoch: every async continuation checks `stopped` and `epoch`; a controller that resolves
 *   after stop/restart is aborted at once, so no socket outlives its stream.
 * - At most one timer and one controller per stream.
 * - The KubeConfig is read from `getKc()` on every attempt and never cached.
 */
import { Watch, type KubeConfig } from '@kubernetes/client-node';
import type { KindItemMap, KindPhase, ListedKind, StreamDiagnostics } from '../../src/types/resource-cache';
import {
  AUTH_FAILED_MESSAGE,
  extractStatusCode,
  mapStatusToMessage,
  toWireShape,
  type CoreKindDescriptor,
  type ListHooks,
  type ListPageOptions,
  type ListPageResult,
  type RawObject,
} from './kinds';

export type WatchParams = Record<string, string | number | boolean | undefined>;
export type WatchFn = (
  kc: KubeConfig,
  path: string,
  params: WatchParams,
  onEvent: (type: string, obj: unknown) => void,
  onDone: (err: unknown) => void,
) => Promise<AbortController>;
export type ListPageFn = (kc: KubeConfig, scope: string, opts: ListPageOptions) => Promise<ListPageResult>;

export const defaultWatch: WatchFn = (kc, path, params, onEvent, onDone) => new Watch(kc).watch(path, params, onEvent, onDone);

export interface StreamSink<K extends ListedKind> {
  upsert(item: KindItemMap[K]): void;
  delete(id: string): void;
  /** Phase or error changed. `code` is the numeric status that caused it, if any. */
  phaseChanged(code?: number): void;
}

export interface ListWatchStreamDeps<K extends ListedKind> {
  descriptor: CoreKindDescriptor<K>;
  scope: string;
  getKc(): KubeConfig;
  sink: StreamSink<K>;
  hooks?: ListHooks;
  requestAuthRebuild(): void;
  listPage?: ListPageFn;
  watch?: WatchFn;
  now?: () => number;
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
}

export const HEALTH_SILENCE_MS = 5 * 60_000;
export const FRESH_FLOOR_MS = 660_000;
const NORMAL_REWATCH_MS = 500;
const FAST_CLOSE_MS = 5000;
const MAX_BACKOFF_MS = 30_000;

export function backoffDelay(attempts: number, random: () => number = Math.random): number {
  return Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS) * (0.8 + 0.4 * random());
}

export class ListWatchStream<K extends ListedKind> {
  readonly kind: K;
  readonly scope: string;
  phase: KindPhase = 'loading';
  error: string | null = null;
  lastSyncedAt: number | null = null;
  lastEventAt: number | null = null;
  listRuns = 0;
  listPages = 0;

  private owned = new Map<string, KindItemMap[K]>();
  private ownedMeta = new Map<string, { name: string; namespace?: string }>();
  private rv: string | undefined;
  private epoch = 0;
  private stopped = false;
  private connecting = false;
  private listing = false;
  private listedOnce = false;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private authFailures = 0;
  private connectedAt = 0;
  private eventsSinceConnect = 0;

  private readonly d: ListWatchStreamDeps<K>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setT: NonNullable<ListWatchStreamDeps<K>['setTimeout']>;
  private readonly clearT: NonNullable<ListWatchStreamDeps<K>['clearTimeout']>;
  private readonly listPageFn: ListPageFn;
  private readonly watchFn: WatchFn;

  constructor(deps: ListWatchStreamDeps<K>) {
    this.d = deps;
    this.kind = deps.descriptor.kind;
    this.scope = deps.scope;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((t) => clearTimeout(t));
    this.listPageFn = deps.listPage ?? ((kc, scope, opts) => deps.descriptor.listPage(kc, scope, opts));
    this.watchFn = deps.watch ?? defaultWatch;
  }

  // --- public API ---------------------------------------------------------------

  start(): void {
    if (this.stopped) return;
    void this.runList();
  }

  stop(): void {
    this.stopped = true;
    this.epoch++;
    this.abortController();
    this.clearTimer();
    this.connecting = false;
    this.listing = false;
  }

  /** Epoch bump, abort, counters reset, fresh LIST with diff. */
  restart(): void {
    if (this.stopped) return;
    this.epoch++;
    this.abortController();
    this.clearTimer();
    this.connecting = false;
    this.attempts = 0;
    this.authFailures = 0;
    void this.runList();
  }

  /** Stop retrying and show `error`, without the permanent stop: restart() can resume it. */
  halt(error: string): void {
    if (this.stopped) return;
    this.epoch++;
    this.abortController();
    this.clearTimer();
    this.connecting = false;
    this.listing = false;
    this.setPhase('error', error);
  }

  isStopped(): boolean {
    return this.stopped;
  }

  /** True when the stream gave up after three consecutive 401s. */
  isAuthFailed(): boolean {
    return this.phase === 'error' && this.error === AUTH_FAILED_MESSAGE;
  }

  hasCompletedList(): boolean {
    return this.listedOnce;
  }

  items(): IterableIterator<KindItemMap[K]> {
    return this.owned.values();
  }

  ownedIds(): string[] {
    return [...this.owned.keys()];
  }

  ownedSize(): number {
    return this.owned.size;
  }

  /** 60 s session interval: re-watch after 5 minutes of silence. */
  checkHealth(now: number = this.now()): void {
    if (!this.canProbe()) return;
    if (now - (this.lastEventAt as number) > HEALTH_SILENCE_MS) this.rewatch();
  }

  ensureFresh(maxSilenceMs: number): void {
    if (!this.canProbe()) return;
    const threshold = maxSilenceMs === 0 ? 0 : Math.max(maxSilenceMs, FRESH_FLOOR_MS);
    if (threshold === 0 || this.now() - (this.lastEventAt as number) > threshold) this.rewatch();
  }

  getDiagnostics(): StreamDiagnostics {
    return {
      kind: this.kind,
      scope: this.scope,
      phase: this.phase,
      connecting: this.connecting,
      hasController: this.controller !== null,
      hasTimer: this.timer !== null,
      lastEventAt: this.lastEventAt,
      epoch: this.epoch,
    };
  }

  // --- LIST -----------------------------------------------------------------------

  private async runList(): Promise<void> {
    if (this.stopped) return;
    const myEpoch = ++this.epoch;
    this.abortController();
    this.clearTimer();
    this.listing = true;
    this.listRuns++;
    const first = !this.listedOnce;
    let temp = new Map<string, KindItemMap[K]>();
    let tempMeta = new Map<string, { name: string; namespace?: string }>();
    let continueToken: string | undefined;
    let restartedOnce = false;
    let listRv: string | undefined;
    const live = () => !this.stopped && myEpoch === this.epoch;

    for (;;) {
      let page: ListPageResult;
      try {
        page = await this.listPageFn(this.d.getKc(), this.scope, { limit: this.d.descriptor.pageSize, continueToken });
      } catch (err) {
        if (!live()) return;
        if (extractStatusCode(err) === 410 && continueToken && !restartedOnce) {
          console.info('[ListWatch] continue token expired, restarting LIST', this.kind);
          restartedOnce = true;
          continueToken = undefined;
          temp = new Map();
          tempMeta = new Map();
          continue;
        }
        this.listing = false;
        this.handleFailure(err);
        return;
      }
      if (!live()) return; // superseded page: discarded before hooks
      this.listPages++;
      const raw = page.items.map((i) => toWireShape(i)) as RawObject[];
      this.d.hooks?.onListPage?.(raw, { first });
      for (const obj of raw) {
        const item = this.d.descriptor.trim(obj);
        temp.set(item.id, item);
        tempMeta.set(item.id, { name: item.name, namespace: item.namespace || undefined });
        if (first) {
          this.owned.set(item.id, item);
          this.ownedMeta.set(item.id, { name: item.name, namespace: item.namespace || undefined });
          this.d.sink.upsert(item);
        }
      }
      listRv = page.resourceVersion;
      continueToken = page.continueToken;
      if (!continueToken) break;
    }

    // Diff against what the renderer has been told.
    const deletedIds: string[] = [];
    const deletedMeta = new Map<string, { name: string; namespace?: string }>();
    for (const [id, meta] of this.ownedMeta) {
      if (!temp.has(id)) {
        deletedIds.push(id);
        deletedMeta.set(id, meta);
        this.d.sink.delete(id);
      }
    }
    if (!first) {
      for (const [id, item] of temp) {
        const prev = this.owned.get(id);
        if (!prev || prev.metadata.resourceVersion !== item.metadata.resourceVersion) this.d.sink.upsert(item);
      }
    }
    this.owned = temp;
    this.ownedMeta = tempMeta;
    this.rv = listRv;
    this.listing = false;
    this.listedOnce = true;
    this.attempts = 0;
    this.authFailures = 0;
    const t = this.now();
    this.lastSyncedAt = t;
    this.lastEventAt = t;
    this.setPhase('ready', null);
    this.d.hooks?.onListComplete?.(deletedIds, deletedMeta, { first });
    if (live()) void this.startWatch();
  }

  // --- WATCH ----------------------------------------------------------------------

  private async startWatch(): Promise<void> {
    if (this.stopped) return;
    if (this.rv === undefined) {
      void this.runList();
      return;
    }
    this.clearTimer();
    const attempt = { epoch: ++this.epoch, done: false };
    const live = () => !this.stopped && attempt.epoch === this.epoch;
    this.connecting = true;
    const params: WatchParams = {
      allowWatchBookmarks: true,
      resourceVersion: this.rv,
      timeoutSeconds: 300 + Math.floor(this.random() * 300),
    };
    let ctrl: AbortController;
    try {
      ctrl = await this.watchFn(
        this.d.getKc(),
        this.d.descriptor.watchPath(this.scope),
        params,
        (type, obj) => {
          if (!live()) return;
          this.onEvent(type, obj);
        },
        (err) => {
          attempt.done = true;
          if (!live()) return;
          this.onDone(err);
        },
      );
    } catch (err) {
      if (attempt.epoch === this.epoch) this.connecting = false;
      if (live()) this.onDone(err ?? new Error('watch failed'));
      return;
    }
    if (attempt.epoch === this.epoch) this.connecting = false;
    if (!live() || attempt.done) {
      ctrl.abort();
      return;
    }
    this.controller = ctrl;
    this.connectedAt = this.now();
    this.eventsSinceConnect = 0;
    this.lastEventAt = this.connectedAt;
  }

  private onEvent(type: string, obj: unknown): void {
    this.lastEventAt = this.now();
    const raw = obj as RawObject | null;
    if (type === 'ERROR') {
      // ERROR events are failures, not progress: they must not reset the backoff/auth counters.
      const code = typeof (obj as { code?: unknown })?.code === 'number' ? (obj as { code: number }).code : undefined;
      if (code === 410) {
        console.info('[ListWatch] 410 on watch, re-listing', this.kind);
        this.rv = undefined;
        void this.runList();
        return;
      }
      this.epoch++;
      this.abortController();
      this.handleFailure({ code });
      return;
    }
    // Successful progress (ADDED/MODIFIED/DELETED/BOOKMARK) resets the retry counters.
    this.eventsSinceConnect++;
    this.attempts = 0;
    this.authFailures = 0;
    const newRv = raw?.metadata?.resourceVersion;
    if (type === 'BOOKMARK') {
      if (newRv) this.rv = newRv;
      return;
    }
    if (!raw || (type !== 'ADDED' && type !== 'MODIFIED' && type !== 'DELETED')) return;
    this.d.hooks?.onWatchEvent?.(type, raw);
    if (type === 'DELETED') {
      const id = this.d.descriptor.id(raw);
      this.owned.delete(id);
      this.ownedMeta.delete(id);
      this.d.sink.delete(id);
    } else {
      const item = this.d.descriptor.trim(raw);
      this.owned.set(item.id, item);
      this.ownedMeta.set(item.id, { name: item.name, namespace: item.namespace || undefined });
      this.d.sink.upsert(item);
    }
    if (newRv) this.rv = newRv;
    if (this.phase === 'reconnecting') this.setPhase('ready', null);
  }

  private onDone(err: unknown): void {
    this.controller = null;
    if (err === null || err === undefined) {
      const healthy = this.now() - this.connectedAt >= FAST_CLOSE_MS || this.eventsSinceConnect > 0;
      if (healthy) {
        this.schedule(NORMAL_REWATCH_MS);
        return;
      }
      this.handleFailure(null); // fast close: proxy / LB / APF rejection
      return;
    }
    if (extractStatusCode(err) === 410) {
      console.info('[ListWatch] 410 on watch, re-listing', this.kind);
      this.rv = undefined;
      void this.runList();
      return;
    }
    this.handleFailure(err);
  }

  // --- failures -------------------------------------------------------------------

  private handleFailure(err: unknown): void {
    if (this.stopped) return;
    const code = extractStatusCode(err);
    if (code === 401) {
      this.authFailures++;
      console.warn('[ListWatch] 401', this.kind);
      const ep = this.epoch;
      this.d.requestAuthRebuild();
      if (this.stopped || this.epoch !== ep) return; // the rebuild failed and halted this stream
      if (this.authFailures >= 3) {
        console.error('[ListWatch] auth failed 3 times, giving up', this.kind);
        this.setPhase('error', AUTH_FAILED_MESSAGE, 401);
        return;
      }
      this.rv = undefined; // re-LIST after the rebuild
      this.setPhase('reconnecting', this.error, 401);
      this.schedule(backoffDelay(this.authFailures - 1, this.random));
      return;
    }
    if (code === 403) {
      console.info('[ListWatch] 403', this.kind, this.scope === '*' ? 'cluster' : 'namespace');
      this.setPhase('forbidden', mapStatusToMessage(err, this.kind), 403);
      return;
    }
    if (code === 404) {
      console.error('[ListWatch] 404', this.kind);
      this.setPhase('error', mapStatusToMessage(err, this.kind), 404);
      return;
    }
    const delay = backoffDelay(this.attempts, this.random);
    this.attempts++;
    if (this.attempts === 1 || this.attempts % 10 === 0) console.warn('[ListWatch] failure', this.kind, code ?? 'network', 'attempt', this.attempts);
    if (this.attempts >= 3) this.rv = undefined; // 3 strikes: next attempt is a LIST
    this.setPhase('reconnecting', null, code);
    this.schedule(delay);
  }

  private schedule(ms: number): void {
    this.clearTimer();
    const myEpoch = this.epoch;
    this.timer = this.setT(() => {
      this.timer = null;
      if (this.stopped || myEpoch !== this.epoch) return;
      if (this.rv === undefined) void this.runList();
      else void this.startWatch();
    }, ms);
  }

  // --- helpers --------------------------------------------------------------------

  private canProbe(): boolean {
    return !this.stopped && this.lastEventAt !== null && !this.connecting && !this.listing && this.timer === null && this.controller !== null;
  }

  private rewatch(): void {
    this.epoch++;
    this.abortController();
    void this.startWatch();
  }

  private abortController(): void {
    if (this.controller) {
      const c = this.controller;
      this.controller = null;
      c.abort();
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clearT(this.timer);
      this.timer = null;
    }
  }

  private setPhase(phase: KindPhase, error: string | null, code?: number): void {
    if (this.phase === phase && this.error === error) return;
    this.phase = phase;
    this.error = error;
    this.d.sink.phaseChanged(code);
  }
}
