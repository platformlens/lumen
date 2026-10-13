// Portions adapted from crossplane-contrib/crossview (Apache-2.0),
// https://github.com/crossplane-contrib/crossview @ 8443621. Modified for Lumen.
/**
 * Snapshot fetchers for the Crossplane view (design B.5 "Snapshot fetchers"): packages, definitions and
 * composites. No caching here (that lives in CrossplaneService). Each fetch runs its sections through its
 * own 6-slot semaphore; errors are mapped per section (404 → skipped, others → errors[]), and a fetch whose
 * every attempted section failed with status 0 rejects with "Cluster unreachable".
 */
import { HEALTH_ORDER } from '../src/types/crossplane';
import type {
    CompositionRow, CrossplaneCompositesPayload, CrossplaneCoreKind, CrossplaneDefinitionsPayload, CrossplaneDetection,
    CrossplanePackagesPayload, CrossplaneSectionError, ManagedKindInfo, ManagedKindsPayload, PackageRow, RevisionRow,
} from '../src/types/crossplane';
import { partitionObjectRefs, revisionFingerprint } from '../src/utils/crossplane-discovery-utils';
import {
    summarizeActivationPolicy, summarizeClaim, summarizeComposite, summarizeComposition, summarizeCompositionRevision,
    summarizeEnvironmentConfig, summarizeOperation, summarizePackage, summarizeProviderConfig, summarizeRevision,
    summarizeRuntimeConfig, summarizeUsage, summarizeXrd,
} from '../src/utils/crossplane-summaries';
import { CrossplaneApiError, createLimiter, listAllPages, toCrossplaneApiError } from './crossplane-api';
import type { CrossplaneApi, Gvr } from './crossplane-api';
import { coreGvr, resolveGroupKinds, trimRevision } from './crossplane-discovery';
import type { CrossplaneDiscovery } from './crossplane-discovery';

export const SNAPSHOT_CONCURRENCY = 6;

type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Shared bookkeeping for one snapshot fetch. */
export class SectionRunner {
    readonly errors: CrossplaneSectionError[] = [];
    readonly truncatedKinds: string[] = [];
    skippedMalformed = 0;
    private attempted = 0;
    private networkFailures = 0;
    readonly limit: Limiter = createLimiter(SNAPSHOT_CONCURRENCY);

    constructor(private readonly api: CrossplaneApi) {}

    /** List one section. Not served (no gvr) → [] with no request; 404 → []; other errors → errors[] and []. */
    async section<T>(section: string, gvr: Gvr | undefined, summarize: (obj: unknown) => T | null): Promise<{ items: T[]; error?: CrossplaneApiError }> {
        if (!gvr) return { items: [] };
        this.attempted++;
        try {
            const res = await this.limit(() => listAllPages(this.api, gvr, { summarize }));
            if (res.truncated) this.truncatedKinds.push(section);
            this.skippedMalformed += res.skippedMalformed;
            return { items: res.items };
        } catch (e) {
            const err = toCrossplaneApiError(e);
            if (err.status === 404) return { items: [] };
            if (err.status === 0) this.networkFailures++;
            console.warn(`[crossplane] ${this.api.context} section ${section} failed (${err.status})`);
            this.errors.push({ section, status: err.status, message: err.message });
            return { items: [], error: err };
        }
    }

    /** Reject when every attempted section failed with status 0. */
    assertReachable(): void {
        if (this.attempted > 0 && this.networkFailures === this.attempted) {
            console.error(`[crossplane] ${this.api.context} cluster unreachable`);
            throw new CrossplaneApiError(0, 'Cluster unreachable');
        }
    }

    base(now: number) {
        return { errors: this.errors, fetchedAt: new Date(now).toISOString(), truncatedKinds: this.truncatedKinds, skippedMalformed: this.skippedMalformed };
    }
}

// ── Packages (two phases) ──

export interface PackagesDeps {
    api: CrossplaneApi;
    discovery: CrossplaneDiscovery;
    detection: CrossplaneDetection;
    now: number;
    /** Fresh cached kind index, no request (fallback for ProviderConfig kinds). */
    peekManagedKinds: () => ManagedKindsPayload | null;
    /** Called with revisionFingerprint(active ProviderRevisions) once that section succeeds. */
    onRevisionFingerprint?: (fingerprint: string) => void;
}

interface RevisionItem { row: RevisionRow; raw: unknown; }

