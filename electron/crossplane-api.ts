/**
 * Read-only Kubernetes adapter for the Crossplane view (design B.5, B.9).
 *
 * One adapter per kube context, built on an isolated KubeConfig (never K8sService's shared one).
 * Every API client shares a Configuration with a counting promise middleware, so the per-context
 * request counter (and the LUMEN_DEBUG_CROSSPLANE=1 log) sees every HTTP request, including
 * KubernetesObjectApi's internal discovery. Only GET/LIST requests are implemented.
 */
import {
    ApiextensionsV1Api, ApisApi, AppsV1Api, CoreV1Api, CustomObjectsApi, KubernetesObjectApi,
    ServerConfiguration, createConfiguration, setHeaderOptions,
} from '@kubernetes/client-node';
import type { KubeConfig, Middleware, RequestContext, ResponseContext } from '@kubernetes/client-node';
import { withTimeout } from '../src/lib/with-timeout';
import type { CrossplaneApiResource, CrossplaneObjectRef } from '../src/types/crossplane';
import { asArray, asNumber, asRecord, asString, getLabels, getPath } from '../src/utils/crossplane-guards';
import { sanitizeK8sErrorMessage } from './k8s';

export interface Gvr { group: string; version: string; plural: string; }
export interface ApiGroupInfo { name: string; preferredVersion?: string; versions: string[]; }
export interface ListPage { items: unknown[]; continueToken?: string; }
export interface ListPageOptions { limit: number; continueToken?: string; }
export interface CoreDeploymentInfo { coreRunning: boolean | null; version: string | null; }

/** Everything the Crossplane service needs from the cluster. Read-only by construction. */
export interface CrossplaneApi {
    readonly context: string;
    requestCount(): number;
    getApiGroups(): Promise<ApiGroupInfo[]>;
    /** Resources of one group/version (`''` group → /api/v1). Subresources (`foo/status`) are dropped. */
    getGroupResources(group: string, version: string): Promise<CrossplaneApiResource[]>;
    /** One cluster-wide LIST page of a grouped kind. */
    listPage(gvr: Gvr, opts: ListPageOptions): Promise<ListPage>;
    /** GET one object. `plural` is required for grouped kinds; core v1 kinds use KubernetesObjectApi.read. */
    get(ref: CrossplaneObjectRef, plural?: string): Promise<unknown>;
    /** One metadata-only CRD LIST page (PartialObjectMetadataList). */
    listCrdMetadataPage(continueToken?: string): Promise<ListPage>;
    /** One page of `type=Warning` events across all namespaces. */
    listWarningEventsPage(continueToken?: string): Promise<ListPage>;
    findCoreDeployment(): Promise<CoreDeploymentInfo>;
    /** Drop the cached KubeConfig and clients (credential refresh). */
    invalidate(): void;
}

export class CrossplaneApiError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'CrossplaneApiError';
    }
}

export class CrossplaneAbortError extends Error {
    constructor() {
        super('Crossplane request cancelled');
        this.name = 'CrossplaneAbortError';
    }
}

export function isAbortError(e: unknown): boolean {
    return e instanceof CrossplaneAbortError;
}

/** Normalise any thrown value to CrossplaneApiError { status, message } (status 0 = network/timeout). */
export function toCrossplaneApiError(err: unknown): CrossplaneApiError {
    if (err instanceof CrossplaneApiError) return err;
    const r = asRecord(err);
    const status = asNumber(r?.code) ?? asNumber(r?.statusCode) ?? asNumber(r?.status) ?? 0;
    const body = r?.body;
    let raw = typeof body === 'string' ? body : body !== undefined && body !== null ? JSON.stringify(body) : '';
    if (!raw) raw = err instanceof Error ? err.message : String(err);
    return new CrossplaneApiError(status, sanitizeK8sErrorMessage(raw));
}

/** Plain JSON copy (Dates → ISO strings) of a typed client result. */
function toPlain(v: unknown): unknown {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function pageOf(result: unknown): ListPage {
    const plain = toPlain(result);
    const continueToken = asString(getPath(plain, 'metadata', 'continue')) ?? asString(getPath(plain, 'metadata', '_continue'));
    return continueToken ? { items: asArray(getPath(plain, 'items')), continueToken } : { items: asArray(getPath(plain, 'items')) };
}

/** Small semaphore: at most `n` tasks run at once. */
export function createLimiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
    let active = 0;
    const queue: (() => void)[] = [];
    const next = () => {
        if (active >= n) return;
        const run = queue.shift();
        if (run) { active++; run(); }
    };
    return <T>(task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
        queue.push(() => {
            task().then(resolve, reject).finally(() => { active--; next(); });
        });
        next();
    });
}

// ── Shared list helper (B.5) ──

export interface ListAllOptions<T> {
    pageSize?: number;
    cap?: number;
    signal?: AbortSignal;
    /** null = malformed, counted in skippedMalformed. */
    summarize: (obj: unknown) => T | null;
}
export interface ListAllResult<T> { items: T[]; truncated: boolean; skippedMalformed: number; }

