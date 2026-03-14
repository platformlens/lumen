import { describe, it, expect } from 'vitest';
import { resolveResourceMeta, formatDeleteMessage, RESOURCE_TYPE_MAP } from './resource-utils';

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
