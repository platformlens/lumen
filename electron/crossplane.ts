/**
 * CrossplaneService: the main-process owner of every Crossplane request (design B.5, B.9, AM-3).
 *
 * - One isolated CrossplaneApi + discovery cache per kube context, LRU of 3 contexts.
 * - TTL caches per B.5; `force` skips the cached value but JOINS any in-flight promise for the same key.
 * - One MR scan at a time (a scan for another context aborts the running one), a per-kind promise map
 *   so getManagedItems joins in-flight kinds, and one shared 6-slot LIST semaphore per context.
 * - Only GET and LIST requests exist; there is no mutating code path.
 */
import type { KubeConfig } from '@kubernetes/client-node';
import { CROSSPLANE_CORE_GROUPS } from '../src/types/crossplane';
import type {
    CrossplaneCompositesPayload, CrossplaneDefinitionsPayload, CrossplaneDetection, CrossplaneObjectRef,
    CrossplanePackagesPayload, CrossplaneScanProgress, CrossplaneTree, CrossplaneWarningEventsPayload,
    ManagedItemsKindResult, ManagedItemsPayload, ManagedKindInfo, ManagedKindScan, ManagedKindsPayload, ManagedRow,
    ManagedScanSummary,
} from '../src/types/crossplane';
import { asRecord } from '../src/utils/crossplane-guards';
import { countHealth } from '../src/utils/crossplane-utils';
import { summarizeManaged } from '../src/utils/crossplane-summaries';
import {
    CrossplaneAbortError, CrossplaneApiError, createCrossplaneApi, createLimiter, isAbortError, listAllPages, toCrossplaneApiError,
} from './crossplane-api';
import type { CrossplaneApi } from './crossplane-api';
import { CrossplaneDiscovery, allManagedKinds, buildManagedKinds, detectCrossplane } from './crossplane-discovery';
import type { ManagedKindsBuild } from './crossplane-discovery';
import { fetchWarningEvents } from './crossplane-events';
import { fetchComposites, fetchDefinitions, fetchPackages, joinFunctionUsedBy, xrdGroups } from './crossplane-snapshots';
import { isSecretRef, walkCrossplaneTree } from './crossplane-tree';
import { validateK8sParam } from './k8s';

export const TTL = {
    detect: 60_000, snapshot: 15_000, managedKinds: 5 * 60_000, scan: 5 * 60_000, kindRows: 60_000, events: 15_000,
} as const;
export const MAX_CONTEXTS = 3;
export const MAX_CACHED_ROWS = 50_000;
export const MAX_UNHEALTHY = 200;
export const PROGRESS_THROTTLE_MS = 250;
export const SECRET_REFUSAL = 'Secrets are not fetched by the Crossplane view';

export interface CrossplaneServiceOptions {
    kubeConfigFactory: (context: string) => KubeConfig;
    emitProgress: (p: CrossplaneScanProgress) => void;
    apiFactory?: (context: string) => CrossplaneApi;
    now?: () => number;
}
export interface ForceOpt { force?: boolean; }

interface KindResult { kindKey: string; rows: ManagedRow[]; truncated: boolean; active: boolean; error?: ManagedKindScan['error']; }
interface RunningScan { context: string; controller: AbortController; promise: Promise<ManagedScanSummary>; kinds: Map<string, Promise<KindResult>>; }

class ContextState {
    readonly cache = new Map<string, { value: unknown; at: number }>();
    readonly inflight = new Map<string, Promise<unknown>>();
    readonly kindRows = new Map<string, { result: KindResult; at: number }>();
    /** AM-3: in-flight direct per-kind lists from getManagedItems; forced and non-forced callers join. */
    readonly directLists = new Map<string, Promise<KindResult>>();
    cachedRowCount = 0;
    /** undefined = no fingerprint recorded by getPackages yet. */
    latestRevisionFingerprint: string | undefined;
    readonly mrLimit = createLimiter(6);
    readonly discovery: CrossplaneDiscovery;
    constructor(readonly api: CrossplaneApi, now: () => number) {
        this.discovery = new CrossplaneDiscovery(api, now);
    }
}

