// Portions adapted from crossplane-contrib/crossview (Apache-2.0),
// https://github.com/crossplane-contrib/crossview @ 8443621. Modified for Lumen.
/**
 * Pure Crossplane helpers shared by the main process and the renderer: guards, conditions,
 * the single health model (design B.6), reference extraction, discovery parsing, classification
 * and list helpers. No Node or Electron imports.
 */
import {
    API_VERSION, CROSSPLANE_CATEGORIES, CROSSPLANE_CORE_GROUPS, DNS_LABEL, DNS_SUBDOMAIN, HEALTH_ORDER, KIND, REF_LIMITS,
} from '../types/crossplane';
import type {
    ConditionStatus, CrossplaneCategory, CrossplaneCondition, CrossplaneDefinitionsPayload,
    CrossplaneEvent, CrossplaneHealth, CrossplaneObjectRef, CrossplaneRowBase, HealthCounts, NeedsAttentionRow, XrdRow,
} from '../types/crossplane';
import { apiGroupOf, asArray, asNumber, asRecord, asString, getAnnotations, getLabels, getPath } from './crossplane-guards';

// Guards and discovery parsing live in their own files to keep this one under 500 lines; re-exported here.
export * from './crossplane-guards';
export * from './crossplane-discovery-utils';

// ── Conditions ──

const CONDITION_STATUSES: readonly string[] = ['True', 'False', 'Unknown'];

export function getConditions(obj: unknown): CrossplaneCondition[] {
    const out: CrossplaneCondition[] = [];
    for (const c of asArray(getPath(obj, 'status', 'conditions'))) {
        const type = asString(getPath(c, 'type'));
        const status = asString(getPath(c, 'status'));
        if (!type || !status || !CONDITION_STATUSES.includes(status)) continue;
        out.push({
            type, status: status as ConditionStatus,
            reason: asString(getPath(c, 'reason')),
            message: asString(getPath(c, 'message')),
            lastTransitionTime: asString(getPath(c, 'lastTransitionTime')),
        });
    }
    return out;
}
export function conditionStatus(conditions: CrossplaneCondition[], type: string): ConditionStatus | undefined {
    return conditions.find(c => c.type === type)?.status;
}

// ── Health model (B.6, AM-1) ──

export const STUCK_THRESHOLD_MS = 15 * 60_000;
export const PROGRESSING_REASONS: ReadonlySet<string> = new Set([
    'Creating', 'Deleting', 'UnpackingPackage', 'AwaitingActivation', 'UnknownPackageRevisionHealth', 'InactivePackageRevision',
]);
const MAX_MESSAGE = 500;
const NONE_CATEGORIES: ReadonlySet<string> = new Set(['composition', 'environmentConfig', 'runtimeConfig', 'providerConfig']);

export interface HealthMeta {
    kind?: string;
    creationTimestamp?: string;
    deletionTimestamp?: string;
    annotations?: Record<string, string>;
    desiredState?: string;
    /** XRD: spec.claimNames is set, so `Offered` is required. */
    claimNamesSet?: boolean;
}
export interface HealthResult { health: CrossplaneHealth; reason?: string; message?: string; since?: string; }

export function healthMetaFromObject(obj: unknown): HealthMeta {
    return {
        kind: asString(getPath(obj, 'kind')),
        creationTimestamp: asString(getPath(obj, 'metadata', 'creationTimestamp')),
        deletionTimestamp: asString(getPath(obj, 'metadata', 'deletionTimestamp')),
        annotations: getAnnotations(obj),
        desiredState: asString(getPath(obj, 'spec', 'desiredState')),
        claimNamesSet: asRecord(getPath(obj, 'spec', 'claimNames')) !== undefined,
    };
}

function truncate(s: string | undefined): string | undefined {
    return s && s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s;
}
export function formatDuration(ms: number): string {
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}

