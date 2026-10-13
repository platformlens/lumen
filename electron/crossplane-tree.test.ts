import { describe, expect, it } from 'vitest';
import { CrossplaneApiError } from './crossplane-api';
import { TREE_MAX_NODES } from './crossplane-tree';
import { READY, crossplaneCluster, obj } from './__fixtures__/fake-crossplane-api';
import { harness } from './__fixtures__/crossplane-service-harness';

const NET = 'platform.example.org/v1';

/** v2 tree: claim Network/net (team) → XNetwork/net-x (team, namespaced) → MRs + nested XR. */
function v2Cluster() {
    const api = crossplaneCluster();
    api.addObject(obj(NET, 'Network', 'net', {
        namespace: 'team', spec: { resourceRef: { apiVersion: NET, kind: 'XNetwork', name: 'net-x' } }, status: { conditions: READY },
    }));
    api.addObject(obj(NET, 'XNetwork', 'net-x', {
        namespace: 'team', uid: 'xr-uid',
        labels: { 'crossplane.io/claim-name': 'net', 'crossplane.io/claim-namespace': 'team' },
        spec: { crossplane: { resourceRefs: [
            { apiVersion: 'ec2.example.io/v1beta2', kind: 'Instance', name: 'i-1' },
            { apiVersion: 'ec2.example.io/v1beta1', kind: 'VPC', name: 'vpc-gone' },
            { apiVersion: 'v1', kind: 'Secret', name: 'creds' },
            { apiVersion: 'ec2.example.io/v1beta1', kind: 'Subnet', name: 'sub-1' },
            { apiVersion: NET, kind: 'XNetwork', name: 'net-child' },
        ] } },
        status: { conditions: READY },
    }));
    // v2: a namespaced XR composes namespaced MRs in its own namespace.
    api.addResources('ec2.example.io', 'v1beta2', [{ name: 'instances', kind: 'Instance', namespaced: true }]);
    api.addObject(obj('ec2.example.io/v1beta2', 'Instance', 'i-1', {
        namespace: 'team', ownerReferences: [{ apiVersion: NET, kind: 'XNetwork', name: 'net-x', controller: true }], status: { conditions: READY },
    }));
    api.addObject(obj(NET, 'XNetwork', 'net-child', { namespace: 'team', spec: { crossplane: { resourceRefs: [] } } }));
    api.failWhen(c => (c.method === 'get' && c.target.startsWith('ec2.example.io/v1beta1|Subnet|') ? new CrossplaneApiError(403, 'forbidden') : undefined));
    return api;
}