/** Defence in depth on IPC refs (after zod): validateK8sParam on every field, and no core Secrets. */
export function assertSafeRef(ref: CrossplaneObjectRef): void {
    validateK8sParam('apiVersion', ref.apiVersion);
    validateK8sParam('kind', ref.kind);
    validateK8sParam('name', ref.name);
    if (ref.namespace !== undefined) validateK8sParam('namespace', ref.namespace);
    if (isSecretRef(ref)) throw new Error(SECRET_REFUSAL);
}

/** Drawer payload: drop managedFields and the last-applied annotation. */
export function stripObject(obj: unknown): Record<string, unknown> {
    const out = { ...(asRecord(obj) ?? {}) };
    const meta = asRecord(out.metadata);
    if (meta) {
        const m: Record<string, unknown> = { ...meta };
        delete m.managedFields;
        const ann = asRecord(m.annotations);
        if (ann && 'kubectl.kubernetes.io/last-applied-configuration' in ann) {
            const a = { ...ann };
            delete a['kubectl.kubernetes.io/last-applied-configuration'];
            m.annotations = a;
        }
        out.metadata = m;
    }
    return out;
}

export class CrossplaneService {
    private readonly states = new Map<string, ContextState>();
    private readonly now: () => number;
    private readonly apiFactory: (context: string) => CrossplaneApi;
    private scan: RunningScan | null = null;

    constructor(private readonly opts: CrossplaneServiceOptions) {
        this.now = opts.now ?? Date.now;
        this.apiFactory = opts.apiFactory ?? (ctx => createCrossplaneApi(opts.kubeConfigFactory, ctx, { now: this.now }));
    }

    // ── State and cache plumbing ──

    private state(context: string): ContextState {
        let st = this.states.get(context);
        if (st) {
            this.states.delete(context);
        } else {
            st = new ContextState(this.apiFactory(context), this.now);
        }
        this.states.set(context, st);
        while (this.states.size > MAX_CONTEXTS) {
            const oldest = this.states.keys().next().value;
            if (oldest === undefined) break;
            this.states.delete(oldest);
            if (this.scan?.context === oldest) this.scan.controller.abort();
        }
        return st;
    }

    private async cached<T>(
        st: ContextState, key: string, ttl: number, force: boolean, load: () => Promise<T>, accept?: (v: T) => boolean,
    ): Promise<T> {
        if (!force) {
            const hit = st.cache.get(key);
            if (hit && this.now() - hit.at < ttl) return hit.value as T;
        }
        const inflight = st.inflight.get(key);
        if (inflight) return inflight as Promise<T>;
        const p = load().then(value => {
            if (!accept || accept(value)) st.cache.set(key, { value, at: this.now() });
            return value;
        }).finally(() => { st.inflight.delete(key); });
        st.inflight.set(key, p);
        return p;
    }

    /** Request counter of a context's adapter (debug and tests). */
    requestCount(context: string): number {
        return this.states.get(context)?.api.requestCount() ?? 0;
    }

    invalidateKubeConfigs(): void {
        for (const st of this.states.values()) st.api.invalidate();
    }

    // ── Detection and snapshots ──

    detect(context: string, opts: ForceOpt = {}): Promise<CrossplaneDetection> {
        const st = this.state(context);
        return this.cached(st, 'detect', TTL.detect, !!opts.force,
            () => detectCrossplane(st.api, st.discovery, !!opts.force, this.now));
    }

    getDefinitions(context: string, opts: ForceOpt = {}): Promise<CrossplaneDefinitionsPayload> {
        const st = this.state(context);
        return this.cached(st, 'definitions', TTL.snapshot, !!opts.force, async () =>
            fetchDefinitions(st.api, await this.detect(context), this.now()));
    }

