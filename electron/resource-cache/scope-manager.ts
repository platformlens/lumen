/**
 * Per-kind scope management for the four main-process kinds (design §3.7 "Mode switching").
 *
 * A kind starts with one cluster-wide stream. A cluster-scope 403 switches it to one stream per
 * selected namespace (or `forbidden` while `['all']` is selected). A one-shot cluster retry can
 * adopt the kind back into cluster mode.
 */
import type { KindItemMap, KindStatus, ListedKind, StreamDiagnostics } from '../../src/types/resource-cache';
import { clusterForbiddenMessage, kindLabel } from './kinds';
import type { ListWatchStream } from './list-watch';

export interface KindScopesDeps<K extends ListedKind> {
  /** Create (not start) a stream; `onPhase` must be called from the stream's sink.phaseChanged. */
  create(scope: string, onPhase: (stream: ListWatchStream<K>, code?: number) => void): ListWatchStream<K>;
  emitDelete(id: string): void;
  /** Ids removed from the kind because their stream went away (not by a LIST/WATCH). */
  onIdsDropped?(ids: string[]): void;
  onStatus(status: KindStatus): void;
  getNamespaces(): string[];
}

const initial = (): KindStatus => ({ phase: 'loading', error: null, lastSyncedAt: null, mode: 'cluster' });

export class KindScopes<K extends ListedKind> {
  mode: 'cluster' | 'namespaced' = 'cluster';
  status: KindStatus = initial();
  private streams = new Map<string, ListWatchStream<K>>();
  private retry: ListWatchStream<K> | null = null;
  private forbiddenAll = false;
  private retired = { runs: 0, pages: 0 };
  private readonly onPhase = (s: ListWatchStream<K>, code?: number) => this.onStreamPhase(s, code);

  constructor(readonly kind: K, private readonly d: KindScopesDeps<K>) {}

  start(): void {
    this.addStream('*');
  }

  stopAll(): void {
    for (const s of this.streams.values()) this.retire(s);
    this.streams.clear();
    if (this.retry) this.retire(this.retry);
    this.retry = null;
  }

  restartAll(): void {
    for (const s of this.streams.values()) s.restart();
  }

  /** Restart streams in phase `error` (401 give-up, failed rebuild, 404). Ready streams are untouched. */
  restartErrored(): void {
    for (const s of this.streams.values()) if (s.phase === 'error') s.restart();
  }

  restartAuthFailed(): void {
    for (const s of this.streams.values()) if (s.isAuthFailed()) s.restart();
  }

  haltAll(error: string): void {
    for (const s of this.streams.values()) s.halt(error);
    this.recompute();
  }

  hasError(): boolean {
    return [...this.streams.values()].some((s) => s.phase === 'error');
  }

  ensureFresh(ms: number): void {
    for (const s of this.streams.values()) s.ensureFresh(ms);
  }

  checkHealth(now: number): void {
    for (const s of this.streams.values()) s.checkHealth(now);
    this.retry?.checkHealth(now);
  }

  items(): KindItemMap[K][] {
    const out = new Map<string, KindItemMap[K]>();
    for (const s of this.streams.values()) for (const it of s.items()) out.set(it.id, it);
    return [...out.values()];
  }

  count(): number {
    let n = 0;
    for (const s of this.streams.values()) n += s.ownedSize();
    return n;
  }

  diagnostics(): StreamDiagnostics[] {
    const out = [...this.streams.values()].map((s) => s.getDiagnostics());
    if (this.retry) out.push(this.retry.getDiagnostics());
    return out;
  }

  listCalls(): { runs: number; pages: number } {
    let runs = this.retired.runs;
    let pages = this.retired.pages;
    for (const s of [...this.streams.values(), ...(this.retry ? [this.retry] : [])]) {
      runs += s.listRuns;
      pages += s.listPages;
    }
    return { runs, pages };
  }

  /** Cluster-mode kinds ignore namespace changes. */
  setNamespaces(namespaces: string[]): void {
    if (this.mode !== 'namespaced') return;
    if (namespaces.includes('all')) {
      for (const s of this.streams.values()) this.dropStream(s);
      this.streams.clear();
      this.forbiddenAll = true;
      this.recompute();
      return;
    }
    this.forbiddenAll = false;
    const want = new Set(namespaces);
    for (const [scope, s] of [...this.streams]) {
      if (!want.has(scope)) {
        this.dropStream(s);
        this.streams.delete(scope);
      }
    }
    for (const ns of want) if (!this.streams.has(ns)) this.addStream(ns);
    this.recompute();
  }

