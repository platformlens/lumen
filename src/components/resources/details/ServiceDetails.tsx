import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ResourceTopology } from '../visualizers/ResourceTopology';
import { PortForwardModal } from '../../shared/PortForwardModal';
import { usePortForwarding } from '../../../hooks/usePortForwarding';
import { PortActions } from '../../shared/PortActions';

interface ServiceDetailsProps {
    resource: any;
    clusterName?: string;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
    onShowTopology?: () => void;
    onOpenYaml?: () => void;
    onNavigate?: (kind: string, name: string) => void;
}

export const ServiceDetails: React.FC<ServiceDetailsProps> = ({ resource, clusterName, explanation, onExplain, isExplaining, onShowTopology, onNavigate }) => {
    const [showTopology, setShowTopology] = useState(false);
    const [endpoints, setEndpoints] = useState<any>(null);
    const [loadingEndpoints, setLoadingEndpoints] = useState(false);

    const {
        selectedPort,
        setSelectedPort,
        activeForwards,
        handleStartForward,
        handleStopForward
    } = usePortForwarding(resource, 'Service', clusterName);

    // Fetch endpoints for this service
    useEffect(() => {
        if (!clusterName || !resource?.metadata?.name || !resource?.metadata?.namespace) return;

        const fetchEndpoints = async () => {
            setLoadingEndpoints(true);
            try {
                const ep = await window.k8s.getEndpoint(
                    clusterName,
                    resource.metadata.namespace,
                    resource.metadata.name
                );
                setEndpoints(ep);
            } catch (err) {
                console.error('Failed to fetch endpoints:', err);
                setEndpoints(null);
            } finally {
                setLoadingEndpoints(false);
            }
        };

        fetchEndpoints();
    }, [clusterName, resource?.metadata?.name, resource?.metadata?.namespace]);

    if (!resource) return null;

    const handlePodClick = (podName: string) => {
        if (onNavigate) {
            onNavigate('Pod', podName);
        }
    };

    const handleNodeClick = (nodeName: string) => {
        if (onNavigate) {
            onNavigate('Node', nodeName);
        }
    };

    return (
        <div className="space-y-8 text-sm">
            {/* AI Explanation Section (if present) */}
            {explanation && (
                <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-lg p-4 mb-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500"></div>
                    <h3 className="text-blue-400 font-bold text-sm mb-2 flex items-center gap-2">
                        <span className="text-lg">✨</span> AI Explanation
                    </h3>
                    <div className="text-gray-200 leading-relaxed font-sans text-sm prose prose-invert max-w-none prose-p:my-1 prose-headings:text-blue-300 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1 prose-li:my-0">
                        <ReactMarkdown>{explanation}</ReactMarkdown>
                    </div>
                </div>
            )}

            {/* Metadata Section */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider">Metadata</h3>
                    <div className="flex items-center gap-2">
                        {onShowTopology && (
                            <button
                                onClick={() => setShowTopology(!showTopology)}
                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border ${showTopology
                                    ? 'bg-pink-600/80 hover:bg-pink-500 text-white border-transparent'
                                    : 'bg-gradient-to-r from-purple-600/80 to-pink-600/80 hover:from-purple-500 hover:to-pink-500 text-white border-transparent'
                                    } hover:shadow-lg hover:scale-105 active:scale-95`}
                            >
                                <span className="text-xs">{showTopology ? '✖️' : '🔗'}</span> {showTopology ? 'Hide' : 'Display'} Topology
                            </button>
                        )}
                        {onExplain && (
                            <button
                                onClick={onExplain}
                                disabled={isExplaining}
                                className={`
                                flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider
                                transition-all duration-300 border
                                ${isExplaining
                                        ? 'bg-purple-500/10 border-purple-500/20 text-purple-400 cursor-wait'
                                        : 'bg-gradient-to-r from-blue-600/80 to-purple-600/80 hover:from-blue-500 hover:to-purple-500 text-white border-transparent hover:shadow-lg hover:scale-105 active:scale-95'
                                    }
                            `}
                            >
                                {isExplaining ? (
                                    <>
                                        <div className="w-2 h-2 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Analyzing...
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xs">✨</span> Explain
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Name</div>
                        <div className="col-span-2 text-white font-mono text-sm">{resource.metadata?.name}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Namespace</div>
                        <div className="col-span-2 text-white font-mono text-sm">{resource.metadata?.namespace}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created At</div>
                        <div className="col-span-2 text-white font-mono text-sm">
                            {resource.metadata?.creationTimestamp ? new Date(resource.metadata.creationTimestamp).toLocaleString() : '-'}
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">UID</div>
                        <div className="col-span-2 text-white font-mono text-sm">{resource.metadata?.uid}</div>
                    </div>
                </div>
            </div>

            {/* Inline Topology View */}
            {showTopology && clusterName && (
                <div className="border border-purple-500/30 rounded-lg overflow-hidden bg-black/20">
                    <ResourceTopology clusterName={clusterName} resource={resource} />
                </div>
            )}

            {/* Spec Section */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Spec</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Type</div>
                        <div className="col-span-2 text-white font-mono text-sm">{resource.spec?.type}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Cluster IP</div>
                        <div className="col-span-2 text-white font-mono text-sm">{resource.spec?.clusterIP}</div>
                    </div>
                    {resource.spec?.selector && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Selector</div>
                            <div className="col-span-2 flex flex-wrap gap-2">
                                {Object.entries(resource.spec.selector).map(([k, v]) => (
                                    <span key={k} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                                        {k}: {String(v)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Ports Section */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Ports</h3>
                <div className="bg-white/5 rounded-lg overflow-hidden border border-white/10">
                    <div className="grid grid-cols-5 bg-white/5 p-3 text-xs font-medium text-gray-400 border-b border-white/10">
                        <div>Name</div>
                        <div>Protocol</div>
                        <div>Port</div>
                        <div>Target Port</div>
                        <div className="text-right">Actions</div>
                    </div>
                    {resource.spec?.ports?.map((port: any, i: number) => {
                        const targetPortVal = port.targetPort || port.port;
                        const active = activeForwards[`${targetPortVal}`];

                        return (
                            <div key={i} className="grid grid-cols-5 p-3 text-sm border-b border-white/10 last:border-0 hover:bg-white/5 items-center">
                                <div className="text-gray-300">{port.name || '-'}</div>
                                <div className="text-gray-300">{port.protocol}</div>
                                <div className="font-mono text-yellow-400">{port.port}</div>
                                <div className="font-mono text-blue-400">{targetPortVal}</div>
                                <PortActions
                                    port={port}
                                    targetPortVal={targetPortVal}
                                    activeForward={active}
                                    onForward={() => setSelectedPort({ port: port.port, targetPort: targetPortVal })}
                                    onStop={() => handleStopForward(targetPortVal)}
                                />
                            </div>
                        );
                    })}
                    {(!resource.spec?.ports || resource.spec.ports.length === 0) && (
                        <div className="p-4 text-center text-gray-500 text-sm col-span-5">No ports defined.</div>
                    )}
                </div>
            </div>

            {/* Endpoints Section */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Endpoints</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10">
                    {loadingEndpoints ? (
                        <div className="text-center text-gray-500 text-sm py-4">Loading endpoints...</div>
                    ) : !endpoints ? (
                        <div className="text-center text-gray-500 text-sm py-4">No endpoints found</div>
                    ) : (
                        <div className="space-y-4">
                            {endpoints.subsets && endpoints.subsets.length > 0 ? (
                                endpoints.subsets.map((subset: any, subsetIdx: number) => (
                                    <div key={subsetIdx} className="space-y-3">
                                        {/* Addresses */}
                                        {subset.addresses && subset.addresses.length > 0 && (
                                            <div>
                                                <div className="text-xs font-medium text-green-400 mb-2 flex items-center gap-2">
                                                    <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                                                    Ready Addresses ({subset.addresses.length})
                                                </div>
                                                <div className="space-y-2">
                                                    {subset.addresses.map((addr: any, addrIdx: number) => (
                                                        <div key={addrIdx} className="bg-white/5 rounded p-2.5 border border-white/10">
                                                            <div className="space-y-1.5 text-sm">
                                                                <div>
                                                                    <span className="text-gray-400">IP:</span>
                                                                    <span className="ml-2 font-mono text-green-400">{addr.ip}</span>
                                                                </div>
                                                                {addr.targetRef && (
                                                                    <div>
                                                                        <span className="text-gray-400">Target:</span>
                                                                        {addr.targetRef.kind === 'Pod' ? (
                                                                            <button
                                                                                onClick={() => handlePodClick(addr.targetRef.name)}
                                                                                className="ml-2 font-mono text-blue-400 hover:text-blue-300 hover:underline cursor-pointer transition-colors"
                                                                            >
                                                                                {addr.targetRef.kind}/{addr.targetRef.name}
                                                                            </button>
                                                                        ) : (
                                                                            <span className="ml-2 font-mono text-blue-400">{addr.targetRef.kind}/{addr.targetRef.name}</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {addr.nodeName && (
                                                                    <div>
                                                                        <span className="text-gray-400">Node:</span>
                                                                        <button
                                                                            onClick={() => handleNodeClick(addr.nodeName)}
                                                                            className="ml-2 font-mono text-purple-400 hover:text-purple-300 hover:underline cursor-pointer transition-colors"
                                                                        >
                                                                            {addr.nodeName}
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Not Ready Addresses */}
                                        {subset.notReadyAddresses && subset.notReadyAddresses.length > 0 && (
                                            <div>
                                                <div className="text-xs font-medium text-yellow-400 mb-2 flex items-center gap-2">
                                                    <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                                                    Not Ready Addresses ({subset.notReadyAddresses.length})
                                                </div>
                                                <div className="space-y-2">
                                                    {subset.notReadyAddresses.map((addr: any, addrIdx: number) => (
                                                        <div key={addrIdx} className="bg-white/5 rounded p-2.5 border border-yellow-500/20">
                                                            <div className="space-y-1.5 text-sm">
                                                                <div>
                                                                    <span className="text-gray-400">IP:</span>
                                                                    <span className="ml-2 font-mono text-yellow-400">{addr.ip}</span>
                                                                </div>
                                                                {addr.targetRef && (
                                                                    <div>
                                                                        <span className="text-gray-400">Target:</span>
                                                                        {addr.targetRef.kind === 'Pod' ? (
                                                                            <button
                                                                                onClick={() => handlePodClick(addr.targetRef.name)}
                                                                                className="ml-2 font-mono text-blue-400 hover:text-blue-300 hover:underline cursor-pointer transition-colors"
                                                                            >
                                                                                {addr.targetRef.kind}/{addr.targetRef.name}
                                                                            </button>
                                                                        ) : (
                                                                            <span className="ml-2 font-mono text-blue-400">{addr.targetRef.kind}/{addr.targetRef.name}</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {addr.nodeName && (
                                                                    <div>
                                                                        <span className="text-gray-400">Node:</span>
                                                                        <button
                                                                            onClick={() => handleNodeClick(addr.nodeName)}
                                                                            className="ml-2 font-mono text-purple-400 hover:text-purple-300 hover:underline cursor-pointer transition-colors"
                                                                        >
                                                                            {addr.nodeName}
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Ports for this subset */}
                                        {subset.ports && subset.ports.length > 0 && (
                                            <div className="text-xs text-gray-400">
                                                <span className="font-medium">Ports:</span>
                                                <span className="ml-2">
                                                    {subset.ports.map((p: any, i: number) => (
                                                        <span key={i} className="font-mono text-blue-400">
                                                            {p.name ? `${p.name}:` : ''}{p.port}/{p.protocol}
                                                            {i < subset.ports.length - 1 ? ', ' : ''}
                                                        </span>
                                                    ))}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <div className="text-center text-gray-500 text-sm py-4">
                                    No endpoint subsets available. The service may not have any backing pods.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Modal */}
            <PortForwardModal
                isOpen={!!selectedPort}
                onClose={() => setSelectedPort(null)}
                onStart={handleStartForward}
                serviceName={resource.metadata?.name}
                targetPort={selectedPort?.port || 0}
            />
        </div>
    );
};