    getPackages(context: string, opts: ForceOpt = {}): Promise<CrossplanePackagesPayload> {
        const st = this.state(context);
        return this.cached(st, 'packages', TTL.snapshot, !!opts.force, async () => {
            const detection = await this.detect(context);
            const [packages, definitions] = await Promise.all([
                fetchPackages({
                    api: st.api, discovery: st.discovery, detection, now: this.now(),
                    peekManagedKinds: () => this.peekManagedKinds(context),
                    onRevisionFingerprint: fp => this.recordFingerprint(st, fp),
                }),
                this.getDefinitions(context).catch(() => null),
            ]);
            if (definitions) joinFunctionUsedBy(packages.functions, definitions.compositions);
            return packages;
        });
    }

    getComposites(context: string, opts: ForceOpt = {}): Promise<CrossplaneCompositesPayload> {
        const st = this.state(context);
        return this.cached(st, 'composites', TTL.snapshot, !!opts.force, async () => {
            const detection = await this.detect(context);
            return fetchComposites(st.api, detection, await this.getDefinitions(context), this.now());
        });
    }

    // ── MR kind index ──

    private recordFingerprint(st: ContextState, fp: string): void {
        st.latestRevisionFingerprint = fp;
        const hit = st.cache.get('managedKinds');
        const build = hit?.value as ManagedKindsBuild | undefined;
        if (build && build.fingerprint !== null && build.fingerprint !== fp) st.cache.delete('managedKinds');
    }

    private managedKindsBuild(context: string, force: boolean): Promise<ManagedKindsBuild> {
        const st = this.state(context);
        return this.cached(st, 'managedKinds', TTL.managedKinds, force,
            async () => buildManagedKinds(st.api, st.discovery, await this.detect(context), this.now),
            build => st.latestRevisionFingerprint === undefined || build.fingerprint === null
                || build.fingerprint === st.latestRevisionFingerprint);
    }

    async getManagedKinds(context: string, opts: ForceOpt = {}): Promise<ManagedKindsPayload> {
        return (await this.managedKindsBuild(context, !!opts.force)).payload;
    }

    /** Fresh cached kind index or null: no request, no in-flight join. */
    peekManagedKinds(context: string): ManagedKindsPayload | null {
        const hit = this.states.get(context)?.cache.get('managedKinds');
        if (!hit || this.now() - hit.at >= TTL.managedKinds) return null;
        return (hit.value as ManagedKindsBuild).payload;
    }

    // ── Warning events ──

    getWarningEvents(context: string, opts: ForceOpt & { limit?: number } = {}): Promise<CrossplaneWarningEventsPayload> {
        const st = this.state(context);
        const limit = opts.limit ?? 50;
        return this.cached(st, `events|${limit}`, TTL.events, !!opts.force, async () => {
            const [, defs, pkgs] = await Promise.allSettled([
                this.detect(context), this.getDefinitions(context), this.getPackages(context),
            ]);
            const groups = new Set<string>(CROSSPLANE_CORE_GROUPS);
            if (pkgs.status === 'fulfilled') for (const g of pkgs.value.providerApiGroups) groups.add(g);
            for (const g of xrdGroups(defs.status === 'fulfilled' ? defs.value : null)) groups.add(g);
            const peek = this.peekManagedKinds(context);
            if (peek) for (const k of [...allManagedKinds(peek), ...peek.providerConfigKinds]) groups.add(k.group);
            return fetchWarningEvents(st.api, groups, limit, this.now());
        });
    }

    // ── MR scan and items ──

    private async listKind(st: ContextState, kind: ManagedKindInfo, signal?: AbortSignal): Promise<KindResult> {
        if (signal?.aborted) throw new CrossplaneAbortError();
        if (!kind.active || !kind.version) return { kindKey: kind.kindKey, rows: [], truncated: false, active: false };
        const now = this.now();
        try {
            const res = await listAllPages(st.api, { group: kind.group, version: kind.version, plural: kind.plural }, {
                signal, summarize: o => summarizeManaged(o, kind.providerName, now, kind.kindKey),
            });
            if (signal?.aborted) throw new CrossplaneAbortError();
            return { kindKey: kind.kindKey, rows: res.items, truncated: res.truncated, active: true };
        } catch (e) {
            if (isAbortError(e)) throw e;
            const err = toCrossplaneApiError(e);
            if (err.status === 404) return { kindKey: kind.kindKey, rows: [], truncated: false, active: false };
            console.warn(`[crossplane] ${st.api.context} list ${kind.kindKey} failed (${err.status})`);
            return {
                kindKey: kind.kindKey, rows: [], truncated: false, active: true,
                error: { section: kind.kindKey, status: err.status, message: err.message },
            };
        }
    }

