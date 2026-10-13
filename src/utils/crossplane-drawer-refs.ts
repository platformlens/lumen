// Portions adapted from crossplane-contrib/crossview (Apache-2.0),
// https://github.com/crossplane-contrib/crossview @ 8443621. Modified for Lumen.
/**
 * Clickable references shown in the Crossplane drawer, per category (design AM-2).
 * Secret refs and refs that would fail the IPC refSchema are emitted without `ref` (plain text).
 */
import type {
    CrossplaneCategory, CrossplaneCoreKind, CrossplaneDefinitionsPayload, CrossplaneDetection,
    CrossplanePackagesPayload, DrawerLink,
} from '../types/crossplane';
import {
    apiGroupOf, asArray, asRecord, asString, getClaimRef, getCompositionRef, getCompositionRevisionRef, getControllerOwner,
    getLabels, getPath, findXrdFor, isValidCrossplaneRef, toCrossplaneRef,
} from './crossplane-utils';

export interface DrawerRefsContext {
    detection: CrossplaneDetection;
    packages?: CrossplanePackagesPayload;
    definitions?: CrossplaneDefinitionsPayload;
    /** Provider that owns a managed resource's kind, when the caller knows it (Managed kind index). */
    providerName?: string;
}

interface LinkTarget { apiVersion?: string; kind: string; name?: string; namespace?: string; category?: CrossplaneCategory; }

function linkText(t: LinkTarget): string {
    const name = t.name ?? '?';
    return `${t.kind}/${t.namespace ? `${t.namespace}/` : ''}${name}`;
}

/** A link when the target is a valid, non-Secret ref; otherwise text only. */
export function makeLink(label: string, t: LinkTarget, text = linkText(t)): DrawerLink {
    if (!t.apiVersion || !t.name || (t.kind === 'Secret' && t.apiVersion === 'v1')) return { label, text };
    const ref = toCrossplaneRef({ apiVersion: t.apiVersion, kind: t.kind, name: t.name, namespace: t.namespace, category: t.category });
    return isValidCrossplaneRef(ref) ? { label, ref, text } : { label, text };
}

function secretText(label: string, ref: unknown, fallbackNamespace?: string): DrawerLink[] {
    const name = asString(getPath(ref, 'name'));
    if (!name) return [];
    const ns = asString(getPath(ref, 'namespace')) ?? fallbackNamespace;
    return [{ label, text: `Secret/${ns ? `${ns}/` : ''}${name}` }];
}

function functionLinks(pipeline: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    const out: DrawerLink[] = [];
    for (const p of asArray(pipeline)) {
        const fn = asString(getPath(p, 'functionRef', 'name'));
        if (fn) out.push(makeLink('Function', { apiVersion: ctx.detection.kindVersions.Function, kind: 'Function', name: fn, category: 'function' }));
    }
    return out;
}

function packageLinks(kind: string, object: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    const kv = ctx.detection.kindVersions;
    const name = asString(getPath(object, 'metadata', 'name')) ?? '';
    const out: DrawerLink[] = [];
    const rc = asString(getPath(object, 'spec', 'runtimeConfigRef', 'name'));
    if (rc) out.push(makeLink('Runtime config', { apiVersion: kv.DeploymentRuntimeConfig, kind: 'DeploymentRuntimeConfig', name: rc, category: 'runtimeConfig' }));
    const revKind = `${kind}Revision` as CrossplaneCoreKind;
    const revs = (ctx.packages?.revisions ?? []).filter(r => r.kind === revKind && r.packageName === name);
    const revNames = revs.length > 0 ? revs.map(r => r.name) : [asString(getPath(object, 'status', 'currentRevision'))].filter((n): n is string => !!n);
    for (const rn of revNames) out.push(makeLink('Revision', { apiVersion: kv[revKind], kind: revKind, name: rn, category: 'packageRevision' }));
    if (kind === 'Function') {
        const row = ctx.packages?.functions.find(f => f.name === name);
        for (const c of row?.usedByCompositions ?? []) {
            out.push(makeLink('Used by', { apiVersion: kv.Composition, kind: 'Composition', name: c, category: 'composition' }));
        }
    }
    return out;
}

const PACKAGE_KIND_CATEGORY: Record<string, CrossplaneCategory> = { Provider: 'provider', Function: 'function', Configuration: 'configuration' };

function revisionLinks(object: unknown): DrawerLink[] {
    for (const o of asArray(getPath(object, 'metadata', 'ownerReferences'))) {
        const kind = asString(getPath(o, 'kind')) ?? '';
        if (!PACKAGE_KIND_CATEGORY[kind]) continue;
        return [makeLink('Package', {
            apiVersion: asString(getPath(o, 'apiVersion')), kind, name: asString(getPath(o, 'name')), category: PACKAGE_KIND_CATEGORY[kind],
        })];
    }
    return [];
}

