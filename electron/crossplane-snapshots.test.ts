import { describe, expect, it } from 'vitest';
import { CrossplaneApiError } from './crossplane-api';
import { crossplaneCluster, managedItems, obj } from './__fixtures__/fake-crossplane-api';
import { gate, harness } from './__fixtures__/crossplane-service-harness';

function xrd(group: string, kind: string, plural: string, claim?: { kind: string; plural: string }) {
    return obj('apiextensions.crossplane.io/v2', 'CompositeResourceDefinition', `${plural}.${group}`, {
        spec: { group, scope: 'Cluster', names: { kind, plural }, ...(claim ? { claimNames: claim } : {}),
            versions: [{ name: 'v1', served: true, referenceable: true }] },
    });
}

describe('getComposites', () => {
    it('pages XR kinds, reports truncation and skips unserved claim kinds', async () => {
        const api = crossplaneCluster();
        api.addList('apiextensions.crossplane.io', 'v2', 'compositeresourcedefinitions', [
            xrd('a.example.org', 'XA', 'xas'), xrd('b.example.org', 'XB', 'xbs', { kind: 'B', plural: 'bs' }),
        ]);
        api.addList('a.example.org', 'v1', 'xas', managedItems('a.example.org/v1', 'XA', 1200));
        api.addList('b.example.org', 'v1', 'xbs', managedItems('b.example.org/v1', 'XB', 6000));
        const h = harness(api);
        const c = await h.service.getComposites('test');
        expect(api.calls.filter(x => x.target === 'a.example.org/v1/xas')).toHaveLength(3);
        expect(c.truncatedKinds).toEqual(['XB']);
        expect(c.composites).toHaveLength(6200);
        expect(c.claims).toEqual([]);
        expect(c.errors).toEqual([]);
        expect(c.operations).toEqual([]);
    });

    it('never runs more than 6 list calls at once', async () => {
        const api = crossplaneCluster();
        const xrds = Array.from({ length: 20 }, (_, i) => xrd(`g${i}.example.org`, `X${i}`, `x${i}s`));
        api.addList('apiextensions.crossplane.io', 'v2', 'compositeresourcedefinitions', xrds);
        for (let i = 0; i < 20; i++) api.addList(`g${i}.example.org`, 'v1', `x${i}s`, managedItems(`g${i}.example.org/v1`, `X${i}`, 700));
        const h = harness(api);
        await h.service.getDefinitions('test');
        api.peakLists = 0;
        const c = await h.service.getComposites('test');
        expect(c.composites).toHaveLength(14_000);
        expect(api.peakLists).toBeLessThanOrEqual(6);
        expect(api.peakLists).toBeGreaterThan(1);
    });
});