    /** Cache per-kind rows within the 50k-row budget. Returns whether the rows were cached. */
    private storeKindRows(st: ContextState, result: KindResult): boolean {
        const old = st.kindRows.get(result.kindKey);
        if (old) {
            st.cachedRowCount -= old.result.rows.length;
            st.kindRows.delete(result.kindKey);
        }
        if (result.error || st.cachedRowCount + result.rows.length > MAX_CACHED_ROWS) return false;
        st.kindRows.set(result.kindKey, { result, at: this.now() });
        st.cachedRowCount += result.rows.length;
        return true;
    }

    scanManaged(context: string, opts: ForceOpt = {}): Promise<ManagedScanSummary> {
        if (this.scan && this.scan.context !== context) this.scan.controller.abort();
        else if (this.scan) return this.scan.promise;
        const st = this.state(context);
        if (!opts.force) {
            const hit = st.cache.get('scan');
            if (hit && this.now() - hit.at < TTL.scan) return Promise.resolve(hit.value as ManagedScanSummary);
        }
        const controller = new AbortController();
        const kinds = new Map<string, Promise<KindResult>>();
        const promise = this.runScan(st, context, controller.signal, kinds).finally(() => {
            if (this.scan?.promise === promise) this.scan = null;
        });
        this.scan = { context, controller, promise, kinds };
        return promise;
    }

    private async runScan(
        st: ContextState, context: string, signal: AbortSignal, kindPromises: Map<string, Promise<KindResult>>,
    ): Promise<ManagedScanSummary> {
        const cancelled = (): ManagedScanSummary => ({
            context, status: 'cancelled', kinds: [], unhealthy: [], scanned: 0, total: 0, errors: [],
            fetchedAt: new Date(this.now()).toISOString(),
        });
        // AM-3: never forced; joins any in-flight (forced or not) kind-index build.
        const index = await this.getManagedKinds(context, { force: false });
        if (signal.aborted) return cancelled();
        const kinds = allManagedKinds(index);
        const total = kinds.length;
        let scanned = 0;
        let lastEmit = 0;
        const emit = (forceEmit: boolean) => {
            const t = this.now();
            if (!forceEmit && t - lastEmit < PROGRESS_THROTTLE_MS) return;
            lastEmit = t;
            this.opts.emitProgress({ context, scanned, total });
        };
        emit(true);
        for (const k of kinds) {
            const p = st.mrLimit(() => this.listKind(st, k, signal));
            p.then(() => { scanned++; emit(scanned === total); }, () => undefined);
            kindPromises.set(k.kindKey, p);
        }
        const settled = await Promise.allSettled(kinds.map(k => kindPromises.get(k.kindKey) ?? Promise.reject(new CrossplaneAbortError())));
        if (signal.aborted) return cancelled();

        const scans: ManagedKindScan[] = [];
        const unhealthy: ManagedRow[] = [];
        const errors: ManagedScanSummary['errors'] = [];
        settled.forEach((s, i) => {
            const k = kinds[i];
            const r: KindResult = s.status === 'fulfilled' ? s.value : {
                kindKey: k.kindKey, rows: [], truncated: false, active: k.active,
                error: { section: k.kindKey, status: toCrossplaneApiError(s.reason).status, message: toCrossplaneApiError(s.reason).message },
            };
            const rowsCached = this.storeKindRows(st, r);
            const scan: ManagedKindScan = {
                kindKey: k.kindKey, active: r.active, count: r.rows.length, truncated: r.truncated,
                byHealth: countHealth(r.rows), rowsCached,
            };
            if (k.providerName) scan.providerName = k.providerName;
            if (r.error) { scan.error = r.error; errors.push(r.error); }
            scans.push(scan);
            for (const row of r.rows) if (row.health === 'unhealthy') unhealthy.push(row);
        });
        unhealthy.sort((a, b) => a.healthOrder - b.healthOrder
            || (b.healthSince ?? '').localeCompare(a.healthSince ?? ''));
        const summary: ManagedScanSummary = {
            context, status: 'complete', kinds: scans, unhealthy: unhealthy.slice(0, MAX_UNHEALTHY),
            scanned, total, errors: [...index.errors, ...errors], fetchedAt: new Date(this.now()).toISOString(),
        };
        st.cache.set('scan', { value: summary, at: this.now() });
        return summary;
    }