function runtimeConfigLinks(object: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    const name = asString(getPath(object, 'metadata', 'name'));
    const p = ctx.packages;
    if (!name || !p) return [];
    return [...p.providers, ...p.functions, ...p.configurations]
        .filter(r => r.runtimeConfigName === name)
        .map(r => makeLink('Used by', r));
}

function xrdLinks(object: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    const kv = ctx.detection.kindVersions;
    const group = asString(getPath(object, 'spec', 'group'));
    const xrKind = asString(getPath(object, 'spec', 'names', 'kind'));
    const out: DrawerLink[] = [];
    const comp = (label: string, name: string) => makeLink(label, { apiVersion: kv.Composition, kind: 'Composition', name, category: 'composition' });
    const def = asString(getPath(object, 'spec', 'defaultCompositionRef', 'name'));
    const enf = asString(getPath(object, 'spec', 'enforcedCompositionRef', 'name'));
    if (def) out.push(comp('Default composition', def));
    if (enf) out.push(comp('Enforced composition', enf));
    for (const c of ctx.definitions?.compositions ?? []) {
        if (c.compositeKind === xrKind && apiGroupOf(c.compositeApiVersion) === group) out.push(comp('Composition', c.name));
    }
    return out;
}

function compositionLinks(category: 'composition' | 'compositionRevision', object: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    const kv = ctx.detection.kindVersions;
    const out: DrawerLink[] = [];
    const ctApi = asString(getPath(object, 'spec', 'compositeTypeRef', 'apiVersion'));
    const ctKind = asString(getPath(object, 'spec', 'compositeTypeRef', 'kind'));
    if (ctApi && ctKind) {
        const xrd = ctx.definitions ? findXrdFor(ctApi, ctKind, ctx.definitions.xrds) : undefined;
        out.push(xrd?.role === 'composite'
            ? makeLink('Composite type', { apiVersion: kv.CompositeResourceDefinition, kind: 'CompositeResourceDefinition', name: xrd.xrd.name, category: 'xrd' }, `${ctKind} (${ctApi})`)
            : { label: 'Composite type', text: `${ctKind} (${ctApi})` });
    }
    out.push(...functionLinks(getPath(object, 'spec', 'pipeline'), ctx));
    const name = asString(getPath(object, 'metadata', 'name'));
    if (category === 'composition') {
        for (const r of ctx.definitions?.compositionRevisions ?? []) {
            if (r.compositionName === name) out.push(makeLink('Revision', { apiVersion: kv.CompositionRevision, kind: 'CompositionRevision', name: r.name, category: 'compositionRevision' }));
        }
    } else {
        const parent = getLabels(object)['crossplane.io/composition-name'];
        if (parent) out.push(makeLink('Composition', { apiVersion: kv.Composition, kind: 'Composition', name: parent, category: 'composition' }));
    }
    return out;
}

function compositeOrClaimLinks(category: 'composite' | 'claim', object: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    const kv = ctx.detection.kindVersions;
    const ns = asString(getPath(object, 'metadata', 'namespace'));
    const out: DrawerLink[] = [];
    const comp = getCompositionRef(object);
    if (comp) out.push(makeLink('Composition', { apiVersion: kv.Composition, kind: 'Composition', name: comp, category: 'composition' }));
    const rev = getCompositionRevisionRef(object);
    if (rev) out.push(makeLink('Composition revision', { apiVersion: kv.CompositionRevision, kind: 'CompositionRevision', name: rev, category: 'compositionRevision' }));
    if (category === 'claim') {
        const rr = getPath(object, 'spec', 'resourceRef');
        const kind = asString(getPath(rr, 'kind'));
        if (kind) {
            out.push(makeLink('Composite', {
                apiVersion: asString(getPath(rr, 'apiVersion')), kind, name: asString(getPath(rr, 'name')),
                namespace: asString(getPath(rr, 'namespace')), category: 'composite',
            }));
        }
    } else {
        const claim = getClaimRef(object);
        if (claim) {
            let { apiVersion, kind } = claim;
            if (!apiVersion || !kind) {
                const own = findXrdFor(asString(getPath(object, 'apiVersion')) ?? '', asString(getPath(object, 'kind')) ?? '', ctx.definitions?.xrds ?? []);
                if (own?.xrd.claimKind) { apiVersion = `${own.xrd.group}/${own.xrd.version}`; kind = own.xrd.claimKind; }
            }
            out.push(makeLink('Claim', { apiVersion, kind: kind ?? 'Claim', name: claim.name, namespace: claim.namespace, category: 'claim' }));
        }
    }
    out.push(...secretText('Connection secret', getPath(object, 'spec', 'writeConnectionSecretToRef'), category === 'claim' ? ns : undefined));
    return out;
}

