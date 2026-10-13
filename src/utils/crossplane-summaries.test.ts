import { describe, it, expect } from 'vitest';
import {
    summarizeActivationPolicy, summarizeClaim, summarizeComposite, summarizeComposition, summarizeCompositionRevision,
    summarizeEnvironmentConfig, summarizeManaged, summarizeOperation, summarizePackage, summarizeProviderConfig,
    summarizeRevision, summarizeRuntimeConfig, summarizeUsage, summarizeXrd,
} from './crossplane-summaries';
import * as F from './__fixtures__/crossplane-fixtures';

const { NOW } = F;

type Summariser = (obj: unknown) => object | null;
const ALL: Record<string, Summariser> = {
    package: o => summarizePackage(o, NOW),
    revision: o => summarizeRevision(o, NOW),
    xrd: o => summarizeXrd(o, NOW),
    composition: o => summarizeComposition(o, NOW),
    compositionRevision: o => summarizeCompositionRevision(o, NOW),
    composite: o => summarizeComposite(o, NOW),
    claim: o => summarizeClaim(o, NOW),
    managed: o => summarizeManaged(o, 'p', NOW),
    usage: o => summarizeUsage(o, NOW),
    providerConfig: o => summarizeProviderConfig(o, 'p', NOW),
    runtimeConfig: o => summarizeRuntimeConfig(o, NOW),
    activationPolicy: o => summarizeActivationPolicy(o, NOW),
    environmentConfig: o => summarizeEnvironmentConfig(o, NOW),
    operation: o => summarizeOperation(o, NOW),
};

const COUNT_FIELDS = ['healthOrder', 'revisionHealthOrder', 'installedDefinitionCount', 'usedByCount', 'depsFound', 'depsInstalled',
    'stepCount', 'revisionCount', 'resourceRefCount', 'runningCount', 'watchingResources', 'userCount', 'activatedCount', 'keyCount',
    'objectRefCount', 'revision'];

function expectNumericCounts(row: object) {
    for (const [k, v] of Object.entries(row)) if (COUNT_FIELDS.includes(k)) expect(typeof v, k).toBe('number');
}

describe('malformed input', () => {
    const bad: unknown[] = [null, undefined, 42, 'x', [], {}, { metadata: { name: 'n' } }, { metadata: { uid: 'u' } }];
    for (const [name, fn] of Object.entries(ALL)) {
        it(`${name} returns null for missing metadata.name/uid`, () => {
            for (const b of bad) expect(fn(b)).toBeNull();
        });
    }
    it('missing spec still yields numeric counts', () => {
        const objs: Record<string, unknown> = {
            package: { apiVersion: 'pkg.crossplane.io/v1', kind: 'Provider', metadata: { name: 'p', uid: 'u' } },
            operation: { apiVersion: 'ops.crossplane.io/v1alpha1', kind: 'WatchOperation', metadata: { name: 'p', uid: 'u' } },
        };
        for (const name of Object.keys(ALL)) {
            const row = ALL[name](objs[name] ?? { apiVersion: 'x.io/v1', kind: 'X', metadata: { name: 'p', uid: 'u' } });
            expect(row, name).not.toBeNull();
            if (row) expectNumericCounts(row);
        }
    });
});

