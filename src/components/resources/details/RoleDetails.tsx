import React from 'react';
import { Shield, Scale, Layers } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface RoleDetailsProps {
    resource: any;
}

export const RoleDetails: React.FC<RoleDetailsProps> = ({ resource }) => {
    if (!resource) return null;

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
                    {resource.metadata?.namespace && (
                        <div className="grid grid-cols-3 gap-4">
                            <span className="text-gray-400">Namespace</span>
                            <span className="col-span-2 text-white font-mono">{resource.metadata?.namespace}</span>
                        </div>
                    )}
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Created</span>
                        <div className="col-span-2 text-white flex items-center gap-2">
                            <TimeAgo timestamp={resource.metadata?.creationTimestamp} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Rules */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Scale size={14} /> Rules
                </h3>
                <div className="space-y-3">
                    {resource.rules?.map((rule: any, idx: number) => (
                        <div key={idx} className="bg-white/5 rounded-md p-4 border border-white/10">

                            {/* Resources */}
                            <div className="mb-3">
                                <span className="text-xs text-gray-500 uppercase font-bold tracking-wider block mb-1.5">Resources</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {rule.resources?.map((r: string, i: number) => (
                                        <span key={i} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs border border-blue-500/20 font-mono">
                                            {r}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Verbs */}
                            <div className="mb-3">
                                <span className="text-xs text-gray-500 uppercase font-bold tracking-wider block mb-1.5">Verbs</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {rule.verbs?.map((v: string, i: number) => (
                                        <span key={i} className={`px-2 py-0.5 rounded text-xs border font-mono uppercase font-bold ${v === '*' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                            'bg-green-500/10 text-green-400 border-green-500/20'
                                            }`}>
                                            {v}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* API Groups */}
                            <div>
                                <span className="text-xs text-gray-500 uppercase font-bold tracking-wider block mb-1.5">API Groups</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {rule.apiGroups?.map((g: string, i: number) => (
                                        <span key={i} className="px-2 py-0.5 bg-white/10 text-gray-300 rounded text-xs font-mono border border-white/10">
                                            {g === "" ? '"" (core)' : g}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                    {(!resource.rules || resource.rules.length === 0) && (
                        <div className="bg-white/5 rounded-md p-4 border border-white/10 text-gray-500 italic text-xs text-center">
                            No rules defined.
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
