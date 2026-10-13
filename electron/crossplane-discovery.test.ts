import { describe, expect, it } from 'vitest';
import { CrossplaneApiError, imageTag, listAllPages, pickCoreDeployment } from './crossplane-api';
import { FakeCrossplaneApi, crossplaneCluster, managedItems, obj } from './__fixtures__/fake-crossplane-api';
import { harness } from './__fixtures__/crossplane-service-harness';

describe('detectCrossplane via CrossplaneService.detect', () => {
    it('detects a v2 install with kindVersions and features', async () => {
        const { service } = harness();
        const d = await service.detect('test');
        expect(d.installed).toBe(true);
        expect(d.coreRunning).toBe(true);
        expect(d.version).toBe('v2.0.0');
        expect(d.majorVersion).toBe(2);
        expect(d.kindVersions.CompositeResourceDefinition).toBe('apiextensions.crossplane.io/v2');
        expect(d.kindVersions.Composition).toBe('apiextensions.crossplane.io/v1');
        expect(d.kindVersions.DeploymentRuntimeConfig).toBe('pkg.crossplane.io/v1beta1');
        expect(d.features.namespacedXrs).toBe(true);
        expect(d.features.mrds).toBe(true);
        expect(d.features.operations).toBe(false);
    });

    it('reports not installed without core lookups', async () => {
        const api = new FakeCrossplaneApi();
        api.addGroup('apps', ['v1']);
        const { service } = harness(api);
        const d = await service.detect('test');
        expect(d.installed).toBe(false);
        expect(api.callsOf('findCoreDeployment')).toHaveLength(0);
        expect(api.callsOf('getGroupResources')).toHaveLength(0);
    });

    it('falls back to major version 1 without v2 and a tag, and keeps coreRunning null when forbidden', async () => {
        const api = new FakeCrossplaneApi();
        api.addGroup('apiextensions.crossplane.io', ['v1']);
        api.addResources('apiextensions.crossplane.io', 'v1', [{ name: 'compositeresourcedefinitions', kind: 'CompositeResourceDefinition', namespaced: false }]);
        api.addGroup('pkg.crossplane.io', ['v1']);
        api.addResources('pkg.crossplane.io', 'v1', []);
        api.deployment = { coreRunning: null, version: null };
        const { service } = harness(api);
        const d = await service.detect('test');
        expect(d.majorVersion).toBe(1);
        expect(d.coreRunning).toBeNull();
        expect(d.features.namespacedXrs).toBe(false);
    });

    it('caches for 60 s, refetches after expiry, and force bypasses', async () => {
        const h = harness();
        await h.service.detect('test');
        await h.service.detect('test');
        expect(h.api.callsOf('findCoreDeployment')).toHaveLength(1);
        h.advance(61_000);
        await h.service.detect('test');
        expect(h.api.callsOf('findCoreDeployment')).toHaveLength(2);
        expect(h.api.callsOf('getApiGroups')).toHaveLength(1); // /apis cached 5 min
        await h.service.detect('test', { force: true });
        expect(h.api.callsOf('getApiGroups')).toHaveLength(2);
    });
});

describe('core Deployment helpers', () => {
    it('parses image tags', () => {
        expect(imageTag('xpkg.crossplane.io/crossplane/crossplane:v1.20.0')).toBe('v1.20.0');
        expect(imageTag('localhost:5000/crossplane')).toBeNull();
        expect(imageTag('repo/crossplane:v2.0.1@sha256:abc')).toBe('v2.0.1');
    });
    it('drops the rbac-manager and prefers the crossplane container', () => {
        const dep = (name: string, app: string, ready: number) => ({
            metadata: { name, labels: { app } },
            spec: { template: { spec: { containers: [{ name: 'sidecar', image: 'x:1' }, { name: 'crossplane', image: 'c:v1.19.2' }] } } },
            status: { availableReplicas: ready },
        });
        const picked = pickCoreDeployment([dep('crossplane-rbac-manager', 'crossplane-rbac-manager', 1), dep('core', 'crossplane', 0)], true);
        expect(picked).toEqual({ version: 'v1.19.2', coreRunning: false });
        expect(pickCoreDeployment([], true)).toBeNull();
    });
});

describe('listAllPages', () => {
    const gvr = { group: 'ec2.example.io', version: 'v1beta1', plural: 'things' };
    const summarize = (o: unknown) => o;
    it('pages with continue and caps at 5000', async () => {
        const api = new FakeCrossplaneApi();
        api.addList(gvr.group, gvr.version, gvr.plural, managedItems('ec2.example.io/v1beta1', 'Thing', 1200));
        const r = await listAllPages(api, gvr, { summarize });
        expect(r.items).toHaveLength(1200);
        expect(r.truncated).toBe(false);
        expect(api.callsOf('listPage')).toHaveLength(3);
        api.addList(gvr.group, gvr.version, gvr.plural, managedItems('ec2.example.io/v1beta1', 'Thing', 6000));
        const capped = await listAllPages(api, gvr, { summarize });
        expect(capped.items).toHaveLength(5000);
        expect(capped.truncated).toBe(true);
        expect(api.callsOf('listPage')).toHaveLength(13);
    });
    it('restarts once on 410 then rejects', async () => {
        const api = new FakeCrossplaneApi();
        api.addList(gvr.group, gvr.version, gvr.plural, managedItems('ec2.example.io/v1beta1', 'Thing', 1200));
        let gone = 1;
        api.failWhen(c => (c.continueToken && gone-- > 0 ? new CrossplaneApiError(410, 'gone') : undefined));
        expect((await listAllPages(api, gvr, { summarize })).items).toHaveLength(1200);
        gone = 2;
        await expect(listAllPages(api, gvr, { summarize })).rejects.toMatchObject({ status: 410 });
    });
    it('rejects 404 and counts malformed items', async () => {
        const api = new FakeCrossplaneApi();
        await expect(listAllPages(api, gvr, { summarize })).rejects.toMatchObject({ status: 404 });
        api.addList(gvr.group, gvr.version, gvr.plural, [1, 2, 3]);
        const r = await listAllPages(api, gvr, { summarize: o => (o === 2 ? null : o) });
        expect(r.skippedMalformed).toBe(1);
        expect(r.items).toEqual([1, 3]);
    });
});