  /** One-shot cluster-scope retry for a namespaced kind (credentials change / same-context re-select). */
  retryCluster(): void {
    if (this.mode !== 'namespaced' || this.retry) return;
    const s = this.d.create('*', this.onPhase);
    this.retry = s;
    s.start();
  }

  // --- internals ----------------------------------------------------------------------

  private addStream(scope: string): void {
    const s = this.d.create(scope, this.onPhase);
    this.streams.set(scope, s);
    s.start();
  }

  private retire(s: ListWatchStream<K>): void {
    s.stop();
    this.retired.runs += s.listRuns;
    this.retired.pages += s.listPages;
  }

  /** Stop a stream and emit deletes for everything it owned. */
  private dropStream(s: ListWatchStream<K>): void {
    const ids = s.ownedIds();
    this.retire(s);
    for (const id of ids) this.d.emitDelete(id);
    if (ids.length) this.d.onIdsDropped?.(ids);
  }

  private onStreamPhase(s: ListWatchStream<K>, code?: number): void {
    if (s === this.retry) {
      if (s.phase === 'ready') this.adoptRetry(s);
      else if (s.phase === 'forbidden' || s.phase === 'error') {
        console.info('[WatchManager] cluster retry failed, staying namespaced', this.kind);
        this.retire(s);
        this.retry = null;
      }
      return;
    }
    if (s.isStopped()) return;
    if (this.mode === 'cluster' && s.scope === '*' && s.phase === 'forbidden' && code === 403) {
      console.info('[WatchManager] cluster-wide 403, switching to namespaced', this.kind);
      // A WATCH-time / re-LIST 403 leaves the stream owning items: emit their deletes.
      this.dropStream(s);
      this.streams.clear();
      this.mode = 'namespaced';
      this.setNamespaces(this.d.getNamespaces());
      return;
    }
    this.recompute();
  }

  private adoptRetry(cluster: ListWatchStream<K>): void {
    const keep = new Set(cluster.ownedIds());
    const dropped: string[] = [];
    for (const s of this.streams.values()) {
      for (const id of s.ownedIds()) if (!keep.has(id)) dropped.push(id);
      this.retire(s);
    }
    for (const id of dropped) this.d.emitDelete(id);
    if (dropped.length) this.d.onIdsDropped?.(dropped);
    this.streams = new Map([['*', cluster]]);
    this.retry = null;
    this.mode = 'cluster';
    this.forbiddenAll = false;
    this.recompute();
  }

  private recompute(): void {
    const next = this.aggregate();
    const s = this.status;
    if (s.phase === next.phase && s.error === next.error && s.mode === next.mode && s.lastSyncedAt === next.lastSyncedAt) return;
    this.status = next;
    this.d.onStatus(next);
  }

  private aggregate(): KindStatus {
    const streams = [...this.streams.values()];
    const lastSyncedAt = streams.reduce<number | null>((m, s) => (s.lastSyncedAt !== null && (m === null || s.lastSyncedAt > m) ? s.lastSyncedAt : m), null);
    if (this.mode === 'namespaced' && (this.forbiddenAll || streams.length === 0)) {
      return { phase: 'forbidden', error: clusterForbiddenMessage(this.kind), lastSyncedAt, mode: 'namespaced' };
    }
    if (this.mode === 'cluster') {
      const s = streams[0];
      return { phase: s?.phase ?? 'loading', error: s?.error ?? null, lastSyncedAt, mode: 'cluster' };
    }
    const forbidden = streams.filter((s) => s.phase === 'forbidden').map((s) => s.scope);
    const nsError = forbidden.length ? `No permission to list ${kindLabel(this.kind)} in: ${forbidden.join(', ')}` : null;
    if (forbidden.length === streams.length) return { phase: 'forbidden', error: nsError, lastSyncedAt, mode: 'namespaced' };
    const phases = streams.filter((s) => s.phase !== 'forbidden').map((s) => s.phase);
    const firstErr = streams.find((s) => s.phase === 'error' || s.phase === 'reconnecting')?.error ?? null;
    const phase = phases.includes('ready') ? 'ready' : phases.includes('loading') ? 'loading' : phases.includes('reconnecting') ? 'reconnecting' : 'error';
    return { phase, error: nsError ?? (phase === 'ready' ? null : firstErr), lastSyncedAt, mode: 'namespaced' };
  }
}
