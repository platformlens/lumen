import { describe, expect, it } from 'vitest';
import { CrossplaneApiError } from './crossplane-api';
import { MAX_CACHED_ROWS, PROGRESS_THROTTLE_MS, SECRET_REFUSAL, stripObject } from './crossplane';
import { crossplaneCluster, managedItems, obj } from './__fixtures__/fake-crossplane-api';
import { gate, harness } from './__fixtures__/crossplane-service-harness';

const listCalls = (h: ReturnType<typeof harness>, target: string) => h.api.calls.filter(c => c.method === 'listPage' && c.target === target).length;

describe('CrossplaneService caching', () => {
    it('serves snapshots from the 15 s cache, refetches after expiry, and force bypasses', async () => {
        const h = harness();
        await h.service.getDefinitions('test');
        await h.service.getDefinitions('test');
        expect(listCalls(h, 'apiextensions.crossplane.io/v1/compositions')).toBe(1);
        h.advance(16_000);
        await h.service.getDefinitions('test');
        expect(listCalls(h, 'apiextensions.crossplane.io/v1/compositions')).toBe(2);
        await h.service.getDefinitions('test', { force: true });
        expect(listCalls(h, 'apiextensions.crossplane.io/v1/compositions')).toBe(3);
    });

    it('dedupes two concurrent requests into one API call', async () => {
        const h = harness();
        await h.service.detect('test');
        const [a, b] = await Promise.all([h.service.getDefinitions('test'), h.service.getDefinitions('test')]);
        expect(a).toBe(b);
        expect(listCalls(h, 'apiextensions.crossplane.io/v1/compositions')).toBe(1);
    });

    it('AM-3: a forced call during an in-flight one joins it (exactly one API call)', async () => {
        const h = harness();
        await h.service.detect('test');
        const g = gate();
        h.api.gate = g.promise;
        const plain = h.service.getPackages('test');
        const forced = h.service.getPackages('test', { force: true });
        g.open();
        h.api.gate = null;
        expect(await forced).toBe(await plain);
        expect(listCalls(h, 'pkg.crossplane.io/v1/providers')).toBe(1);
    });

    it('does not cache rejected promises', async () => {
        const h = harness();
        await h.service.detect('test');
        let fail = true;
        h.api.failWhen(c => (fail && c.method === 'listPage' ? new CrossplaneApiError(0, 'ECONNREFUSED') : undefined));
        await expect(h.service.getDefinitions('test')).rejects.toThrow('Cluster unreachable');
        fail = false;
        await expect(h.service.getDefinitions('test')).resolves.toMatchObject({ errors: [] });
    });

    it('evicts the least recently used of four contexts', async () => {
        const h = harness();
        for (const ctx of ['test', 'b', 'c', 'd']) await h.service.detect(ctx);
        expect(h.factoryCalls).toEqual(['test', 'b', 'c', 'd']);
        await h.service.detect('test');
        expect(h.factoryCalls).toEqual(['test', 'b', 'c', 'd', 'test']);
        expect(h.api.callsOf('findCoreDeployment')).toHaveLength(2);
    });

    it('invalidateKubeConfigs drops every context adapter client', async () => {
        const h = harness();
        await h.service.detect('test');
        h.service.invalidateKubeConfigs();
        expect(h.api.invalidations).toBe(1);
    });
});

describe('CrossplaneService snapshots', () => {
    it('returns a partial payload with errors when one section is forbidden', async () => {
        const h = harness();
        h.api.failWhen(c => (c.target === 'apiextensions.crossplane.io/v1/compositions' ? new CrossplaneApiError(403, 'forbidden') : undefined));
        const d = await h.service.getDefinitions('test');
        expect(d.xrds).toHaveLength(1);
        expect(d.compositions).toEqual([]);
        expect(d.errors).toEqual([expect.objectContaining({ section: 'compositions', status: 403 })]);
        expect(d.claimsSupported).toBe(true);
    });

    it('joins Function used-by from compositions', async () => {
        const h = harness();
        const p = await h.service.getPackages('test');
        expect(p.functions[0]).toMatchObject({ name: 'function-patch', usedByCompositions: ['xnetworks'], usedByCount: 1 });
        expect(p.providers[0]).toMatchObject({ revisionHealth: 'healthy', installedDefinitionCount: 7 });
        expect(p.providers[0].revisions[0]).toMatchObject({ category: 'packageRevision', name: 'provider-example-abc' });
        expect(p.providerConfigs.map(c => c.name)).toEqual(['default']);
        expect(p.providerApiGroups).toEqual(['ec2.example.io', 'example.io', 'unserved.example.io']);
    });
});

