import React, { useState } from 'react';
import { Shield, Copy, Check, Clock, Key, Globe, Lock, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface CertificateDetailsProps {
    certificate: any;
    explanation?: string | null;
    onExplain?: () => void;
    onOpenYaml?: () => void;
    onNavigate?: (kind: string, name: string, namespace?: string) => void;
}

/** Format a Go duration string like "2160h0m0s" into a human-readable label */
function formatDuration(dur?: string): string {
    if (!dur) return '-';
    const match = dur.match(/^(\d+)h(\d+)m(\d+)s$/);
    if (!match) return dur;
    const hours = parseInt(match[1], 10);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (days > 0 && remainingHours > 0) return `${days}d ${remainingHours}h`;
    if (days > 0) return `${days}d`;
    return `${hours}h`;
}

/** Calculate days remaining until a date, returning negative for past dates */
function daysUntil(dateStr?: string): number | null {
    if (!dateStr) return null;
    const target = new Date(dateStr).getTime();
    const now = Date.now();
    return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

/** Get color classes based on days remaining */
function expiryColor(days: number | null): { bg: string; text: string; border: string } {
    if (days === null) return { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' };
    if (days <= 0) return { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' };
    if (days <= 30) return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' };
    return { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' };
}

export const CertificateDetails: React.FC<CertificateDetailsProps> = ({
    certificate,
    explanation: _explanation,
    onExplain: _onExplain,
    onOpenYaml: _onOpenYaml,
    onNavigate,
}) => {
    const [copiedDns, setCopiedDns] = useState<string | null>(null);

    if (!certificate) return null;

    const name = certificate.name || certificate.metadata?.name || '';
    const namespace = certificate.namespace || certificate.metadata?.namespace || '';
    const age = certificate.age || certificate.metadata?.creationTimestamp || '';
    const spec = certificate.spec || {};
    const status = certificate.status || {};
    const conditions: any[] = status.conditions || [];
    const dnsNames: string[] = spec.dnsNames || [];
    const usages: string[] = spec.usages || [];
    const issuerRef = spec.issuerRef || {};
    const privateKey = spec.privateKey || {};

    const readyCondition = conditions.find((c: any) => c.type === 'Ready');
    const isReady = readyCondition?.status === 'True';

    const notAfterDays = daysUntil(status.notAfter);
    const renewalDays = daysUntil(status.renewalTime);
    const expiryColors = expiryColor(notAfterDays);

    const handleCopyDns = (dns: string) => {
        navigator.clipboard.writeText(dns);
        setCopiedDns(dns);
        setTimeout(() => setCopiedDns(null), 2000);
    };

    return (
        <div className="space-y-6 text-sm">
            {/* Status Banner */}
            <div className={`rounded-xl p-4 border ${isReady ? 'bg-green-500/10 border-green-500/20' : 'bg-yellow-500/10 border-yellow-500/20'}`}>
                <div className="flex items-center gap-3">
                    {isReady
                        ? <CheckCircle size={20} className="text-green-400 shrink-0" />
                        : <AlertTriangle size={20} className="text-yellow-400 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                        <div className={`font-semibold ${isReady ? 'text-green-400' : 'text-yellow-400'}`}>
                            {readyCondition?.reason || (isReady ? 'Ready' : 'Not Ready')}
                        </div>
                        {readyCondition?.message && (
                            <div className="text-gray-300 text-xs mt-0.5">{readyCondition.message}</div>
                        )}
                    </div>
                    {status.revision != null && (
                        <span className="text-xs text-gray-500 shrink-0">Revision {status.revision}</span>
                    )}
                </div>
            </div>

            {/* Metadata */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Metadata</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Name</div>
                        <div className="col-span-2 text-white font-mono text-sm break-all">{name}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Namespace</div>
                        <div className="col-span-2 text-white font-mono text-sm">{namespace}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">API Version</div>
                        <div className="col-span-2 text-white font-mono text-sm">{certificate.apiVersion || 'cert-manager.io/v1'}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {age ? <TimeAgo timestamp={age} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Validity & Renewal */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Clock size={14} />
                    Validity & Renewal
                </h3>
                <div className="bg-white/5 rounded-md border border-white/10 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/10">
                        {/* Not Before */}
                        <div className="p-4 space-y-1">
                            <div className="text-gray-400 text-xs uppercase tracking-wider">Not Before</div>
                            <div className="text-white text-sm font-mono">
                                {status.notBefore ? new Date(status.notBefore).toLocaleDateString() : '-'}
                            </div>
                        </div>
                        {/* Not After */}
                        <div className="p-4 space-y-1">
                            <div className="text-gray-400 text-xs uppercase tracking-wider">Not After</div>
                            <div className="flex items-center gap-2">
                                <span className="text-white text-sm font-mono">
                                    {status.notAfter ? new Date(status.notAfter).toLocaleDateString() : '-'}
                                </span>
                                {notAfterDays !== null && (
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${expiryColors.bg} ${expiryColors.text} ${expiryColors.border}`}>
                                        {notAfterDays <= 0 ? 'Expired' : `${notAfterDays}d left`}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-white/10 grid grid-cols-2 divide-x divide-white/10">
                        {/* Duration */}
                        <div className="p-4 space-y-1">
                            <div className="text-gray-400 text-xs uppercase tracking-wider">Duration</div>
                            <div className="text-white text-sm">{formatDuration(spec.duration)}</div>
                        </div>
                        {/* Renew Before */}
                        <div className="p-4 space-y-1">
                            <div className="text-gray-400 text-xs uppercase tracking-wider">Renew Before</div>
                            <div className="text-white text-sm">{formatDuration(spec.renewBefore)}</div>
                        </div>
                    </div>
                    {status.renewalTime && (
                        <div className="border-t border-white/10 p-4">
                            <div className="flex items-center gap-2">
                                <RefreshCw size={14} className="text-blue-400" />
                                <span className="text-gray-400 text-xs uppercase tracking-wider">Next Renewal</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-white text-sm font-mono">
                                    {new Date(status.renewalTime).toLocaleDateString()}
                                </span>
                                {renewalDays !== null && (
                                    <span className="text-xs text-gray-400">
                                        ({renewalDays <= 0 ? 'overdue' : `in ${renewalDays}d`})
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Issuer Reference */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Shield size={14} />
                    Issuer
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Name</div>
                        <div className="col-span-2">
                            {onNavigate ? (
                                <button
                                    onClick={() => onNavigate(issuerRef.kind || 'Issuer', issuerRef.name)}
                                    className="text-blue-400 hover:text-blue-300 font-mono text-sm hover:underline"
                                >
                                    {issuerRef.name || '-'}
                                </button>
                            ) : (
                                <span className="text-white font-mono text-sm">{issuerRef.name || '-'}</span>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Kind</div>
                        <div className="col-span-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-purple-500/10 text-purple-400 border-purple-500/20">
                                {issuerRef.kind || '-'}
                            </span>
                        </div>
                    </div>
                    {issuerRef.group && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Group</div>
                            <div className="col-span-2 text-white font-mono text-sm">{issuerRef.group}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Secret & Private Key */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Key size={14} />
                    Secret & Private Key
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Secret Name</div>
                        <div className="col-span-2">
                            {onNavigate ? (
                                <button
                                    onClick={() => onNavigate('Secret', spec.secretName, namespace)}
                                    className="text-blue-400 hover:text-blue-300 font-mono text-sm hover:underline"
                                >
                                    {spec.secretName || '-'}
                                </button>
                            ) : (
                                <span className="text-white font-mono text-sm">{spec.secretName || '-'}</span>
                            )}
                        </div>
                    </div>
                    {privateKey.algorithm && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Algorithm</div>
                            <div className="col-span-2">
                                <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                    {privateKey.algorithm} {privateKey.size ? `(${privateKey.size})` : ''}
                                </span>
                            </div>
                        </div>
                    )}
                    {privateKey.rotationPolicy && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Rotation Policy</div>
                            <div className="col-span-2 text-white text-sm">{privateKey.rotationPolicy}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Usages */}
            {usages.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Lock size={14} />
                        Usages
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {usages.map((usage: string) => (
                            <span key={usage} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400">
                                {usage}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* DNS Names */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Globe size={14} />
                    DNS Names ({dnsNames.length})
                </h3>
                {dnsNames.length > 0 ? (
                    <div className="bg-black/40 rounded-md border border-white/10 overflow-hidden">
                        <table className="w-full text-xs font-mono">
                            <tbody>
                                {dnsNames.map((dns: string, idx: number) => (
                                    <tr key={idx} className="group border-b border-white/5 last:border-0 hover:bg-white/5">
                                        <td className="px-3 py-2 text-blue-400 break-all">{dns}</td>
                                        <td className="px-2 py-2 w-8 text-right">
                                            <button
                                                onClick={() => handleCopyDns(dns)}
                                                className="shrink-0 p-0.5 text-gray-700 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Copy DNS name"
                                            >
                                                {copiedDns === dns
                                                    ? <Check size={12} className="text-green-400" />
                                                    : <Copy size={12} />
                                                }
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="bg-white/5 rounded-md p-4 border border-white/10 text-center text-gray-500">
                        No DNS names defined
                    </div>
                )}
            </div>

            {/* Conditions */}
            {conditions.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Conditions</h3>
                    <div className="space-y-2">
                        {conditions.map((cond: any, idx: number) => (
                            <div key={idx} className={`rounded-md p-3 border ${
                                cond.status === 'True'
                                    ? 'bg-green-500/5 border-green-500/20'
                                    : 'bg-yellow-500/5 border-yellow-500/20'
                            }`}>
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${cond.status === 'True' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                                        <span className="text-white font-medium text-xs">{cond.type}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                                            cond.status === 'True'
                                                ? 'bg-green-500/10 text-green-400'
                                                : 'bg-yellow-500/10 text-yellow-400'
                                        }`}>
                                            {cond.reason}
                                        </span>
                                    </div>
                                    {cond.lastTransitionTime && (
                                        <span className="text-gray-500 text-xs">
                                            <TimeAgo timestamp={cond.lastTransitionTime} />
                                        </span>
                                    )}
                                </div>
                                {cond.message && (
                                    <div className="text-gray-400 text-xs mt-1 pl-4">{cond.message}</div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
