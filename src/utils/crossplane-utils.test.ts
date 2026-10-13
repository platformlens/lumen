import { describe, it, expect } from 'vitest';
import { CROSSPLANE_CATEGORIES } from '../types/crossplane';
import type { CrossplaneCondition, CrossplaneRowBase } from '../types/crossplane';
import { refRequestSchema } from '../../electron/crossplane-ipc-schemas';
import {
    classifyCrossplaneObject, collectNeedsAttention, compareKubeVersions, countHealth, crossplaneKey, deriveHealth,
    deriveObjectHealth, filterCrossplaneEvents, getClaimRef, getCompositionRef, getConditions, getControllerOwner,
    getResourceRefs, isValidCrossplaneRef, parseCrdName, partitionObjectRefs, pickKindVersion, pickReferenceableVersion,
    resolveKindVersion, resolveXrdScope, revisionFingerprint, toCrossplaneRef,
} from './crossplane-utils';
import { summarizePackage, summarizeRevision, summarizeXrd } from './crossplane-summaries';
import * as F from './__fixtures__/crossplane-fixtures';

const { NOW, MIN, cond } = F;
const conds = (...c: ReturnType<typeof cond>[]) => getConditions({ status: { conditions: c } });
const h = (category: Parameters<typeof deriveHealth>[0], c: CrossplaneCondition[], meta = {}) => deriveHealth(category, c, meta, NOW);

describe('CROSSPLANE_CATEGORIES (AM-1)', () => {
    it('is exactly the AM-1 list', () => {
        expect([...CROSSPLANE_CATEGORIES]).toEqual(['provider', 'function', 'configuration', 'packageRevision', 'providerConfig',
            'runtimeConfig', 'activationPolicy', 'xrd', 'composition', 'compositionRevision', 'environmentConfig',
            'composite', 'claim', 'usage', 'operation', 'managed']);
    });
});