/**
 * Every LIST in the feature goes through here: pages on `continue` until done or `cap` raw items,
 * 404/403 reject, one restart on a 410 continue token, abort checked before each page, and each raw
 * object is summarised and dropped right away.
 */
export async function listAllPages<T>(api: Pick<CrossplaneApi, 'listPage'>, gvr: Gvr, opts: ListAllOptions<T>): Promise<ListAllResult<T>> {
    const pageSize = opts.pageSize ?? 500;
    const cap = opts.cap ?? 5000;
    let restarted = false;
    for (;;) {
        const items: T[] = [];
        let skippedMalformed = 0;
        let seen = 0;
        let token: string | undefined;
        try {
            do {
                if (opts.signal?.aborted) throw new CrossplaneAbortError();
                const page = await api.listPage(gvr, { limit: Math.min(pageSize, cap - seen), continueToken: token });
                for (const raw of page.items) {
                    const s = opts.summarize(raw);
                    if (s === null) skippedMalformed++;
                    else items.push(s);
                }
                seen += page.items.length;
                token = page.continueToken;
            } while (token && seen < cap);
            if (skippedMalformed > 0) {
                console.warn(`[crossplane] skipped ${skippedMalformed} malformed ${gvr.plural}.${gvr.group}`);
            }
            return { items, truncated: !!token, skippedMalformed };
        } catch (e) {
            if (isAbortError(e)) throw e;
            const err = toCrossplaneApiError(e);
            if (err.status === 410 && token !== undefined && !restarted) {
                restarted = true;
                continue;
            }
            throw err;
        }
    }
}

// ── Core Deployment lookup helpers (A3) ──

/** Tag of an image reference (`repo:tag@sha` → tag), or null. */
export function imageTag(image: string | undefined): string | null {
    if (!image) return null;
    const noDigest = image.split('@')[0];
    const colon = noDigest.lastIndexOf(':');
    return colon > noDigest.lastIndexOf('/') ? noDigest.slice(colon + 1) || null : null;
}

/** Version and readiness of the chosen core Deployment from a LIST result's items. */
export function pickCoreDeployment(items: readonly unknown[], dropRbacManager: boolean): CoreDeploymentInfo | null {
    const candidates = dropRbacManager
        ? items.filter(d => !(getLabels(d).app ?? '').endsWith('-rbac-manager'))
        : [...items];
    const d = candidates.find(x => getPath(x, 'metadata', 'name') === 'crossplane') ?? candidates[0];
    if (!d) return null;
    const containers = asArray(getPath(d, 'spec', 'template', 'spec', 'containers'));
    const c = containers.find(x => getPath(x, 'name') === 'crossplane') ?? containers[0];
    return {
        version: imageTag(asString(getPath(c, 'image'))),
        coreRunning: (asNumber(getPath(d, 'status', 'availableReplicas')) ?? 0) > 0,
    };
}

// ── Adapter ──

interface Clients {
    apis: ApisApi; custom: CustomObjectsApi; core: CoreV1Api; apps: AppsV1Api;
    crd: ApiextensionsV1Api; objects: KubernetesObjectApi; builtAt: number;
}

export interface CrossplaneApiOptions {
    timeoutMs?: number;
    /** KubeConfig reuse window (mirrors K8sService RELOAD_INTERVAL_MS). */
    kubeConfigTtlMs?: number;
    debug?: boolean;
    now?: () => number;
}

const CRD_METADATA_ACCEPT = 'application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1';

function pathOf(url: string): string {
    try {
        const u = new URL(url);
        return `${u.pathname}${u.search}`;
    } catch {
        return url;
    }
}

