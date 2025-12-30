import React from 'react';
import { Server, Activity, Cpu, Database, Network, Tag, Shield } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';
import { formatMemory, getNodeProviderInfo } from '../../../utils/cluster-utils';

interface NodeDetailsProps {
    node: any;
}

export const NodeDetails: React.FC<NodeDetailsProps> = ({ node }) => {
    if (!node) return null;

    const metadata = node.metadata || {};
    const status = node.status || {};
    const spec = node.spec || {};
    const nodeInfo = status.nodeInfo || {};
    const addresses = status.addresses || [];
    const capacity = status.capacity || {};
    const allocatable = status.allocatable || {};
    const conditions = status.conditions || [];

    const info = getNodeProviderInfo(node);
    const isReady = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';

    return (
        <div className="space-y-6">
            {/* Header / Overview */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                            <Server size={20} className="text-blue-400" />
                            {metadata.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${isReady
                                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                : 'bg-red-500/10 text-red-400 border-red-500/20'
                                }`}>
                                {isReady ? 'Ready' : 'Not Ready'}
                            </span>
                            <span className="text-xs text-gray-500">
                                Age: <TimeAgo timestamp={metadata.creationTimestamp} />
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* System Info */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Activity size={16} /> System Info
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <span className="block text-gray-500 text-xs">Kubelet Version</span>
                        <span className="text-gray-300">{nodeInfo.kubeletVersion}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">OS Image</span>
                        <span className="text-gray-300">{nodeInfo.osImage}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Instance Type</span>
                        <span className="text-gray-300">{info.instanceType}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Capacity</span>
                        <span className={`text-xs font-bold uppercase ${info.isSpot ? 'text-purple-400' : 'text-blue-400'}`}>
                            {info.capacityType}
                        </span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Kernel Version</span>
                        <span className="text-gray-300">{nodeInfo.kernelVersion}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Architecture</span>
                        <span className="text-gray-300">{nodeInfo.architecture}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Container Runtime</span>
                        <span className="text-gray-300">{nodeInfo.containerRuntimeVersion}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500 text-xs">Pod CIDR</span>
                        <span className="text-gray-300">{spec.podCIDR || '-'}</span>
                    </div>
                </div>
            </div>

            {/* Addresses */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Network size={16} /> Addresses
                </h4>
                <div className="space-y-2">
                    {addresses.map((addr: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm py-1 border-b border-white/5 last:border-0">
                            <span className="text-gray-400">{addr.type}</span>
                            <span className="text-gray-200 font-mono">{addr.address}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Capacity & Allocatable */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Database size={16} /> Capacity
                </h4>
                <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="p-3 bg-black/20 rounded-lg">
                        <Cpu size={16} className="mx-auto text-blue-400 mb-2" />
                        <div className="text-xs text-gray-500">CPU</div>
                        <div className="font-mono text-sm text-gray-200">{capacity.cpu}</div>
                    </div>
                    <div className="p-3 bg-black/20 rounded-lg">
                        <Database size={16} className="mx-auto text-purple-400 mb-2" />
                        <div className="text-xs text-gray-500">Memory</div>
                        <div className="font-mono text-sm text-gray-200">{capacity.memory}</div>
                    </div>
                    <div className="p-3 bg-black/20 rounded-lg">
                        <Activity size={16} className="mx-auto text-green-400 mb-2" />
                        <div className="text-xs text-gray-500">Pods</div>
                        <div className="font-mono text-sm text-gray-200">{capacity.pods}</div>
                    </div>
                </div>
                <p className="text-xs text-center text-gray-500 mt-2">Allocatable: {allocatable.cpu} CPU, {formatMemory(allocatable.memory)} Memory</p>
            </div>

            {/* Labels */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Tag size={16} /> Labels
                </h4>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(metadata.labels || {}).map(([k, v]) => (
                        <span key={k} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                            {k}: {String(v)}
                        </span>
                    ))}
                </div>
            </div>

            {/* Annotations */}
            {metadata.annotations && Object.keys(metadata.annotations).length > 0 && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Tag size={16} /> Annotations
                    </h4>
                    <div className="flex flex-col gap-2">
                        {Object.entries(metadata.annotations).map(([k, v]) => (
                            <div key={k} className="text-xs border-b border-white/5 last:border-0 py-1 break-all">
                                <span className="text-blue-400/80 mr-1">{k}:</span>
                                <span className="text-gray-400">{String(v)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Taints */}
            {spec.taints && spec.taints.length > 0 && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Shield size={16} /> Taints
                    </h4>
                    <div className="space-y-2">
                        {spec.taints.map((taint: any, idx: number) => (
                            <div key={idx} className="flex flex-wrap items-center gap-2 text-xs bg-red-500/10 border border-red-500/20 px-2 py-1.5 rounded">
                                <span className="font-medium text-red-300">{taint.key}</span>
                                {taint.value && <span className="text-gray-400">={taint.value}</span>}
                                <span className="ml-auto text-red-400/70 italic">{taint.effect}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