describe('deriveHealth', () => {
    it('packages v1/v2: Installed + Healthy', () => {
        expect(deriveObjectHealth('provider', F.provider, NOW).health).toBe('healthy');
        const bad = deriveObjectHealth('provider', F.providerUnhealthy, NOW);
        expect(bad).toMatchObject({ health: 'unhealthy', reason: 'UnhealthyPackageRevision', message: 'pod crashloop' });
        expect(deriveObjectHealth('configuration', F.configuration, NOW).health).toBe('progressing');
    });
    it('packageRevision v2 uses RevisionHealthy + RuntimeHealthy', () => {
        expect(deriveObjectHealth('packageRevision', F.providerRevisionV2, NOW).health).toBe('healthy');
        expect(deriveObjectHealth('packageRevision', F.providerRevisionV2Unhealthy, NOW)).toMatchObject({ health: 'unhealthy', reason: 'Unavailable' });
        expect(h('packageRevision', conds(cond('RevisionHealthy', 'True'), cond('Healthy', 'False', 'X'))).health).toBe('healthy');
    });
    it('packageRevision v1 falls back to Healthy', () => {
        expect(deriveObjectHealth('packageRevision', F.providerRevisionV1, NOW).health).toBe('healthy');
        expect(h('packageRevision', conds(cond('Healthy', 'False', 'UnhealthyPackageRevision'))).health).toBe('unhealthy');
    });
    it('Inactive packageRevision → none', () => {
        expect(deriveObjectHealth('packageRevision', F.providerRevisionInactive, NOW).health).toBe('none');
    });
    it('xrd requires Offered only with claimNames', () => {
        expect(deriveObjectHealth('xrd', F.xrdV1WithClaims, NOW).health).toBe('healthy');
        expect(deriveObjectHealth('xrd', F.xrdV2Namespaced, NOW).health).toBe('healthy');
        expect(deriveObjectHealth('xrd', F.xrdNotOffered, NOW)).toMatchObject({ health: 'unhealthy', reason: 'OfferFailed' });
        expect(h('xrd', conds(cond('Established', 'True'), cond('Offered', 'False', 'OfferFailed'))).health).toBe('healthy');
        expect(h('xrd', conds(cond('Established', 'True')), { claimNamesSet: true }).health).toBe('progressing');
    });
    it('XR Synced=False ReconcileError → unhealthy; Ready=False Creating → progressing', () => {
        expect(deriveObjectHealth('composite', F.xrV1, NOW)).toMatchObject({ health: 'unhealthy', reason: 'ReconcileError', message: 'cannot compose resources' });
        expect(deriveObjectHealth('composite', F.xrV2, NOW)).toMatchObject({ health: 'progressing', reason: 'Creating' });
    });
    it('managed resources: fresh vs stuck, ReconcileError, LastAsyncOperation, paused, deleting, no conditions', () => {
        expect(deriveObjectHealth('managed', F.mrHealthy, NOW).health).toBe('healthy');
        expect(deriveObjectHealth('managed', F.mrCreatingFresh, NOW)).toMatchObject({ health: 'progressing', reason: 'Creating' });
        const stuck = deriveObjectHealth('managed', F.mrCreatingStuck, NOW);
        expect(stuck.health).toBe('unhealthy');
        expect(stuck.reason).toBe('Stuck: Creating for 16m');
        expect(deriveObjectHealth('managed', F.mrReconcileError, NOW)).toMatchObject({ health: 'unhealthy', reason: 'ReconcileError' });
        expect(deriveObjectHealth('managed', F.mrAsyncFailed, NOW)).toMatchObject({
            health: 'unhealthy', reason: 'ApplyFailure', message: 'InvalidParameterValue: bad AMI',
        });
        expect(deriveObjectHealth('managed', F.mrPaused, NOW).health).toBe('paused');
        expect(deriveObjectHealth('managed', F.mrDeleting, NOW)).toMatchObject({ health: 'progressing', reason: 'Deleting' });
        expect(deriveObjectHealth('managed', F.mrNoConditions, NOW).health).toBe('unknown');
    });
    it('deleting for more than 15 minutes escalates', () => {
        const r = h('managed', conds(cond('Synced', 'True'), cond('Ready', 'True')), { deletionTimestamp: F.iso(2 * 60 * MIN) });
        expect(r).toMatchObject({ health: 'unhealthy', reason: 'Stuck: Deleting for 2h' });
    });
    it('Synced=False ReconcilePaused → paused', () => {
        expect(h('composite', conds(cond('Synced', 'False', 'ReconcilePaused'), cond('Ready', 'True'))).health).toBe('paused');
    });
    it('none categories', () => {
        for (const c of ['composition', 'environmentConfig', 'runtimeConfig', 'providerConfig'] as const) {
            expect(h(c, conds(cond('Ready', 'False', 'Boom'))).health).toBe('none');
        }
    });
    it('truncates messages to 500 characters', () => {
        const r = h('managed', conds(cond('Synced', 'False', 'ReconcileError', MIN, 'x'.repeat(900))));
        expect(r.message?.length).toBe(500);
    });
    it('generic rule (usage, activationPolicy, compositionRevision)', () => {
        expect(h('generic', conds(cond('Ready', 'True'))).health).toBe('healthy');
        expect(h('usage', conds(cond('Synced', 'True'), cond('Ready', 'False', 'ReconcileError'))).health).toBe('unhealthy');
        expect(h('activationPolicy', conds(cond('Foo', 'False', 'Bad'))).health).toBe('unhealthy');
        expect(h('compositionRevision', [])).toMatchObject({ health: 'unknown' });
        expect(h('compositionRevision', conds(cond('Ready', 'True'))).health).toBe('healthy');
    });
    it('operations', () => {
        expect(deriveObjectHealth('operation', F.operation, NOW).health).toBe('healthy');
        expect(deriveObjectHealth('operation', F.operationFailed, NOW)).toMatchObject({ health: 'unhealthy', reason: 'PipelineError' });
        expect(deriveObjectHealth('operation', F.operationRunning, NOW)).toMatchObject({ health: 'progressing', reason: 'PipelineRunning' });
        const stuck = deriveObjectHealth('operation', F.operationStuck, NOW);
        expect(stuck.health).toBe('unhealthy');
        expect(stuck.reason).toMatch(/^Stuck: PipelineRunning/);
        expect(h('operation', conds(cond('Synced', 'True'), cond('Scheduling', 'False', 'ScheduleInvalid')), { kind: 'CronOperation' }).health).toBe('unhealthy');
        expect(h('operation', conds(cond('Synced', 'True'), cond('Scheduling', 'False', 'SchedulePaused')), { kind: 'CronOperation' }).health).toBe('paused');
        expect(h('operation', conds(cond('Synced', 'True'), cond('Watching', 'False', 'WatchFailed')), { kind: 'WatchOperation' }).health).toBe('unhealthy');
        expect(h('operation', conds(cond('Synced', 'True'), cond('Watching', 'False', 'WatchPaused')), { kind: 'WatchOperation' }).health).toBe('paused');
        expect(deriveObjectHealth('operation', F.cronOperation, NOW).health).toBe('healthy');
    });
});

