import React, { useState, useEffect } from 'react';
import { Network, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { PortForwardModal } from '../../shared/PortForwardModal';
import { ResourceTopology } from '../visualizers/ResourceTopology';

interface ServiceDetailsProps {
    resource: any;
    clusterName?: string;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
    onShowTopology?: () => void;
}

export const ServiceDetails: React.FC<ServiceDetailsProps> = ({ resource, clusterName, explanation, onExplain, isExplaining, onShowTopology }) => {
    const [selectedPort, setSelectedPort] = useState<{port: number, targetPort: any} | null>(null);
    const [activeForwards, setActiveForwards] = useState<{[key: string]: {id: string, localPort: number, targetPort: number}}>({});
    const [showTopology, setShowTopology] = useState(false);

    const fetchForwards = async () => {
        try {
            const forwards = await window.k8s.getActivePortForwards();
            // Filter for this service
            const myForwards = forwards.filter((f: any) => 
                f.namespace === resource.metadata.namespace && 
                f.serviceName === resource.metadata.name
            );
            
            const myActive: {[key: string]: any} = {};
            myForwards.forEach((f: any) => {
                // Use inputPort if available (for exact match with what UI sent), otherwise fallback to targetPort
                const key = f.inputPort !== undefined ? `${f.inputPort}` : `${f.targetPort}`;
                myActive[key] = f;
            });
            setActiveForwards(myActive);
        } catch (err) {
            console.error("Failed to sync forwards", err);
        }
    };

    // Sync active forwards on mount
    useEffect(() => {
        fetchForwards();
    }, [resource.metadata.name, resource.metadata.namespace]);

    const handleStartForward = async (localPort: number) => {
        if (!clusterName) {
            console.error("Cluster name missing");
            return;
        }
        
        const targetPort = selectedPort?.targetPort || selectedPort?.port;
        
        try {
            const result = await window.k8s.startPortForward(
                clusterName, 
                resource.metadata.namespace, 
                resource.metadata.name, 
                targetPort, 
                localPort
            );
            
            // Auto open active browser
            const url = `http://localhost:${result.localPort}`;
            window.k8s.openExternal(url);
            
            // Refresh state from backend
            await fetchForwards();
            
        } catch (err) {
            console.error("Failed to start port forward", err);
        } finally {
            setSelectedPort(null);
        }
    };

    const handleStopForward = async (targetPort: number) => {
        const portKey = `${targetPort}`;
        const forward = activeForwards[portKey];
        if (!forward) return;

        try {
            await window.k8s.stopPortForward(forward.id);
            // Refresh state from backend to ensure we are in sync
            await fetchForwards();
        } catch (err) {
            console.error("Failed to stop", err);
        }
    }

    if (!resource) return null;

    return (
        <div className="space-y-6">
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
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Metadata</h3>
                    <div className="flex items-center gap-2">
                        {onShowTopology && (
                            <button
                                onClick={() => setShowTopology(!showTopology)}
                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border ${
                                    showTopology 
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
                <div className="bg-[#1e1e1e] rounded-lg p-4 space-y-3">
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
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Spec</h3>
                <div className="bg-[#1e1e1e] rounded-lg p-4 space-y-3">
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
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Ports</h3>
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
                                <div className="flex justify-end items-center gap-2">
                                    {active ? (
                                        <div className="flex items-center gap-2">
                                            <button 
                                                onClick={() => window.k8s.openExternal(`http://localhost:${active.localPort}`)}
                                                className="text-xs text-green-400 hover:text-green-300 underline font-mono truncate max-w-[100px]"
                                            >
                                                :{active.localPort}
                                            </button>
                                            <button 
                                                onClick={() => handleStopForward(targetPortVal)}
                                                className="p-1.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                                                title="Stop Forwarding"
                                            >
                                                <Square size={12} fill="currentColor" />
                                            </button>
                                        </div>
                                    ) : (
                                        <button 
                                            onClick={() => setSelectedPort({ port: port.port, targetPort: targetPortVal })}
                                            className="px-2 py-1 rounded bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 text-xs flex items-center gap-1 transition-colors"
                                        >
                                            <Network size={12} /> Forward
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                     {(!resource.spec?.ports || resource.spec.ports.length === 0) && (
                         <div className="p-4 text-center text-gray-500 text-sm col-span-5">No ports defined.</div>
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