describe('getPackages', () => {
    it('issues no MR-group discovery on a cold kind index, and nothing within the TTL', async () => {
        const h = harness();
        await h.service.detect('test');
        await h.service.getPackages('test');
        const gr = h.api.callsOf('getGroupResources').map(c => c.target);
        expect(gr.filter(t => t.startsWith('ec2.example.io/'))).toEqual([]);
        expect(gr.filter(t => t.startsWith('example.io/'))).toEqual(['example.io/v1beta1']);
        const before = h.api.requestCount();
        await h.service.getPackages('test');
        expect(h.api.requestCount()).toBe(before);
    });

    it('evicts the kind index when the revision fingerprint changes', async () => {
        const h = harness();
        await h.service.getManagedKinds('test');
        const prList = () => h.api.calls.filter(c => c.target === 'pkg.crossplane.io/v1/providerrevisions').length;
        await h.service.getManagedKinds('test');
        expect(prList()).toBe(1);
        const revs = h.api.lists.get('pkg.crossplane.io/v1/providerrevisions') ?? [];
        const rev = revs[0] as { metadata: { resourceVersion: string } };
        rev.metadata.resourceVersion = '8';
        await h.service.getPackages('test', { force: true });
        expect(h.service.peekManagedKinds('test')).toBeNull();
        const listsBefore = prList();
        await h.service.getManagedKinds('test');
        expect(prList()).toBe(listsBefore + 1);
    });

    it('does not cache an in-flight kind-index build whose fingerprint went stale', async () => {
        const h = harness();
        await h.service.detect('test');
        // Hold the build in MR-group discovery, after it has read the revisions.
        const g = gate();
        const orig = h.api.getGroupResources.bind(h.api);
        h.api.getGroupResources = async (group, version) => {
            if (group === 'ec2.example.io') await g.promise;
            return orig(group, version);
        };
        const building = h.service.getManagedKinds('test');
        await new Promise(r => setTimeout(r, 10));
        const revs = h.api.lists.get('pkg.crossplane.io/v1/providerrevisions') ?? [];
        (revs[0] as { metadata: { resourceVersion: string } }).metadata.resourceVersion = '9';
        await h.service.getPackages('test', { force: true });
        g.open();
        const payload = await building;
        expect(payload.source).toBe('objectRefs');
        expect(h.service.peekManagedKinds('test')).toBeNull();
    });

    it('keeps package sections when ProviderRevisions are forbidden and uses a cached crdMetadata index', async () => {
        const api = crossplaneCluster();
        api.failWhen(c => (c.target === 'pkg.crossplane.io/v1/providerrevisions' ? new CrossplaneApiError(403, 'forbidden') : undefined));
        const h = harness(api);
        const p = await h.service.getPackages('test');
        expect(p.providers).toHaveLength(1);
        expect(p.providerConfigs).toEqual([]);
        expect(p.errors).toContainEqual(expect.objectContaining({ section: 'providerConfigs', status: 403 }));

        api.crds = [{ metadata: { name: 'providerconfigs.example.io', ownerReferences: [{ apiVersion: 'pkg.crossplane.io/v1', kind: 'Provider', name: 'provider-example' }] } }];
        expect((await h.service.getManagedKinds('test')).source).toBe('crdMetadata');
        const p2 = await h.service.getPackages('test', { force: true });
        expect(p2.providerConfigs.map(c => c.name)).toEqual(['default']);
        expect(p2.errors.some(e => e.section === 'providerConfigs')).toBe(false);
    });

    it('rejects with Cluster unreachable when every section fails with status 0', async () => {
        const h = harness();
        await h.service.detect('test');
        h.api.failWhen(c => (c.method === 'listPage' ? new CrossplaneApiError(0, 'timeout') : undefined));
        await expect(h.service.getPackages('test')).rejects.toThrow('Cluster unreachable');
    });
});

describe('getWarningEvents', () => {
    const event = (uid: string, apiVersion: string, ts: string) => ({
        metadata: { uid, creationTimestamp: ts }, reason: 'Fail', message: uid, type: 'Warning', lastTimestamp: ts,
        involvedObject: { apiVersion, kind: 'Thing', name: uid },
    });

    it('keeps MR events with a cold kind index and makes no discovery calls for MR groups', async () => {
        const h = harness();
        h.api.events = [event('mr', 'ec2.example.io/v1beta1', '2024-01-02T00:00:00Z'), event('pod', 'v1', '2024-01-03T00:00:00Z')];
        const r = await h.service.getWarningEvents('test');
        expect(r.events.map(e => e.uid)).toEqual(['mr']);
        expect(h.api.callsOf('getGroupResources').some(c => c.target.startsWith('ec2.example.io/'))).toBe(false);
    });

    it('finds Crossplane events on page 3 newest first, and caps at 10 pages', async () => {
        const h = harness();
        const pods = Array.from({ length: 1000 }, (_, i) => event(`p${i}`, 'v1', '2024-01-05T00:00:00Z'));
        h.api.events = [...pods,
            event('old', 'pkg.crossplane.io/v1', '2024-01-01T00:00:00Z'),
            event('new', 'platform.example.org/v1', '2024-01-04T00:00:00Z'),
            event('new', 'platform.example.org/v1', '2024-01-04T00:00:00Z')];
        const r = await h.service.getWarningEvents('test', { limit: 10 });
        expect(r.events.map(e => e.uid)).toEqual(['new', 'old']);
        expect(r.scanned).toBe(1003);
        expect(r.truncatedScan).toBe(false);

        h.api.events = Array.from({ length: 6000 }, (_, i) => event(`q${i}`, 'v1', '2024-01-05T00:00:00Z'));
        const capped = await h.service.getWarningEvents('test', { limit: 10, force: true });
        expect(capped.truncatedScan).toBe(true);
        expect(capped.scanned).toBe(5000);
    });

    it('returns an events error on 403', async () => {
        const h = harness();
        h.api.failWhen(c => (c.method === 'listWarningEventsPage' ? new CrossplaneApiError(403, 'forbidden') : undefined));
        const r = await h.service.getWarningEvents('test');
        expect(r.events).toEqual([]);
        expect(r.errors).toEqual([expect.objectContaining({ section: 'events', status: 403 })]);
    });
});