describe('references', () => {
    it('v1 spec.resourceRefs vs v2 spec.crossplane.resourceRefs (nameless entries skipped)', () => {
        expect(getResourceRefs(F.xrV1).map(r => r.name)).toEqual(['orders-db-x7k2p-rds', 'orders-db-x7k2p-sg']);
        expect(getResourceRefs(F.xrV2)).toEqual([{ apiVersion: 'rds.aws.m.upbound.io/v1beta1', kind: 'Instance', name: 'billing-db-rds' }]);
        expect(getResourceRefs({})).toEqual([]);
    });
    it('compositionRef from both locations', () => {
        expect(getCompositionRef(F.xrV1)).toBe('xdatabases-aws');
        expect(getCompositionRef(F.xrV2)).toBe('xdatabases-aws');
    });
    it('claimRef vs labels', () => {
        expect(getClaimRef(F.xrV1)).toEqual({ name: 'orders-db', namespace: 'team-a', apiVersion: 'platform.example.io/v1', kind: 'Database' });
        expect(getClaimRef(F.xrV2)).toEqual({ name: 'billing', namespace: 'team-b' });
        expect(getClaimRef(F.mrHealthy)?.name).toBe('orders-db');
        expect(getClaimRef({})).toBeUndefined();
    });
    it('controller owner', () => {
        expect(getControllerOwner(F.mrHealthy)).toMatchObject({ kind: 'XDatabase', name: 'orders-db-x7k2p' });
        expect(getControllerOwner(F.provider)).toBeUndefined();
    });
});

