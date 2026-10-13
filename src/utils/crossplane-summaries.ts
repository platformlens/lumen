// Portions adapted from crossplane-contrib/crossview (Apache-2.0),
// https://github.com/crossplane-contrib/crossview @ 8443621. Modified for Lumen.
/**
 * Raw Kubernetes object → flattened Crossplane row. Used by the main process when listing and by the
 * renderer where needed. Every summariser returns null for malformed input (missing metadata.name or uid),
 * and every count field is a number defaulting to 0.
 */
import { HEALTH_ORDER } from '../types/crossplane';
import type {
    ActivationPolicyRow, ClaimRow, CompositeRow, CompositionRevisionRow, CompositionRow, CompositionStep,
    CrossplaneCategory, CrossplaneObjectRef, CrossplaneRowBase, EnvironmentConfigRow, ManagedRow, OperationRow,
    PackageRow, ProviderConfigRow, RevisionRow, RuntimeConfigRow, UsageRow, XrdRow, XrdVersionInfo,
} from '../types/crossplane';
import {
    asArray, asNumber, asRecord, asString, conditionStatus, crossplaneKey, deriveHealth, getAnnotations, getClaimRef,
    getCompositionRef, getCompositionRevisionRef, getConditions, getLabels, getPath, getResourceRefs, healthMetaFromObject,
    pickReferenceableVersion, resolveXrdScope, revisionPackageName,
} from './crossplane-utils';

type PackageCategory = 'provider' | 'function' | 'configuration';
const PACKAGE_CATEGORY_BY_KIND: Record<string, PackageCategory> = {
    Provider: 'provider', Function: 'function', Configuration: 'configuration',
};

/** Shared row fields, with health derived for `healthCategory` (defaults to the row category). */
function buildBase(
    obj: unknown, category: CrossplaneCategory, now: number, healthCategory: CrossplaneCategory | 'generic' = category,
): CrossplaneRowBase | null {
    const name = asString(getPath(obj, 'metadata', 'name'));
    const uid = asString(getPath(obj, 'metadata', 'uid'));
    if (!name || !uid) return null;
    const apiVersion = asString(getPath(obj, 'apiVersion')) ?? '';
    const kind = asString(getPath(obj, 'kind')) ?? '';
    const namespace = asString(getPath(obj, 'metadata', 'namespace'));
    const conditions = getConditions(obj);
    const h = deriveHealth(healthCategory, conditions, healthMetaFromObject(obj), now);
    const row: CrossplaneRowBase = {
        apiVersion, kind, name, key: crossplaneKey({ apiVersion, kind, namespace, name }), uid, category,
        age: asString(getPath(obj, 'metadata', 'creationTimestamp')) ?? '',
        health: h.health, healthOrder: HEALTH_ORDER[h.health],
    };
    if (namespace) row.namespace = namespace;
    if (h.reason !== undefined) row.healthReason = h.reason;
    if (h.message !== undefined) row.healthMessage = h.message;
    if (h.since !== undefined) row.healthSince = h.since;
    const synced = conditionStatus(conditions, 'Synced');
    const ready = conditionStatus(conditions, 'Ready');
    if (synced) row.synced = synced;
    if (ready) row.ready = ready;
    return row;
}

const count = (v: unknown): number => asArray(v).length;
const strings = (v: unknown): string[] => asArray(v).filter((s): s is string => typeof s === 'string');

function pipelineSteps(pipeline: unknown): CompositionStep[] {
    return asArray(pipeline).map((p, i) => {
        const step: CompositionStep = { step: asString(getPath(p, 'step')) ?? `step-${i + 1}` };
        const fn = asString(getPath(p, 'functionRef', 'name'));
        if (fn) step.functionName = fn;
        return step;
    });
}

