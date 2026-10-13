import { describe, it, expect } from 'vitest';
import { resolveResourceMeta, formatDeleteMessage, filterByNamespaces, countInNamespaces, coreKindForView, computePodStatusStats } from './resource-utils';

describe('resolveResourceMeta', () => {
    it('resolves full metadata from resource object', () => {
        const resource = {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'my-app', namespace: 'default' },
        };
        const result = resolveResourceMeta(resource, 'deployment');
        expect(result).toEqual({
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            name: 'my-app',
            namespace: 'default',
        });
    });

    it('falls back to RESOURCE_TYPE_MAP for apiVersion and kind', () => {
        const resource = { metadata: { name: 'my-pod', namespace: 'kube-system' } };
        const result = resolveResourceMeta(resource, 'pod');
        expect(result).toEqual({
            apiVersion: 'v1',
            kind: 'Pod',
            name: 'my-pod',
            namespace: 'kube-system',
        });
    });

    it('uses resource.name when metadata.name is absent', () => {
        const resource = { name: 'fallback-name' };
        const result = resolveResourceMeta(resource, 'service');
        expect(result.name).toBe('fallback-name');
    });

    it('uses resource.namespace when metadata.namespace is absent', () => {
        const resource = { name: 'svc', namespace: 'prod' };
        const result = resolveResourceMeta(resource, 'service');
        expect(result.namespace).toBe('prod');
    });

    it('returns undefined namespace for cluster-scoped resources', () => {
        const resource = { metadata: { name: 'my-node' } };
        const result = resolveResourceMeta(resource, 'node');
        expect(result.namespace).toBeUndefined();
    });

    it('resource object apiVersion/kind take precedence over map', () => {
        const resource = {
            apiVersion: 'custom.io/v1beta1',
            kind: 'MyCRD',
            metadata: { name: 'cr-1', namespace: 'ns' },
        };
        const result = resolveResourceMeta(resource, 'deployment');
        expect(result.apiVersion).toBe('custom.io/v1beta1');
        expect(result.kind).toBe('MyCRD');
    });

    it('throws when neither resource nor map provides apiVersion/kind', () => {
        const resource = { metadata: { name: 'orphan' } };
        expect(() => resolveResourceMeta(resource, 'unknown-type')).toThrow(
            'Unable to resolve apiVersion or kind for resource type "unknown-type"'
        );
    });
});

describe('formatDeleteMessage', () => {
    it('formats message for namespaced resource', () => {
        const msg = formatDeleteMessage('Deployment', 'my-app', 'default');
        expect(msg).toBe('Are you sure you want to delete Deployment my-app in namespace default?');
    });

    it('formats message for cluster-scoped resource', () => {
        const msg = formatDeleteMessage('Node', 'worker-1');
        expect(msg).toBe('Are you sure you want to delete Node worker-1? This is a cluster-scoped resource.');
    });

    it('treats empty string namespace as namespaced', () => {
        // empty string is falsy, so should produce cluster-scoped message
        const msg = formatDeleteMessage('PersistentVolume', 'pv-1', '');
        expect(msg).toBe('Are you sure you want to delete PersistentVolume pv-1? This is a cluster-scoped resource.');
    });
});

describe('resource cache helpers', () => {
    const items = [
        { id: '1', namespace: 'a' },
        { id: '2', namespace: 'b' },
        { id: '3', namespace: 'a' },
    ];

    it('filterByNamespaces keeps everything for [all] or [] and filters otherwise', () => {
        expect(filterByNamespaces(items, ['all'])).toBe(items);
        expect(filterByNamespaces(items, [])).toBe(items);
        expect(filterByNamespaces(items, ['a']).map((i) => i.id)).toEqual(['1', '3']);
        expect(filterByNamespaces(items, ['b', 'c']).map((i) => i.id)).toEqual(['2']);
    });

    it('countInNamespaces counts the selection', () => {
        const byId = new Map(items.map((i) => [i.id, i]));
        expect(countInNamespaces(byId, 'all')).toBe(3);
        expect(countInNamespaces(byId, 'a')).toBe(2);
        expect(countInNamespaces(byId, 'a,b')).toBe(3);
        expect(countInNamespaces(byId, 'zzz')).toBe(0);
    });

    it('coreKindForView maps the six core views and nothing else', () => {
        expect(coreKindForView('deployments')).toBe('deployments');
        expect(coreKindForView('pods')).toBe('pods');
        expect(coreKindForView('secrets')).toBe('secrets');
        expect(coreKindForView('configmaps')).toBe('configmaps');
        expect(coreKindForView('services')).toBe('services');
        expect(coreKindForView('helm-releases')).toBe('helmreleases');
        for (const v of ['overview', 'helmreleases', 'daemonsets', 'constructor', 'toString', '']) {
            expect(coreKindForView(v)).toBeNull();
        }
    });

    it('computePodStatusStats filters by namespace and keeps the previous reference when unchanged', () => {
        const pods = new Map([
            ['p1', { namespace: 'a', status: 'Running' }],
            ['p2', { namespace: 'b', status: 'Pending' }],
            ['p3', { namespace: 'a', status: 'Terminating' }],
        ]);
        const zero = { Running: 0, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 0 };
        const all = computePodStatusStats(pods, ['all'], zero);
        expect(all).toEqual({ Running: 1, Pending: 1, Failed: 0, Succeeded: 0, Unknown: 1 });
        expect(computePodStatusStats(pods, ['all'], all)).toBe(all);
        expect(computePodStatusStats(pods, ['a'], zero)).toEqual({ Running: 1, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 1 });
    });
});