describe('discovery parsing', () => {
    it('parseCrdName', () => {
        expect(parseCrdName('instances.ec2.aws.upbound.io')).toEqual({ plural: 'instances', group: 'ec2.aws.upbound.io' });
        expect(parseCrdName('INVALID')).toBeNull();
        expect(parseCrdName('nodot')).toBeNull();
        expect(parseCrdName('a.b/c')).toBeNull();
    });
    it('pickReferenceableVersion', () => {
        expect(pickReferenceableVersion(F.xrdV1WithClaims)).toBe('v1');
        expect(pickReferenceableVersion(F.xrdV2NoScope)).toBe('v1');
        expect(pickReferenceableVersion({ spec: { versions: [{ name: 'v1alpha1' }] } })).toBe('v1alpha1');
        expect(pickReferenceableVersion({})).toBeUndefined();
    });
    it('pickKindVersion ordering', () => {
        expect(pickKindVersion(['v1alpha1', 'v1beta1', 'v1', 'v1beta2', 'v2'])).toBe('v2');
        expect(['v1alpha1', 'weird', 'v1beta1', 'v1', 'v1beta2', 'v2'].sort(compareKubeVersions))
            .toEqual(['v2', 'v1', 'v1beta2', 'v1beta1', 'v1alpha1', 'weird']);
        expect(pickKindVersion([])).toBeUndefined();
    });
    it('resolveKindVersion with mixed served versions', () => {
        const group = { preferredVersion: 'v1beta2', versions: ['v1beta2', 'v1beta1'] };
        const res = {
            v1beta2: [{ name: 'instances', kind: 'Instance', namespaced: false }, { name: 'instances/status', kind: 'Instance', namespaced: false }],
            v1beta1: [{ name: 'instances', kind: 'Instance', namespaced: false }, { name: 'foos', kind: 'Foo', namespaced: true }],
        };
        expect(resolveKindVersion('foos', group, res)).toEqual({ active: true, servedVersions: ['v1beta1'], version: 'v1beta1', kind: 'Foo', namespaced: true });
        expect(resolveKindVersion('instances', group, res)).toMatchObject({ active: true, version: 'v1beta2', kind: 'Instance' });
        expect(resolveKindVersion('bars', group, res)).toEqual({ active: false, servedVersions: [] });
        expect(resolveKindVersion('instances', { versions: ['v1beta1', 'v1beta2'] }, res).version).toBe('v1beta2');
    });
    it('resolveXrdScope', () => {
        expect(resolveXrdScope(F.xrdV2Namespaced)).toBe('Namespaced');
        expect(resolveXrdScope(F.xrdV2NoScope)).toBe('Namespaced');
        expect(resolveXrdScope(F.xrdV1WithClaims)).toBe('LegacyCluster');
        expect(resolveXrdScope({ apiVersion: 'apiextensions.crossplane.io/v2', spec: { scope: 'Cluster' } })).toBe('Cluster');
    });
    it('partitionObjectRefs', () => {
        const p = partitionObjectRefs([F.providerRevisionV2, F.providerRevisionV1, F.providerRevisionInactive]);
        expect(p.managed).toEqual([
            { providerName: 'provider-aws-ec2', group: 'ec2.aws.upbound.io', plural: 'instances' },
            { providerName: 'provider-aws-ec2', group: 'ec2.aws.upbound.io', plural: 'vpcs' },
            { providerName: 'provider-aws-ec2', group: 'ec2.aws.m.upbound.io', plural: 'instances' },
            { providerName: 'provider-nop', group: 'nop.crossplane.io', plural: 'nopresources' },
        ]);
        expect(p.providerConfigs).toEqual([
            { providerName: 'provider-aws-ec2', group: 'aws.upbound.io', plural: 'providerconfigs' },
            { providerName: 'provider-aws-ec2', group: 'aws.m.upbound.io', plural: 'clusterproviderconfigs' },
        ]);
        expect(p.groups).toEqual(['aws.m.upbound.io', 'aws.upbound.io', 'ec2.aws.m.upbound.io', 'ec2.aws.upbound.io', 'nop.crossplane.io']);
    });
    it('revisionFingerprint is order-independent and ignores inactive revisions', () => {
        const a = revisionFingerprint([F.providerRevisionV2, F.providerRevisionV1, F.providerRevisionInactive]);
        expect(a).toBe('provider-aws-ec2-abc@42,provider-nop-v1@7');
        expect(revisionFingerprint([F.providerRevisionV1, F.providerRevisionV2])).toBe(a);
    });
});