export function summarizePackage(obj: unknown, now: number): PackageRow | null {
    const category = PACKAGE_CATEGORY_BY_KIND[asString(getPath(obj, 'kind')) ?? ''];
    if (!category) return null;
    const base = buildBase(obj, category, now);
    if (!base) return null;
    const conditions = getConditions(obj);
    return {
        ...base,
        packageRef: asString(getPath(obj, 'spec', 'package')) ?? '',
        installed: conditionStatus(conditions, 'Installed'),
        healthy: conditionStatus(conditions, 'Healthy'),
        currentRevision: asString(getPath(obj, 'status', 'currentRevision')),
        revisionHealthOrder: HEALTH_ORDER.none,
        revisions: [],
        runtimeConfigName: asString(getPath(obj, 'spec', 'runtimeConfigRef', 'name')),
        installedDefinitionCount: 0,
        usedByCompositions: [],
        usedByCount: 0,
        depsFound: asNumber(getPath(obj, 'status', 'foundDependencies')) ?? 0,
        depsInstalled: asNumber(getPath(obj, 'status', 'installedDependencies')) ?? 0,
    };
}

export function summarizeRevision(obj: unknown, now: number): RevisionRow | null {
    const base = buildBase(obj, 'packageRevision', now);
    if (!base) return null;
    return {
        ...base,
        packageName: revisionPackageName(obj) ?? '',
        revision: asNumber(getPath(obj, 'spec', 'revision')) ?? 0,
        desiredState: getPath(obj, 'spec', 'desiredState') === 'Inactive' ? 'Inactive' : 'Active',
        image: asString(getPath(obj, 'spec', 'image')) ?? asString(getPath(obj, 'spec', 'package')) ?? '',
        objectRefCount: count(getPath(obj, 'status', 'objectRefs')),
    };
}

export function summarizeXrd(obj: unknown, now: number): XrdRow | null {
    const base = buildBase(obj, 'xrd', now);
    if (!base) return null;
    const conditions = getConditions(obj);
    const versions: XrdVersionInfo[] = asArray(getPath(obj, 'spec', 'versions')).flatMap(v => {
        const name = asString(getPath(v, 'name'));
        return name ? [{ name, served: getPath(v, 'served') === true, referenceable: getPath(v, 'referenceable') === true }] : [];
    });
    const claimNames = asRecord(getPath(obj, 'spec', 'claimNames'));
    return {
        ...base,
        group: asString(getPath(obj, 'spec', 'group')) ?? '',
        xrKind: asString(getPath(obj, 'spec', 'names', 'kind')) ?? '',
        xrPlural: asString(getPath(obj, 'spec', 'names', 'plural')) ?? '',
        version: pickReferenceableVersion(obj) ?? '',
        scope: resolveXrdScope(obj),
        claimKind: asString(claimNames?.kind),
        claimPlural: asString(claimNames?.plural),
        established: conditionStatus(conditions, 'Established'),
        offered: conditionStatus(conditions, 'Offered'),
        defaultComposition: asString(getPath(obj, 'spec', 'defaultCompositionRef', 'name')),
        enforcedComposition: asString(getPath(obj, 'spec', 'enforcedCompositionRef', 'name')),
        versions,
    };
}

export function summarizeComposition(obj: unknown, now: number): CompositionRow | null {
    const base = buildBase(obj, 'composition', now);
    if (!base) return null;
    const pipeline = getPath(obj, 'spec', 'pipeline');
    const mode = asString(getPath(obj, 'spec', 'mode')) ?? (Array.isArray(pipeline) ? 'Pipeline' : 'Resources');
    const steps = pipelineSteps(pipeline);
    return {
        ...base,
        compositeApiVersion: asString(getPath(obj, 'spec', 'compositeTypeRef', 'apiVersion')) ?? '',
        compositeKind: asString(getPath(obj, 'spec', 'compositeTypeRef', 'kind')) ?? '',
        mode: mode === 'Resources' ? 'Resources' : 'Pipeline',
        steps, stepCount: steps.length, revisionCount: 0,
    };
}