const PACKAGE_REVISION_KIND: Record<string, CrossplaneCoreKind> = {
    Provider: 'ProviderRevision', Function: 'FunctionRevision', Configuration: 'ConfigurationRevision',
};

/** Attach revisions, revision health and installed-definition counts to package rows. */
export function joinPackageRevisions(packages: PackageRow[], revisions: readonly RevisionRow[]): void {
    for (const pkg of packages) {
        const revKind = PACKAGE_REVISION_KIND[pkg.kind];
        pkg.revisions = revisions.filter(r => r.kind === revKind && r.packageName === pkg.name)
            .sort((a, b) => b.revision - a.revision);
        const current = pkg.revisions.find(r => r.name === pkg.currentRevision)
            ?? pkg.revisions.find(r => r.desiredState === 'Active');
        if (current) {
            pkg.revisionHealth = current.health;
            pkg.revisionHealthOrder = HEALTH_ORDER[current.health];
            pkg.installedDefinitionCount = current.objectRefCount;
        }
    }
}

/** Function "used by": compositions whose pipeline references the function (crossview GetFunctionsUseCase). */
export function joinFunctionUsedBy(functions: PackageRow[], compositions: readonly CompositionRow[]): void {
    for (const fn of functions) {
        const names = compositions.filter(c => c.steps.some(s => s.functionName === fn.name)).map(c => c.name).sort();
        fn.usedByCompositions = names;
        fn.usedByCount = names.length;
    }
}

export async function fetchPackages(deps: PackagesDeps): Promise<CrossplanePackagesPayload> {
    const { api, detection, now } = deps;
    const run = new SectionRunner(api);
    const gvr = (k: CrossplaneCoreKind) => coreGvr(detection, k);
    const pkg = (o: unknown) => summarizePackage(o, now);
    const rev = (o: unknown): RevisionItem | null => {
        const row = summarizeRevision(o, now);
        return row ? { row, raw: trimRevision(o) } : null;
    };
    const revRow = (o: unknown) => summarizeRevision(o, now);

    const providerRevisions = run.section('providerRevisions', gvr('ProviderRevision'), rev);
    const providerConfigsPhase = providerRevisions.then(async res => {
        if (!res.error) {
            const raws = res.items.map(i => i.raw);
            deps.onRevisionFingerprint?.(revisionFingerprint(raws));
            const parts = partitionObjectRefs(raws);
            const resolved = await resolveGroupKinds(deps.discovery, parts.providerConfigs, run.limit);
            for (const [group, err] of resolved.failedGroups) {
                if (!resolved.kinds.some(k => k.group === group && k.active)) {
                    run.errors.push({ section: `providerConfigs:${group}`, status: err.status, message: err.message });
                }
            }
            return { kinds: resolved.kinds, groups: parts.groups };
        }
        const peeked = deps.peekManagedKinds();
        if (peeked) return { kinds: peeked.providerConfigKinds, groups: [] };
        console.warn('[crossplane] Provider revisions unavailable; provider configs not listed');
        run.errors.push({ section: 'providerConfigs', status: res.error.status, message: 'Provider revisions unavailable; provider configs not listed' });
        return { kinds: [] as ManagedKindInfo[], groups: [] };
    }).then(async ({ kinds, groups }) => {
        const lists = await Promise.all(kinds.filter(k => k.active && k.version).map(k => run.section(
            `providerConfigs:${k.plural}.${k.group}`,
            { group: k.group, version: k.version ?? '', plural: k.plural },
            o => summarizeProviderConfig(o, k.providerName, now),
        )));
        return { providerConfigs: lists.flatMap(l => l.items), groups };
    });

    const [providers, functions, configurations, provRevs, fnRevs, cfgRevs, runtimeConfigs, policies, pcs] = await Promise.all([
        run.section('providers', gvr('Provider'), pkg),
        run.section('functions', gvr('Function'), pkg),
        run.section('configurations', gvr('Configuration'), pkg),
        providerRevisions,
        run.section('functionRevisions', gvr('FunctionRevision'), revRow),
        run.section('configurationRevisions', gvr('ConfigurationRevision'), revRow),
        run.section('runtimeConfigs', gvr('DeploymentRuntimeConfig'), o => summarizeRuntimeConfig(o, now)),
        run.section('activationPolicies', gvr('ManagedResourceActivationPolicy'), o => summarizeActivationPolicy(o, now)),
        providerConfigsPhase,
    ]);
    run.assertReachable();

    const revisions = [...provRevs.items.map(i => i.row), ...fnRevs.items, ...cfgRevs.items];
    const allPackages = [...providers.items, ...functions.items, ...configurations.items];
    joinPackageRevisions(allPackages, revisions);
    for (const rc of runtimeConfigs.items) {
        rc.usedBy = allPackages.filter(p => p.runtimeConfigName === rc.name)
            .map(p => ({ apiVersion: p.apiVersion, kind: p.kind, name: p.name, category: p.category }));
        rc.usedByCount = rc.usedBy.length;
    }
    return {
        ...run.base(now),
        providers: providers.items, functions: functions.items, configurations: configurations.items,
        revisions, providerConfigs: pcs.providerConfigs, runtimeConfigs: runtimeConfigs.items,
        activationPolicies: policies.items, providerApiGroups: pcs.groups,
    };
}

