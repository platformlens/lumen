import { describe, it, expect } from 'vitest';
import { buildYamlTabId, computeDraft } from './yaml-draft-utils';

describe('buildYamlTabId', () => {
    it('includes the cluster so tabs are cluster-scoped', () => {
        const a = buildYamlTabId('cluster-a', 'Deployment', 'default', 'web');
        const b = buildYamlTabId('cluster-b', 'Deployment', 'default', 'web');
        expect(a).toBe('yaml-cluster-a-Deployment-default-web');
        expect(a).not.toBe(b);
    });

    it('uses "global" for cluster-scoped resources', () => {
        expect(buildYamlTabId('c', 'Node', undefined, 'n1')).toBe('yaml-c-Node-global-n1');
        expect(buildYamlTabId('c', 'Node', '', 'n1')).toBe('yaml-c-Node-global-n1');
    });
});

describe('computeDraft', () => {
    it('returns undefined when the editor matches the base', () => {
        expect(computeDraft('a: 1\n', 'a: 1\n')).toBeUndefined();
    });

    it('returns the editor value when it differs from the base', () => {
        expect(computeDraft('a: 2\n', 'a: 1\n')).toBe('a: 2\n');
    });

    it('treats an emptied editor as a draft', () => {
        expect(computeDraft('', 'a: 1\n')).toBe('');
    });
});
