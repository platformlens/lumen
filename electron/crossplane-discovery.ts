// Portions adapted from crossplane-contrib/crossview (Apache-2.0),
// https://github.com/crossplane-contrib/crossview @ 8443621. Modified for Lumen.
/**
 * Crossplane detection, API discovery cache, served-version resolution and the MR kind index (design B.5).
 * The ProviderRevision → CRD ownership mapping used by the `crdMetadata` fallback is adapted from
 * crossview's `crossview-go-server/services/kubernetes_managed.go`, without fetching CRD bodies.
 */
import type {
    CrossplaneApiResource, CrossplaneCoreKind, CrossplaneDetection, CrossplaneFeatures, CrossplaneHealth,
    CrossplaneSectionError, ManagedKindInfo, ManagedKindsPayload, ParsedRef,
} from '../src/types/crossplane';
import { asArray, asString, getPath } from '../src/utils/crossplane-guards';
import { partitionObjectRefs, resolveKindVersion, revisionFingerprint, isActiveRevision, revisionPackageName } from '../src/utils/crossplane-discovery-utils';
import { summarizeRevision } from '../src/utils/crossplane-summaries';
import { createLimiter, listAllPages, toCrossplaneApiError, CrossplaneApiError } from './crossplane-api';
import type { ApiGroupInfo, CrossplaneApi, Gvr } from './crossplane-api';

export const DISCOVERY_TTL_MS = 5 * 60_000;
const APIEXT = 'apiextensions.crossplane.io';
const PKG = 'pkg.crossplane.io';
const PROTECTION = 'protection.crossplane.io';
const OPS = 'ops.crossplane.io';

/** Group and plural for each core kind (matched by plural in discovery). */
export const CORE_KINDS: Record<CrossplaneCoreKind, { group: string; plural: string }> = {
    Provider: { group: PKG, plural: 'providers' },
    Function: { group: PKG, plural: 'functions' },
    Configuration: { group: PKG, plural: 'configurations' },
    ProviderRevision: { group: PKG, plural: 'providerrevisions' },
    FunctionRevision: { group: PKG, plural: 'functionrevisions' },
    ConfigurationRevision: { group: PKG, plural: 'configurationrevisions' },
    DeploymentRuntimeConfig: { group: PKG, plural: 'deploymentruntimeconfigs' },
    CompositeResourceDefinition: { group: APIEXT, plural: 'compositeresourcedefinitions' },
    Composition: { group: APIEXT, plural: 'compositions' },
    CompositionRevision: { group: APIEXT, plural: 'compositionrevisions' },
    EnvironmentConfig: { group: APIEXT, plural: 'environmentconfigs' },
    ManagedResourceDefinition: { group: APIEXT, plural: 'managedresourcedefinitions' },
    ManagedResourceActivationPolicy: { group: APIEXT, plural: 'managedresourceactivationpolicies' },
    LegacyUsage: { group: APIEXT, plural: 'usages' },
    Usage: { group: PROTECTION, plural: 'usages' },
    ClusterUsage: { group: PROTECTION, plural: 'clusterusages' },
    Operation: { group: OPS, plural: 'operations' },
    CronOperation: { group: OPS, plural: 'cronoperations' },
    WatchOperation: { group: OPS, plural: 'watchoperations' },
};
const CORE_KIND_NAMES = Object.keys(CORE_KINDS) as CrossplaneCoreKind[];

/** GVR of a core kind at its detected version, or undefined when not served. */
export function coreGvr(detection: CrossplaneDetection, kind: CrossplaneCoreKind): Gvr | undefined {
    const apiVersion = detection.kindVersions[kind];
    if (!apiVersion) return undefined;
    const slash = apiVersion.indexOf('/');
    return { group: apiVersion.slice(0, slash), version: apiVersion.slice(slash + 1), plural: CORE_KINDS[kind].plural };
}

interface Timed<T> { value: T; at: number; }

/** Per-context discovery cache: `/apis` and group resources (keyed `group/version`), 5 min TTL, in-flight dedupe. */
export class CrossplaneDiscovery {
    private groups: Timed<Map<string, ApiGroupInfo>> | null = null;
    private groupsInFlight: Promise<Map<string, ApiGroupInfo>> | null = null;
    private resources = new Map<string, Timed<CrossplaneApiResource[]>>();
    private resourcesInFlight = new Map<string, Promise<CrossplaneApiResource[]>>();

    constructor(private readonly api: CrossplaneApi, private readonly now: () => number) {}

