// Portions adapted from crossplane-contrib/crossview (Apache-2.0),
// https://github.com/crossplane-contrib/crossview @ 8443621. Modified for Lumen.
/**
 * Pure discovery parsing for Crossplane (design B.5): CRD names, served-version resolution, XRD scope,
 * ProviderRevision objectRefs partitioning and fingerprints. Re-exported from crossplane-utils.
 */
import type { CrossplaneApiResource, ParsedRef } from '../types/crossplane';
import { asArray, asString, getLabels, getPath } from './crossplane-guards';

const CRD_NAME = /^[a-z0-9-]+\.[a-z0-9.-]+$/;

/** `<plural>.<group>` → parts, split at the first '.'. */
export function parseCrdName(name: string): { plural: string; group: string } | null {
    if (!CRD_NAME.test(name)) return null;
    const i = name.indexOf('.');
    return { plural: name.slice(0, i), group: name.slice(i + 1) };
}

/** XRD version with `referenceable: true`, else the first served, else the first. */
export function pickReferenceableVersion(xrd: unknown): string | undefined {
    const versions = asArray(getPath(xrd, 'spec', 'versions'));
    const pick = (pred: (v: unknown) => boolean) => asString(getPath(versions.find(pred), 'name'));
    return pick(v => getPath(v, 'referenceable') === true) ?? pick(v => getPath(v, 'served') === true) ?? pick(() => true);
}

const VERSION_RE = /^v(\d+)(?:(alpha|beta)(\d+))?$/;
function versionRank(v: string): [number, number, number] {
    const m = VERSION_RE.exec(v);
    if (!m) return [-1, 0, 0];
    const stability = m[2] === undefined ? 2 : m[2] === 'beta' ? 1 : 0;
    return [stability, Number(m[1]), m[3] ? Number(m[3]) : 0];
}
/** Sort comparator: v2 > v1 > v1beta2 > v1beta1 > v1alpha1, unknown suffixes last. */
export function compareKubeVersions(a: string, b: string): number {
    const ra = versionRank(a);
    const rb = versionRank(b);
    for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return a.localeCompare(b);
}
/** Highest version by Kubernetes ordering. */
export function pickKindVersion(versions: readonly string[]): string | undefined {
    return [...versions].sort(compareKubeVersions)[0];
}

export interface KindVersionResolution {
    active: boolean; servedVersions: string[]; version?: string; kind?: string; namespaced?: boolean;
}

export function resolveKindVersion(
    plural: string,
    group: { preferredVersion?: string; versions: readonly string[] },
    resourcesByVersion: Readonly<Record<string, readonly CrossplaneApiResource[] | undefined>>,
): KindVersionResolution {
    const servedVersions = group.versions.filter(v => (resourcesByVersion[v] ?? []).some(r => r.name === plural));
    if (servedVersions.length === 0) return { active: false, servedVersions };
    const version = group.preferredVersion && servedVersions.includes(group.preferredVersion)
        ? group.preferredVersion : pickKindVersion(servedVersions);
    const entry = (resourcesByVersion[version ?? ''] ?? []).find(r => r.name === plural);
    return { active: true, servedVersions, version, kind: entry?.kind, namespaced: entry?.namespaced };
}

export function resolveXrdScope(obj: unknown): string {
    return asString(getPath(obj, 'spec', 'scope'))
        ?? (asString(getPath(obj, 'apiVersion'))?.endsWith('/v2') ? 'Namespaced' : 'LegacyCluster');
}

export function isActiveRevision(rev: unknown): boolean {
    return getPath(rev, 'spec', 'desiredState') === 'Active';
}
/** Package a revision belongs to: label `pkg.crossplane.io/package`, else an owner of a package kind. */
export function revisionPackageName(rev: unknown): string | undefined {
    const label = getLabels(rev)['pkg.crossplane.io/package'];
    if (label) return label;
    for (const o of asArray(getPath(rev, 'metadata', 'ownerReferences'))) {
        const kind = asString(getPath(o, 'kind'));
        if (kind === 'Provider' || kind === 'Function' || kind === 'Configuration') return asString(getPath(o, 'name'));
    }
    return undefined;
}

const PROVIDER_CONFIG_PLURALS: ReadonlySet<string> = new Set(['providerconfigs', 'clusterproviderconfigs']);
const IGNORED_PLURALS: ReadonlySet<string> = new Set([
    'providerconfigusages', 'clusterproviderconfigusages', 'storeconfigs', 'clusterstoreconfigs',
]);

/** Split active revisions' CRD/MRD objectRefs into MR kinds and ProviderConfig kinds (B.5 steps 2–3). */
export function partitionObjectRefs(revisions: readonly unknown[]): { managed: ParsedRef[]; providerConfigs: ParsedRef[]; groups: string[] } {
    const managed: ParsedRef[] = [];
    const providerConfigs: ParsedRef[] = [];
    const groups = new Set<string>();
    const seen = new Set<string>();
    for (const rev of revisions) {
        if (!isActiveRevision(rev)) continue;
        const providerName = revisionPackageName(rev);
        for (const ref of asArray(getPath(rev, 'status', 'objectRefs'))) {
            const kind = asString(getPath(ref, 'kind'));
            if (kind !== 'CustomResourceDefinition' && kind !== 'ManagedResourceDefinition') continue;
            const parsed = parseCrdName(asString(getPath(ref, 'name')) ?? '');
            if (!parsed) continue;
            groups.add(parsed.group);
            const id = `${parsed.group}/${parsed.plural}`;
            if (IGNORED_PLURALS.has(parsed.plural) || seen.has(id)) continue;
            seen.add(id);
            const entry: ParsedRef = providerName ? { providerName, ...parsed } : { ...parsed };
            (PROVIDER_CONFIG_PLURALS.has(parsed.plural) ? providerConfigs : managed).push(entry);
        }
    }
    return { managed, providerConfigs, groups: [...groups].sort() };
}

/** Sorted `name@resourceVersion` of active revisions, joined with ','. */
export function revisionFingerprint(revisions: readonly unknown[]): string {
    return revisions.filter(isActiveRevision)
        .map(r => `${asString(getPath(r, 'metadata', 'name')) ?? ''}@${asString(getPath(r, 'metadata', 'resourceVersion')) ?? ''}`)
        .sort().join(',');
}
