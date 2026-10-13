import { describe, it, expect } from 'vitest';
import type { CrossplaneDefinitionsPayload, CrossplanePackagesPayload, DrawerLink } from '../types/crossplane';
import { refRequestSchema } from '../../electron/crossplane-ipc-schemas';
import { resolveDrawerRefs, makeLink } from './crossplane-drawer-refs';
import type { DrawerRefsContext } from './crossplane-drawer-refs';
import {
    summarizeComposition, summarizeCompositionRevision, summarizePackage, summarizeProviderConfig, summarizeRevision, summarizeXrd,
} from './crossplane-summaries';
import * as F from './__fixtures__/crossplane-fixtures';

const { NOW, detection } = F;
const nn = <T,>(v: T | null): T => { if (v === null) throw new Error('fixture failed to summarise'); return v; };

const fnRow = { ...nn(summarizePackage(F.fn, NOW)), usedByCompositions: ['xdatabases-aws'], usedByCount: 1 };
const packages: CrossplanePackagesPayload = {
    providers: [nn(summarizePackage(F.provider, NOW))], functions: [fnRow], configurations: [nn(summarizePackage(F.configuration, NOW))],
    revisions: [nn(summarizeRevision(F.providerRevisionV2, NOW)), nn(summarizeRevision(F.providerRevisionInactive, NOW))],
    providerConfigs: [
        nn(summarizeProviderConfig(F.providerConfig, 'provider-aws-ec2', NOW)),
        nn(summarizeProviderConfig(F.providerConfigNamespaced, 'provider-aws-ec2', NOW)),
    ],
    runtimeConfigs: [], activationPolicies: [], providerApiGroups: [],
    errors: [], fetchedAt: '', truncatedKinds: [], skippedMalformed: 0,
};
const definitions: CrossplaneDefinitionsPayload = {
    xrds: [nn(summarizeXrd(F.xrdV1WithClaims, NOW)), nn(summarizeXrd(F.xrdV2Namespaced, NOW))],
    compositions: [nn(summarizeComposition(F.composition, NOW)), nn(summarizeComposition(F.compositionOrphan, NOW))],
    compositionRevisions: [nn(summarizeCompositionRevision(F.compositionRevision, NOW))],
    environmentConfigs: [], claimsSupported: true,
    errors: [], fetchedAt: '', truncatedKinds: [], skippedMalformed: 0,
};
const ctx: DrawerRefsContext = { detection, packages, definitions };

/** Every emitted ref must pass the IPC schema; Secrets never become links. */
function check(links: DrawerLink[]): DrawerLink[] {
    for (const l of links) {
        if (l.ref) {
            expect(refRequestSchema.safeParse({ context: 'ctx', ref: l.ref }).success, JSON.stringify(l)).toBe(true);
            expect(l.ref.kind === 'Secret' && l.ref.apiVersion === 'v1').toBe(false);
        }
    }
    return links;
}
const summary = (links: DrawerLink[]) => links.map(l => `${l.label}:${l.ref ? `${l.ref.apiVersion}|${l.ref.kind}|${l.ref.namespace ?? ''}|${l.ref.name}` : `text(${l.text})`}`);

