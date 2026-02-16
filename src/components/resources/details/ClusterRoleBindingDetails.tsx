import React from 'react';
import { Shield, User, Users, Layers } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface ClusterRoleBindingDetailsProps {
    resource: any;
    onNavigate?: (kind: string, name: string) => void;
}

export const ClusterRoleBindingDetails: React.FC<ClusterRoleBindingDetailsProps> = ({ resource, onNavigate }) => {
    if (!resource) return null;

    const handleSubjectClick = (subj: any) => {
        if (!onNavigate) return;
        if (subj.kind === 'ServiceAccount') {
            onNavigate('serviceaccount', subj.name);
        }
    };

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
                            <Shield size={14} className="text-red-400" />
                            {resource.metadata?.name}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Created</span>
                        <div className="col-span-2 text-white flex items-center gap-2">
                            <TimeAgo timestamp={resource.metadata?.creationTimestamp} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Role Ref */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Shield size={14} /> Role Reference
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4 items-center">
                        <span className="text-gray-400">Kind</span>
                        <span className="col-span-2 text-purple-400 font-mono font-bold">{resource.roleRef?.kind}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 items-center">
                        <span className="text-gray-400">Name</span>
                        <span className={`col-span-2 text-white font-mono ${onNavigate ? 'cursor-pointer hover:underline' : ''}`}
                            onClick={() => onNavigate && onNavigate(resource.roleRef?.kind.toLowerCase(), resource.roleRef?.name)}>
                            {resource.roleRef?.name}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 items-center">
                        <span className="text-gray-400">API Group</span>
                        <span className="col-span-2 text-gray-500 font-mono text-xs">{resource.roleRef?.apiGroup}</span>
                    </div>
                </div>
            </div>

            {/* Subjects */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Users size={14} /> Subjects ({resource.subjects?.length || 0})
                </h3>
                <div className="space-y-2">
                    {resource.subjects?.map((subj: any, idx: number) => (
                        <div key={idx}
                            className={`bg-white/5 rounded-md p-3 border border-white/10 flex items-center gap-3 transition-colors ${onNavigate && subj.kind === 'ServiceAccount' ? 'hover:bg-white/10 cursor-pointer' : ''}`}
                            onClick={() => handleSubjectClick(subj)}
                        >
                            <div className={`p-2 rounded bg-white/5 border border-white/10 ${subj.kind === 'ServiceAccount' ? 'text-blue-400' : 'text-green-400'}`}>
                                <User size={16} />
                            </div>
                            <div>
                                <div className="text-white font-mono font-bold text-sm">{subj.name}</div>
                                <div className="text-xs text-gray-500 flex gap-2 mt-0.5">
                                    <span className="bg-white/10 px-1.5 rounded text-[10px] uppercase font-bold tracking-wider text-gray-400">{subj.kind}</span>
                                    {subj.namespace && <span className="text-gray-500">• {subj.namespace}</span>}
                                </div>
                            </div>
                        </div>
                    ))}
                    {(!resource.subjects || resource.subjects.length === 0) && (
                        <div className="bg-white/5 rounded-md p-4 border border-white/10 text-gray-500 italic text-xs text-center">
                            No subjects bound.
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