    /** `force` refetches `/apis`; resources of groups whose version list changed are dropped. */
    async apiGroups(force = false): Promise<Map<string, ApiGroupInfo>> {
        if (this.groupsInFlight) return this.groupsInFlight;
        if (!force && this.groups && this.now() - this.groups.at < DISCOVERY_TTL_MS) return this.groups.value;
        const previous = this.groups?.value;
        const p = this.api.getApiGroups().then(list => {
            const map = new Map(list.map(g => [g.name, g]));
            if (previous) {
                for (const [name, old] of previous) {
                    const cur = map.get(name);
                    if (!cur || cur.versions.join(',') !== old.versions.join(',')) this.dropGroupResources(name);
                }
            }
            this.groups = { value: map, at: this.now() };
            return map;
        }).finally(() => { this.groupsInFlight = null; });
        this.groupsInFlight = p;
        return p;
    }

    private dropGroupResources(group: string): void {
        for (const key of [...this.resources.keys()]) if (key.startsWith(`${group}/`)) this.resources.delete(key);
    }

    async groupResources(group: string, version: string): Promise<CrossplaneApiResource[]> {
        const key = `${group}/${version}`;
        const cached = this.resources.get(key);
        if (cached && this.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;
        const inflight = this.resourcesInFlight.get(key);
        if (inflight) return inflight;
        const p = this.api.getGroupResources(group, version).then(value => {
            this.resources.set(key, { value, at: this.now() });
            return value;
        }).finally(() => { this.resourcesInFlight.delete(key); });
        this.resourcesInFlight.set(key, p);
        return p;
    }

    /** Plural and scope of `kind` at `apiVersion` (one discovery call for an unknown group/version). */
    async resolveKind(apiVersion: string, kind: string): Promise<CrossplaneApiResource | undefined> {
        const slash = apiVersion.indexOf('/');
        const group = slash === -1 ? '' : apiVersion.slice(0, slash);
        const version = slash === -1 ? apiVersion : apiVersion.slice(slash + 1);
        return (await this.groupResources(group, version)).find(r => r.kind === kind);
    }
}

// ── Detection (B.5 steps 1–6) ──

const EMPTY_FEATURES: CrossplaneFeatures = {
    namespacedXrs: false, mrds: false, protectionUsages: false, legacyUsages: false,
    environmentConfigs: false, deploymentRuntimeConfigs: false, operations: false,
};

export async function detectCrossplane(
    api: CrossplaneApi, discovery: CrossplaneDiscovery, force: boolean, now: () => number,
): Promise<CrossplaneDetection> {
    const groups = await discovery.apiGroups(force);
    const installed = groups.has(APIEXT) && groups.has(PKG);
    const fetchedAt = new Date(now()).toISOString();
    if (!installed) {
        return { installed, coreRunning: false, version: null, majorVersion: null, kindVersions: {}, features: { ...EMPTY_FEATURES }, fetchedAt };
    }
    const limit = createLimiter(8);
    const byGroupVersion = new Map<string, CrossplaneApiResource[] | undefined>();
    const coreGroups = [APIEXT, PKG, PROTECTION, OPS].map(g => groups.get(g)).filter((g): g is ApiGroupInfo => !!g);
    const [, core] = await Promise.all([
        Promise.all(coreGroups.flatMap(g => g.versions.map(v => limit(async () => {
            try {
                byGroupVersion.set(`${g.name}/${v}`, await discovery.groupResources(g.name, v));
            } catch (e) {
                console.warn(`[crossplane] discovery failed for ${g.name}/${v}: ${toCrossplaneApiError(e).message}`);
            }
        })))),
        api.findCoreDeployment().catch(() => ({ coreRunning: null, version: null })),
    ]);

    const kindVersions: CrossplaneDetection['kindVersions'] = {};
    for (const kind of CORE_KIND_NAMES) {
        const { group, plural } = CORE_KINDS[kind];
        const g = groups.get(group);
        if (!g) continue;
        const resourcesByVersion = Object.fromEntries(g.versions.map(v => [v, byGroupVersion.get(`${group}/${v}`)]));
        const r = resolveKindVersion(plural, g, resourcesByVersion);
        if (r.active && r.version) kindVersions[kind] = `${group}/${r.version}`;
    }
    const tagMajor = /^v?(\d+)\./.exec(core.version ?? '');
    const servesV2 = groups.get(APIEXT)?.versions.includes('v2') ?? false;
    return {
        installed, coreRunning: core.coreRunning, version: core.version,
        majorVersion: tagMajor ? Number(tagMajor[1]) : servesV2 ? 2 : 1,
        kindVersions,
        features: {
            namespacedXrs: servesV2,
            mrds: !!kindVersions.ManagedResourceDefinition,
            protectionUsages: !!kindVersions.Usage,
            legacyUsages: !!kindVersions.LegacyUsage,
            environmentConfigs: !!kindVersions.EnvironmentConfig,
            deploymentRuntimeConfigs: !!kindVersions.DeploymentRuntimeConfig,
            operations: groups.has(OPS),
        },
        fetchedAt,
    };
}

// ── Served-version resolution (B.5 step 4–5), shared by the kind index and getPackages ──

export interface ResolvedKinds { kinds: ManagedKindInfo[]; failedGroups: Map<string, CrossplaneApiError>; }

export function kindKeyOf(group: string, version: string | undefined, plural: string): string {
    return `${group}/${version ?? ''}/${plural}`;
}

export async function resolveGroupKinds(
    discovery: CrossplaneDiscovery,
    refs: readonly ParsedRef[],
    limit: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<ResolvedKinds> {
    const groups = await discovery.apiGroups();
    const failedGroups = new Map<string, CrossplaneApiError>();
    const resourcesByGroup = new Map<string, Record<string, CrossplaneApiResource[] | undefined>>();
    const distinct = [...new Set(refs.map(r => r.group))];
    await Promise.all(distinct.flatMap(name => {
        const g = groups.get(name);
        if (!g) return [];
        const byVersion: Record<string, CrossplaneApiResource[] | undefined> = {};
        resourcesByGroup.set(name, byVersion);
        return g.versions.map(v => limit(async () => {
            try {
                byVersion[v] = await discovery.groupResources(name, v);
            } catch (e) {
                const err = toCrossplaneApiError(e);
                console.warn(`[crossplane] discovery failed for ${name}/${v}: ${err.message}`);
                failedGroups.set(name, err);
            }
        }));
    }));
    const kinds = refs.map((ref): ManagedKindInfo => {
        const g = groups.get(ref.group);
        const r = g ? resolveKindVersion(ref.plural, g, resourcesByGroup.get(ref.group) ?? {}) : { active: false, servedVersions: [] };
        const info: ManagedKindInfo = {
            kindKey: kindKeyOf(ref.group, r.active ? r.version : undefined, ref.plural),
            group: ref.group, plural: ref.plural, servedVersions: r.servedVersions, active: r.active,
        };
        if (r.active) {
            info.version = r.version;
            if (r.kind) info.kind = r.kind;
            if (r.namespaced !== undefined) info.namespaced = r.namespaced;
        }
        if (ref.providerName) info.providerName = ref.providerName;
        return info;
    });
    return { kinds, failedGroups };
}

// ── MR kind index (B.5 "MR kind index") ──

export interface ManagedKindsBuild { payload: ManagedKindsPayload; fingerprint: string | null; }

/** Trimmed revision kept only for partitioning, fingerprinting and health. */
export function trimRevision(obj: unknown): unknown {
    if (!asString(getPath(obj, 'metadata', 'name'))) return null;
    return {
        apiVersion: getPath(obj, 'apiVersion'), kind: getPath(obj, 'kind'),
        metadata: {
            name: getPath(obj, 'metadata', 'name'), uid: getPath(obj, 'metadata', 'uid'),
            resourceVersion: getPath(obj, 'metadata', 'resourceVersion'), labels: getPath(obj, 'metadata', 'labels'),
            ownerReferences: getPath(obj, 'metadata', 'ownerReferences'),
            creationTimestamp: getPath(obj, 'metadata', 'creationTimestamp'),
        },
        spec: { desiredState: getPath(obj, 'spec', 'desiredState'), revision: getPath(obj, 'spec', 'revision') },
        status: { objectRefs: getPath(obj, 'status', 'objectRefs'), conditions: getPath(obj, 'status', 'conditions') },
    };
}

export async function listProviderRevisions(api: CrossplaneApi, detection: CrossplaneDetection): Promise<unknown[]> {
    const gvr = coreGvr(detection, 'ProviderRevision');
    if (!gvr) throw new CrossplaneApiError(404, 'ProviderRevisions are not served');
    return (await listAllPages(api, gvr, { summarize: trimRevision })).items;
}

/** CRD owner → provider name (ProviderRevision names are `<provider>-<hash>`). */
function crdOwnerProvider(crd: unknown): string | undefined {
    for (const o of asArray(getPath(crd, 'metadata', 'ownerReferences'))) {
        if (!(asString(getPath(o, 'apiVersion')) ?? '').startsWith('pkg.crossplane.io/')) continue;
        const kind = getPath(o, 'kind');
        const name = asString(getPath(o, 'name'));
        if (!name) continue;
        if (kind === 'Provider') return name;
        if (kind === 'ProviderRevision') return name.includes('-') ? name.slice(0, name.lastIndexOf('-')) : name;
    }
    return undefined;
}

/** Fallback: metadata-only CRD list, grouped into synthetic active revisions per provider. */
async function crdMetadataRevisions(api: CrossplaneApi): Promise<unknown[]> {
    const byProvider = new Map<string, { kind: string; name: string }[]>();
    let token: string | undefined;
    let pages = 0;
    do {
        const page = await api.listCrdMetadataPage(token);
        for (const crd of page.items) {
            const provider = crdOwnerProvider(crd);
            const name = asString(getPath(crd, 'metadata', 'name'));
            if (!provider || !name) continue;
            const refs = byProvider.get(provider) ?? [];
            refs.push({ kind: 'CustomResourceDefinition', name });
            byProvider.set(provider, refs);
        }
        token = page.continueToken;
        pages++;
    } while (token && pages < 50);
    return [...byProvider].map(([provider, objectRefs]) => ({
        metadata: { name: provider, labels: { 'pkg.crossplane.io/package': provider } },
        spec: { desiredState: 'Active' }, status: { objectRefs },
    }));
}

export async function buildManagedKinds(
    api: CrossplaneApi, discovery: CrossplaneDiscovery, detection: CrossplaneDetection, now: () => number,
): Promise<ManagedKindsBuild> {
    const errors: CrossplaneSectionError[] = [];
    let revisions: unknown[] | null = null;
    try {
        revisions = await listProviderRevisions(api, detection);
    } catch (e) {
        console.warn(`[crossplane] ProviderRevisions unavailable, using CRD metadata: ${toCrossplaneApiError(e).message}`);
    }
    const active = (revisions ?? []).filter(isActiveRevision);
    const hasRefs = active.some(r => asArray(getPath(r, 'status', 'objectRefs')).length > 0);
    let source: ManagedKindsPayload['source'] = 'objectRefs';
    let fingerprint: string | null = revisions ? revisionFingerprint(revisions) : null;
    let input: unknown[] = active;
    if (!hasRefs) {
        source = 'crdMetadata';
        fingerprint = null;
        try {
            input = await crdMetadataRevisions(api);
        } catch (e) {
            const err = toCrossplaneApiError(e);
            console.warn(`[crossplane] CRD metadata fallback failed: ${err.message}`);
            errors.push({ section: 'managedKinds', status: err.status, message: err.message });
            input = [];
        }
    }
    const parts = partitionObjectRefs(input);
    const { kinds } = await resolveGroupKinds(discovery, [...parts.managed, ...parts.providerConfigs], createLimiter(8));
    const pcKeys = new Set(parts.providerConfigs.map(r => `${r.group}/${r.plural}`));
    const managed = kinds.filter(k => !pcKeys.has(`${k.group}/${k.plural}`));
    const providerConfigKinds = kinds.filter(k => pcKeys.has(`${k.group}/${k.plural}`));

    const health = new Map<string, CrossplaneHealth>();
    for (const rev of source === 'objectRefs' ? active : []) {
        const pkg = revisionPackageName(rev);
        const row = summarizeRevision(rev, now());
        if (pkg && row) health.set(pkg, row.health);
    }
    const byProvider = new Map<string, ManagedKindInfo[]>();
    const unattributed: ManagedKindInfo[] = [];
    for (const k of managed) {
        if (!k.providerName) { unattributed.push(k); continue; }
        const list = byProvider.get(k.providerName) ?? [];
        list.push(k);
        byProvider.set(k.providerName, list);
    }
    const byPlural = (a: ManagedKindInfo, b: ManagedKindInfo) => a.plural.localeCompare(b.plural) || a.group.localeCompare(b.group);
    const providers = [...byProvider].sort(([a], [b]) => a.localeCompare(b))
        .map(([name, list]) => ({ name, health: health.get(name) ?? 'unknown' as CrossplaneHealth, kinds: list.sort(byPlural) }));
    return {
        payload: {
            providers, unattributed: unattributed.sort(byPlural), providerConfigKinds, source, errors,
            fetchedAt: new Date(now()).toISOString(),
        },
        fingerprint,
    };
}

/** Every active kind of an index, providers first. */
export function allManagedKinds(payload: ManagedKindsPayload): ManagedKindInfo[] {
    return [...payload.providers.flatMap(p => p.kinds), ...payload.unattributed];
}