// ── Definitions ──

export async function fetchDefinitions(api: CrossplaneApi, detection: CrossplaneDetection, now: number): Promise<CrossplaneDefinitionsPayload> {
    const run = new SectionRunner(api);
    const gvr = (k: CrossplaneCoreKind) => coreGvr(detection, k);
    const [xrds, compositions, revisions, envs] = await Promise.all([
        run.section('xrds', gvr('CompositeResourceDefinition'), o => summarizeXrd(o, now)),
        run.section('compositions', gvr('Composition'), o => summarizeComposition(o, now)),
        run.section('compositionRevisions', gvr('CompositionRevision'), o => summarizeCompositionRevision(o, now)),
        run.section('environmentConfigs', gvr('EnvironmentConfig'), o => summarizeEnvironmentConfig(o, now)),
    ]);
    run.assertReachable();
    for (const c of compositions.items) {
        const revs = revisions.items.filter(r => r.compositionName === c.name);
        c.revisionCount = revs.length;
        if (revs.length > 0) c.latestRevision = Math.max(...revs.map(r => r.revision));
    }
    return {
        ...run.base(now),
        xrds: xrds.items, compositions: compositions.items, compositionRevisions: revisions.items,
        environmentConfigs: envs.items, claimsSupported: xrds.items.some(x => !!x.claimKind),
    };
}

// ── Composites ──

export async function fetchComposites(
    api: CrossplaneApi, detection: CrossplaneDetection, definitions: CrossplaneDefinitionsPayload, now: number,
): Promise<CrossplaneCompositesPayload> {
    const run = new SectionRunner(api);
    const gvr = (k: CrossplaneCoreKind) => coreGvr(detection, k);
    const xrdSections = definitions.xrds.filter(x => x.group && x.version && x.xrPlural);
    const composites = Promise.all(xrdSections.map(x => run.section(
        x.xrKind || x.xrPlural, { group: x.group, version: x.version, plural: x.xrPlural },
        o => summarizeComposite(o, now, {
            scope: x.scope,
            claimApiVersion: x.claimKind ? `${x.group}/${x.version}` : undefined,
            claimKind: x.claimKind,
        }),
    )));
    const claims = Promise.all(xrdSections.filter(x => x.claimPlural).map(x => run.section(
        x.claimKind ?? x.claimPlural ?? '', { group: x.group, version: x.version, plural: x.claimPlural ?? '' },
        o => summarizeClaim(o, now),
    )));
    const usage = (o: unknown) => summarizeUsage(o, now);
    const op = (o: unknown) => summarizeOperation(o, now);
    const ops = detection.features.operations;
    const [xrs, cls, usages, operations] = await Promise.all([
        composites,
        claims,
        Promise.all([
            run.section('usages', gvr('LegacyUsage'), usage),
            run.section('protectionUsages', gvr('Usage'), usage),
            run.section('clusterUsages', gvr('ClusterUsage'), usage),
        ]),
        Promise.all(ops ? [
            run.section('operations', gvr('Operation'), op),
            run.section('cronOperations', gvr('CronOperation'), op),
            run.section('watchOperations', gvr('WatchOperation'), op),
        ] : []),
    ]);
    run.assertReachable();
    return {
        ...run.base(now),
        composites: xrs.flatMap(s => s.items), claims: cls.flatMap(s => s.items),
        usages: usages.flatMap(s => s.items), operations: operations.flatMap(s => s.items),
    };
}

/** API groups of every XR and claim kind defined by XRDs. */
export function xrdGroups(definitions: CrossplaneDefinitionsPayload | null): string[] {
    return (definitions?.xrds ?? []).map(x => x.group).filter(g => g.length > 0);
}