describe('CrossplaneService MR scan', () => {
    it('AM-3: scanManaged during a forced getManagedKinds build joins it', async () => {
        const h = harness();
        await h.service.detect('test');
        const g = gate();
        h.api.gate = g.promise;
        const kinds = h.service.getManagedKinds('test', { force: true });
        const scan = h.service.scanManaged('test');
        g.open();
        h.api.gate = null;
        await kinds;
        expect((await scan).status).toBe('complete');
        expect(listCalls(h, 'pkg.crossplane.io/v1/providerrevisions')).toBe(1);
    });

    it('AM-3: scanManaged(force) re-scans but does not rebuild a cached kind index', async () => {
        const h = harness();
        await h.service.scanManaged('test');
        await h.service.scanManaged('test');
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(1);
        await h.service.scanManaged('test', { force: true });
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(2);
        expect(listCalls(h, 'pkg.crossplane.io/v1/providerrevisions')).toBe(1);
    });

    it('cancels a running scan when another context starts one, and caches nothing', async () => {
        const h = harness();
        await h.service.getManagedKinds('test');
        const g = gate();
        h.api.gate = g.promise;
        const a = h.service.scanManaged('test');
        await new Promise(r => setTimeout(r, 5));
        const b = h.service.scanManaged('other');
        g.open();
        h.api.gate = null;
        expect((await a).status).toBe('cancelled');
        expect((await b).status).toBe('complete');
        const before = listCalls(h, 'ec2.example.io/v1beta1/subnets');
        expect((await h.service.scanManaged('test')).status).toBe('complete');
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(before + 1);
    });

    it('emits progress for the scanned context', async () => {
        const h = harness();
        await h.service.scanManaged('test');
        expect(h.progress[0]).toEqual({ context: 'test', scanned: 0, total: 5 });
        expect(h.progress[h.progress.length - 1]).toEqual({ context: 'test', scanned: 5, total: 5 });
    });

    it('getManagedItems joins the in-flight scan kind, and lists directly after cancellation', async () => {
        const h = harness();
        await h.service.getManagedKinds('test');
        const g = gate();
        h.api.gate = g.promise;
        const scan = h.service.scanManaged('test');
        await new Promise(r => setTimeout(r, 5));
        const items = h.service.getManagedItems('test', ['ec2.example.io/v1beta1/subnets']);
        g.open();
        h.api.gate = null;
        await scan;
        expect((await items).kinds[0].rows).toHaveLength(3);
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(1);

        // Cached rows within 60 s; force lists again.
        await h.service.getManagedItems('test', ['ec2.example.io/v1beta1/subnets']);
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(1);
        await h.service.getManagedItems('test', ['ec2.example.io/v1beta1/subnets'], { force: true });
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(2);

        // Cancelled scan: the waiting caller falls through to a direct list.
        const vpcsBefore = listCalls(h, 'ec2.example.io/v1beta1/vpcs');
        const g2 = gate();
        h.api.gate = g2.promise;
        const scan2 = h.service.scanManaged('test', { force: true });
        await new Promise(r => setTimeout(r, 5));
        const items2 = h.service.getManagedItems('test', ['ec2.example.io/v1beta1/vpcs'], { force: true });
        await new Promise(r => setTimeout(r, 5));
        const other = h.service.scanManaged('other');
        g2.open();
        h.api.gate = null;
        expect((await scan2).status).toBe('cancelled');
        await other;
        const res = await items2;
        expect(res.kinds[0]).toMatchObject({ kindKey: 'ec2.example.io/v1beta1/vpcs', active: true, rows: [] });
        // One list by the cancelled scan, one direct list for the waiting caller ('other' is a separate fake).
        expect(listCalls(h, 'ec2.example.io/v1beta1/vpcs')).toBe(vpcsBefore + 2);
    });

    it('AM-3: overlapping getManagedItems calls (forced and not) share one direct LIST per kind', async () => {
        const h = harness();
        await h.service.getManagedKinds('test');
        const g = gate();
        h.api.gate = g.promise;
        const a = h.service.getManagedItems('test', ['ec2.example.io/v1beta1/subnets']);
        const b = h.service.getManagedItems('test', ['ec2.example.io/v1beta1/subnets'], { force: true });
        g.open();
        h.api.gate = null;
        const [ra, rb] = await Promise.all([a, b]);
        expect(ra.kinds[0]).toBe(rb.kinds[0]);
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(1);
        // Settled: a later forced call lists again.
        await h.service.getManagedItems('test', ['ec2.example.io/v1beta1/subnets'], { force: true });
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(2);
    });

    it(`stops caching rows past ${MAX_CACHED_ROWS} (rowsCached: false) but keeps counts`, async () => {
        const h = harness();
        const items = managedItems('fill.example.io/v1', 'Fill', 5000);
        const fillKeys = Array.from({ length: MAX_CACHED_ROWS / 5000 }, (_, i) => {
            h.api.addList('fill.example.io', 'v1', `fills${i}`, items);
            return `fill.example.io/v1/fills${i}`;
        });
        for (const key of fillKeys) await h.service.getManagedItems('test', [key]);
        const scan = await h.service.scanManaged('test');
        const subnets = scan.kinds.find(k => k.kindKey === 'ec2.example.io/v1beta1/subnets');
        expect(subnets).toMatchObject({ count: 3, rowsCached: false, byHealth: expect.objectContaining({ healthy: 3 }) });
        // Not cached → a non-forced items call lists again; a cached fill kind does not.
        const before = listCalls(h, 'ec2.example.io/v1beta1/subnets');
        expect((await h.service.getManagedItems('test', ['ec2.example.io/v1beta1/subnets'])).kinds[0].rows).toHaveLength(3);
        expect(listCalls(h, 'ec2.example.io/v1beta1/subnets')).toBe(before + 1);
        const fillPages = listCalls(h, 'fill.example.io/v1/fills0');
        await h.service.getManagedItems('test', [fillKeys[0]]);
        expect(listCalls(h, 'fill.example.io/v1/fills0')).toBe(fillPages);
    });

    it(`throttles scan progress to one emit per ${PROGRESS_THROTTLE_MS} ms (first and last always sent)`, async () => {
        const still = harness();
        await still.service.scanManaged('test');
        expect(still.progress).toEqual([{ context: 'test', scanned: 0, total: 5 }, { context: 'test', scanned: 5, total: 5 }]);

        const h = harness();
        await h.service.getManagedKinds('test');
        const times: number[] = [];
        const push = h.progress.push.bind(h.progress);
        h.progress.push = (...p) => { times.push(h.now()); return push(...p); };
        h.api.failWhen(c => { if (c.method === 'listPage') h.advance(100); return undefined; });
        await h.service.scanManaged('test');
        expect(h.progress[h.progress.length - 1]).toEqual({ context: 'test', scanned: 5, total: 5 });
        expect(h.progress.length).toBeGreaterThan(2);
        for (let i = 1; i < times.length - 1; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(PROGRESS_THROTTLE_MS);
    });
});

describe('CrossplaneService drawer', () => {
    it('refuses Secrets without any request', async () => {
        const h = harness();
        await expect(h.service.getResource('test', { apiVersion: 'v1', kind: 'Secret', name: 'creds', namespace: 'crossplane-system' }))
            .rejects.toThrow(SECRET_REFUSAL);
        await expect(h.service.getTree('test', { apiVersion: 'v1', kind: 'Secret', name: 'creds' })).rejects.toThrow(SECRET_REFUSAL);
        expect(h.api.requestCount()).toBe(0);
    });

    it('rejects refs that fail validateK8sParam', async () => {
        const h = harness();
        await expect(h.service.getResource('test', { apiVersion: 'a..b/v1', kind: 'X', name: 'n' })).rejects.toThrow(/path traversal/);
    });

    it('strips managedFields and last-applied-configuration', async () => {
        const api = crossplaneCluster();
        const o = obj('ec2.example.io/v1beta1', 'VPC', 'vpc-1');
        const withMeta = {
            ...o, metadata: { ...o.metadata, managedFields: [{ manager: 'x' }],
                annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}', keep: 'yes' } },
        };
        api.addObject(withMeta);
        const h = harness(api);
        const got = await h.service.getResource('test', { apiVersion: 'ec2.example.io/v1beta1', kind: 'VPC', name: 'vpc-1' });
        expect(got.metadata).not.toHaveProperty('managedFields');
        expect(got.metadata).toMatchObject({ annotations: { keep: 'yes' } });
        expect(JSON.stringify(got)).not.toContain('last-applied-configuration');
        expect(stripObject(null)).toEqual({});
    });

    it('drops a namespace for cluster-scoped kinds and rejects unknown kinds as not served', async () => {
        const h = harness();
        h.api.addObject(obj('ec2.example.io/v1beta1', 'VPC', 'vpc-2'));
        await expect(h.service.getResource('test', { apiVersion: 'ec2.example.io/v1beta1', kind: 'VPC', name: 'vpc-2', namespace: 'x' }))
            .resolves.toMatchObject({ kind: 'VPC' });
        await expect(h.service.getResource('test', { apiVersion: 'ec2.example.io/v1beta1', kind: 'Nope', name: 'n' }))
            .rejects.toThrow(/not served/);
    });
});
