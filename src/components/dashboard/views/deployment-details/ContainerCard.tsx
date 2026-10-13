import React from 'react';
import { AlertTriangle, Cpu, Info, Key, XCircle } from 'lucide-react';
import type { ContainerFlag, ContainerInsight, EnvEntry, ProbeSummary } from '../../../../utils/container-insights-utils';
import { Disclosure } from './Disclosure';
import { FOCUS_RING, STATUS_CLASSES, type StatusColor } from './status-classes';

interface ContainerCardProps {
    insight: ContainerInsight;
    defaultOpen: boolean;
    onOpenConfigMap: (name: string) => void;
}

const KIND_LABEL: Record<ContainerInsight['kind'], string> = { init: 'Init', sidecar: 'Sidecar', main: 'Container' };
const KIND_COLOR: Record<ContainerInsight['kind'], StatusColor> = { init: 'gray', sidecar: 'blue', main: 'green' };
const FLAG_COLOR: Record<ContainerFlag['level'], StatusColor> = { fail: 'red', warn: 'yellow', info: 'blue' };
const FLAG_ICON: Record<ContainerFlag['level'], typeof Info> = { fail: XCircle, warn: AlertTriangle, info: Info };
const SOURCE_LABEL: Record<EnvEntry['source'], string> = {
    literal: 'value', configMapKeyRef: 'configmap', secretKeyRef: 'secret', fieldRef: 'field', resourceFieldRef: 'resource',
};

const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div>
        <div className="text-xs text-gray-400 mb-1">{title}</div>
        {children}
    </div>
);

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <th scope="col" className="text-left font-medium text-gray-400 px-2 py-1.5">{children}</th>
);

const Missing: React.FC<{ label: string }> = ({ label }) => (
    <span className="inline-flex items-center gap-1 text-yellow-400"><AlertTriangle size={11} aria-hidden="true" />{label}</span>
);

const Quantity: React.FC<{ label: string; value: string | undefined; warnIfMissing: boolean }> = ({ label, value, warnIfMissing }) => (
    <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-400 w-16">{label}</span>
        {value
            ? <span className="text-white font-mono">{value}</span>
            : warnIfMissing ? <Missing label="Not set" /> : <span className="text-gray-500 italic">Not set</span>}
    </div>
);

const ProbeRow: React.FC<{ name: string; probe: ProbeSummary | null }> = ({ name, probe }) => (
    <tr>
        <td className="px-2 py-1.5 text-gray-400">{name}</td>
        {probe ? (
            <>
                <td className="px-2 py-1.5 font-mono text-gray-300 break-all">{probe.target || probe.handler}</td>
                <td className="px-2 py-1.5 font-mono text-gray-400 whitespace-nowrap">
                    delay {probe.initialDelaySeconds}s · every {probe.periodSeconds}s · timeout {probe.timeoutSeconds}s · fail ×{probe.failureThreshold}
                </td>
            </>
        ) : <td colSpan={2} className="px-2 py-1.5 text-gray-500 italic">Not configured</td>}
    </tr>
);

const ImageLine: React.FC<{ insight: ContainerInsight }> = ({ insight }) => {
    const { image } = insight;
    return (
        <div className="space-y-1">
            <div className="font-mono text-sm text-white break-all">{image.raw || '(no image)'}</div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
                {image.registry && <span className="font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">registry {image.registry}</span>}
                <span className="font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 break-all">repo {image.repository}</span>
                {image.tag && <span className={`font-mono px-1.5 py-0.5 rounded ${image.isLatest ? STATUS_CLASSES.yellow : 'bg-white/5 border border-white/10 text-gray-400'}`}>tag {image.tag}</span>}
                {image.isUntagged && <span className={`px-1.5 py-0.5 rounded ${STATUS_CLASSES.yellow}`}>no tag</span>}
                {image.digest && <span className="font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 break-all">{image.digest}</span>}
                <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">pull {insight.effectivePullPolicy}</span>
            </div>
            {insight.runningImageIDs.length > 0 && (
                <div className="text-[11px] text-gray-400">
                    Running digest{insight.runningImageIDs.length > 1 ? 's' : ''}:
                    {insight.runningImageIDs.map(id => <div key={id} className="font-mono text-gray-300 break-all">{id}</div>)}
                </div>
            )}
        </div>
    );
};

