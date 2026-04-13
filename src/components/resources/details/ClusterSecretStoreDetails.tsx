import React from 'react';
import { Database, CheckCircle, AlertTriangle, Cloud, Key, Globe, User } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface ClusterSecretStoreDetailsProps {
    store: any;
    explanation?: string | null;
    onExplain?: () => void;
    onOpenYaml?: () => void;
    onNavigate?: (kind: string, name: string, namespace?: string) => void;
}

/** Extract a flat list of key-value pairs from a deeply nested provider config */
function flattenProvider(obj: any, prefix = ''): { label: string; value: string }[] {
    const result: { label: string; value: string }[] = [];
    if (!obj || typeof obj !== 'object') return result;
    for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            result.push(...flattenProvider(v, path));
        } else {
            result.push({ label: path, value: String(v) });
        }
    }
    return result;
}

/** Try to detect the provider type from the spec.provider object */
function detectProvider(provider: any): { type: string; icon: React.ReactNode; details: any } {
    if (provider.aws) return { type: 'AWS', icon: <Cloud size={14} className="text-orange-400" />, details: provider.aws };
    if (provider.gcpsm) return { type: 'GCP Secret Manager', icon: <Cloud size={14} className="text-blue-400" />, details: provider.gcpsm };
    if (provider.azurekv) return { type: 'Azure Key Vault', icon: <Cloud size={14} className="text-blue-400" />, details: provider.azurekv };
    if (provider.vault) return { type: 'HashiCorp Vault', icon: <Key size={14} className="text-yellow-400" />, details: provider.vault };
    // Fallback: use the first key
    const firstKey = Object.keys(provider)[0];
    if (firstKey) return { type: firstKey, icon: <Database size={14} className="text-purple-400" />, details: provider[firstKey] };
    return { type: 'Unknown', icon: <Database size={14} className="text-gray-400" />, details: {} };
}

export const ClusterSecretStoreDetails: React.FC<ClusterSecretStoreDetailsProps> = ({
    store,
    explanation: _explanation,
    onExplain: _onExplain,
    onOpenYaml: _onOpenYaml,
    onNavigate,
}) => {
    if (!store) return null;

    const name = store.name || store.metadata?.name || '';
    const age = store.age || store.metadata?.creationTimestamp || '';
    const spec = store.spec || {};
    const status = store.status || {};
    const conditions: any[] = status.conditions || [];
    const provider = spec.provider || {};

    const readyCondition = conditions.find((c: any) => c.type === 'Ready');
    const isReady = readyCondition?.status === 'True';

    const detected = detectProvider(provider);
    const awsDetails = provider.aws;
    const auth = awsDetails?.auth || detected.details?.auth || {};
    const serviceAccountRef = auth.jwt?.serviceAccountRef || auth.secretRef || null;

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
                            {readyCondition?.reason || (isReady ? 'Valid' : 'Not Ready')}
                        </div>
                        {readyCondition?.message && (
                            <div className="text-gray-300 text-xs mt-0.5">{readyCondition.message}</div>
                        )}
                    </div>
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
                        <div className="text-gray-400">Kind</div>
                        <div className="col-span-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-purple-500/10 text-purple-400 border-purple-500/20">
                                {store.kind || 'ClusterSecretStore'}
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">API Version</div>
                        <div className="col-span-2 text-white font-mono text-sm">{store.apiVersion || 'external-secrets.io/v1alpha1'}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Scope</div>
                        <div className="col-span-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                Cluster-wide
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {age ? <TimeAgo timestamp={age} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Provider */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    {detected.icon}
                    Provider
                </h3>
                <div className="bg-white/5 rounded-md border border-white/10 overflow-hidden">
                    <div className="p-4 space-y-2">
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Type</div>
                            <div className="col-span-2">
                                <span className="px-2 py-0.5 rounded text-xs font-medium border bg-orange-500/10 text-orange-400 border-orange-500/20">
                                    {detected.type}
                                </span>
                            </div>
                        </div>
                        {awsDetails?.service && (
                            <div className="grid grid-cols-3 gap-4">
                                <div className="text-gray-400">Service</div>
                                <div className="col-span-2">
                                    <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                        {awsDetails.service}
                                    </span>
                                </div>
                            </div>
                        )}
                        {awsDetails?.region && (
                            <div className="grid grid-cols-3 gap-4">
                                <div className="text-gray-400">Region</div>
                                <div className="col-span-2 flex items-center gap-2">
                                    <Globe size={14} className="text-gray-500" />
                                    <span className="text-white font-mono text-sm">{awsDetails.region}</span>
                                </div>
                            </div>
                        )}
                        {awsDetails?.role && (
                            <div className="grid grid-cols-3 gap-4">
                                <div className="text-gray-400">Role ARN</div>
                                <div className="col-span-2 text-white font-mono text-xs break-all">{awsDetails.role}</div>
                            </div>
                        )}
                    </div>

                    {/* Non-AWS providers: show flattened config */}
                    {!awsDetails && detected.details && (
                        <div className="p-4 space-y-2">
                            {flattenProvider(detected.details).map(({ label, value }) => (
                                <div key={label} className="grid grid-cols-3 gap-4">
                                    <div className="text-gray-400 text-xs font-mono">{label}</div>
                                    <div className="col-span-2 text-white font-mono text-xs break-all">{value}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Authentication */}
            {serviceAccountRef && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <User size={14} />
                        Authentication
                    </h3>
                    <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Method</div>
                            <div className="col-span-2">
                                <span className="px-2 py-0.5 rounded text-xs font-medium border bg-green-500/10 text-green-400 border-green-500/20">
                                    {auth.jwt ? 'JWT (ServiceAccount)' : auth.secretRef ? 'Secret Reference' : 'Unknown'}
                                </span>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">ServiceAccount</div>
                            <div className="col-span-2">
                                {onNavigate ? (
                                    <button
                                        onClick={() => onNavigate('ServiceAccount', serviceAccountRef.name, serviceAccountRef.namespace)}
                                        className="text-blue-400 hover:text-blue-300 font-mono text-sm hover:underline"
                                    >
                                        {serviceAccountRef.name}
                                    </button>
                                ) : (
                                    <span className="text-white font-mono text-sm">{serviceAccountRef.name}</span>
                                )}
                            </div>
                        </div>
                        {serviceAccountRef.namespace && (
                            <div className="grid grid-cols-3 gap-4">
                                <div className="text-gray-400">Namespace</div>
                                <div className="col-span-2 text-white font-mono text-sm">{serviceAccountRef.namespace}</div>
                            </div>
                        )}
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
