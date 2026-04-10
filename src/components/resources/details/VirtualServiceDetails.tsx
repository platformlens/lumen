import React, { useState } from 'react';
import { Globe, Copy, Check, ArrowRight, Network } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface VirtualServiceDetailsProps {
    virtualService: any;
    onExplain?: () => void;
    onOpenYaml?: () => void;
    onNavigate?: (kind: string, name: string, namespace?: string) => void;
}

export const VirtualServiceDetails: React.FC<VirtualServiceDetailsProps> = ({ virtualService, onExplain: _onExplain, onOpenYaml: _onOpenYaml, onNavigate }) => {
    const [copiedHost, setCopiedHost] = useState<string | null>(null);

    if (!virtualService) return null;

    const metadata = virtualService.metadata || {};
    const spec = virtualService.spec || {};
    const gateways: string[] = spec.gateways || [];
    const hosts: string[] = spec.hosts || [];
    const httpRoutes: any[] = spec.http || [];
    const tcpRoutes: any[] = spec.tcp || [];
    const tlsRoutes: any[] = spec.tls || [];

    const handleCopyHost = (host: string) => {
        navigator.clipboard.writeText(host);
        setCopiedHost(host);
        setTimeout(() => setCopiedHost(null), 2000);
    };

    return (
        <div className="space-y-6 text-sm">
            {/* Metadata */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Metadata</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Namespace</div>
                        <div className="col-span-2 text-white font-mono text-sm">{metadata.namespace}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">API Version</div>
                        <div className="col-span-2 text-white font-mono text-sm">{virtualService.apiVersion}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {metadata.creationTimestamp ? <TimeAgo timestamp={metadata.creationTimestamp} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Gateways */}
            {gateways.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Network size={14} />
                        Gateways
                    </h3>
                    <div className="bg-white/5 rounded-md p-4 border border-white/10">
                        <div className="flex flex-wrap gap-2">
                            {gateways.map((gw: string, i: number) => (
                                <button
                                    key={i}
                                    onClick={() => onNavigate?.('Gateway', gw, metadata.namespace)}
                                    className="px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded text-xs text-purple-400 font-mono hover:bg-purple-500/20 hover:border-purple-500/30 transition-colors cursor-pointer"
                                >
                                    {gw}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Hosts */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Globe size={14} />
                    Hosts ({hosts.length})
                </h3>
                <div className="bg-black/40 rounded border border-white/10 overflow-hidden">
                    <table className="w-full text-xs font-mono">
                        <tbody>
                            {hosts.length === 0 && (
                                <tr><td className="text-gray-600 italic py-2 px-2">No hosts defined</td></tr>
                            )}
                            {hosts.map((host: string, hIdx: number) => (
                                <tr key={hIdx} className="group border-b border-white/5 last:border-0 hover:bg-white/5">
                                    <td className="px-2 py-1.5 text-blue-400 break-all">{host}</td>
                                    <td className="px-2 py-1.5 w-8 text-right">
                                        <button
                                            onClick={() => handleCopyHost(host)}
                                            className="shrink-0 p-0.5 text-gray-700 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Copy host"
                                        >
                                            {copiedHost === host ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* HTTP Routes */}
            {httpRoutes.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">HTTP Routes</h3>
                    <div className="space-y-3">
                        {httpRoutes.map((route: any, rIdx: number) => (
                            <div key={rIdx} className="bg-white/5 rounded-md border border-white/10 overflow-hidden">
                                {/* Match conditions */}
                                {route.match && route.match.length > 0 && (
                                    <div className="p-4 border-b border-white/10 space-y-2">
                                        <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Match</div>
                                        {route.match.map((m: any, mIdx: number) => (
                                            <div key={mIdx} className="flex flex-wrap gap-2">
                                                {m.uri && (
                                                    <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                                                        uri: {Object.entries(m.uri).map(([k, v]) => `${k}=${String(v)}`).join(', ')}
                                                    </span>
                                                )}
                                                {m.headers && Object.entries(m.headers).map(([hk, hv]: [string, any]) => (
                                                    <span key={hk} className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-400 font-mono">
                                                        header {hk}: {Object.entries(hv).map(([k, v]) => `${k}=${String(v)}`).join(', ')}
                                                    </span>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Route destinations */}
                                <div className="p-4">
                                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Destinations</div>
                                    <div className="space-y-2">
                                        {(route.route || []).map((dest: any, dIdx: number) => {
                                            const d = dest.destination || {};
                                            return (
                                                <div key={dIdx} className="flex items-center gap-2 bg-black/40 rounded px-3 py-2 border border-white/10">
                                                    <ArrowRight size={14} className="text-green-400 shrink-0" />
                                                    <span className="font-mono text-green-400">{d.host}</span>
                                                    {d.port?.number && (
                                                        <span className="font-mono text-yellow-400">:{d.port.number}</span>
                                                    )}
                                                    {d.subset && (
                                                        <span className="px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-xs text-purple-400">
                                                            subset: {d.subset}
                                                        </span>
                                                    )}
                                                    {dest.weight != null && (
                                                        <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400">
                                                            weight: {dest.weight}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Timeout / Retries / Fault */}
                                {(route.timeout || route.retries || route.fault) && (
                                    <div className="p-4 border-t border-white/10 space-y-2">
                                        {route.timeout && (
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="text-gray-400">Timeout</div>
                                                <div className="col-span-2 font-mono text-white">{route.timeout}</div>
                                            </div>
                                        )}
                                        {route.retries && (
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="text-gray-400">Retries</div>
                                                <div className="col-span-2 font-mono text-white">
                                                    {route.retries.attempts} attempts{route.retries.perTryTimeout ? `, ${route.retries.perTryTimeout} per try` : ''}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* TCP Routes */}
            {tcpRoutes.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">TCP Routes</h3>
                    <div className="space-y-2">
                        {tcpRoutes.map((route: any, rIdx: number) => (
                            <div key={rIdx} className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                                {(route.route || []).map((dest: any, dIdx: number) => {
                                    const d = dest.destination || {};
                                    return (
                                        <div key={dIdx} className="flex items-center gap-2 bg-black/40 rounded px-3 py-2 border border-white/10">
                                            <ArrowRight size={14} className="text-green-400 shrink-0" />
                                            <span className="font-mono text-green-400">{d.host}</span>
                                            {d.port?.number && <span className="font-mono text-yellow-400">:{d.port.number}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* TLS Routes */}
            {tlsRoutes.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">TLS Routes</h3>
                    <div className="space-y-2">
                        {tlsRoutes.map((route: any, rIdx: number) => (
                            <div key={rIdx} className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                                {(route.route || []).map((dest: any, dIdx: number) => {
                                    const d = dest.destination || {};
                                    return (
                                        <div key={dIdx} className="flex items-center gap-2 bg-black/40 rounded px-3 py-2 border border-white/10">
                                            <ArrowRight size={14} className="text-green-400 shrink-0" />
                                            <span className="font-mono text-green-400">{d.host}</span>
                                            {d.port?.number && <span className="font-mono text-yellow-400">:{d.port.number}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Labels */}
            {metadata.labels && Object.keys(metadata.labels).length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Labels</h3>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(metadata.labels).map(([k, v]) => (
                            <span key={k} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                                {k}: {String(v)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