function requiredConditions(category: CrossplaneCategory | 'generic', conds: CrossplaneCondition[], meta: HealthMeta): string[] {
    const has = (t: string) => conds.some(c => c.type === t);
    switch (category) {
        case 'provider': case 'function': case 'configuration':
            return ['Installed', 'Healthy'];
        case 'packageRevision':
            return has('RevisionHealthy') ? (has('RuntimeHealthy') ? ['RevisionHealthy', 'RuntimeHealthy'] : ['RevisionHealthy']) : ['Healthy'];
        case 'xrd':
            return meta.claimNamesSet ? ['Established', 'Offered'] : ['Established'];
        case 'composite': case 'claim': case 'managed':
            return ['Synced', 'Ready'];
        case 'operation':
            if (meta.kind === 'Operation') return ['Succeeded'];
            if (meta.kind === 'CronOperation') return ['Synced', 'Scheduling'];
            if (meta.kind === 'WatchOperation') return ['Synced', 'Watching'];
            break;
        default:
            break;
    }
    // Generic rule: whichever of Synced/Ready are present, else every condition.
    const sr = ['Synced', 'Ready'].filter(has);
    return sr.length > 0 ? sr : conds.map(c => c.type);
}

function escalate(r: HealthResult, now: number): HealthResult {
    if (r.health !== 'progressing' || !r.since) return r;
    const t = Date.parse(r.since);
    if (Number.isNaN(t) || now - t <= STUCK_THRESHOLD_MS) return r;
    return { ...r, health: 'unhealthy', reason: `Stuck: ${r.reason ?? 'Progressing'} for ${formatDuration(now - t)}` };
}

export function deriveHealth(
    category: CrossplaneCategory | 'generic',
    conditions: CrossplaneCondition[],
    meta: HealthMeta,
    now: number,
): HealthResult {
    const byType = new Map(conditions.map(c => [c.type, c]));
    const fromCond = (health: CrossplaneHealth, c: CrossplaneCondition | undefined, fallbackReason?: string): HealthResult => ({
        health,
        reason: c?.reason ?? fallbackReason,
        message: truncate(c?.message),
        since: c?.lastTransitionTime ?? meta.creationTimestamp,
    });
    // 1. Deleting
    if (meta.deletionTimestamp) {
        return escalate({ health: 'progressing', reason: 'Deleting', since: meta.deletionTimestamp }, now);
    }
    // 2. Paused
    if (meta.annotations?.['crossplane.io/paused'] === 'true') {
        return { health: 'paused', reason: 'Paused', since: meta.creationTimestamp };
    }
    const synced = byType.get('Synced');
    if (synced?.status === 'False' && synced.reason === 'ReconcilePaused') return fromCond('paused', synced);
    if (category === 'operation') {
        const p = conditions.find(c => (c.type === 'Scheduling' && c.reason === 'SchedulePaused')
            || (c.type === 'Watching' && c.reason === 'WatchPaused'));
        if (p) return fromCond('paused', p);
    }
    // 3. No health
    if (NONE_CATEGORIES.has(category)) return { health: 'none' };
    if (category === 'packageRevision' && meta.desiredState === 'Inactive') return { health: 'none', reason: 'Inactive' };
    // 4. Required conditions
    const required = requiredConditions(category, conditions, meta);
    // 5. Any required False
    const falses = required.map(t => byType.get(t)).filter((c): c is CrossplaneCondition => c?.status === 'False');
    const hardFalse = falses.find(c => !c.reason || !PROGRESSING_REASONS.has(c.reason));
    if (hardFalse) return fromCond('unhealthy', hardFalse, `${hardFalse.type}=False`);
    if (category === 'managed') {
        const lao = byType.get('LastAsyncOperation');
        if (lao?.status === 'False') return fromCond('unhealthy', lao, 'LastAsyncOperationFailed');
    }
    if (falses.length > 0) return escalate(fromCond('progressing', falses[0]), now);
    // 6. All True / missing / Unknown
    if (conditions.length === 0) return { health: 'unknown', since: meta.creationTimestamp };
    const pending = required.find(t => byType.get(t)?.status !== 'True');
    if (pending === undefined) {
        const last = required.map(t => byType.get(t)).filter((c): c is CrossplaneCondition => !!c).pop();
        return { health: 'healthy', reason: last?.reason, since: last?.lastTransitionTime ?? meta.creationTimestamp };
    }
    // 7. Stuck escalation applies to progressing
    const c = byType.get(pending);
    return escalate(fromCond('progressing', c, c ? `${pending}=Unknown` : `Waiting for ${pending}`), now);
}

