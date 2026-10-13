/**
 * Networking helpers for the Deployment Full View: service → container port mapping,
 * ingress routes to the deployment's services, and NetworkPolicy summaries.
 */
import type { V1Container, V1Ingress, V1NetworkPolicy, V1Service } from '@kubernetes/client-node';
import type { Jsonified, PodTemplate } from '../types/deployment-details';

export interface PortMapping {
    serviceName: string; serviceType: string; servicePort: number; protocol: string;
    targetPort: string; nodePort: number | null;
    resolved: { container: string; containerPort: number; portName: string | null } | null;   // null -> warn
}
export interface IngressRoute {
    ingress: string; className: string | null; host: string; path: string; pathType: string;
    serviceName: string; servicePort: string; tls: boolean;
}

type Container = Jsonified<V1Container>;

function portContainers(template: PodTemplate): Container[] {
    // Main containers first; sidecars (restartPolicy Always init containers) can also serve traffic.
    return [
        ...(template.spec?.containers ?? []),
        ...(template.spec?.initContainers ?? []).filter(c => c.restartPolicy === 'Always'),
    ];
}

function resolveTarget(target: number | string, protocol: string, containers: Container[]): PortMapping['resolved'] {
    for (const c of containers) {
        for (const p of c.ports ?? []) {
            const matches = typeof target === 'number'
                ? p.containerPort === target && (p.protocol ?? 'TCP') === protocol
                : p.name === target;
            if (matches) return { container: c.name, containerPort: p.containerPort, portName: p.name ?? null };
        }
    }
    return null;
}

/** targetPort int -> containerPort match; string -> ports[].name match; unset -> equals port. */
export function mapServicePorts(services: Jsonified<V1Service>[], template: PodTemplate): PortMapping[] {
    const containers = portContainers(template);
    const out: PortMapping[] = [];
    for (const svc of services) {
        for (const port of svc.spec?.ports ?? []) {
            const target = port.targetPort ?? port.port;
            const protocol = port.protocol ?? 'TCP';
            out.push({
                serviceName: svc.metadata?.name ?? '',
                serviceType: svc.spec?.type ?? 'ClusterIP',
                servicePort: port.port,
                protocol,
                targetPort: String(target),
                nodePort: port.nodePort ?? null,
                resolved: resolveTarget(target, protocol, containers),
            });
        }
    }
    return out;
}

function hostHasTls(host: string, tlsHosts: string[]): boolean {
    return tlsHosts.some(t => t === host || (t.startsWith('*.') && host.endsWith(t.slice(1)) && host.split('.').length === t.split('.').length));
}

/** Every ingress default backend and rule path that routes to one of `serviceNames`. */
export function ingressRoutesForServices(ingresses: Jsonified<V1Ingress>[], serviceNames: Set<string>): IngressRoute[] {
    const routes: IngressRoute[] = [];
    for (const ing of ingresses) {
        const name = ing.metadata?.name ?? '';
        const className = ing.spec?.ingressClassName ?? ing.metadata?.annotations?.['kubernetes.io/ingress.class'] ?? null;
        const tlsHosts = (ing.spec?.tls ?? []).flatMap(t => t.hosts ?? []);
        const def = ing.spec?.defaultBackend?.service;
        if (def && serviceNames.has(def.name)) {
            routes.push({ ingress: name, className, host: '*', path: '(default backend)', pathType: 'Default',
                serviceName: def.name, servicePort: def.port?.name ?? String(def.port?.number ?? ''), tls: false });
        }
        for (const rule of ing.spec?.rules ?? []) {
            const host = rule.host ?? '*';
            for (const p of rule.http?.paths ?? []) {
                const svc = p.backend?.service;
                if (!svc || !serviceNames.has(svc.name)) continue;
                routes.push({
                    ingress: name, className, host,
                    path: p.path ?? '/', pathType: p.pathType ?? 'ImplementationSpecific',
                    serviceName: svc.name, servicePort: svc.port?.name ?? String(svc.port?.number ?? ''),
                    tls: rule.host ? hostHasTls(rule.host, tlsHosts) : false,
                });
            }
        }
    }
    return routes;
}

/** Policy types (Kubernetes defaults when unset), rule counts and default-deny detection. */
export function describeNetworkPolicy(np: Jsonified<V1NetworkPolicy>): {
    name: string; policyTypes: string[];
    ingressRules: number; egressRules: number; defaultDenyIngress: boolean; defaultDenyEgress: boolean;
} {
    const spec = np.spec;
    const ingressRules = spec?.ingress?.length ?? 0;
    const egressRules = spec?.egress?.length ?? 0;
    const policyTypes = spec?.policyTypes?.length
        ? spec.policyTypes
        : (spec?.egress ? ['Ingress', 'Egress'] : ['Ingress']);
    return {
        name: np.metadata?.name ?? '',
        policyTypes,
        ingressRules, egressRules,
        defaultDenyIngress: policyTypes.includes('Ingress') && ingressRules === 0,
        defaultDenyEgress: policyTypes.includes('Egress') && egressRules === 0,
    };
}
