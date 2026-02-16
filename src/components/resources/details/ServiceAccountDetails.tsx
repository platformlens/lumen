import React from 'react';
import { Shield, Key, Image, Layers } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface ServiceAccountDetailsProps {
    resource: any;
}

export const ServiceAccountDetails: React.FC<ServiceAccountDetailsProps> = ({ resource }) => {
    if (!resource) return null;

    const annotations = resource.metadata?.annotations || {};
    const awsRoleArn = annotations['eks.amazonaws.com/role-arn'];
    const azureClientId = annotations['azure.workload.identity/client-id'];

    return (
        <div className="space-y-6 text-sm">
            {/* Header / Meta */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    Metadata
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Name</span>
                        <span className="col-span-2 text-white font-mono flex items-center gap-2">
                            <Shield size={14} className="text-blue-400" />
                            {resource.metadata?.name}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Namespace</span>
                        <span className="col-span-2 text-white font-mono">{resource.metadata?.namespace}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Created</span>
                        <div className="col-span-2 text-white flex items-center gap-2">
                            <TimeAgo timestamp={resource.metadata?.creationTimestamp} />
                        </div>
                    </div>
                    {resource.metadata?.ownerReferences && resource.metadata.ownerReferences.length > 0 && (
                        <div className="grid grid-cols-3 gap-4">
                            <span className="text-gray-400">Controlled By</span>
                            <div className="col-span-2 flex flex-col gap-1">
                                {resource.metadata.ownerReferences.map((ref: any, i: number) => (
                                    <div key={i} className="text-white font-mono text-xs flex items-center gap-2">
                                        <span className="text-purple-400">{ref.kind}</span>
                                        <span className="text-gray-600">/</span>
                                        <span>{ref.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Labels & Annotations */}
            {((resource.metadata?.labels && Object.keys(resource.metadata.labels).length > 0) ||
                (resource.metadata?.annotations && Object.keys(resource.metadata.annotations).length > 0)) && (
                    <div>
                        {resource.metadata?.labels && Object.keys(resource.metadata.labels).length > 0 && (
                            <div className="mb-4">
                                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-2 flex items-center gap-2">
                                    Labels
                                </h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(resource.metadata.labels).map(([k, v], i) => (
                                        <div key={i} className="px-2 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-mono">
                                            <span className="opacity-70">{k}:</span> {String(v)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {resource.metadata?.annotations && Object.keys(resource.metadata.annotations).length > 0 && (
                            <div>
                                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-2 flex items-center gap-2">
                                    Annotations
                                </h3>
                                <div className="bg-white/5 rounded-md border border-white/10 divide-y divide-white/5">
                                    {Object.entries(resource.metadata.annotations).map(([k, v], i) => (
                                        <div key={i} className="p-2 grid grid-cols-1 gap-1">
                                            <span className="text-gray-500 text-[10px] font-mono">{k}</span>
                                            <span className="text-gray-300 text-xs font-mono break-all">{String(v)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

            {/* Identity Section (IRSA / Workload Identity) */}
            {(awsRoleArn || azureClientId) && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Shield size={14} /> Identity & Access
                    </h3>
                    <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-3">
                        {awsRoleArn && (
                            <div className="grid grid-cols-3 gap-4 items-center">
                                <span className="text-gray-400">AWS Role ARN</span>
                                <div className="col-span-2 flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs font-mono break-all">
                                        {awsRoleArn}
                                    </span>
                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold bg-white/5 px-1.5 rounded">IRSA</span>
                                </div>
                            </div>
                        )}
                        {azureClientId && (
                            <div className="grid grid-cols-3 gap-4 items-center">
                                <span className="text-gray-400">Azure Client ID</span>
                                <div className="col-span-2 flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-mono break-all">
                                        {azureClientId}
                                    </span>
                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold bg-white/5 px-1.5 rounded">Workload ID</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Secrets */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Key size={14} /> Secrets
                </h3>
                <div className="space-y-2">
                    {resource.secrets?.map((secret: any, idx: number) => (
                        <div key={idx} className="bg-white/5 rounded-md p-3 border border-white/10 flex items-center justify-between">
                            <span className="text-white font-mono text-xs">{secret.name}</span>
                        </div>
                    ))}
                    {(!resource.secrets || resource.secrets.length === 0) && (
                        <div className="bg-white/5 rounded-md p-4 border border-white/10 text-gray-500 italic text-xs text-center">
                            No secrets bound to this Service Account.
                        </div>
                    )}
                </div>
            </div>

            {/* Image Pull Secrets */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Image size={14} /> Image Pull Secrets
                </h3>
                <div className="space-y-2">
                    {resource.imagePullSecrets?.map((secret: any, idx: number) => (
                        <div key={idx} className="bg-white/5 rounded-md p-3 border border-white/10 flex items-center justify-between">
                            <span className="text-white font-mono text-xs">{secret.name}</span>
                        </div>
                    ))}
                    {(!resource.imagePullSecrets || resource.imagePullSecrets.length === 0) && (
                        <div className="bg-white/5 rounded-md p-4 border border-white/10 text-gray-500 italic text-xs text-center">
                            No image pull secrets.
                        </div>
                    )}
                </div>
            </div>
            {/* Raw View */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Layers size={16} /> Data
                </h4>
                <div className="bg-black/50 rounded-lg p-2 overflow-auto max-h-[600px]">
                    <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap word-break-break-all">
                        {JSON.stringify(resource, null, 2)}
                    </pre>
                </div>
            </div>
        </div>
    );
};