/** deriveHealth on a full object. */
export function deriveObjectHealth(category: CrossplaneCategory | 'generic', obj: unknown, now: number): HealthResult {
    return deriveHealth(category, getConditions(obj), healthMetaFromObject(obj), now);
}

// ── References ──

function refFrom(v: unknown, fallbackNamespace?: string): CrossplaneObjectRef | undefined {
    const apiVersion = asString(getPath(v, 'apiVersion'));
    const kind = asString(getPath(v, 'kind'));
    const name = asString(getPath(v, 'name'));
    if (!apiVersion || !kind || !name) return undefined;
    const namespace = asString(getPath(v, 'namespace')) ?? fallbackNamespace;
    return namespace ? { apiVersion, kind, name, namespace } : { apiVersion, kind, name };
}

/** v2 `spec.crossplane.resourceRefs` ?? v1 `spec.resourceRefs`. Entries without a name are skipped. */
export function getResourceRefs(obj: unknown): CrossplaneObjectRef[] {
    const raw = getPath(obj, 'spec', 'crossplane', 'resourceRefs') ?? getPath(obj, 'spec', 'resourceRefs');
    return asArray(raw).map(r => refFrom(r)).filter((r): r is CrossplaneObjectRef => !!r);
}
export function getCompositionRef(obj: unknown): string | undefined {
    return asString(getPath(obj, 'spec', 'crossplane', 'compositionRef', 'name')) ?? asString(getPath(obj, 'spec', 'compositionRef', 'name'));
}
export function getCompositionRevisionRef(obj: unknown): string | undefined {
    return asString(getPath(obj, 'spec', 'crossplane', 'compositionRevisionRef', 'name'))
        ?? asString(getPath(obj, 'spec', 'compositionRevisionRef', 'name'));
}

export interface ClaimRefInfo { name: string; namespace?: string; apiVersion?: string; kind?: string; }

/** v1 `spec.claimRef`, else the `crossplane.io/claim-name`/`-namespace` labels (apiVersion/kind unknown). */
export function getClaimRef(obj: unknown): ClaimRefInfo | undefined {
    const cr = getPath(obj, 'spec', 'claimRef');
    const name = asString(getPath(cr, 'name'));
    if (name) {
        return {
            name, namespace: asString(getPath(cr, 'namespace')),
            apiVersion: asString(getPath(cr, 'apiVersion')), kind: asString(getPath(cr, 'kind')),
        };
    }
    const labels = getLabels(obj);
    const ln = labels['crossplane.io/claim-name'];
    return ln ? { name: ln, namespace: labels['crossplane.io/claim-namespace'] } : undefined;
}

export interface OwnerInfo { apiVersion: string; kind: string; name: string; uid?: string; }

export function getControllerOwner(obj: unknown): OwnerInfo | undefined {
    for (const o of asArray(getPath(obj, 'metadata', 'ownerReferences'))) {
        if (getPath(o, 'controller') !== true) continue;
        const apiVersion = asString(getPath(o, 'apiVersion'));
        const kind = asString(getPath(o, 'kind'));
        const name = asString(getPath(o, 'name'));
        if (apiVersion && kind && name) return { apiVersion, kind, name, uid: asString(getPath(o, 'uid')) };
    }
    return undefined;
}

// ── Keys and refs ──

export function crossplaneKey(r: { apiVersion: string; kind: string; namespace?: string; name: string }): string {
    return `${r.apiVersion}|${r.kind}|${r.namespace ?? ''}|${r.name}`;
}

/** The only way a renderer builds an IPC ref: strips row extras, omits '' and undefined namespace. */
export function toCrossplaneRef(r: CrossplaneObjectRef): CrossplaneObjectRef {
    const ref: CrossplaneObjectRef = { apiVersion: r.apiVersion, kind: r.kind, name: r.name };
    if (r.namespace) ref.namespace = r.namespace;
    if (r.category) ref.category = r.category;
    return ref;
}