export function summarizeCompositionRevision(obj: unknown, now: number): CompositionRevisionRow | null {
    const base = buildBase(obj, 'compositionRevision', now);
    if (!base) return null;
    return {
        ...base,
        compositionName: getLabels(obj)['crossplane.io/composition-name'] ?? '',
        revision: asNumber(getPath(obj, 'spec', 'revision')) ?? 0,
    };
}

export interface CompositeSummaryOptions {
    /** XRD scope; derived from the object when absent. */
    scope?: string;
    /** Claim apiVersion/kind from the XRD (`spec.group/version`, `claimNames.kind`), used with the claim labels. */
    claimApiVersion?: string;
    claimKind?: string;
}

export function summarizeComposite(obj: unknown, now: number, opts: CompositeSummaryOptions = {}): CompositeRow | null {
    const base = buildBase(obj, 'composite', now);
    if (!base) return null;
    const scope = opts.scope ?? (base.namespace ? 'Namespaced' : asRecord(getPath(obj, 'spec', 'crossplane')) ? 'Cluster' : 'LegacyCluster');
    const row: CompositeRow = {
        ...base, scope,
        compositionName: getCompositionRef(obj),
        compositionRevisionName: getCompositionRevisionRef(obj),
        resourceRefCount: getResourceRefs(obj).length,
    };
    const claim = getClaimRef(obj);
    if (claim) {
        row.claimName = claim.name;
        if (claim.namespace) row.claimNamespace = claim.namespace;
        const apiVersion = claim.apiVersion ?? opts.claimApiVersion;
        const kind = claim.kind ?? opts.claimKind;
        if (apiVersion && kind) {
            const ref: CrossplaneObjectRef = { apiVersion, kind, name: claim.name, category: 'claim' };
            if (claim.namespace) ref.namespace = claim.namespace;
            row.claim = ref;
        }
    }
    return row;
}

export function summarizeClaim(obj: unknown, now: number): ClaimRow | null {
    const base = buildBase(obj, 'claim', now);
    if (!base) return null;
    const rr = getPath(obj, 'spec', 'resourceRef');
    const apiVersion = asString(getPath(rr, 'apiVersion'));
    const kind = asString(getPath(rr, 'kind'));
    const name = asString(getPath(rr, 'name'));
    return {
        ...base,
        compositeRef: apiVersion && kind && name ? { apiVersion, kind, name, category: 'composite' } : undefined,
        connectionSecretName: asString(getPath(obj, 'spec', 'writeConnectionSecretToRef', 'name')),
        compositionName: getCompositionRef(obj),
    };
}

export function summarizeManaged(obj: unknown, providerName: string | undefined, now: number, kindKey = ''): ManagedRow | null {
    const base = buildBase(obj, 'managed', now);
    if (!base) return null;
    const labels = getLabels(obj);
    const policies = strings(getPath(obj, 'spec', 'managementPolicies'));
    return {
        ...base, kindKey, providerName,
        externalName: getAnnotations(obj)['crossplane.io/external-name'],
        providerConfigName: asString(getPath(obj, 'spec', 'providerConfigRef', 'name')),
        providerConfigKind: asString(getPath(obj, 'spec', 'providerConfigRef', 'kind')),
        managementPolicies: policies.length > 0 ? policies : undefined,
        deletionPolicy: asString(getPath(obj, 'spec', 'deletionPolicy')),
        compositeName: labels['crossplane.io/composite'],
        claim: labels['crossplane.io/claim-name'],
    };
}

/** "Kind/name" for a Usage `of`/`by` entry, or "Kind (selector: k=v,…)" for a resourceSelector. */
export function describeUsageTarget(target: unknown): string | undefined {
    const kind = asString(getPath(target, 'kind'));
    const name = asString(getPath(target, 'resourceRef', 'name'));
    if (name) return kind ? `${kind}/${name}` : name;
    const match = asRecord(getPath(target, 'resourceSelector', 'matchLabels'));
    if (match) {
        const sel = Object.entries(match).map(([k, v]) => `${k}=${String(v)}`).join(',');
        return `${kind ? `${kind} ` : ''}(selector: ${sel})`;
    }
    return kind;
}

