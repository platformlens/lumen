import React, { useState } from 'react';
import { Globe, Copy, Check, Lock, Unlock } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface GatewayDetailsProps {
    gateway: any;
    onExplain?: () => void;
    onOpenYaml?: () => void;
}

export const GatewayDetails: React.FC<GatewayDetailsProps> = ({ gateway, onExplain: _onExplain, onOpenYaml: _onOpenYaml }) => {
    const [copiedHost, setCopiedHost] = useState<string | null>(null);

    if (!gateway) return null;

    const metadata = gateway.metadata || {};
    const spec = gateway.spec || {};
    const servers = spec.servers || [];
    const selector = spec.selector || {};

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
                        <div className="col-span-2 text-white font-mono text-sm">{gateway.apiVersion}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {metadata.creationTimestamp ? <TimeAgo timestamp={metadata.creationTimestamp} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Selector */}
            {Object.keys(selector).length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Selector</h3>
                    <div className="bg-white/5 rounded-md p-4 border border-white/10">
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(selector).map(([k, v]) => (
                                <span key={k} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                                    {k}: {String(v)}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Servers */}
            {servers.map((server: any, idx: number) => {
                const port = server.port || {};
                const tls = server.tls || {};
                const hosts: string[] = server.hosts || [];
                const isSecure = port.protocol === 'HTTPS' || port.protocol === 'TLS';

                return (
                    <div key={idx}>
                        <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                            {isSecure ? <Lock size={14} className="text-green-400" /> : <Unlock size={14} className="text-yellow-400" />}
                            Server — {port.name || `Port ${port.number}`}
                        </h3>
                        <div className="bg-white/5 rounded-md border border-white/10 overflow-hidden">
                            {/* Port info */}
                            <div className="p-4 space-y-2 border-b border-white/10">
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-gray-400">Port</div>
                                    <div className="col-span-2 font-mono text-yellow-400">{port.number}</div>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-gray-400">Protocol</div>
                                    <div className="col-span-2">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                                            isSecure
                                                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                        }`}>
                                            {port.protocol}
                                        </span>
                                    </div>
                                </div>
                                {port.name && (
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="text-gray-400">Name</div>
                                        <div className="col-span-2 text-white font-mono text-sm">{port.name}</div>
                                    </div>
                                )}
                            </div>

                            {/* TLS info */}
                            {Object.keys(tls).length > 0 && (
                                <div className="p-4 space-y-2 border-b border-white/10">
                                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">TLS</div>
                                    {tls.mode && (
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="text-gray-400">Mode</div>
                                            <div className="col-span-2">
                                                <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                                    {tls.mode}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                    {tls.credentialName && (
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="text-gray-400">Credential</div>
                                            <div className="col-span-2 text-white font-mono text-sm break-all">{tls.credentialName}</div>
                                        </div>
                                    )}
                                    {tls.httpsRedirect && (
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="text-gray-400">HTTPS Redirect</div>
                                            <div className="col-span-2">
                                                <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                                                    Enabled
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Hosts */}
                            <div className="p-4">
                                <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <Globe size={14} />
                                    Hosts ({hosts.length})
                                </div>
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
                        </div>
                    </div>
                );
            })}

            {servers.length === 0 && (
                <div className="bg-white/5 rounded-md p-4 border border-white/10 text-center text-gray-500">
                    No servers defined
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
