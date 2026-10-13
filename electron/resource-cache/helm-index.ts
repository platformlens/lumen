/**
 * HelmIndex (design §3.5): Helm releases derived from the core Secrets stream.
 *
 * - Keeps labels/rv/summary per helm secret; never retains raw secrets beyond the decode post.
 * - Decodes only the max revision of a release, and only with the raw in hand.
 * - Label-derived fallback summary whenever the max revision has no decoded summary.
 * - Guarded on-demand `readSecret` fetch when a never-decoded revision becomes max.
 * - One instance per session; results from another session or after clear() are dropped.
 */
import type { HelmReleaseItem } from '../../src/types/resource-cache';
import type { TransformRequest, TransformResponse } from '../resource-transform-worker';
import { extractStatusCode, HELM_SECRET_TYPE, toWireShape, type RawObject } from './kinds';

export const HELM_DECODE_BATCH = 50;
export const HELM_WATCH_DECODE_MS = 650;

type DecodeState = 'none' | 'pending' | 'failed';

export interface HelmEntry {
  uid: string;
  releaseId: string;
  revision: number;
  rv: string;
  name: string;
  namespace: string;
  creationTimestamp: string;
  labelStatus?: string;
  /** No label/name parse was possible; release identity comes from the decode. */
  unparsed: boolean;
  summary: HelmReleaseItem | null;
  decodeState: DecodeState;
  corrupt: boolean;
  retryOnce: boolean;
}

export interface HelmIndexDeps {
  sendToTransformWorker(req: TransformRequest): Promise<TransformResponse>;
  readSecret(namespace: string, name: string): Promise<RawObject>;
  emitUpsert(item: HelmReleaseItem): void;
  emitDelete(releaseId: string): void;
  /** The live session id, or null once the session stopped. */
  getSessionId(): string | null;
  /** Called when the inputs of the helm phase (first list / initial decodes) change. */
  onPhaseInputsChanged?(): void;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
}

interface Queued { uid: string; rv: string; raw: RawObject }

