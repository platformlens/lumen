import React, { useState, useEffect } from 'react';
import { Server, Activity, Cpu, Database, Network, Tag, Shield, Copy, Check, Box } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';
import { ToggleGroup, ToggleOption } from '../../shared/ToggleGroup';
import { formatMemory, getNodeProviderInfo } from '../../../utils/cluster-utils';

interface NodeDetailsProps {
    node: any;
    clusterName?: string;
    onNavigate?: (kind: string, name: string) => void;
}

type WorkloadType = 'all' | 'deployments' | 'daemonsets' | 'statefulsets';

export const NodeDetails: React.FC<NodeDetailsProps> = ({ node, clusterName, onNavigate }) => {
    const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
    const [pods, setPods] = useState<any[]>([]);
    const [loadingPods, setLoadingPods] = useState(false);
    const [workloadFilter, setWorkloadFilter] = useState<WorkloadType>('all');

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

    const handleCopyAddress = (address: string) => {
        navigator.clipboard.writeText(address);
        setCopiedAddress(address);
        setTimeout(() => setCopiedAddress(null), 2000);
    };

    // Fetch pods running on this node
    useEffect(() => {
        if (!clusterName || !metadata.name) return;

        const fetchPods = async () => {
            setLoadingPods(true);
            try {
                // Get all pods across all namespaces
                const allPods = await window.k8s.getPods(clusterName, ['all']);
                // Filter pods running on this node
                const nodePods = allPods.filter((p: any) => p.spec?.nodeName === metadata.name);
                setPods(nodePods);
            } catch (err) {
                console.error('Failed to fetch pods for node:', err);
                setPods([]);
            } finally {
                setLoadingPods(false);
            }
        };

        fetchPods();
    }, [clusterName, metadata.name]);

    // Categorize pods by workload type
    const categorizedPods = pods.reduce((acc, pod) => {
        const ownerRefs = pod.metadata?.ownerReferences || [];
        const owner = ownerRefs[0];

        if (!owner) {
            acc.other.push(pod);
            return acc;
        }

        if (owner.kind === 'ReplicaSet') {
            acc.deployments.push(pod);
        } else if (owner.kind === 'DaemonSet') {
            acc.daemonsets.push(pod);
        } else if (owner.kind === 'StatefulSet') {
            acc.statefulsets.push(pod);
        } else {
            acc.other.push(pod);
        }

        return acc;
    }, { deployments: [] as any[], daemonsets: [] as any[], statefulsets: [] as any[], other: [] as any[] });

    // Filter pods based on selected workload type
    const filteredPods = workloadFilter === 'all'
        ? pods
        : workloadFilter === 'deployments'
            ? categorizedPods.deployments
            : workloadFilter === 'daemonsets'
                ? categorizedPods.daemonsets
                : categorizedPods.statefulsets;

    const workloadOptions: ToggleOption<WorkloadType>[] = [
        { value: 'all', label: `All (${pods.length})` },
        { value: 'deployments', label: `Deployments (${categorizedPods.deployments.length})` },
        { value: 'daemonsets', label: `DaemonSets (${categorizedPods.daemonsets.length})` },
        { value: 'statefulsets', label: `StatefulSets (${categorizedPods.statefulsets.length})` },
    ];

    const handlePodClick = (podName: string) => {
        if (onNavigate) {
            onNavigate('Pod', podName);
        }
    };

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
                        <div key={idx} className="flex items-center justify-between text-sm py-2 px-3 bg-white/5 rounded border border-white/10 hover:bg-white/10 transition-colors group">
                            <div className="flex items-center gap-3 flex-1">
                                <span className="text-gray-400 min-w-[120px]">{addr.type}</span>
                                <span className="text-gray-200 font-mono">{addr.address}</span>
                            </div>
                            <button
                                onClick={() => handleCopyAddress(addr.address)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-white/10 rounded"
                                title="Copy address"
                            >
                                {copiedAddress === addr.address ? (
                                    <Check size={14} className="text-green-400" />
                                ) : (
                                    <Copy size={14} className="text-gray-400" />
                                )}
                            </button>
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

            {/* Pods on this Node */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                        <Box size={16} /> Pods on this Node
                    </h4>
                </div>

                {loadingPods ? (
                    <div className="text-center text-gray-500 text-sm py-4">Loading pods...</div>
                ) : pods.length === 0 ? (
                    <div className="text-center text-gray-500 text-sm py-4">No pods running on this node</div>
                ) : (
                    <>
                        <div className="mb-4">
                            <ToggleGroup
                                options={workloadOptions}
                                value={workloadFilter}
                                onChange={setWorkloadFilter}
                            />
                        </div>

                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {filteredPods.map((pod: any) => {
                                const podName = pod.metadata?.name;
                                const namespace = pod.metadata?.namespace;
                                const phase = pod.status?.phase;
                                const ownerRefs = pod.metadata?.ownerReferences || [];
                                const owner = ownerRefs[0];

                                const statusColor =
                                    phase === 'Running' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
                                        phase === 'Pending' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' :
                                            phase === 'Failed' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                                                'text-gray-400 bg-gray-500/10 border-gray-500/20';

                                return (
                                    <div
                                        key={`${namespace}/${podName}`}
                                        className="flex items-center justify-between text-sm py-2 px-3 bg-white/5 rounded border border-white/10 hover:bg-white/10 transition-colors group"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <button
                                                onClick={() => handlePodClick(podName)}
                                                className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer transition-colors font-mono text-xs truncate block"
                                            >
                                                {podName}
                                            </button>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-gray-500 text-xs">{namespace}</span>
                                                {owner && (
                                                    <span className="text-gray-500 text-xs">
                                                        • {owner.kind}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusColor} ml-2`}>
                                            {phase}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

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