export function summarizeUsage(obj: unknown, now: number): UsageRow | null {
    const base = buildBase(obj, 'usage', now);
    if (!base) return null;
    const replay = getPath(obj, 'spec', 'replayDeletion');
    return {
        ...base,
        of: describeUsageTarget(getPath(obj, 'spec', 'of')),
        by: describeUsageTarget(getPath(obj, 'spec', 'by')),
        reason: asString(getPath(obj, 'spec', 'reason')),
        replayDeletion: typeof replay === 'boolean' ? replay : undefined,
    };
}

export function summarizeProviderConfig(obj: unknown, providerName: string | undefined, now: number): ProviderConfigRow | null {
    const base = buildBase(obj, 'providerConfig', now);
    if (!base) return null;
    return {
        ...base, providerName,
        credentialsSource: asString(getPath(obj, 'spec', 'credentials', 'source')),
        userCount: asNumber(getPath(obj, 'status', 'users')) ?? 0,
    };
}

export function summarizeRuntimeConfig(obj: unknown, now: number): RuntimeConfigRow | null {
    const base = buildBase(obj, 'runtimeConfig', now);
    return base ? { ...base, usedBy: [], usedByCount: 0 } : null;
}

export function summarizeActivationPolicy(obj: unknown, now: number): ActivationPolicyRow | null {
    const base = buildBase(obj, 'activationPolicy', now);
    if (!base) return null;
    return {
        ...base,
        patterns: strings(getPath(obj, 'spec', 'activate')),
        activatedCount: count(getPath(obj, 'status', 'activated')),
    };
}

export function summarizeEnvironmentConfig(obj: unknown, now: number): EnvironmentConfigRow | null {
    const base = buildBase(obj, 'environmentConfig', now);
    if (!base) return null;
    const keys = Object.keys(asRecord(getPath(obj, 'data')) ?? {});
    return { ...base, keys, keyCount: keys.length };
}

const OP_KINDS: readonly OperationRow['opKind'][] = ['Operation', 'CronOperation', 'WatchOperation'];

export function summarizeOperation(obj: unknown, now: number): OperationRow | null {
    const opKind = OP_KINDS.find(k => k === getPath(obj, 'kind'));
    if (!opKind) return null;
    const base = buildBase(obj, 'operation', now);
    if (!base) return null;
    const conditions = getConditions(obj);
    const pipeline = opKind === 'Operation'
        ? getPath(obj, 'spec', 'pipeline') : getPath(obj, 'spec', 'operationTemplate', 'spec', 'pipeline');
    return {
        ...base, opKind,
        mode: asString(getPath(obj, 'spec', 'mode')) ?? asString(getPath(obj, 'spec', 'operationTemplate', 'spec', 'mode')),
        stepCount: count(pipeline),
        succeeded: conditionStatus(conditions, 'Succeeded'),
        schedule: asString(getPath(obj, 'spec', 'schedule')),
        scheduling: conditionStatus(conditions, 'Scheduling'),
        runningCount: count(getPath(obj, 'status', 'runningOperationRefs')),
        watchedApiVersion: asString(getPath(obj, 'spec', 'watch', 'apiVersion')),
        watchedKind: asString(getPath(obj, 'spec', 'watch', 'kind')),
        watchingResources: asNumber(getPath(obj, 'status', 'watchingResources')) ?? 0,
        watching: conditionStatus(conditions, 'Watching'),
        lastScheduleTime: asString(getPath(obj, 'status', 'lastScheduleTime')),
        lastSuccessfulTime: asString(getPath(obj, 'status', 'lastSuccessfulTime')),
    };
}
