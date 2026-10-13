import React from 'react';
import { AlertTriangle, ArrowRight, Lock, ShieldOff, Unlock } from 'lucide-react';
import type { SectionResult } from '../../../../types/deployment-details';
import type { IngressRoute } from '../../../../utils/networking-utils';
import type { NetworkPolicyRow, ServiceRow } from './useDeploymentDerivedData';
import { SectionNote, SectionShell, SectionUnavailable } from './SectionShell';
import { FOCUS_RING, STATUS_CLASSES } from './status-classes';

interface NetworkingSectionProps {
    namespace: string;
    services: SectionResult<ServiceRow[]>;
    ingressRoutes: SectionResult<IngressRoute[]>;
    networkPolicies: SectionResult<NetworkPolicyRow[]>;
    onOpenService: (name: string) => void;
    onOpenIngress: (name: string) => void;
    onOpenNetworkPolicy: (name: string) => void;
}

const LinkButton: React.FC<{ name: string; kind: string; onClick: (name: string) => void }> = ({ name, kind, onClick }) => (
    <button type="button" onClick={() => onClick(name)} aria-label={`Open ${kind} ${name}`}
        className={`font-mono text-sm text-blue-400 hover:underline text-left break-all rounded ${FOCUS_RING}`}>
        {name}
    </button>
);

/** Renders a sub-list's own SectionResult (forbidden / error / note / ok). */
function SubList<T>({ title, result, label, namespace, children }: {
    title: string; result: SectionResult<T>; label: string; namespace: string; children: (data: T) => React.ReactNode;
}) {
    return (
        <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
            {result.status === 'forbidden' && <SectionUnavailable kind="forbidden" label={label} namespace={namespace} />}
            {result.status === 'error' && <SectionUnavailable kind="error" message={result.message} />}
            {result.status === 'ok' && (
                <>
                    {result.note && <SectionNote>{result.note}</SectionNote>}
                    {children(result.data)}
                </>
            )}
        </div>
    );
}

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-3">{children}</p>
);

const ServiceCard: React.FC<{ svc: ServiceRow; onOpen: (name: string) => void }> = ({ svc, onOpen }) => (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
            <LinkButton name={svc.name} kind="service" onClick={onOpen} />
            <span className="text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded-md">{svc.type}</span>
            {svc.clusterIP && <span className="font-mono text-xs text-gray-400">{svc.clusterIP}</span>}
        </div>
        {svc.loadBalancer.length > 0 && (
            <div className="text-xs text-gray-400">LoadBalancer: {svc.loadBalancer.map(h => <span key={h} className="font-mono text-gray-300 mr-2 break-all">{h}</span>)}</div>
        )}
        <ul className="space-y-1">
            {svc.ports.map((p, i) => (
                <li key={`${p.servicePort}-${p.protocol}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs font-mono text-gray-300">
                    <span className="text-white">{p.servicePort}/{p.protocol}</span>
                    <ArrowRight size={11} className="text-gray-500" aria-label="to" />
                    <span>{p.targetPort}</span>
                    <ArrowRight size={11} className="text-gray-500" aria-label="to" />
                    {p.resolved
                        ? <span>{p.resolved.container}:{p.resolved.containerPort}{p.resolved.portName ? ` (${p.resolved.portName})` : ''}</span>
                        : <span className="inline-flex items-center gap-1 text-yellow-400 font-sans"><AlertTriangle size={11} aria-hidden="true" />No matching container port</span>}
                    {p.nodePort !== null && <span className="text-gray-400 font-sans">NodePort <span className="font-mono">{p.nodePort}</span></span>}
                </li>
            ))}
        </ul>
    </div>
);

const NetworkingSectionInner: React.FC<NetworkingSectionProps> = ({
    namespace, services, ingressRoutes, networkPolicies, onOpenService, onOpenIngress, onOpenNetworkPolicy,
}) => (
    <SectionShell id="networking" title="Networking" namespace={namespace}>
        <div className="space-y-5">
            <SubList title="Services" result={services} label="list services" namespace={namespace}>
                {list => list.length === 0
                    ? <Empty>No Service selects these pods.</Empty>
                    : <div className="space-y-2">{list.map(s => <ServiceCard key={s.name} svc={s} onOpen={onOpenService} />)}</div>}
            </SubList>

            <SubList title="Ingress routes" result={ingressRoutes} label="list ingresses" namespace={namespace}>
                {routes => routes.length === 0 ? <Empty>No Ingress routes to these services.</Empty> : (
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-white/5 text-gray-400 font-medium border-b border-white/10">
                                <tr>{['Host', 'Path', 'TLS', 'Class', 'Backend', 'Ingress'].map(h => <th key={h} scope="col" className="text-left px-3 py-2">{h}</th>)}</tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {routes.map((r, i) => (
                                    <tr key={`${r.ingress}-${r.host}-${r.path}-${i}`} className="hover:bg-white/5 transition-colors">
                                        <td className="px-3 py-2 font-mono text-gray-300 break-all">{r.host}</td>
                                        <td className="px-3 py-2 font-mono text-gray-300 break-all">{r.path} <span className="text-gray-500 font-sans">({r.pathType})</span></td>
                                        <td className="px-3 py-2">{r.tls
                                            ? <span className="inline-flex items-center gap-1 text-green-400"><Lock size={11} aria-hidden="true" />TLS</span>
                                            : <span className="inline-flex items-center gap-1 text-gray-400"><Unlock size={11} aria-hidden="true" />None</span>}</td>
                                        <td className="px-3 py-2 text-gray-400">{r.className ?? '–'}</td>
                                        <td className="px-3 py-2 font-mono text-gray-300">{r.serviceName}:{r.servicePort}</td>
                                        <td className="px-3 py-2"><LinkButton name={r.ingress} kind="ingress" onClick={onOpenIngress} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </SubList>

            <SubList title="Network policies" result={networkPolicies} label="list networkpolicies" namespace={namespace}>
                {list => list.length === 0 ? (
                    <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-400">
                        <ShieldOff size={14} className="mt-px shrink-0" aria-hidden="true" />
                        No NetworkPolicy selects these pods; all ingress and egress traffic is allowed.
                    </div>
                ) : (
                    <ul className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
                        {list.map(np => (
                            <li key={np.name} className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
                                <LinkButton name={np.name} kind="network policy" onClick={onOpenNetworkPolicy} />
                                <span className="text-gray-400">{np.policyTypes.join(' + ')}</span>
                                <span className="text-gray-400">{np.ingressRules} ingress rule{np.ingressRules === 1 ? '' : 's'}, {np.egressRules} egress rule{np.egressRules === 1 ? '' : 's'}</span>
                                {np.defaultDenyIngress && <span className={`px-1.5 py-0.5 rounded ${STATUS_CLASSES.yellow}`}>Default deny ingress</span>}
                                {np.defaultDenyEgress && <span className={`px-1.5 py-0.5 rounded ${STATUS_CLASSES.yellow}`}>Default deny egress</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </SubList>
        </div>
    </SectionShell>
);

export const NetworkingSection = React.memo(NetworkingSectionInner);
