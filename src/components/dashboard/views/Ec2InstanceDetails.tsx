import React, { useEffect, useState } from 'react';
import {
    X, Server, HardDrive, Network, Shield, Box
} from 'lucide-react';

interface Ec2InstanceDetailsProps {
    instance: any;
    node: any;
    onClose: () => void;
}

export const Ec2InstanceDetails: React.FC<Ec2InstanceDetailsProps> = ({ instance, node, onClose }) => {
    const [pods, setPods] = useState<any[]>([]);
    const [loadingPods, setLoadingPods] = useState(false);

    useEffect(() => {
        if (!node) return;
        const fetchNodePods = async () => {
            setLoadingPods(true);
            try {
                // Get all pods and filter by nodeName client-side 
                // (Optimization: In a huge cluster, fieldSelector would be better, but getPods currently doesn't expose it easily in our preload)
                const allPods = await window.k8s.getPods(node.metadata.clusterName);
                const nodePods = allPods.filter((p: any) => p.spec?.nodeName === node.metadata.name);
                setPods(nodePods);
            } catch (err) {
                console.error("Failed to fetch node pods", err);
            } finally {
                setLoadingPods(false);
            }
        };
        fetchNodePods();
    }, [node]);

    const InfoRow: React.FC<{ label: string; value: string | React.ReactNode }> = ({ label, value }) => (
        <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
            <div className="text-gray-200 text-sm break-all font-mono">{value || '-'}</div>
        </div>
    );

    const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
        <div className="bg-white/5 rounded-xl border border-white/10 p-5 space-y-4">
            <h3 className="text-md font-medium text-white flex items-center gap-2">
                {icon}
                {title}
            </h3>
            <div className="w-full h-px bg-white/10"></div>
            <div className="flex flex-wrap gap-y-6 gap-x-4">
                {children}
            </div>
        </div>
    );

    const getName = (tags: any[]) => tags?.find(t => t.Key === 'Name')?.Value || instance.InstanceId;

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-white overflow-y-auto">
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-start sticky top-0 bg-[#1e1e1e] z-10 shadow-lg">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-orange-500/10 rounded-lg text-orange-500">
                        <Server size={32} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">{getName(instance.Tags)}</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-gray-400 font-mono text-sm">{instance.InstanceId}</span>
                            <span className={`px-2 py-0.5 rounded text-xs border ${instance.State?.Name === 'running'
                                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                : 'bg-gray-500/10 border-gray-500/30 text-gray-400'
                                }`}>
                                {instance.State?.Name}
                            </span>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <X size={20} />
                </button>
            </div>

            <div className="p-6 space-y-6">

                {/* General Info */}
                <Section title="Instance Overview" icon={<Box size={18} className="text-blue-400" />}>
                    <InfoRow label="Instance Type" value={instance.InstanceType} />
                    <InfoRow label="Architecture" value={instance.Architecture} />
                    <InfoRow label="Image ID (AMI)" value={instance.ImageId} />
                    <InfoRow label="Key Name" value={instance.KeyName} />
                    <InfoRow label="Launch Time" value={new Date(instance.LaunchTime).toLocaleString()} />
                    <InfoRow label="Platform" value={instance.PlatformDetails} />
                </Section>

                {/* Network & Location */}
                <Section title="Network & Location" icon={<Network size={18} className="text-purple-400" />}>
                    <InfoRow label="Availability Zone" value={instance.Placement?.AvailabilityZone} />
                    <InfoRow label="VPC ID" value={instance.VpcId} />
                    <InfoRow label="Subnet ID" value={instance.SubnetId} />
                    <InfoRow label="Private IP" value={instance.PrivateIpAddress} />
                    <InfoRow label="Public IP" value={instance.PublicIpAddress || 'None'} />
                    <InfoRow label="Public DNS" value={instance.PublicDnsName || 'None'} />
                </Section>

                {/* Security Groups */}
                <Section title="Security Groups" icon={<Shield size={18} className="text-red-400" />}>
                    <div className="flex flex-wrap gap-2 w-full">
                        {instance.SecurityGroups?.map((sg: any) => (
                            <div key={sg.GroupId} className="flex flex-col bg-black/20 p-2 rounded border border-white/5 min-w-[200px]">
                                <span className="text-xs font-mono text-blue-300">{sg.GroupId}</span>
                                <span className="text-sm text-gray-300">{sg.GroupName}</span>
                            </div>
                        ))}
                    </div>
                </Section>

                {/* Storage / Block Devices */}
                <Section title="Block Devices" icon={<HardDrive size={18} className="text-yellow-400" />}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                        {instance.BlockDeviceMappings?.map((bd: any) => (
                            <div key={bd.DeviceName} className="flex items-center justify-between bg-black/20 p-3 rounded border border-white/5">
                                <span className="text-sm font-mono text-gray-300">{bd.DeviceName}</span>
                                <div className="text-xs text-gray-500">
                                    <span className="block">{bd.Ebs?.Status}</span>
                                    <span className="block font-mono">{bd.Ebs?.VolumeId}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>

                {/* Kubernetes Node Mapping */}
                {node ? (
                    <div className="bg-blue-500/5 rounded-xl border border-blue-500/20 p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-md font-medium text-blue-100 flex items-center gap-2">
                                <Box size={18} className="text-blue-400" />
                                Mapped Kubernetes Node
                            </h3>
                            <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 text-xs font-mono">
                                {node.metadata.name}
                            </span>
                        </div>

                        <div className="flex flex-wrap gap-6">
                            <InfoRow label="Kubelet Version" value={node.status?.nodeInfo?.kubeletVersion} />
                            <InfoRow label="OS Image" value={node.status?.nodeInfo?.osImage} />
                            <InfoRow label="Kernel" value={node.status?.nodeInfo?.kernelVersion} />
                            <InfoRow label="Container Runtime" value={node.status?.nodeInfo?.containerRuntimeVersion} />
                            <div className="w-full">
                                <h4 className="text-sm font-semibold text-gray-400 mb-3 mt-2">Running Pods ({pods.length})</h4>
                                {loadingPods ? (
                                    <div className="text-sm text-gray-500 animate-pulse">Loading workloads...</div>
                                ) : (
                                    <div className="border border-white/10 rounded-lg overflow-hidden bg-black/20">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-white/5 text-gray-400">
                                                <tr>
                                                    <th className="p-3 font-medium">Namespace</th>
                                                    <th className="p-3 font-medium">Pod Name</th>
                                                    <th className="p-3 font-medium">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {pods.map(pod => (
                                                    <tr key={pod.metadata.uid} className="hover:bg-white/5">
                                                        <td className="p-3 text-gray-300">{pod.metadata.namespace}</td>
                                                        <td className="p-3 font-mono text-blue-300">{pod.metadata.name}</td>
                                                        <td className="p-3">
                                                            <span className={`px-1.5 py-0.5 rounded text-xs ${pod.status?.phase === 'Running' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                                                                }`}>
                                                                {pod.status?.phase}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {pods.length === 0 && (
                                                    <tr>
                                                        <td colSpan={3} className="p-4 text-center text-gray-500 italic">No pods found running on this node</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white/5 rounded-xl border border-white/10 p-5 text-center text-gray-500 italic">
                        No Kubernetes Node mapped to this instance.
                    </div>
                )}
            </div>
        </div>
    );
};