describe('summarisers on fixtures', () => {
    it('package', () => {
        const p = summarizePackage(F.provider, NOW)!;
        expect(p).toMatchObject({
            category: 'provider', health: 'healthy', healthOrder: 4, installed: 'True', healthy: 'True',
            packageRef: 'xpkg.upbound.io/upbound/provider-aws-ec2:v1.0.0', currentRevision: 'provider-aws-ec2-abc',
            runtimeConfigName: 'default', revisions: [], key: 'pkg.crossplane.io/v1|Provider||provider-aws-ec2',
        });
        expect(p.age).toBe(F.provider.metadata.creationTimestamp);
        expect(summarizePackage(F.fn, NOW)?.category).toBe('function');
        expect(summarizePackage(F.configuration, NOW)?.category).toBe('configuration');
        expect(summarizePackage(F.providerRevisionV2, NOW)).toBeNull();
        expectNumericCounts(p);
    });
    it('revision', () => {
        expect(summarizeRevision(F.providerRevisionV2, NOW)).toMatchObject({
            category: 'packageRevision', packageName: 'provider-aws-ec2', revision: 3, desiredState: 'Active',
            image: 'xpkg.upbound.io/upbound/provider-aws-ec2:v1.0.0', objectRefCount: 8, health: 'healthy',
        });
        expect(summarizeRevision(F.providerRevisionInactive, NOW)).toMatchObject({ desiredState: 'Inactive', health: 'none' });
    });
    it('xrd', () => {
        expect(summarizeXrd(F.xrdV1WithClaims, NOW)).toMatchObject({
            group: 'platform.example.io', xrKind: 'XDatabase', xrPlural: 'xdatabases', version: 'v1', scope: 'LegacyCluster',
            claimKind: 'Database', claimPlural: 'databases', established: 'True', offered: 'True', defaultComposition: 'xdatabases-aws',
        });
        expect(summarizeXrd(F.xrdV2NoScope, NOW)).toMatchObject({ scope: 'Namespaced', claimKind: undefined });
    });
    it('composition and revision', () => {
        expect(summarizeComposition(F.composition, NOW)).toMatchObject({
            compositeApiVersion: 'platform.example.io/v1', compositeKind: 'XDatabase', mode: 'Pipeline', stepCount: 2,
            steps: [{ step: 'patch-and-transform', functionName: 'function-patch-and-transform' }, { step: 'auto-ready', functionName: 'function-auto-ready' }],
            revisionCount: 0, health: 'none', category: 'composition',
        });
        expect(summarizeComposition({ ...F.composition, spec: { compositeTypeRef: F.composition.spec.compositeTypeRef } }, NOW)?.mode).toBe('Resources');
        expect(summarizeCompositionRevision(F.compositionRevision, NOW)).toMatchObject({
            category: 'compositionRevision', compositionName: 'xdatabases-aws', revision: 2, health: 'unknown',
        });
    });
    it('composite v1 and v2', () => {
        expect(summarizeComposite(F.xrV1, NOW, { scope: 'LegacyCluster' })).toMatchObject({
            scope: 'LegacyCluster', compositionName: 'xdatabases-aws', compositionRevisionName: 'xdatabases-aws-1a2b3c',
            resourceRefCount: 2, claim: { apiVersion: 'platform.example.io/v1', kind: 'Database', name: 'orders-db', namespace: 'team-a', category: 'claim' },
            health: 'unhealthy', synced: 'False',
        });
        const v2 = summarizeComposite(F.xrV2, NOW)!;
        expect(v2).toMatchObject({ scope: 'Namespaced', namespace: 'team-b', resourceRefCount: 1, claimName: 'billing', health: 'progressing' });
        expect(v2.claim).toBeUndefined();
        expect(summarizeComposite(F.xrV2, NOW, { claimApiVersion: 'platform.example.io/v1', claimKind: 'Database' })?.claim)
            .toEqual({ apiVersion: 'platform.example.io/v1', kind: 'Database', name: 'billing', namespace: 'team-b', category: 'claim' });
    });
    it('claim', () => {
        expect(summarizeClaim(F.claim, NOW)).toMatchObject({
            namespace: 'team-a', health: 'healthy', connectionSecretName: 'orders-db-conn', compositionName: 'xdatabases-aws',
            compositeRef: { apiVersion: 'platform.example.io/v1', kind: 'XDatabase', name: 'orders-db-x7k2p', category: 'composite' },
        });
    });
    it('managed', () => {
        expect(summarizeManaged(F.mrReconcileError, 'provider-aws-ec2', NOW, 'ec2.aws.upbound.io/v1beta1/instances')).toMatchObject({
            kindKey: 'ec2.aws.upbound.io/v1beta1/instances', providerName: 'provider-aws-ec2', externalName: 'i-web-4',
            providerConfigName: 'default', managementPolicies: ['*'], deletionPolicy: 'Delete', compositeName: 'orders-db-x7k2p',
            claim: 'orders-db', health: 'unhealthy', healthReason: 'ReconcileError', synced: 'False', ready: 'True',
        });
        expect(summarizeManaged(F.mrNamespaced, undefined, NOW)).toMatchObject({ namespace: 'team-a', providerConfigKind: 'ProviderConfig', kindKey: '' });
    });
    it('usage', () => {
        expect(summarizeUsage(F.usageRef, NOW)).toMatchObject({
            of: 'Instance/orders-db-x7k2p-rds', by: 'SecurityGroup/orders-db-x7k2p-sg', reason: 'database in use', replayDeletion: true, health: 'healthy',
        });
        expect(summarizeUsage(F.usageSelector, NOW)).toMatchObject({ of: 'VPC (selector: tier=net,env=prod)', by: 'XDatabase/billing-db', health: 'unhealthy' });
    });
    it('provider config, runtime config, activation policy, environment config', () => {
        expect(summarizeProviderConfig(F.providerConfig, 'provider-aws', NOW)).toMatchObject({
            providerName: 'provider-aws', credentialsSource: 'Secret', userCount: 4, health: 'none',
        });
        expect(summarizeRuntimeConfig(F.runtimeConfig, NOW)).toMatchObject({ usedBy: [], usedByCount: 0, health: 'none' });
        expect(summarizeActivationPolicy(F.activationPolicy, NOW)).toMatchObject({
            patterns: ['*.ec2.aws.upbound.io', 'buckets.s3.aws.upbound.io'], activatedCount: 1, health: 'healthy',
        });
        expect(summarizeEnvironmentConfig(F.environmentConfig, NOW)).toMatchObject({ keys: ['region', 'tier', 'secretish'], keyCount: 3, health: 'none' });
    });
    it('operations', () => {
        expect(summarizeOperation(F.operation, NOW)).toMatchObject({ opKind: 'Operation', mode: 'Pipeline', stepCount: 1, succeeded: 'True', health: 'healthy' });
        expect(summarizeOperation(F.cronOperation, NOW)).toMatchObject({
            opKind: 'CronOperation', schedule: '0 2 * * *', stepCount: 2, runningCount: 2, scheduling: 'True', mode: 'Pipeline',
            lastScheduleTime: F.cronOperation.status.lastScheduleTime, lastSuccessfulTime: F.cronOperation.status.lastSuccessfulTime,
        });
        expect(summarizeOperation(F.watchOperation, NOW)).toMatchObject({
            opKind: 'WatchOperation', watchedApiVersion: 'v1', watchedKind: 'ConfigMap', watchingResources: 12, watching: 'True', health: 'healthy',
        });
        expect(summarizeOperation(F.provider, NOW)).toBeNull();
    });
});