describe('getTree', () => {
    it('ascends MR → XR → claim and descends with namespace inheritance and node states', async () => {
        const api = v2Cluster();
        const { service } = harness(api);
        const tree = await service.getTree('test', { apiVersion: 'ec2.example.io/v1beta2', kind: 'Instance', name: 'i-1', namespace: 'team' });
        expect(tree.rootKey).toBe(`${NET}|Network|team|net`);
        expect(tree.focusKey).toBe('ec2.example.io/v1beta2|Instance|team|i-1');
        const byKey = new Map(tree.nodes.map(n => [n.key, n]));
        expect(byKey.get(`${NET}|XNetwork|team|net-x`)).toMatchObject({ depth: 1, state: 'ok', health: 'healthy', ref: { category: 'composite' } });
        expect(byKey.get('ec2.example.io/v1beta2|Instance|team|i-1')).toMatchObject({ depth: 2, state: 'ok', ref: { category: 'managed' } });
        expect(byKey.get('ec2.example.io/v1beta1|VPC||vpc-gone')?.state).toBe('missing');
        expect(byKey.get('ec2.example.io/v1beta1|Subnet||sub-1')?.state).toBe('forbidden');
        expect(byKey.get('v1|Secret||creds')).toMatchObject({ state: 'notFetched', health: 'none' });
        expect(byKey.get(`${NET}|XNetwork|team|net-child`)).toMatchObject({ state: 'ok', depth: 2, parentKey: `${NET}|XNetwork|team|net-x` });
        expect(api.calls.some(c => c.target.startsWith('v1|Secret'))).toBe(false);
        expect(tree.truncated).toBe(false);
        expect(tree.warnings).toEqual([]);
    });

    it('ascends a v1 LegacyCluster XR via spec.claimRef', async () => {
        const api = crossplaneCluster();
        api.addGroup('legacy.example.org', ['v1']);
        api.addResources('legacy.example.org', 'v1', [{ name: 'xlegacies', kind: 'XLegacy', namespaced: false }, { name: 'legacies', kind: 'Legacy', namespaced: true }]);
        api.addList('apiextensions.crossplane.io', 'v2', 'compositeresourcedefinitions', [
            obj('apiextensions.crossplane.io/v1', 'CompositeResourceDefinition', 'xlegacies.legacy.example.org', {
                spec: { group: 'legacy.example.org', names: { kind: 'XLegacy', plural: 'xlegacies' }, claimNames: { kind: 'Legacy', plural: 'legacies' },
                    versions: [{ name: 'v1', served: true, referenceable: true }] },
            }),
        ]);
        api.addObject(obj('legacy.example.org/v1', 'XLegacy', 'xl-1', {
            spec: { claimRef: { apiVersion: 'legacy.example.org/v1', kind: 'Legacy', name: 'l-1', namespace: 'apps' },
                resourceRefs: [{ apiVersion: 'ec2.example.io/v1beta1', kind: 'VPC', name: 'vpc-1' }] },
        }));
        api.addObject(obj('legacy.example.org/v1', 'Legacy', 'l-1', { namespace: 'apps', spec: { resourceRef: { apiVersion: 'legacy.example.org/v1', kind: 'XLegacy', name: 'xl-1' } } }));
        api.addObject(obj('ec2.example.io/v1beta1', 'VPC', 'vpc-1'));
        const { service } = harness(api);
        const tree = await service.getTree('test', { apiVersion: 'legacy.example.org/v1', kind: 'XLegacy', name: 'xl-1' });
        expect(tree.rootKey).toBe('legacy.example.org/v1|Legacy|apps|l-1');
        expect(tree.nodes.map(n => [n.key, n.depth])).toEqual([
            ['legacy.example.org/v1|Legacy|apps|l-1', 0],
            ['legacy.example.org/v1|XLegacy||xl-1', 1],
            ['ec2.example.io/v1beta1|VPC||vpc-1', 2],
        ]);
    });

    it('truncates at 300 nodes', async () => {
        const api = crossplaneCluster();
        const refs = Array.from({ length: 400 }, (_, i) => ({ apiVersion: 'ec2.example.io/v1beta1', kind: 'VPC', name: `v-${i}` }));
        for (const r of refs) api.addObject(obj(r.apiVersion, r.kind, r.name));
        api.addObject(obj(NET, 'XNetwork', 'big', { namespace: 'team', spec: { crossplane: { resourceRefs: refs } } }));
        const { service } = harness(api);
        const tree = await service.getTree('test', { apiVersion: NET, kind: 'XNetwork', name: 'big', namespace: 'team' });
        expect(tree.nodes).toHaveLength(TREE_MAX_NODES);
        expect(tree.truncated).toBe(true);
    });

    it('stops on uid cycles', async () => {
        const api = crossplaneCluster();
        api.addObject(obj(NET, 'XNetwork', 'a', { namespace: 'team', uid: 'ua', spec: { crossplane: { resourceRefs: [{ apiVersion: NET, kind: 'XNetwork', name: 'b' }] } } }));
        api.addObject(obj(NET, 'XNetwork', 'b', { namespace: 'team', uid: 'ub', spec: { crossplane: { resourceRefs: [{ apiVersion: NET, kind: 'XNetwork', name: 'a' }] } } }));
        const { service } = harness(api);
        const tree = await service.getTree('test', { apiVersion: NET, kind: 'XNetwork', name: 'a', namespace: 'team' });
        expect(tree.nodes.map(n => n.key)).toEqual([`${NET}|XNetwork|team|a`, `${NET}|XNetwork|team|b`]);
    });

    it('loads definitions exactly once on a cold cache before walking', async () => {
        const api = v2Cluster();
        const { service } = harness(api);
        await service.getTree('test', { apiVersion: NET, kind: 'XNetwork', name: 'net-x', namespace: 'team' });
        expect(api.calls.filter(c => c.target === 'apiextensions.crossplane.io/v2/compositeresourcedefinitions')).toHaveLength(1);
    });

    it('still returns a tree with a warning when definitions reject', async () => {
        const api = v2Cluster();
        api.failWhen(c => (c.method === 'listPage' && c.target.startsWith('apiextensions.crossplane.io/') ? new CrossplaneApiError(0, 'timeout') : undefined));
        const { service } = harness(api);
        const tree = await service.getTree('test', { apiVersion: NET, kind: 'XNetwork', name: 'net-x', namespace: 'team' });
        expect(tree.warnings).toEqual(['Definitions unavailable: Cluster unreachable']);
        expect(tree.rootKey).toBe(`${NET}|XNetwork|team|net-x`);
        expect(tree.nodes.length).toBeGreaterThan(1);
    });

    it('rejects when the root cannot be fetched', async () => {
        const { service } = harness();
        await expect(service.getTree('test', { apiVersion: NET, kind: 'XNetwork', name: 'nope', namespace: 'team' })).rejects.toThrow(/not found/);
    });
});