describe('resolveDrawerRefs', () => {
    it('null category → []', () => {
        expect(resolveDrawerRefs(null, F.mrd, ctx)).toEqual([]);
    });
    it('provider: runtime config + revisions', () => {
        expect(summary(check(resolveDrawerRefs('provider', F.provider, ctx)))).toEqual([
            'Runtime config:pkg.crossplane.io/v1beta1|DeploymentRuntimeConfig||default',
            'Revision:pkg.crossplane.io/v1|ProviderRevision||provider-aws-ec2-abc',
            'Revision:pkg.crossplane.io/v1|ProviderRevision||provider-aws-ec2-old',
        ]);
        const revLink = resolveDrawerRefs('provider', F.provider, ctx)[1];
        expect(revLink.ref?.category).toBe('packageRevision');
    });
    it('provider without packages payload falls back to status.currentRevision', () => {
        expect(summary(check(resolveDrawerRefs('provider', F.provider, { detection })))).toEqual([
            'Runtime config:pkg.crossplane.io/v1beta1|DeploymentRuntimeConfig||default',
            'Revision:pkg.crossplane.io/v1|ProviderRevision||provider-aws-ec2-abc',
        ]);
    });
    it('function: used by compositions', () => {
        expect(summary(check(resolveDrawerRefs('function', F.fn, ctx)))).toEqual([
            'Used by:apiextensions.crossplane.io/v1|Composition||xdatabases-aws',
        ]);
    });
    it('configuration: no runtime config, no revisions known', () => {
        expect(check(resolveDrawerRefs('configuration', F.configuration, ctx))).toEqual([]);
    });
    it('packageRevision: owner package', () => {
        expect(summary(check(resolveDrawerRefs('packageRevision', F.providerRevisionV2, ctx)))).toEqual([
            'Package:pkg.crossplane.io/v1|Provider||provider-aws-ec2',
        ]);
    });
    it('runtimeConfig: used-by packages are their row refs', () => {
        const links = check(resolveDrawerRefs('runtimeConfig', F.runtimeConfig, ctx));
        expect(summary(links)).toEqual(['Used by:pkg.crossplane.io/v1|Provider||provider-aws-ec2']);
        expect(Object.keys(links[0].ref ?? {}).sort()).toEqual(['apiVersion', 'category', 'kind', 'name']);
    });
    it('providerConfig: credentials secretRef is text only', () => {
        expect(resolveDrawerRefs('providerConfig', F.providerConfig, ctx)).toEqual([
            { label: 'Credentials', text: 'Secret/crossplane-system/aws-creds' },
        ]);
        expect(resolveDrawerRefs('providerConfig', F.providerConfigNamespaced, ctx)).toEqual([]);
    });
    it('activationPolicy and environmentConfig: no refs', () => {
        expect(resolveDrawerRefs('activationPolicy', F.activationPolicy, ctx)).toEqual([]);
        expect(resolveDrawerRefs('environmentConfig', F.environmentConfig, ctx)).toEqual([]);
    });
    it('xrd: default composition + matching compositions', () => {
        expect(summary(check(resolveDrawerRefs('xrd', F.xrdV1WithClaims, ctx)))).toEqual([
            'Default composition:apiextensions.crossplane.io/v1|Composition||xdatabases-aws',
            'Composition:apiextensions.crossplane.io/v1|Composition||xdatabases-aws',
        ]);
        expect(resolveDrawerRefs('xrd', F.xrdV2Namespaced, ctx)).toEqual([]);
    });
    it('composition: compositeTypeRef with XRD, functions, revisions', () => {
        expect(summary(check(resolveDrawerRefs('composition', F.composition, ctx)))).toEqual([
            'Composite type:apiextensions.crossplane.io/v2|CompositeResourceDefinition||xdatabases.platform.example.io',
            'Function:pkg.crossplane.io/v1|Function||function-patch-and-transform',
            'Function:pkg.crossplane.io/v1|Function||function-auto-ready',
            'Revision:apiextensions.crossplane.io/v1|CompositionRevision||xdatabases-aws-1a2b3c',
        ]);
    });
    it('composition: compositeTypeRef without XRD → text', () => {
        expect(resolveDrawerRefs('composition', F.compositionOrphan, ctx)).toEqual([
            { label: 'Composite type', text: 'XOrphan (other.example.io/v1)' },
        ]);
        expect(resolveDrawerRefs('composition', F.composition, { detection })[0]).toEqual({ label: 'Composite type', text: 'XDatabase (platform.example.io/v1)' });
    });
    it('compositionRevision: parent composition', () => {
        expect(summary(check(resolveDrawerRefs('compositionRevision', F.compositionRevision, ctx))).slice(-1)).toEqual([
            'Composition:apiextensions.crossplane.io/v1|Composition||xdatabases-aws',
        ]);
    });
    it('composite v1: composition, revision, claimRef, connection secret text', () => {
        expect(summary(check(resolveDrawerRefs('composite', F.xrV1, ctx)))).toEqual([
            'Composition:apiextensions.crossplane.io/v1|Composition||xdatabases-aws',
            'Composition revision:apiextensions.crossplane.io/v1|CompositionRevision||xdatabases-aws-1a2b3c',
            'Claim:platform.example.io/v1|Database|team-a|orders-db',
            'Connection secret:text(Secret/crossplane-system/orders-db-x7k2p)',
        ]);
    });
    it('composite v2: claim from labels resolved via XRD claimNames; text without definitions', () => {
        expect(summary(check(resolveDrawerRefs('composite', F.xrV2, ctx)))).toContain('Claim:platform.example.io/v1|Database|team-b|billing');
        expect(summary(resolveDrawerRefs('composite', F.xrV2, { detection }))).toContain('Claim:text(Claim/team-b/billing)');
    });
    it('claim: XR via resourceRef, connection secret in claim namespace is text', () => {
        expect(summary(check(resolveDrawerRefs('claim', F.claim, ctx)))).toEqual([
            'Composition:apiextensions.crossplane.io/v1|Composition||xdatabases-aws',
            'Composite:platform.example.io/v1|XDatabase||orders-db-x7k2p',
            'Connection secret:text(Secret/team-a/orders-db-conn)',
        ]);
    });
    it('managed: providerConfigRef found, composite owner', () => {
        expect(summary(check(resolveDrawerRefs('managed', F.mrHealthy, ctx)))).toEqual([
            'Provider config:aws.upbound.io/v1beta1|ProviderConfig||default',
            'Composite:platform.example.io/v1|XDatabase||orders-db-x7k2p',
        ]);
    });
    it('managed: providerConfigRef matched by providerName when given', () => {
        expect(resolveDrawerRefs('managed', F.mrHealthy, { ...ctx, providerName: 'provider-aws-ec2' })[0].ref?.name).toBe('default');
        expect(resolveDrawerRefs('managed', F.mrHealthy, { ...ctx, providerName: 'other' })[0]).toEqual({ label: 'Provider config', text: 'ProviderConfig/default' });
    });
    it('managed: providerConfigRef not found → text', () => {
        expect(resolveDrawerRefs('managed', F.mrHealthy, { detection })[0]).toEqual({ label: 'Provider config', text: 'ProviderConfig/default' });
    });
    it('managed: namespaced MR matches namespaced ProviderConfig in its namespace', () => {
        const links = check(resolveDrawerRefs('managed', F.mrNamespaced, ctx));
        expect(summary(links)[0]).toBe('Provider config:aws.m.upbound.io/v1beta1|ProviderConfig|team-a|team-a');
        const otherNs = { ...F.mrNamespaced, metadata: { ...F.mrNamespaced.metadata, namespace: 'team-z' } };
        expect(resolveDrawerRefs('managed', otherNs, ctx)[0]).toEqual({ label: 'Provider config', text: 'ProviderConfig/team-z/team-a' });
    });
    it('managed: namespaced MR → Composite link inherits the MR namespace', () => {
        const composite = summary(check(resolveDrawerRefs('managed', F.mrNamespaced, ctx))).find(s => s.startsWith('Composite:'));
        expect(composite).toMatch(/^Composite:platform\.example\.io\/v1\|XDatabase\|team-a\|/);
    });
    it('usage: resourceRef link and resourceSelector text', () => {
        expect(summary(check(resolveDrawerRefs('usage', F.usageRef, ctx)))).toEqual([
            'Of:rds.aws.upbound.io/v1beta1|Instance||orders-db-x7k2p-rds',
            'By:ec2.aws.upbound.io/v1beta1|SecurityGroup||orders-db-x7k2p-sg',
        ]);
        expect(summary(check(resolveDrawerRefs('usage', F.usageSelector, ctx)))).toEqual([
            'Of:text(selector: tier=net,env=prod)',
            'By:platform.example.io/v1|XDatabase|team-b|billing-db',
        ]);
    });
    it('operation: pipeline functions and running operations', () => {
        expect(summary(check(resolveDrawerRefs('operation', F.operation, ctx)))).toEqual(['Function:pkg.crossplane.io/v1|Function||function-rotate']);
        expect(summary(check(resolveDrawerRefs('operation', F.cronOperation, ctx)))).toEqual([
            'Function:pkg.crossplane.io/v1|Function||function-a',
            'Running operation:ops.crossplane.io/v1alpha1|Operation||nightly-1',
            'Running operation:ops.crossplane.io/v1alpha1|Operation||nightly-2',
        ]);
        expect(summary(check(resolveDrawerRefs('operation', F.watchOperation, ctx)))).toEqual(['Function:pkg.crossplane.io/v1|Function||function-react']);
    });
    it('unresolvable kindVersion → text', () => {
        const noKinds: DrawerRefsContext = { detection: { ...detection, kindVersions: {} } };
        expect(resolveDrawerRefs('provider', F.provider, noKinds)).toEqual([
            { label: 'Runtime config', text: 'DeploymentRuntimeConfig/default' },
            { label: 'Revision', text: 'ProviderRevision/provider-aws-ec2-abc' },
        ]);
    });
    it('makeLink: Secret and invalid refs are text', () => {
        expect(makeLink('S', { apiVersion: 'v1', kind: 'Secret', name: 'creds', namespace: 'ns' })).toEqual({ label: 'S', text: 'Secret/ns/creds' });
        expect(makeLink('Bad', { apiVersion: 'a.io/v1', kind: 'Thing', name: 'Not_Valid' }).ref).toBeUndefined();
        expect(makeLink('Ok', { apiVersion: 'v1', kind: 'ConfigMap', name: 'cm', namespace: 'ns' }).ref).toEqual({ apiVersion: 'v1', kind: 'ConfigMap', name: 'cm', namespace: 'ns' });
    });
});
