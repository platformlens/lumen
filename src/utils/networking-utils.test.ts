import { describe, it, expect } from 'vitest';
import { mapServicePorts, ingressRoutesForServices, describeNetworkPolicy } from './networking-utils';
import type { PodTemplate } from '../types/deployment-details';

const template: PodTemplate = {
    spec: {
        containers: [{ name: 'app', ports: [{ name: 'http', containerPort: 8080 }, { name: 'metrics', containerPort: 9090 }] }],
        initContainers: [{ name: 'proxy', restartPolicy: 'Always', ports: [{ name: 'admin', containerPort: 15000 }] }],
    },
};

describe('mapServicePorts', () => {
    it('resolves numeric, named and unset targetPort', () => {
        const m = mapServicePorts([{
            metadata: { name: 'web' },
            spec: { type: 'NodePort', ports: [
                { port: 80, targetPort: 8080, nodePort: 30080 },
                { port: 9000, targetPort: 'metrics' },
                { port: 9090 },
                { port: 15000, targetPort: 'admin' },
            ] },
        }], template);
        expect(m[0]).toEqual({ serviceName: 'web', serviceType: 'NodePort', servicePort: 80, protocol: 'TCP', targetPort: '8080',
            nodePort: 30080, resolved: { container: 'app', containerPort: 8080, portName: 'http' } });
        expect(m[1].resolved).toEqual({ container: 'app', containerPort: 9090, portName: 'metrics' });
        expect(m[2]).toMatchObject({ targetPort: '9090', nodePort: null, resolved: { containerPort: 9090 } });
        expect(m[3].resolved).toEqual({ container: 'proxy', containerPort: 15000, portName: 'admin' });
    });
    it('unresolved targets give resolved: null', () => {
        const m = mapServicePorts([{ metadata: { name: 's' }, spec: { ports: [{ port: 80, targetPort: 'nope' }, { port: 81, targetPort: 81 }] } }], template);
        expect(m.map(p => p.resolved)).toEqual([null, null]);
        expect(m[0].serviceType).toBe('ClusterIP');
    });
});

describe('ingressRoutesForServices', () => {
    it('returns default backend and rule routes for the given services, with TLS host detection', () => {
        const routes = ingressRoutesForServices([{
            metadata: { name: 'ing', annotations: { 'kubernetes.io/ingress.class': 'nginx' } },
            spec: {
                defaultBackend: { service: { name: 'web', port: { number: 80 } } },
                tls: [{ hosts: ['a.example.com', '*.apps.example.com'] }],
                rules: [
                    { host: 'a.example.com', http: { paths: [{ path: '/api', pathType: 'Prefix', backend: { service: { name: 'web', port: { name: 'http' } } } }] } },
                    { host: 'x.apps.example.com', http: { paths: [{ pathType: 'Prefix', backend: { service: { name: 'web', port: { number: 80 } } } }] } },
                    { host: 'b.example.com', http: { paths: [{ path: '/', pathType: 'Exact', backend: { service: { name: 'web', port: { number: 80 } } } }] } },
                    { host: 'c.example.com', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'other', port: { number: 80 } } } }] } },
                ],
            },
        }], new Set(['web']));
        expect(routes).toEqual([
            { ingress: 'ing', className: 'nginx', host: '*', path: '(default backend)', pathType: 'Default', serviceName: 'web', servicePort: '80', tls: false },
            { ingress: 'ing', className: 'nginx', host: 'a.example.com', path: '/api', pathType: 'Prefix', serviceName: 'web', servicePort: 'http', tls: true },
            { ingress: 'ing', className: 'nginx', host: 'x.apps.example.com', path: '/', pathType: 'Prefix', serviceName: 'web', servicePort: '80', tls: true },
            { ingress: 'ing', className: 'nginx', host: 'b.example.com', path: '/', pathType: 'Exact', serviceName: 'web', servicePort: '80', tls: false },
        ]);
    });
    it('prefers spec.ingressClassName and skips unrelated ingresses', () => {
        const routes = ingressRoutesForServices([
            { metadata: { name: 'a' }, spec: { ingressClassName: 'alb', rules: [{ http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'web' } } }] } }] } },
            { metadata: { name: 'b' }, spec: { defaultBackend: { service: { name: 'other' } } } },
        ], new Set(['web']));
        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({ ingress: 'a', className: 'alb', host: '*', tls: false });
    });
});

describe('describeNetworkPolicy', () => {
    it('detects default deny', () => {
        expect(describeNetworkPolicy({ metadata: { name: 'deny' }, spec: { podSelector: {} } })).toEqual({
            name: 'deny', policyTypes: ['Ingress'], ingressRules: 0, egressRules: 0, defaultDenyIngress: true, defaultDenyEgress: false,
        });
        expect(describeNetworkPolicy({ metadata: { name: 'all' }, spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'] } }))
            .toMatchObject({ defaultDenyIngress: true, defaultDenyEgress: true });
        expect(describeNetworkPolicy({ metadata: { name: 'allow' }, spec: { podSelector: {}, ingress: [{}], egress: [{}, {}] } }))
            .toMatchObject({ policyTypes: ['Ingress', 'Egress'], ingressRules: 1, egressRules: 2, defaultDenyIngress: false, defaultDenyEgress: false });
    });
});