describe('keys, refs and classification', () => {
    it('crossplaneKey', () => {
        expect(crossplaneKey({ apiVersion: 'pkg.crossplane.io/v1', kind: 'Provider', name: 'p' })).toBe('pkg.crossplane.io/v1|Provider||p');
        expect(crossplaneKey({ apiVersion: 'a/v1', kind: 'K', name: 'n', namespace: 'ns' })).toBe('a/v1|K|ns|n');
    });
    it('classifyCrossplaneObject', () => {
        const defs = { xrds: [summarizeXrd(F.xrdV1WithClaims, NOW)!] };
        expect(classifyCrossplaneObject(F.provider)).toBe('provider');
        expect(classifyCrossplaneObject(F.fn)).toBe('function');
        expect(classifyCrossplaneObject(F.configuration)).toBe('configuration');
        expect(classifyCrossplaneObject(F.providerRevisionV2)).toBe('packageRevision');
        expect(classifyCrossplaneObject({ apiVersion: 'pkg.crossplane.io/v1', kind: 'FunctionRevision' })).toBe('packageRevision');
        expect(classifyCrossplaneObject(F.compositionRevision)).toBe('compositionRevision');
        expect(classifyCrossplaneObject(F.composition)).toBe('composition');
        expect(classifyCrossplaneObject(F.xrdV2Namespaced)).toBe('xrd');
        expect(classifyCrossplaneObject(F.runtimeConfig)).toBe('runtimeConfig');
        expect(classifyCrossplaneObject(F.environmentConfig)).toBe('environmentConfig');
        expect(classifyCrossplaneObject(F.activationPolicy)).toBe('activationPolicy');
        expect(classifyCrossplaneObject(F.usageRef)).toBe('usage');
        expect(classifyCrossplaneObject(F.usageSelector)).toBe('usage');
        expect(classifyCrossplaneObject(F.cronOperation)).toBe('operation');
        expect(classifyCrossplaneObject(F.providerConfig)).toBe('providerConfig');
        expect(classifyCrossplaneObject(F.xrV1, defs)).toBe('composite');
        expect(classifyCrossplaneObject(F.claim, defs)).toBe('claim');
        expect(classifyCrossplaneObject(F.mrHealthy, defs)).toBe('managed');
        expect(classifyCrossplaneObject(F.xrV1)).toBe('managed');
    });
    it('never returns managed for a core Crossplane group', () => {
        expect(classifyCrossplaneObject(F.mrd)).toBeNull();
        for (const apiVersion of ['pkg.crossplane.io/v1beta1', 'apiextensions.crossplane.io/v1', 'protection.crossplane.io/v1beta1', 'ops.crossplane.io/v1alpha1']) {
            expect(classifyCrossplaneObject({ apiVersion, kind: 'ImageConfig' })).toBeNull();
            expect(classifyCrossplaneObject({ apiVersion, kind: 'Lock' })).not.toBe('managed');
        }
        expect(classifyCrossplaneObject({ apiVersion: 'v1', kind: 'ConfigMap' })).toBeNull();
        expect(classifyCrossplaneObject({})).toBeNull();
    });
    it('toCrossplaneRef: a full row plus `type` parses refRequestSchema only after conversion', () => {
        const row = summarizePackage(F.provider, NOW)!;
        const raw = { ...row, type: 'crossplane' };
        expect(refRequestSchema.safeParse({ context: 'ctx', ref: raw }).success).toBe(false);
        const ref = toCrossplaneRef(raw);
        expect(ref).toEqual({ apiVersion: 'pkg.crossplane.io/v1', kind: 'Provider', name: 'provider-aws-ec2', category: 'provider' });
        expect(refRequestSchema.safeParse({ context: 'arn:aws:eks:eu-west-1:123:cluster/x', ref }).success).toBe(true);
        expect(isValidCrossplaneRef(ref)).toBe(true);
    });
    it("toCrossplaneRef omits namespace ''", () => {
        const ref = toCrossplaneRef({ apiVersion: 'a.io/v1', kind: 'K', name: 'n', namespace: '' });
        expect('namespace' in ref).toBe(false);
        expect(refRequestSchema.safeParse({ context: 'c', ref: { apiVersion: 'a.io/v1', kind: 'K', name: 'n', namespace: '' } }).success).toBe(false);
    });
    it('isValidCrossplaneRef agrees with refSchema', () => {
        const cases: unknown[] = [
            { apiVersion: 'v1', kind: 'Pod', name: 'p' },
            { apiVersion: 'BAD/v1', kind: 'Pod', name: 'p' },
            { apiVersion: 'a.io/v1', kind: 'pod', name: 'p' },
            { apiVersion: 'a.io/v1', kind: 'Pod', name: 'P_' },
            { apiVersion: 'a.io/v1', kind: 'Pod', name: 'p', namespace: 'a.b' },
            { apiVersion: 'a.io/v1', kind: 'Pod', name: 'p', category: 'nope' },
            { apiVersion: 'a.io/v1', kind: 'Pod', name: 'p', extra: 1 },
            null,
        ];
        for (const c of cases) expect(isValidCrossplaneRef(c)).toBe(refRequestSchema.safeParse({ context: 'c', ref: c }).success);
    });
});