function providerConfigMatchesGroup(pcApiVersion: string, mrGroup: string): boolean {
    const g = apiGroupOf(pcApiVersion);
    return g === mrGroup || mrGroup.endsWith(`.${g}`);
}

function managedLinks(object: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    const out: DrawerLink[] = [];
    const pcName = asString(getPath(object, 'spec', 'providerConfigRef', 'name'));
    if (pcName) {
        const pcKind = asString(getPath(object, 'spec', 'providerConfigRef', 'kind')) ?? 'ProviderConfig';
        const mrNs = asString(getPath(object, 'metadata', 'namespace'));
        const mrGroup = apiGroupOf(asString(getPath(object, 'apiVersion')) ?? '');
        const row = (ctx.packages?.providerConfigs ?? []).find(pc => pc.kind === pcKind && pc.name === pcName
            && (pcKind !== 'ProviderConfig' || !mrNs || pc.namespace === mrNs)
            && (ctx.providerName ? pc.providerName === ctx.providerName : providerConfigMatchesGroup(pc.apiVersion, mrGroup)));
        out.push(row
            ? makeLink('Provider config', row)
            : { label: 'Provider config', text: `${pcKind}/${pcKind === 'ProviderConfig' && mrNs ? `${mrNs}/` : ''}${pcName}` });
    }
    const owner = getControllerOwner(object);
    // ownerReferences carry no namespace: a namespaced owner lives in the MR's namespace. getObject strips
    // the namespace again for cluster-scoped XR kinds.
    const mrNamespace = asString(getPath(object, 'metadata', 'namespace'));
    if (owner) out.push(makeLink('Composite', { ...owner, ...(mrNamespace ? { namespace: mrNamespace } : {}), category: 'composite' }));
    out.push(...secretText('Connection secret', getPath(object, 'spec', 'writeConnectionSecretToRef')));
    return out;
}

function usageTarget(label: string, target: unknown, usageNs: string | undefined): DrawerLink[] {
    const t = asRecord(target);
    if (!t) return [];
    const kind = asString(t.kind) ?? 'Resource';
    const name = asString(getPath(t, 'resourceRef', 'name'));
    if (name) {
        return [makeLink(label, {
            apiVersion: asString(t.apiVersion), kind, name,
            namespace: asString(getPath(t, 'resourceRef', 'namespace')) ?? usageNs,
        })];
    }
    const match = asRecord(getPath(t, 'resourceSelector', 'matchLabels'));
    if (match) return [{ label, text: `selector: ${Object.entries(match).map(([k, v]) => `${k}=${String(v)}`).join(',')}` }];
    return [];
}

function operationLinks(object: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    const kind = asString(getPath(object, 'kind'));
    const pipeline = kind === 'Operation' ? getPath(object, 'spec', 'pipeline') : getPath(object, 'spec', 'operationTemplate', 'spec', 'pipeline');
    const out = functionLinks(pipeline, ctx);
    for (const r of asArray(getPath(object, 'status', 'runningOperationRefs'))) {
        const name = asString(getPath(r, 'name'));
        if (name) out.push(makeLink('Running operation', { apiVersion: ctx.detection.kindVersions.Operation, kind: 'Operation', name, category: 'operation' }));
    }
    return out;
}

export function resolveDrawerRefs(category: CrossplaneCategory | null, object: unknown, ctx: DrawerRefsContext): DrawerLink[] {
    switch (category) {
        case 'provider': return packageLinks('Provider', object, ctx);
        case 'function': return packageLinks('Function', object, ctx);
        case 'configuration': return packageLinks('Configuration', object, ctx);
        case 'packageRevision': return revisionLinks(object);
        case 'runtimeConfig': return runtimeConfigLinks(object, ctx);
        case 'providerConfig':
            return secretText('Credentials', getPath(object, 'spec', 'credentials', 'secretRef'));
        case 'activationPolicy': case 'environmentConfig': return [];
        case 'xrd': return xrdLinks(object, ctx);
        case 'composition': case 'compositionRevision': return compositionLinks(category, object, ctx);
        case 'composite': case 'claim': return compositeOrClaimLinks(category, object, ctx);
        case 'managed': return managedLinks(object, ctx);
        case 'usage': {
            const ns = asString(getPath(object, 'metadata', 'namespace'));
            return [...usageTarget('Of', getPath(object, 'spec', 'of'), ns), ...usageTarget('By', getPath(object, 'spec', 'by'), ns)];
        }
        case 'operation': return operationLinks(object, ctx);
        default: return [];
    }
}