export function createCrossplaneApi(
    kcFactory: (context: string) => KubeConfig,
    context: string,
    opts: CrossplaneApiOptions = {},
): CrossplaneApi {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const kcTtl = opts.kubeConfigTtlMs ?? 10 * 60_000;
    const debug = opts.debug ?? process.env.LUMEN_DEBUG_CROSSPLANE === '1';
    const now = opts.now ?? Date.now;
    let count = 0;
    let clients: Clients | null = null;

    const counting: Middleware = {
        pre: async (ctx: RequestContext) => {
            count++;
            if (debug) console.log(`[crossplane] ${context} ${ctx.getHttpMethod()} ${pathOf(ctx.getUrl())} (n=${count})`);
            return ctx;
        },
        post: async (res: ResponseContext) => res,
    };

    const build = (): Clients => {
        const kc = kcFactory(context);
        const cluster = kc.getCurrentCluster();
        if (!cluster) throw new CrossplaneApiError(0, `No cluster for kube context: ${context}`);
        const config = createConfiguration({
            baseServer: new ServerConfiguration(cluster.server, {}),
            authMethods: { default: kc },
            promiseMiddleware: [counting],
        });
        return {
            apis: new ApisApi(config), custom: new CustomObjectsApi(config), core: new CoreV1Api(config),
            apps: new AppsV1Api(config), crd: new ApiextensionsV1Api(config), objects: new KubernetesObjectApi(config),
            builtAt: now(),
        };
    };
    const getClients = (): Clients => {
        if (!clients || now() - clients.builtAt > kcTtl) clients = build();
        return clients;
    };

    async function run<T>(label: string, fn: (c: Clients) => Promise<T>): Promise<T> {
        const attempt = async () => withTimeout(fn(getClients()), timeoutMs, `crossplane ${label}`);
        try {
            return await attempt();
        } catch (e) {
            const err = toCrossplaneApiError(e);
            if (err.status !== 401) throw err;
            console.warn(`[crossplane] ${context} 401 on ${label}; rebuilding kubeconfig and retrying once`);
            clients = null;
            try {
                return await attempt();
            } catch (e2) {
                const err2 = toCrossplaneApiError(e2);
                if (err2.status === 401) console.error(`[crossplane] ${context} 401 again on ${label}`);
                throw err2;
            }
        }
    }

    const listDeployments = (labelSelector: string) =>
        run(`GET deployments ${labelSelector}`, async c => asArray(getPath(toPlain(
            await c.apps.listDeploymentForAllNamespaces({ labelSelector, limit: 5 })), 'items')));

    return {
        context,
        requestCount: () => count,
        invalidate: () => { clients = null; },

        async getApiGroups() {
            const res = toPlain(await run('GET /apis', c => c.apis.getAPIVersions()));
            return asArray(getPath(res, 'groups')).flatMap(g => {
                const name = asString(getPath(g, 'name'));
                if (!name) return [];
                const versions = asArray(getPath(g, 'versions'))
                    .map(v => asString(getPath(v, 'version'))).filter((v): v is string => !!v);
                const preferredVersion = asString(getPath(g, 'preferredVersion', 'version'));
                return [preferredVersion ? { name, preferredVersion, versions } : { name, versions }];
            });
        },

        async getGroupResources(group, version) {
            const res = toPlain(await run(`GET resources ${group || 'core'}/${version}`, c => (group === ''
                ? c.core.getAPIResources()
                : c.custom.getAPIResources({ group, version }))));
            return asArray(getPath(res, 'resources')).flatMap(r => {
                const name = asString(getPath(r, 'name'));
                const kind = asString(getPath(r, 'kind'));
                if (!name || !kind || name.includes('/')) return [];
                return [{ name, kind, namespaced: getPath(r, 'namespaced') === true }];
            });
        },

        async listPage(gvr, { limit, continueToken }) {
            return pageOf(await run(`LIST ${gvr.plural}.${gvr.group}/${gvr.version}`, c => c.custom.listClusterCustomObject({
                group: gvr.group, version: gvr.version, plural: gvr.plural, limit, _continue: continueToken,
            })));
        },

        async get(ref, plural) {
            const slash = ref.apiVersion.indexOf('/');
            if (slash === -1) {
                return toPlain(await run(`GET ${ref.apiVersion} ${ref.kind}`, c => c.objects.read({
                    apiVersion: ref.apiVersion, kind: ref.kind,
                    metadata: ref.namespace ? { name: ref.name, namespace: ref.namespace } : { name: ref.name },
                })));
            }
            if (!plural) throw new CrossplaneApiError(404, `Kind ${ref.kind} is not served by ${ref.apiVersion}`);
            const group = ref.apiVersion.slice(0, slash);
            const version = ref.apiVersion.slice(slash + 1);
            const ns = ref.namespace;
            return toPlain(await run(`GET ${plural}.${group}/${version}`, c => (ns
                ? c.custom.getNamespacedCustomObject({ group, version, namespace: ns, plural, name: ref.name })
                : c.custom.getClusterCustomObject({ group, version, plural, name: ref.name }))));
        },

        async listCrdMetadataPage(continueToken) {
            return pageOf(await run('LIST crd metadata', c => c.crd.listCustomResourceDefinition(
                { limit: 500, _continue: continueToken }, setHeaderOptions('Accept', CRD_METADATA_ACCEPT))));
        },

        async listWarningEventsPage(continueToken) {
            return pageOf(await run('LIST warning events', c => c.core.listEventForAllNamespaces({
                fieldSelector: 'type=Warning', limit: 500, _continue: continueToken,
            })));
        },

        async findCoreDeployment() {
            let items: unknown[];
            try {
                items = await listDeployments('app=crossplane');
            } catch {
                return { coreRunning: null, version: null };
            }
            let picked = pickCoreDeployment(items, false);
            if (!picked) {
                try {
                    picked = pickCoreDeployment(await listDeployments('app.kubernetes.io/name=crossplane'), true);
                } catch {
                    return { coreRunning: null, version: null };
                }
            }
            return picked ?? { coreRunning: false, version: null };
        },
    };
}