describe('lists', () => {
    const row = (name: string, health: CrossplaneRowBase['health'], healthOrder: number, healthSince?: string): CrossplaneRowBase => ({
        apiVersion: 'a.io/v1', kind: 'K', name, key: `k|${name}`, uid: name, category: 'managed', age: '', health, healthOrder, healthSince,
    });
    it('countHealth excludes none from total', () => {
        expect(countHealth([row('a', 'healthy', 4), row('b', 'unhealthy', 0), row('c', 'none', 5)]))
            .toEqual({ total: 2, healthy: 1, unhealthy: 1, none: 1, progressing: 0, paused: 0, unknown: 0 });
    });
    it('collectNeedsAttention: unhealthy only, dedupe, healthSince desc, missing last', () => {
        const out = collectNeedsAttention(
            [row('old', 'unhealthy', 0, F.iso(60 * MIN)), row('ok', 'healthy', 4)],
            [row('none-since', 'unhealthy', 0), row('new', 'unhealthy', 0, F.iso(MIN))],
            [row('new', 'unhealthy', 0, F.iso(MIN))], undefined,
        );
        expect(out.map(r => r.name)).toEqual(['new', 'old', 'none-since']);
    });
    it('a Needs-attention row from an unhealthy revision parses through toCrossplaneRef + refRequestSchema', () => {
        const rev = summarizeRevision(F.providerRevisionV2Unhealthy, NOW)!;
        const [na] = collectNeedsAttention([rev]);
        expect(na.category).toBe('packageRevision');
        expect('revision' in na).toBe(false);
        expect(refRequestSchema.safeParse({ context: 'c', ref: toCrossplaneRef(na) }).success).toBe(true);
    });
});

describe('filterCrossplaneEvents', () => {
    it('filters by group, sorts newest first, dedupes, slices', () => {
        const events = [
            F.warningEvent('1', 'ec2.aws.upbound.io/v1beta1', F.iso(10 * MIN)),
            F.warningEvent('2', 'v1', F.iso(MIN)),
            F.warningEvent('3', 'pkg.crossplane.io/v1', F.iso(2 * MIN)),
            F.warningEvent('3', 'pkg.crossplane.io/v1', F.iso(2 * MIN)),
            F.warningEvent('4', 'ec2.aws.upbound.io/v1beta1', F.iso(5 * MIN), { eventTime: F.iso(30 * MIN) }),
            F.warningEvent('5', 'apps/v1', F.iso(0)),
        ];
        const out = filterCrossplaneEvents(events, ['ec2.aws.upbound.io', 'pkg.crossplane.io'], 10);
        expect(out.map(e => e.uid)).toEqual(['3', '1', '4']);
        expect(out[0]).toMatchObject({ reason: 'CannotObserveExternalResource', count: 3, involvedObject: { kind: 'Instance', name: 'web-4' } });
        expect(filterCrossplaneEvents(events, ['ec2.aws.upbound.io', 'pkg.crossplane.io'], 2)).toHaveLength(2);
        expect(filterCrossplaneEvents(events, [''], 10).map(e => e.uid)).toEqual(['2']);
    });
});