const CATEGORY_SET: ReadonlySet<string> = new Set(CROSSPLANE_CATEGORIES);
const ALLOWED_REF_KEYS: ReadonlySet<string> = new Set(['apiVersion', 'kind', 'name', 'namespace', 'category']);

function matches(v: unknown, re: RegExp, max: number): boolean {
    return typeof v === 'string' && v.length >= 1 && v.length <= max && re.test(v);
}
/** Same rules as the `.strict()` refSchema in electron/crossplane-ipc-schemas.ts. */
export function isValidCrossplaneRef(ref: unknown): ref is CrossplaneObjectRef {
    const r = asRecord(ref);
    if (!r || Object.keys(r).some(k => !ALLOWED_REF_KEYS.has(k))) return false;
    if (!matches(r.apiVersion, API_VERSION, REF_LIMITS.apiVersion)) return false;
    if (!matches(r.kind, KIND, REF_LIMITS.kind)) return false;
    if (!matches(r.name, DNS_SUBDOMAIN, REF_LIMITS.name)) return false;
    if (r.namespace !== undefined && !matches(r.namespace, DNS_LABEL, REF_LIMITS.namespace)) return false;
    return r.category === undefined || (typeof r.category === 'string' && CATEGORY_SET.has(r.category));
}

// ── Classification (AM-1) ──

const CORE_GROUP_SET: ReadonlySet<string> = new Set(CROSSPLANE_CORE_GROUPS);
const CORE_KIND_CATEGORIES: Record<string, Record<string, CrossplaneCategory>> = {
    'pkg.crossplane.io': {
        Provider: 'provider', Function: 'function', Configuration: 'configuration',
        ProviderRevision: 'packageRevision', FunctionRevision: 'packageRevision', ConfigurationRevision: 'packageRevision',
        DeploymentRuntimeConfig: 'runtimeConfig',
    },
    'apiextensions.crossplane.io': {
        CompositeResourceDefinition: 'xrd', Composition: 'composition', CompositionRevision: 'compositionRevision',
        EnvironmentConfig: 'environmentConfig', ManagedResourceActivationPolicy: 'activationPolicy', Usage: 'usage',
    },
    'protection.crossplane.io': { Usage: 'usage', ClusterUsage: 'usage' },
    'ops.crossplane.io': { Operation: 'operation', CronOperation: 'operation', WatchOperation: 'operation' },
};

/**
 * Category from apiVersion group and kind. Unknown kinds in core Crossplane groups → null.
 * `managed` only for non-core, non-Kubernetes-core groups that are not ProviderConfigs, XRs or claims.
 */
export function classifyCrossplaneObject(
    object: unknown,
    definitions?: Pick<CrossplaneDefinitionsPayload, 'xrds'> | null,
): CrossplaneCategory | null {
    const apiVersion = asString(getPath(object, 'apiVersion'));
    const kind = asString(getPath(object, 'kind'));
    if (!apiVersion || !kind) return null;
    const group = apiGroupOf(apiVersion);
    if (CORE_GROUP_SET.has(group)) return CORE_KIND_CATEGORIES[group]?.[kind] ?? null;
    if (group === '') return null;
    if (kind === 'ProviderConfig' || kind === 'ClusterProviderConfig') return 'providerConfig';
    for (const xrd of definitions?.xrds ?? []) {
        if (xrd.group !== group) continue;
        if (xrd.xrKind === kind) return 'composite';
        if (xrd.claimKind === kind) return 'claim';
    }
    return 'managed';
}

/** XRD whose XR or claim kind matches the given apiVersion/kind. */
export function findXrdFor(apiVersion: string, kind: string, xrds: readonly XrdRow[]): { xrd: XrdRow; role: 'composite' | 'claim' } | undefined {
    const group = apiGroupOf(apiVersion);
    for (const xrd of xrds) {
        if (xrd.group !== group) continue;
        if (xrd.xrKind === kind) return { xrd, role: 'composite' };
        if (xrd.claimKind === kind) return { xrd, role: 'claim' };
    }
    return undefined;
}

// ── Lists ──

