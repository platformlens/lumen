import React, { useState } from 'react';
import { KeyRound, Copy, Check, RefreshCw, AlertTriangle, CheckCircle, Database, Shield, Target, ArrowRight } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface ExternalSecretDetailsProps {
    externalSecret: any;
    explanation?: string | null;
    onExplain?: () => void;
    onOpenYaml?: () => void;
    onNavigate?: (kind: string, name: string, namespace?: string) => void;
}

/** Format a Go duration string like "2h0m0s" into a human-readable label */
function formatDuration(dur?: string): string {
    if (!dur) return '-';
    const match = dur.match(/^(\d+)h(\d+)m(\d+)s$/);
    if (!match) return dur;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return dur;
}

export const ExternalSecretDetails: React.FC<ExternalSecretDetailsProps> = ({
    externalSecret,
    explanation: _explanation,
    onExplain: _onExplain,
    onOpenYaml: _onOpenYaml,
    onNavigate,
}) => {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    if (!externalSecret) return null;

    const name = externalSecret.name || externalSecret.metadata?.name || '';
    const namespace = externalSecret.namespace || externalSecret.metadata?.namespace || '';
    const age = externalSecret.age || externalSecret.metadata?.creationTimestamp || '';
    const spec = externalSecret.spec || {};
    const status = externalSecret.status || {};
    const conditions: any[] = status.conditions || [];
    const dataEntries: any[] = spec.data || [];
    const dataFrom: any[] = spec.dataFrom || [];
    const secretStoreRef = spec.secretStoreRef || {};
    const target = spec.target || {};
    const binding = status.binding || {};

    const readyCondition = conditions.find((c: any) => c.type === 'Ready');
    const isReady = readyCondition?.status === 'True';

    const handleCopyKey = (key: string) => {
        navigator.clipboard.writeText(key);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
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
                            {readyCondition?.reason || (isReady ? 'Synced' : 'Not Synced')}
                        </div>
                        {readyCondition?.message && (
                            <div className="text-gray-300 text-xs mt-0.5">{readyCondition.message}</div>
                        )}
                    </div>
                    {status.syncedResourceVersion && (
                        <span className="text-xs text-gray-500 font-mono shrink-0 max-w-[140px] truncate" title={status.syncedResourceVersion}>
                            v{status.syncedResourceVersion.split('-')[0]}
                        </span>
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
                        <div className="col-span-2 text-white font-mono text-sm">{externalSecret.apiVersion || 'external-secrets.io/v1alpha1'}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {age ? <TimeAgo timestamp={age} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Sync & Refresh */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <RefreshCw size={14} />
                    Sync & Refresh
                </h3>
                <div className="bg-white/5 rounded-md border border-white/10 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/10">
                        <div className="p-4 space-y-1">
                            <div className="text-gray-400 text-xs uppercase tracking-wider">Refresh Interval</div>
                            <div className="text-white text-sm">{formatDuration(spec.refreshInterval)}</div>
                        </div>
                        <div className="p-4 space-y-1">
                            <div className="text-gray-400 text-xs uppercase tracking-wider">Last Refreshed</div>
                            <div className="text-white text-sm">
                                {status.refreshTime ? <TimeAgo timestamp={status.refreshTime} /> : '-'}
                            </div>
                        </div>
                    </div>
                    {status.syncedResourceVersion && (
                        <div className="border-t border-white/10 p-4 space-y-1">
                            <div className="text-gray-400 text-xs uppercase tracking-wider">Synced Resource Version</div>
                            <div className="text-white font-mono text-xs break-all">{status.syncedResourceVersion}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Secret Store Reference */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Database size={14} />
                    Secret Store
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Name</div>
                        <div className="col-span-2">
                            {onNavigate ? (
                                <button
                                    onClick={() => onNavigate(secretStoreRef.kind || 'SecretStore', secretStoreRef.name)}
                                    className="text-blue-400 hover:text-blue-300 font-mono text-sm hover:underline"
                                >
                                    {secretStoreRef.name || '-'}
                                </button>
                            ) : (
                                <span className="text-white font-mono text-sm">{secretStoreRef.name || '-'}</span>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Kind</div>
                        <div className="col-span-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-purple-500/10 text-purple-400 border-purple-500/20">
                                {secretStoreRef.kind || '-'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Target */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Target size={14} />
                    Target Secret
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Secret Name</div>
                        <div className="col-span-2">
                            {onNavigate ? (
                                <button
                                    onClick={() => onNavigate('Secret', target.name || name, namespace)}
                                    className="text-blue-400 hover:text-blue-300 font-mono text-sm hover:underline"
                                >
                                    {target.name || name}
                                </button>
                            ) : (
                                <span className="text-white font-mono text-sm">{target.name || name}</span>
                            )}
                        </div>
                    </div>
                    {target.creationPolicy && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Creation Policy</div>
                            <div className="col-span-2">
                                <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                    {target.creationPolicy}
                                </span>
                            </div>
                        </div>
                    )}
                    {target.deletionPolicy && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Deletion Policy</div>
                            <div className="col-span-2">
                                <span className="px-2 py-0.5 rounded text-xs font-medium border bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                                    {target.deletionPolicy}
                                </span>
                            </div>
                        </div>
                    )}
                    {binding.name && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Bound Secret</div>
                            <div className="col-span-2">
                                <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-green-400" />
                                    <span className="text-white font-mono text-sm">{binding.name}</span>
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Data Mappings */}
            {dataEntries.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <KeyRound size={14} />
                        Data Mappings ({dataEntries.length})
                    </h3>
                    <div className="space-y-2">
                        {dataEntries.map((entry: any, idx: number) => {
                            const remoteRef = entry.remoteRef || {};
                            const secretKey = entry.secretKey || '';
                            return (
                                <div key={idx} className="bg-white/5 rounded-md border border-white/10 overflow-hidden">
                                    <div className="p-3 flex items-center gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-mono text-xs text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded break-all">
                                                    {remoteRef.key || '-'}
                                                </span>
                                                <ArrowRight size={12} className="text-gray-600 shrink-0" />
                                                <span className="font-mono text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded">
                                                    {secretKey}
                                                </span>
                                            </div>
                                            {remoteRef.conversionStrategy && remoteRef.conversionStrategy !== 'Default' && (
                                                <div className="text-gray-500 text-xs mt-1">
                                                    Conversion: {remoteRef.conversionStrategy}
                                                </div>
                                            )}
                                            {remoteRef.property && (
                                                <div className="text-gray-500 text-xs mt-1">
                                                    Property: <span className="font-mono text-gray-400">{remoteRef.property}</span>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleCopyKey(remoteRef.key || '')}
                                            className="shrink-0 p-1 text-gray-700 hover:text-white transition-colors"
                                            title="Copy remote key"
                                        >
                                            {copiedKey === remoteRef.key
                                                ? <Check size={14} className="text-green-400" />
                                                : <Copy size={14} />
                                            }
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* DataFrom (if present) */}
            {dataFrom.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Shield size={14} />
                        Data From ({dataFrom.length})
                    </h3>
                    <div className="space-y-2">
                        {dataFrom.map((entry: any, idx: number) => {
                            const extract = entry.extract || {};
                            const find = entry.find || {};
                            return (
                                <div key={idx} className="bg-white/5 rounded-md p-3 border border-white/10">
                                    {extract.key && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400 text-xs">Extract Key:</span>
                                            <span className="font-mono text-xs text-orange-400">{extract.key}</span>
                                        </div>
                                    )}
                                    {find.name && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400 text-xs">Find Name:</span>
                                            <span className="font-mono text-xs text-blue-400">{find.name.regex || find.name}</span>
                                        </div>
                                    )}
                                    {find.path && (
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-gray-400 text-xs">Path:</span>
                                            <span className="font-mono text-xs text-blue-400">{find.path}</span>
                                        </div>
                                    )}
                                    {!extract.key && !find.name && !find.path && (
                                        <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap">
                                            {JSON.stringify(entry, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

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