const NAME_RE = /^sh\.helm\.release\.v1\.(.+)\.v(\d+)$/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export class HelmIndex {
  private bySecretUid = new Map<string, HelmEntry>();
  private byRelease = new Map<string, Set<string>>();
  private emitted = new Map<string, { key: string; item: HelmReleaseItem }>();
  private fetchInFlight = new Map<string, { uid: string; rv: string; sessionId: string; token: number }>();
  private watchQueue = new Map<string, Queued>();
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private warned = new Set<string>();
  private gen = 0;
  private reqCounter = 0;
  private fetchToken = 0;
  private firstListComplete = false;
  private initialDecodesPending = 0;
  private readonly setT: NonNullable<HelmIndexDeps['setTimeout']>;
  private readonly clearT: NonNullable<HelmIndexDeps['clearTimeout']>;

  constructor(private readonly deps: HelmIndexDeps) {
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((t) => clearTimeout(t));
  }

  // --- entry points ----------------------------------------------------------------

  /** Secrets LIST page hook. Decode requests for the page are posted before returning. */
  onListPage(rawItems: RawObject[], ctx: { first: boolean }): void {
    const queue = new Map<string, Queued>();
    for (const raw of rawItems) {
      if (raw.type !== HELM_SECRET_TYPE) continue;
      this.ingest(raw, queue);
    }
    this.postQueue(queue, ctx.first);
  }

  /** Secrets LIST complete hook. */
  onListComplete(deletedIds: string[], first: boolean): void {
    for (const id of deletedIds) this.onSecretDeleted(id);
    if (first) this.onFirstListComplete();
  }

  /** Secrets WATCH event hook. */
  onWatchEvent(type: 'ADDED' | 'MODIFIED' | 'DELETED', raw: RawObject): void {
    if (raw.type !== HELM_SECRET_TYPE) return;
    if (type === 'DELETED') {
      const uid = str(raw.metadata?.uid);
      if (uid) this.onSecretDeleted(uid);
      return;
    }
    this.ingest(raw, this.watchQueue);
    if (this.watchQueue.size > 0 && this.watchTimer === null) {
      this.watchTimer = this.setT(() => {
        this.watchTimer = null;
        const q = this.watchQueue;
        this.watchQueue = new Map();
        this.postQueue(q, false);
      }, HELM_WATCH_DECODE_MS);
    }
  }

  onSecretDeleted(uid: string): void {
    const e = this.bySecretUid.get(uid);
    if (!e) return;
    this.bySecretUid.delete(uid);
    this.watchQueue.delete(uid);
    this.removeFromRelease(e.releaseId, uid);
    this.recompute(e.releaseId, uid);
  }

  onFirstListComplete(): void {
    this.firstListComplete = true;
    this.deps.onPhaseInputsChanged?.();
  }

  /** True once the first Secrets LIST completed and all of its decodes settled. */
  isInitialSettled(): boolean {
    return this.firstListComplete && this.initialDecodesPending === 0;
  }

  /** Drop everything. With `emit`, deletes are emitted for every shown release. */
  clear(opts: { emit: boolean }): void {
    this.gen++;
    if (opts.emit) for (const rid of this.emitted.keys()) this.deps.emitDelete(rid);
    this.bySecretUid.clear();
    this.byRelease.clear();
    this.emitted.clear();
    this.fetchInFlight.clear();
    this.watchQueue.clear();
    if (this.watchTimer !== null) {
      this.clearT(this.watchTimer);
      this.watchTimer = null;
    }
    this.firstListComplete = false;
    this.initialDecodesPending = 0;
  }

  getDiagnostics(): { helmDecodeCacheSize: number; helmFallbackFetchesInFlight: number; hasTimer: boolean } {
    let cached = 0;
    for (const e of this.bySecretUid.values()) if (e.summary) cached++;
    return { helmDecodeCacheSize: cached, helmFallbackFetchesInFlight: this.fetchInFlight.size, hasTimer: this.watchTimer !== null };
  }

  /** Test/diagnostic accessor. */
  entry(uid: string): Readonly<HelmEntry> | undefined {
    return this.bySecretUid.get(uid);
  }

  releaseCount(): number {
    return this.emitted.size;
  }

  /** Currently shown releases (for snapshots). */
  items(): HelmReleaseItem[] {
    return [...this.emitted.values()].map((e) => e.item);
  }

  // --- ingest / recompute ------------------------------------------------------------

  private ingest(raw: RawObject, queue: Map<string, Queued>): void {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    const uid = str(meta.uid);
    if (!uid) return;
    const name = str(meta.name);
    const namespace = str(meta.namespace);
    const rv = str(meta.resourceVersion);
    const labels = (meta.labels ?? {}) as Record<string, unknown>;
    let releaseName = str(labels.name);
    let revision = Number.parseInt(str(labels.version), 10);
    if (!releaseName || !Number.isFinite(revision)) {
      const m = NAME_RE.exec(name);
      if (m) {
        releaseName = m[1];
        revision = Number.parseInt(m[2], 10);
      }
    }
    const unparsed = !releaseName || !Number.isFinite(revision);
    const releaseId = unparsed ? `${namespace}/?${uid}` : `${namespace}/${releaseName}`;
    let e = this.bySecretUid.get(uid);
    if (e && e.unparsed && !unparsed) e = undefined; // treat as new identity
    if (e) {
      if (e.rv !== rv) {
        e.summary = null;
        e.decodeState = 'none';
        e.corrupt = false;
        e.retryOnce = false;
      }
      e.rv = rv;
      e.labelStatus = str(labels.status) || undefined;
      e.creationTimestamp = str(meta.creationTimestamp);
      if (!e.unparsed && e.releaseId !== releaseId) {
        this.removeFromRelease(e.releaseId, uid);
        const old = e.releaseId;
        e.releaseId = releaseId;
        e.revision = revision;
        this.addToRelease(releaseId, uid);
        this.recompute(old);
      } else if (!e.unparsed) {
        e.revision = revision;
      }
    } else {
      const prev = this.bySecretUid.get(uid);
      if (prev) this.removeFromRelease(prev.releaseId, uid);
      e = {
        uid, releaseId, revision: unparsed ? 0 : revision, rv, name, namespace,
        creationTimestamp: str(meta.creationTimestamp), labelStatus: str(labels.status) || undefined,
        unparsed, summary: null, decodeState: 'none', corrupt: false, retryOnce: false,
      };
      this.bySecretUid.set(uid, e);
      this.addToRelease(releaseId, uid);
      if (prev) this.recompute(prev.releaseId);
    }
    this.recompute(e.releaseId, uid, { raw, queue });
  }

  private maxOf(releaseId: string): HelmEntry | undefined {
    const uids = this.byRelease.get(releaseId);
    if (!uids) return undefined;
    let best: HelmEntry | undefined;
    for (const uid of uids) {
      const e = this.bySecretUid.get(uid);
      if (!e || e.corrupt) continue;
      if (!best || e.revision > best.revision) best = e;
    }
    return best;
  }

  private recompute(releaseId: string, deliveredUid?: string, inHand?: { raw: RawObject; queue: Map<string, Queued> }): void {
    const uids = this.byRelease.get(releaseId);
    const max = uids && uids.size > 0 ? this.maxOf(releaseId) : undefined;
    if (!max) {
      if (this.emitted.has(releaseId)) {
        this.emitted.delete(releaseId);
        this.deps.emitDelete(releaseId);
      }
      return;
    }
    if (max.summary) {
      this.emit(max.summary);
      return;
    }
    if (inHand && max.uid === deliveredUid && max.decodeState !== 'pending' && !max.corrupt) {
      max.decodeState = 'pending';
      inHand.queue.set(max.uid, { uid: max.uid, rv: max.rv, raw: inHand.raw });
    } else if (max.decodeState === 'none' && max.uid !== deliveredUid) {
      this.issueFetch(releaseId, max);
    }
    if (!max.unparsed) this.emit(labelSummary(max));
  }

  private emit(item: HelmReleaseItem): void {
    const key = JSON.stringify(item);
    if (this.emitted.get(item.id)?.key === key) return;
    this.emitted.set(item.id, { key, item });
    this.deps.emitUpsert(item);
  }

  // --- decode -------------------------------------------------------------------------

  /** Posts queued raws that are still their release's max; reverts the rest to 'none'. */
  private postQueue(queue: Map<string, Queued>, initial: boolean): void {
    const items: Queued[] = [];
    for (const q of queue.values()) {
      const e = this.bySecretUid.get(q.uid);
      if (!e || e.rv !== q.rv) continue;
      if (this.maxOf(e.releaseId)?.uid !== e.uid) {
        if (e.decodeState === 'pending') e.decodeState = 'none';
        continue;
      }
      items.push(q);
    }
    queue.clear();
    for (let i = 0; i < items.length; i += HELM_DECODE_BATCH) this.postDecode(items.slice(i, i + HELM_DECODE_BATCH), initial);
  }

  private postDecode(items: Queued[], initial: boolean): void {
    const sessionId = this.deps.getSessionId();
    if (!sessionId || items.length === 0) return;
    const gen = this.gen;
    const meta = items.map((i) => ({ uid: i.uid, rv: i.rv }));
    const req: TransformRequest = {
      id: `helm-${sessionId}-${++this.reqCounter}`,
      resourceType: 'helmrelease',
      events: items.map((i) => ({ type: 'ADDED' as const, resource: i.raw as Record<string, unknown> })),
    };
    if (initial) this.initialDecodesPending++;
    const settle = (resp: TransformResponse) => {
      if (gen !== this.gen || this.deps.getSessionId() !== sessionId) return;
      this.applyDecode(resp, meta);
      if (initial) {
        this.initialDecodesPending--;
        this.deps.onPhaseInputsChanged?.();
      }
    };
    this.deps.sendToTransformWorker(req).then(settle, () => settle({ id: req.id, resourceType: 'helmrelease', events: [], error: 'failed' }));
  }

  private applyDecode(resp: TransformResponse, meta: Array<{ uid: string; rv: string }>): void {
    const touched = new Set<string>();
    const handled = new Set<string>();
    for (const ev of resp.events) {
      const r = ev.resource as Record<string, unknown>;
      const uid = str(r.secretUid);
      const e = this.bySecretUid.get(uid);
      if (!e || e.rv !== str(r.secretResourceVersion)) continue;
      handled.add(uid);
      if (e.unparsed) this.rekey(e, str(r.name), Number(r.revision) || 0, touched);
      if (this.maxOf(e.releaseId)?.uid !== uid) {
        if (e.decodeState === 'pending') e.decodeState = 'none';
        touched.add(e.releaseId);
        continue;
      }
      e.summary = {
        id: e.releaseId,
        name: str(r.name) || e.releaseId.split('/')[1],
        namespace: e.namespace,
        revision: Number(r.revision) || e.revision,
        status: str(r.status),
        chart: str(r.chart),
        chartVersion: str(r.chartVersion),
        appVersion: str(r.appVersion),
        lastUpdated: str(r.lastUpdated),
        description: str(r.description),
        secretName: e.name,
      };
      e.decodeState = 'none';
      touched.add(e.releaseId);
    }
    for (const f of resp.failures ?? []) {
      const m = meta[f.index];
      const uid = f.uid ?? m?.uid;
      const e = uid ? this.bySecretUid.get(uid) : undefined;
      if (!e || !m || e.rv !== m.rv) continue;
      handled.add(e.uid);
      e.decodeState = 'failed';
      e.corrupt = true;
      this.warnOnce(e.uid, '[HelmIndex] decode failed');
      touched.add(e.releaseId);
    }
    const whole = !!resp.error && resp.events.length === 0 && !(resp.failures && resp.failures.length > 0);
    if (whole) console.warn('[HelmIndex] decode request failed');
    for (const m of meta) {
      if (handled.has(m.uid)) continue;
      const e = this.bySecretUid.get(m.uid);
      if (!e || e.rv !== m.rv || e.decodeState !== 'pending') continue;
      if (!whole || this.maxOf(e.releaseId)?.uid !== e.uid) {
        e.decodeState = 'none';
      } else if (!e.retryOnce) {
        e.decodeState = 'none';
        e.retryOnce = true; // recompute below issues exactly one readSecret
      } else {
        e.decodeState = 'failed';
        e.corrupt = false;
        continue; // no further fetch; label-derived summary stays
      }
      touched.add(e.releaseId);
    }
    for (const rid of touched) this.recompute(rid);
  }

  private rekey(e: HelmEntry, releaseName: string, revision: number, touched: Set<string>): void {
    if (!releaseName) return;
    this.removeFromRelease(e.releaseId, e.uid);
    touched.add(e.releaseId);
    e.releaseId = `${e.namespace}/${releaseName}`;
    e.revision = revision;
    e.unparsed = false;
    this.addToRelease(e.releaseId, e.uid);
  }

  // --- fallback fetch ---------------------------------------------------------------------

  private issueFetch(releaseId: string, target: HelmEntry): void {
    if (this.fetchInFlight.has(releaseId)) return; // the result handler re-targets on arrival
    const sessionId = this.deps.getSessionId();
    if (!sessionId) return;
    const token = ++this.fetchToken;
    const rec = { uid: target.uid, rv: target.rv, sessionId, token };
    this.fetchInFlight.set(releaseId, rec);
    target.decodeState = 'pending';
    const gen = this.gen;
    const done = (raw: RawObject | null, err?: unknown) => {
      if (gen !== this.gen || this.deps.getSessionId() !== sessionId) return;
      if (this.fetchInFlight.get(releaseId)?.token !== token) return;
      this.fetchInFlight.delete(releaseId);
      this.onFetchResult(releaseId, rec, raw, err);
    };
    this.deps.readSecret(target.namespace, target.name).then((raw) => done(toWireShape(raw)), (err: unknown) => done(null, err));
  }

  private onFetchResult(releaseId: string, rec: { uid: string; rv: string }, raw: RawObject | null, err: unknown): void {
    const e = this.bySecretUid.get(rec.uid);
    const max = this.maxOf(releaseId);
    const fetchedUid = raw ? str(raw.metadata?.uid) : rec.uid;
    if (!e || !max || max.uid !== rec.uid || fetchedUid !== rec.uid) {
      if (e && e.rv === rec.rv && e.decodeState === 'pending') e.decodeState = 'none';
      this.recompute(releaseId);
      return;
    }
    if (e.rv !== rec.rv) return; // the watch is ahead: the raw-in-hand path owns the entry
    if (!raw) {
      e.decodeState = 'failed';
      e.corrupt = false;
      this.warnOnce(e.uid, '[HelmIndex] fallback fetch failed', extractStatusCode(err) ?? 'network');
      return;
    }
    if (str(raw.metadata?.resourceVersion) !== e.rv) {
      e.decodeState = 'failed'; // the fetch is ahead of the watch; the next event decodes in hand
      e.corrupt = false;
      return;
    }
    this.postDecode([{ uid: e.uid, rv: e.rv, raw }], false);
  }

  // --- helpers -------------------------------------------------------------------------------

  private addToRelease(releaseId: string, uid: string): void {
    let set = this.byRelease.get(releaseId);
    if (!set) {
      set = new Set();
      this.byRelease.set(releaseId, set);
    }
    set.add(uid);
  }

  private removeFromRelease(releaseId: string, uid: string): void {
    const set = this.byRelease.get(releaseId);
    if (!set) return;
    set.delete(uid);
    if (set.size === 0) this.byRelease.delete(releaseId);
  }

  private warnOnce(uid: string, msg: string, code?: number | string): void {
    const key = `${msg}:${uid}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    if (code === undefined) console.warn(msg, uid);
    else console.warn(msg, code);
  }
}

export function labelSummary(e: HelmEntry): HelmReleaseItem {
  return {
    id: e.releaseId,
    name: e.releaseId.slice(e.releaseId.indexOf('/') + 1),
    namespace: e.namespace,
    revision: e.revision,
    status: e.labelStatus ?? '',
    chart: '',
    chartVersion: '',
    appVersion: '',
    lastUpdated: e.creationTimestamp,
    description: '',
    secretName: e.name,
  };
}
