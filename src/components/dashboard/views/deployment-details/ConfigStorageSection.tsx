import React from 'react';
import { FileText, HardDrive, Key, XCircle } from 'lucide-react';
import type { PvcSummary, SectionResult } from '../../../../types/deployment-details';
import type { ConfigRef, ConfigRefs } from './config-refs';
import { SectionNote, SectionShell, SectionUnavailable } from './SectionShell';
import { FOCUS_RING, STATUS_CLASSES } from './status-classes';

interface ConfigStorageSectionProps {
    namespace: string;
    refs: ConfigRefs;
    pvcs: SectionResult<PvcSummary[]>;
    onOpenConfigMap: (name: string) => void;
    onOpenPvc: (name: string) => void;
}

const ViaChips: React.FC<{ via: string[] }> = ({ via }) => (
    <span className="flex flex-wrap gap-1">
        {via.map(v => <span key={v} className="text-[10px] text-gray-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">via {v}</span>)}
    </span>
);

const Heading: React.FC<{ children: React.ReactNode; count: number }> = ({ children, count }) => (
    <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        {children}<span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white">{count}</span>
    </h3>
);

const RefList: React.FC<{ refs: ConfigRef[]; render: (r: ConfigRef) => React.ReactNode; empty: string }> = ({ refs, render, empty }) => (
    refs.length === 0
        ? <p className="text-sm text-gray-500">{empty}</p>
        : <ul className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
            {refs.map(r => <li key={r.name} className="px-3 py-2 flex flex-wrap items-center gap-2">{render(r)}<ViaChips via={r.via} /></li>)}
        </ul>
);

const ConfigStorageSectionInner: React.FC<ConfigStorageSectionProps> = ({ namespace, refs, pvcs, onOpenConfigMap, onOpenPvc }) => (
    <SectionShell id="config-storage" title="Config & Storage" namespace={namespace}>
        <div className="space-y-5">
            <div className="space-y-2">
                <Heading count={refs.configMaps.length}>ConfigMaps</Heading>
                <RefList refs={refs.configMaps} empty="No ConfigMap references." render={r => (
                    <button type="button" onClick={() => onOpenConfigMap(r.name)} aria-label={`Open ConfigMap ${r.name}`}
                        className={`inline-flex items-center gap-1.5 font-mono text-sm text-blue-400 hover:underline break-all text-left rounded ${FOCUS_RING}`}>
                        <FileText size={12} className="shrink-0" aria-hidden="true" />{r.name}
                    </button>
                )} />
            </div>

            <div className="space-y-2">
                <Heading count={refs.secrets.length}>Secrets</Heading>
                {/* Names only and deliberately not clickable: the page never opens or reads Secret values. */}
                <RefList refs={refs.secrets} empty="No Secret references." render={r => (
                    <span className="inline-flex items-center gap-1.5 font-mono text-sm text-gray-300 break-all">
                        <Key size={12} className="shrink-0 text-purple-400" aria-hidden="true" />{r.name}
                    </span>
                )} />
            </div>

            <div className="space-y-2">
                <Heading count={refs.volumes.length}>Volumes</Heading>
                {refs.volumes.length === 0 ? <p className="text-sm text-gray-500">No volumes.</p> : (
                    <ul className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
                        {refs.volumes.map(v => (
                            <li key={v.name} className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-mono text-gray-300 break-all">{v.name}</span>
                                <span className={`px-1.5 py-0.5 rounded ${v.type === 'hostPath' ? STATUS_CLASSES.red : 'bg-white/10 text-gray-300'}`}>{v.type}</span>
                                {v.detail && <span className={`font-mono break-all ${v.type === 'hostPath' ? 'text-red-400' : 'text-gray-400'}`}>{v.detail}</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2"><HardDrive size={14} aria-hidden="true" />Persistent volume claims</h3>
                {pvcs.status === 'forbidden' && <SectionUnavailable kind="forbidden" label="read persistentvolumeclaims" namespace={namespace} />}
                {pvcs.status === 'error' && <SectionUnavailable kind="error" message={pvcs.message} />}
                {pvcs.status === 'ok' && (
                    <>
                        {pvcs.note && <SectionNote>{pvcs.note}</SectionNote>}
                        {pvcs.data.length === 0 ? <p className="text-sm text-gray-500">No PVCs mounted.</p> : (
                            <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-white/5 text-gray-400 font-medium border-b border-white/10">
                                        <tr>{['Claim', 'Phase', 'Class', 'Capacity', 'Access modes'].map(h => <th key={h} scope="col" className="text-left px-3 py-2">{h}</th>)}</tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {pvcs.data.map(p => (
                                            <tr key={p.claimName} className="hover:bg-white/5 transition-colors">
                                                <td className="px-3 py-2">
                                                    {p.found ? (
                                                        <button type="button" onClick={() => onOpenPvc(p.claimName)} aria-label={`Open PVC ${p.claimName}`}
                                                            className={`font-mono text-blue-400 hover:underline break-all text-left rounded ${FOCUS_RING}`}>{p.claimName}</button>
                                                    ) : <span className="font-mono text-gray-300 break-all">{p.claimName}</span>}
                                                </td>
                                                <td className="px-3 py-2">{p.found
                                                    ? <span className={`px-1.5 py-0.5 rounded ${STATUS_CLASSES[p.phase === 'Bound' ? 'green' : 'yellow']}`}>{p.phase ?? 'Unknown'}</span>
                                                    : <span className="inline-flex items-center gap-1 text-red-400"><XCircle size={11} aria-hidden="true" />Not found</span>}</td>
                                                <td className="px-3 py-2 text-gray-400">{p.storageClass ?? '–'}</td>
                                                <td className="px-3 py-2 font-mono text-gray-300">{p.capacity ?? '–'}</td>
                                                <td className="px-3 py-2 text-gray-400">{p.accessModes.join(', ') || '–'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    </SectionShell>
);

export const ConfigStorageSection = React.memo(ConfigStorageSectionInner);