const EnvTable: React.FC<{ env: EnvEntry[]; onOpenConfigMap: (name: string) => void }> = ({ env, onOpenConfigMap }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-xs">
            <thead className="bg-white/5 border-b border-white/10"><tr><Th>Name</Th><Th>Source</Th><Th>Value</Th></tr></thead>
            <tbody className="divide-y divide-white/5">
                {env.map((e, i) => (
                    <tr key={`${e.name}-${i}`}>
                        <td className="px-2 py-1.5 font-mono text-gray-300 break-all">{e.name}</td>
                        <td className="px-2 py-1.5"><span className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300">{SOURCE_LABEL[e.source]}</span></td>
                        <td className="px-2 py-1.5 font-mono break-all">
                            {e.source === 'secretKeyRef' ? (
                                // Secret refs: name / key only, never clickable, never the value.
                                <span className="inline-flex items-center gap-1 text-gray-300"><Key size={11} className="text-purple-400" aria-hidden="true" />{e.display}</span>
                            ) : e.source === 'configMapKeyRef' && e.refName ? (
                                <button type="button" onClick={() => onOpenConfigMap(e.refName as string)} aria-label={`Open ConfigMap ${e.refName}`}
                                    className={`text-blue-400 hover:underline text-left break-all rounded ${FOCUS_RING}`}>{e.display}</button>
                            ) : e.masked ? (
                                <span className="text-gray-500" title="Value hidden: looks sensitive">{e.display}</span>
                            ) : <span className="text-gray-300">{e.display}</span>}
                            {e.optional && <span className="ml-1 text-gray-500">(optional)</span>}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const ContainerCardInner: React.FC<ContainerCardProps> = ({ insight, defaultOpen, onOpenConfigMap }) => {
    const { resources, probes, lifecycle } = insight;
    const flags = insight.flags;
    const header = (
        <span className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="font-mono text-white break-all">{insight.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLASSES[KIND_COLOR[insight.kind]]}`}>{KIND_LABEL[insight.kind]}</span>
            {flags.some(f => f.level !== 'info') && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLASSES.yellow}`}>
                    {flags.filter(f => f.level !== 'info').length} warning{flags.filter(f => f.level !== 'info').length === 1 ? '' : 's'}
                </span>
            )}
        </span>
    );

    return (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <Disclosure title={header} defaultOpen={defaultOpen} buttonClassName="text-sm font-semibold hover:text-white">
                <div className="space-y-4">
                    <ImageLine insight={insight} />
                    {flags.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                            {flags.map(f => {
                                const Icon = FLAG_ICON[f.level];
                                return (
                                    <li key={f.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${STATUS_CLASSES[FLAG_COLOR[f.level]]}`}>
                                        <Icon size={11} aria-hidden="true" />{f.message}
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {insight.ports.length > 0 && (
                        <Block title="Ports">
                            <table className="w-full text-xs">
                                <thead className="bg-white/5 border-b border-white/10"><tr><Th>Name</Th><Th>Container port</Th><Th>Protocol</Th><Th>Host port</Th></tr></thead>
                                <tbody className="divide-y divide-white/5">
                                    {insight.ports.map((p, i) => (
                                        <tr key={`${p.containerPort}-${p.protocol}-${i}`}>
                                            <td className="px-2 py-1.5 font-mono text-gray-300">{p.name ?? '–'}</td>
                                            <td className="px-2 py-1.5 font-mono text-white">{p.containerPort}</td>
                                            <td className="px-2 py-1.5 text-gray-300">{p.protocol}</td>
                                            <td className="px-2 py-1.5 font-mono">{p.hostPort !== null ? <Missing label={String(p.hostPort)} /> : <span className="text-gray-500">–</span>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Block>
                    )}

                    {(insight.command.length > 0 || insight.args.length > 0 || insight.workingDir) && (
                        <Block title="Command">
                            <div className="font-mono text-xs text-gray-300 bg-black/40 border border-white/10 rounded-lg p-2 whitespace-pre-wrap break-all space-y-1">
                                {insight.command.length > 0 && <div><span className="text-gray-500">command: </span>{insight.command.join(' ')}</div>}
                                {insight.args.length > 0 && <div><span className="text-gray-500">args: </span>{insight.args.join(' ')}</div>}
                                {insight.workingDir && <div><span className="text-gray-500">workingDir: </span>{insight.workingDir}</div>}
                            </div>
                        </Block>
                    )}

                    {insight.env.length > 0 && <Block title={`Environment (${insight.env.length})`}><EnvTable env={insight.env} onOpenConfigMap={onOpenConfigMap} /></Block>}

                    {insight.envFrom.length > 0 && (
                        <Block title="Env from">
                            <div className="flex flex-wrap gap-1.5">
                                {insight.envFrom.map((ef, i) => ef.kind === 'secret' ? (
                                    <span key={`s-${ef.name}-${i}`} className="inline-flex items-center gap-1 font-mono text-xs text-gray-300 bg-white/5 border border-white/10 px-2 py-0.5 rounded-md">
                                        <Key size={11} className="text-purple-400" aria-hidden="true" />secret {ef.name}{ef.prefix ? ` (prefix ${ef.prefix})` : ''}{ef.optional ? ' (optional)' : ''}
                                    </span>
                                ) : (
                                    <button key={`c-${ef.name}-${i}`} type="button" onClick={() => onOpenConfigMap(ef.name)} aria-label={`Open ConfigMap ${ef.name}`}
                                        className={`font-mono text-xs text-blue-400 hover:underline bg-white/5 border border-white/10 px-2 py-0.5 rounded-md ${FOCUS_RING}`}>
                                        configmap {ef.name}{ef.prefix ? ` (prefix ${ef.prefix})` : ''}{ef.optional ? ' (optional)' : ''}
                                    </button>
                                ))}
                            </div>
                        </Block>
                    )}

                    {insight.volumeMounts.length > 0 && (
                        <Block title="Volume mounts">
                            <table className="w-full text-xs">
                                <thead className="bg-white/5 border-b border-white/10"><tr><Th>Path</Th><Th>Volume</Th><Th>Type</Th><Th>Mode</Th></tr></thead>
                                <tbody className="divide-y divide-white/5">
                                    {insight.volumeMounts.map((m, i) => (
                                        <tr key={`${m.mountPath}-${i}`}>
                                            <td className="px-2 py-1.5 font-mono text-gray-300 break-all">{m.mountPath}{m.subPath ? ` (subPath ${m.subPath})` : ''}</td>
                                            <td className="px-2 py-1.5 font-mono text-gray-300 break-all">{m.name}</td>
                                            <td className={`px-2 py-1.5 ${m.volumeType === 'hostPath' ? 'text-red-400' : 'text-gray-400'}`}>{m.volumeType}</td>
                                            <td className="px-2 py-1.5">{m.readOnly
                                                ? <span className={`px-1.5 py-0.5 rounded ${STATUS_CLASSES.green}`}>RO</span>
                                                : <span className="text-gray-400">RW</span>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Block>
                    )}

                    <div>
                        <span className="text-gray-500 text-xs uppercase font-bold mb-2 flex items-center gap-2"><Cpu size={14} aria-hidden="true" /> Resources</span>
                        <div className="grid grid-cols-2 gap-4 bg-black/40 p-3 rounded border border-white/10">
                            <div>
                                <span className="text-gray-500 text-[10px] uppercase block mb-1 font-bold">Requests</span>
                                <Quantity label="CPU" value={resources.requests.cpu} warnIfMissing />
                                <Quantity label="Memory" value={resources.requests.memory} warnIfMissing />
                            </div>
                            <div>
                                <span className="text-gray-500 text-[10px] uppercase block mb-1 font-bold">Limits</span>
                                <Quantity label="CPU" value={resources.limits.cpu} warnIfMissing={false} />
                                <Quantity label="Memory" value={resources.limits.memory} warnIfMissing />
                            </div>
                        </div>
                    </div>

                    <Block title="Probes">
                        <table className="w-full text-xs">
                            <tbody className="divide-y divide-white/5">
                                <ProbeRow name="Readiness" probe={probes.readiness} />
                                <ProbeRow name="Liveness" probe={probes.liveness} />
                                <ProbeRow name="Startup" probe={probes.startup} />
                            </tbody>
                        </table>
                    </Block>

                    {(lifecycle.postStart || lifecycle.preStop) && (
                        <Block title="Lifecycle hooks">
                            <div className="font-mono text-xs text-gray-300 space-y-1 break-all">
                                {lifecycle.postStart && <div><span className="text-gray-500">postStart: </span>{lifecycle.postStart}</div>}
                                {lifecycle.preStop && <div><span className="text-gray-500">preStop: </span>{lifecycle.preStop}</div>}
                            </div>
                        </Block>
                    )}
                </div>
            </Disclosure>
        </div>
    );
};

export const ContainerCard = React.memo(ContainerCardInner);