export function emptyHealthCounts(): HealthCounts {
    return { total: 0, unhealthy: 0, progressing: 0, paused: 0, unknown: 0, healthy: 0, none: 0 };
}
/** Per-health counts; `total` excludes `none` (objects without health). */
export function countHealth(rows: readonly { health: CrossplaneHealth }[]): HealthCounts {
    const c = emptyHealthCounts();
    for (const r of rows) {
        c[r.health]++;
        if (r.health !== 'none') c.total++;
    }
    return c;
}

function toNeedsAttentionRow(r: CrossplaneRowBase): NeedsAttentionRow {
    const out: NeedsAttentionRow = {
        apiVersion: r.apiVersion, kind: r.kind, name: r.name, key: r.key, uid: r.uid, category: r.category,
        age: r.age, health: r.health, healthOrder: r.healthOrder,
    };
    if (r.namespace) out.namespace = r.namespace;
    if (r.healthReason !== undefined) out.healthReason = r.healthReason;
    if (r.healthMessage !== undefined) out.healthMessage = r.healthMessage;
    if (r.healthSince !== undefined) out.healthSince = r.healthSince;
    if (r.synced !== undefined) out.synced = r.synced;
    if (r.ready !== undefined) out.ready = r.ready;
    return out;
}

/** Unhealthy rows from every source, de-duplicated by key, sorted by healthOrder asc then healthSince desc (missing last). */
export function collectNeedsAttention(...sources: ReadonlyArray<readonly CrossplaneRowBase[] | undefined | null>): NeedsAttentionRow[] {
    const byKey = new Map<string, NeedsAttentionRow>();
    for (const src of sources) {
        for (const r of src ?? []) if (r.health === 'unhealthy' && !byKey.has(r.key)) byKey.set(r.key, toNeedsAttentionRow(r));
    }
    return [...byKey.values()].sort((a, b) => {
        if (a.healthOrder !== b.healthOrder) return a.healthOrder - b.healthOrder;
        if (!a.healthSince || !b.healthSince) return a.healthSince ? -1 : b.healthSince ? 1 : 0;
        return a.healthSince < b.healthSince ? 1 : a.healthSince > b.healthSince ? -1 : 0;
    });
}

export function healthOrderOf(h: CrossplaneHealth): number { return HEALTH_ORDER[h]; }

// ── Events ──

/** Summarise a core v1 Event; null when it has no uid or involvedObject apiVersion/kind/name. */
export function toCrossplaneEvent(raw: unknown): CrossplaneEvent | null {
    const uid = asString(getPath(raw, 'metadata', 'uid'));
    const involved = refFrom(getPath(raw, 'involvedObject'));
    if (!uid || !involved) return null;
    const timestamp = asString(getPath(raw, 'eventTime')) ?? asString(getPath(raw, 'lastTimestamp'))
        ?? asString(getPath(raw, 'firstTimestamp')) ?? asString(getPath(raw, 'metadata', 'creationTimestamp')) ?? '';
    return {
        uid, involvedObject: involved, timestamp,
        reason: asString(getPath(raw, 'reason')) ?? '',
        message: asString(getPath(raw, 'message')) ?? '',
        count: asNumber(getPath(raw, 'count')) ?? 1,
    };
}

/** Newest first, de-duplicated by uid, first `limit`. */
export function sortAndDedupeEvents(events: readonly CrossplaneEvent[], limit: number): CrossplaneEvent[] {
    const seen = new Set<string>();
    return [...events]
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
        .filter(e => (seen.has(e.uid) ? false : (seen.add(e.uid), true)))
        .slice(0, Math.max(0, limit));
}

/** Keep raw events whose involvedObject API group is in `groups`, summarise, sort newest first, dedupe, slice. */
export function filterCrossplaneEvents(rawEvents: readonly unknown[], groups: Iterable<string>, limit: number): CrossplaneEvent[] {
    const set = new Set(groups);
    const kept: CrossplaneEvent[] = [];
    for (const raw of rawEvents) {
        const apiVersion = asString(getPath(raw, 'involvedObject', 'apiVersion')) ?? '';
        if (!set.has(apiGroupOf(apiVersion))) continue;
        const e = toCrossplaneEvent(raw);
        if (e) kept.push(e);
    }
    return sortAndDedupeEvents(kept, limit);
}