    async getManagedItems(context: string, kindKeys: readonly string[], opts: ForceOpt = {}): Promise<ManagedItemsPayload> {
        const st = this.state(context);
        let index: ManagedKindsPayload | null = this.peekManagedKinds(context);
        if (!index) index = await this.getManagedKinds(context).catch(() => null);
        const known = new Map<string, ManagedKindInfo>();
        if (index) for (const k of [...allManagedKinds(index), ...index.providerConfigKinds]) known.set(k.kindKey, k);

        const one = async (kindKey: string): Promise<ManagedItemsKindResult> => {
            const cachedRows = st.kindRows.get(kindKey);
            if (!opts.force && cachedRows && this.now() - cachedRows.at < TTL.kindRows) return cachedRows.result;
            const pending = this.scan?.context === context ? this.scan.kinds.get(kindKey) : undefined;
            if (pending) {
                try {
                    return await pending;
                } catch {
                    // Scan cancelled while waiting: fall through to a direct list.
                }
            }
            const direct = st.directLists.get(kindKey);
            if (direct) return direct;
            const [group, version, plural] = kindKey.split('/');
            const info = known.get(kindKey) ?? { kindKey, group, version, plural, servedVersions: [version], active: true };
            const p = st.mrLimit(() => this.listKind(st, info)).then(result => {
                this.storeKindRows(st, result);
                return result;
            }).finally(() => { st.directLists.delete(kindKey); });
            st.directLists.set(kindKey, p);
            return p;
        };
        const kinds = await Promise.all(kindKeys.map(one));
        const errors = kinds.flatMap(k => (k.error ? [k.error] : []));
        return { kinds, errors, fetchedAt: new Date(this.now()).toISOString() };
    }

    // ── Drawer ──

    private async getObject(st: ContextState, ref: CrossplaneObjectRef): Promise<unknown> {
        if (isSecretRef(ref)) throw new CrossplaneApiError(403, SECRET_REFUSAL);
        if (!ref.apiVersion.includes('/')) return st.api.get(ref);
        const r = await st.discovery.resolveKind(ref.apiVersion, ref.kind);
        if (!r) throw new CrossplaneApiError(404, `Kind ${ref.kind} is not served by ${ref.apiVersion}`);
        return st.api.get(r.namespaced ? ref : { ...ref, namespace: undefined }, r.name);
    }

    async getResource(context: string, ref: CrossplaneObjectRef): Promise<Record<string, unknown>> {
        assertSafeRef(ref);
        const st = this.state(context);
        try {
            return stripObject(await this.getObject(st, ref));
        } catch (e) {
            const err = toCrossplaneApiError(e);
            console.warn(`[crossplane] getResource ${ref.kind} failed (${err.status})`);
            throw new Error(err.message);
        }
    }

    async getTree(context: string, ref: CrossplaneObjectRef): Promise<CrossplaneTree> {
        assertSafeRef(ref);
        const st = this.state(context);
        try {
            return await walkCrossplaneTree(ref, {
                getDefinitions: () => this.getDefinitions(context),
                getObject: r => this.getObject(st, r),
                isNamespaced: async (apiVersion, kind) => (await st.discovery.resolveKind(apiVersion, kind))?.namespaced,
                now: this.now(),
            });
        } catch (e) {
            const err = toCrossplaneApiError(e);
            console.warn(`[crossplane] getTree ${ref.kind} failed (${err.status})`);
            throw new Error(err.message);
        }
    }
}
