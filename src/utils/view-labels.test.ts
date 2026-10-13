import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    DEPLOYMENT_DETAIL_PREFIX, buildDeploymentDetailViewId, parseDeploymentDetailViewId, getViewLabel,
} from './view-labels';

// DNS-1123 label (namespaces) and subdomain (names, may contain dots)
const dnsLabel = fc.stringMatching(/^[a-z0-9]([-a-z0-9]{0,30}[a-z0-9])?$/);
const dnsSubdomain = fc.array(dnsLabel, { minLength: 1, maxLength: 4 }).map(parts => parts.join('.'));

describe('deployment detail view ids', () => {
    it('build/parse round-trips over DNS names', () => {
        fc.assert(fc.property(dnsLabel, dnsSubdomain, (namespace, name) => {
            const id = buildDeploymentDetailViewId(namespace, name);
            expect(id.startsWith(DEPLOYMENT_DETAIL_PREFIX)).toBe(true);
            expect(parseDeploymentDetailViewId(id)).toEqual({ namespace, name });
        }));
    });

    it('encodes segments', () => {
        expect(buildDeploymentDetailViewId('default', 'web.v2')).toBe('deployment-detail/default/web.v2');
        expect(buildDeploymentDetailViewId('a/b', 'c d')).toBe('deployment-detail/a%2Fb/c%20d');
        expect(parseDeploymentDetailViewId('deployment-detail/a%2Fb/c%20d')).toEqual({ namespace: 'a/b', name: 'c d' });
    });

    it.each([
        'deployments',
        'helm-release-detail/default/web',
        'deployment-detail/default',
        'deployment-detail/default/web/extra',
        'deployment-detail//web',
        'deployment-detail/default/',
        'deployment-detail/default/%E0%A4%A',
    ])('returns null for malformed id %s', id => {
        expect(parseDeploymentDetailViewId(id)).toBeNull();
    });
});

describe('getViewLabel', () => {
    it('labels deployment detail tabs', () => {
        expect(getViewLabel('deployment-detail/default/web')).toBe('Deploy: web');
        expect(getViewLabel('deployment-detail/default/%E0%A4%A')).toBe('Deployment');
        expect(getViewLabel('deployment-detail/oops')).toBe('Deployment');
    });

    it('leaves existing labels unchanged', () => {
        expect(getViewLabel('deployments')).toBe('Deployments');
        expect(getViewLabel('helm-chart-detail/repo/nginx')).toBe('Chart: nginx');
        expect(getViewLabel('crd/example.com/v1/widgets')).toBe('Widgets');
        expect(getViewLabel('unknown-view')).toBe('unknown-view');
    });
});