describe('MR kind index', () => {
    it('resolves mixed versions per kind and partitions provider configs', async () => {
        const { service } = harness();
        await service.detect('test');
        const idx = await service.getManagedKinds('test');
        expect(idx.source).toBe('objectRefs');
        const kinds = idx.providers.find(p => p.name === 'provider-example')?.kinds ?? [];
        const byPlural = Object.fromEntries(kinds.map(k => [k.plural, k]));
        expect(byPlural.instances).toMatchObject({ active: true, version: 'v1beta2', kind: 'Instance' });
        expect(byPlural.vpcs).toMatchObject({ active: true, version: 'v1beta1', kindKey: 'ec2.example.io/v1beta1/vpcs' });
        expect(byPlural.widgets).toMatchObject({ active: false, kindKey: 'unserved.example.io//widgets' });
        expect(byPlural.providerconfigusages).toBeUndefined();
        expect(idx.providerConfigKinds.map(k => k.kindKey)).toEqual(['example.io/v1beta1/providerconfigs']);
    });

    it('issues exactly P + V + Σ pages(n_k) requests for getManagedKinds + scanManaged with detection warm', async () => {
        const h = harness();
        await h.service.detect('test');
        const before = h.api.requestCount();
        const summary = await h.service.scanManaged('test');
        const P = 1; // one ProviderRevision page
        const V = 2 + 1; // ec2.example.io (v1beta2, v1beta1) + example.io (v1beta1); unserved group costs 0
        const pages = 3 /* instances 1200 */ + 1 /* vpcs empty */ + 1 /* subnets 3 */ + 10 /* bigs 6000, capped */;
        expect(h.api.requestCount() - before).toBe(P + V + pages);
        expect(summary.status).toBe('complete');
        const big = summary.kinds.find(k => k.kindKey === 'ec2.example.io/v1beta1/bigs');
        expect(big).toMatchObject({ count: 5000, truncated: true });
        expect(summary.kinds.find(k => k.kindKey === 'ec2.example.io/v1beta1/vpcs')).toMatchObject({ count: 0, active: true });
        expect(summary.kinds.find(k => k.kindKey === 'unserved.example.io//widgets')).toMatchObject({ active: false, count: 0 });
        expect(summary.unhealthy).toHaveLength(200);
        expect(h.api.calls.some(c => c.target.includes('customresourcedefinitions') || c.method === 'listCrdMetadataPage')).toBe(false);
    });

    it('falls back to CRD metadata when ProviderRevisions are forbidden', async () => {
        const api = crossplaneCluster();
        api.failWhen(c => (c.target === 'pkg.crossplane.io/v1/providerrevisions' ? new CrossplaneApiError(403, 'forbidden') : undefined));
        api.crds = [
            { metadata: { name: 'vpcs.ec2.example.io', ownerReferences: [{ apiVersion: 'pkg.crossplane.io/v1', kind: 'Provider', name: 'provider-example' }] } },
            { metadata: { name: 'providerconfigs.example.io', ownerReferences: [{ apiVersion: 'pkg.crossplane.io/v1', kind: 'ProviderRevision', name: 'provider-example-abc' }] } },
            { metadata: { name: 'foos.other.io' } },
        ];
        const { service } = harness(api);
        const idx = await service.getManagedKinds('test');
        expect(idx.source).toBe('crdMetadata');
        expect(idx.providers[0]).toMatchObject({ name: 'provider-example' });
        expect(idx.providers[0].kinds.map(k => k.plural)).toEqual(['vpcs']);
        expect(idx.providerConfigKinds.map(k => k.providerName)).toEqual(['provider-example']);
    });

    it('reports an error and no providers when the fallback also fails', async () => {
        const api = crossplaneCluster();
        api.failWhen(c => (c.target === 'pkg.crossplane.io/v1/providerrevisions' || c.method === 'listCrdMetadataPage'
            ? new CrossplaneApiError(403, 'forbidden') : undefined));
        const { service } = harness(api);
        const idx = await service.getManagedKinds('test');
        expect(idx.providers).toEqual([]);
        expect(idx.errors[0]).toMatchObject({ section: 'managedKinds', status: 403 });
    });

    it('treats every active revision with empty objectRefs as the fallback trigger', async () => {
        const api = crossplaneCluster();
        api.addList('pkg.crossplane.io', 'v1', 'providerrevisions', [obj('pkg.crossplane.io/v1', 'ProviderRevision', 'p-1', {
            spec: { desiredState: 'Active' }, status: { objectRefs: [] },
        })]);
        const { service } = harness(api);
        expect((await service.getManagedKinds('test')).source).toBe('crdMetadata');
        expect(api.callsOf('listCrdMetadataPage')).toHaveLength(1);
    });
});
