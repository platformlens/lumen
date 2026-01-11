import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Box, Tag, List, Server, Network, Copy, Check, AlertCircle, ShieldAlert, Info, ChevronLeft, ChevronRight } from 'lucide-react';
import { ResourceTopology } from '../visualizers/ResourceTopology';
import { TimeAgo } from '../../shared/TimeAgo';
import { ToggleGroup } from '../../shared/ToggleGroup';
import { ContainerResources } from './ContainerResources';
import { PortForwardModal } from '../../shared/PortForwardModal';
import { usePortForwarding } from '../../../hooks/usePortForwarding';
import { PortActions } from '../../shared/PortActions';

interface PodDetailsProps {
    pod: any;
    explanation?: string | null;
    onOpenLogs: (containerName: string) => void;
    onExplain?: () => void;
    isExplaining?: boolean;
    onNavigate?: (kind: string, name: string) => void;
    onShowTopology?: () => void;
    onOpenYaml?: () => void;
    clusterName?: string;
}

export const PodDetails: React.FC<PodDetailsProps> = ({ pod, explanation, onOpenLogs, onExplain, isExplaining, onNavigate, onShowTopology, clusterName }) => {
    const [copiedImage, setCopiedImage] = useState<string | null>(null);
    const [showTopology, setShowTopology] = useState(false);
    const [events, setEvents] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'all' | 'unhealthy' | 'policy' | 'generic'>('all');
    const [page, setPage] = useState(1);
    const [showAllContainers, setShowAllContainers] = useState(false);
    const EVENTS_PER_PAGE = 10;

    const {
        selectedPort,
        setSelectedPort,
        activeForwards,
        handleStartForward,
        handleStopForward
    } = usePortForwarding(pod, 'Pod', clusterName);

    useEffect(() => {
        let isMounted = true;
        const fetchEvents = async () => {
            if (!clusterName || !pod || !pod.metadata?.namespace || !pod.metadata?.uid) return;
            try {
                // Filter by UID to be precise
                const selector = `involvedObject.uid=${pod.metadata.uid}`;
                // Cast to any to bypass potential type definition delay
                const evts = await (window.k8s as any).getEvents(clusterName, [pod.metadata.namespace], selector);
                if (isMounted) setEvents(evts);
            } catch (e) {
                console.error("Failed to fetch pod events", e);
            }
        };

        fetchEvents();
        // Update to 2000ms as requested
        const interval = setInterval(fetchEvents, 2000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [clusterName, pod?.metadata?.uid, pod?.metadata?.namespace]);

    // Reset pagination when tab changes
    useEffect(() => {
        setPage(1);
    }, [activeTab]);

    const filteredEvents = events.filter(e => {
        if (activeTab === 'all') return true;
        if (activeTab === 'policy') return e.reason === 'PolicyViolation' || e.reason === 'Forbidden';
        if (activeTab === 'unhealthy') return e.type === 'Warning' && e.reason !== 'PolicyViolation' && e.reason !== 'Forbidden';
        if (activeTab === 'generic') return e.type !== 'Warning';
        return true;
    });

    const totalPages = Math.ceil(filteredEvents.length / EVENTS_PER_PAGE);
    const paginatedEvents = filteredEvents.slice((page - 1) * EVENTS_PER_PAGE, page * EVENTS_PER_PAGE);

    if (!pod) return null;

    const { metadata, spec, status } = pod;

    const handleCopyImage = (image: string) => {
        navigator.clipboard.writeText(image);
        setCopiedImage(image);
        setTimeout(() => setCopiedImage(null), 2000);
    };

    return (
        <div className="space-y-8 text-sm">
            {/* AI Explanation Section (Placeholder for future) */}
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
                        <span className="text-gray-400">Name</span>
                        <span className="col-span-2 text-white font-mono">{metadata.name}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Namespace</span>
                        <span className="col-span-2 text-white font-mono">{metadata.namespace}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Created</span>
                        <span className="col-span-2 text-white">{new Date(metadata.creationTimestamp).toLocaleString()}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">UID</span>
                        <span className="col-span-2 text-gray-500 font-mono text-xs">{metadata.uid}</span>
                    </div>

                    {/* Controlled By */}
                    {metadata.ownerReferences && (
                        <div className="grid grid-cols-3 gap-4">
                            <span className="text-gray-400">Controlled By</span>
                            <div className="col-span-2 space-y-1">
                                {metadata.ownerReferences.map((ref: any) => (
                                    <div key={ref.uid} className="flex items-center gap-2 text-xs">
                                        <span className="text-gray-400">{ref.kind}</span>
                                        {onNavigate ? (
                                            <button
                                                onClick={() => onNavigate(ref.kind, ref.name)}
                                                className="text-blue-400 hover:text-blue-300 underline font-mono cursor-pointer"
                                            >
                                                {ref.name}
                                            </button>
                                        ) : (
                                            <span className="text-blue-400 font-mono">{ref.name}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Inline Topology View */}
            {showTopology && clusterName && (
                <div className="border border-purple-500/30 rounded-lg overflow-hidden bg-black/20">
                    <ResourceTopology clusterName={clusterName} resource={pod} />
                </div>
            )}

            {/* Status & Networking */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Network size={14} /> Status & Networking
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Phase</span>
                        <span className={`col-span-2 font-bold ${status.phase === 'Running' ? 'text-green-400' : 'text-yellow-400'}`}>
                            {status.phase}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Host IP</span>
                        <span className="col-span-2 text-white font-mono">{status.hostIP || '-'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Pod IP</span>
                        <span className="col-span-2 text-white font-mono">{status.podIP || '-'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Node</span>
                        <span className="col-span-2 text-white font-mono">{spec.nodeName || '-'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">QoS Class</span>
                        <span className="col-span-2 text-white">{status.qosClass}</span>
                    </div>
                </div>
            </div>

            {/* Labels & Annotations */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Tag size={14} /> Labels
                </h3>
                <div className="flex flex-wrap gap-2 mb-6">
                    {metadata.labels ? Object.entries(metadata.labels).map(([k, v]) => (
                        <div key={k} className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded text-xs border border-blue-500/20 font-mono">
                            {k}: {String(v)}
                        </div>
                    )) : <span className="text-gray-500 italic">No labels</span>}
                </div>

                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <List size={14} /> Annotations
                </h3>
                <div className="space-y-1">
                    {metadata.annotations ? Object.entries(metadata.annotations).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-1 gap-1 border-b border-white/10 pb-2 mb-2 last:border-0">
                            <span className="text-gray-400 font-mono text-xs">{k}</span>
                            <span className="text-gray-300 break-all">{String(v)}</span>
                        </div>
                    )) : <span className="text-gray-500 italic">No annotations</span>}
                </div>
            </div>

            {/* Containers */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider flex items-center gap-2">
                        <Box size={14} /> Containers
                    </h3>
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs uppercase font-bold tracking-wider">Show All</span>
                        <button
                            onClick={() => setShowAllContainers(!showAllContainers)}
                            className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${showAllContainers ? 'bg-blue-500' : 'bg-gray-600'}`}
                        >
                            <div className={`bg-white w-3 h-3 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${showAllContainers ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>
                <div className="space-y-4">
                    {[
                        ...(spec.initContainers || []).map((c: any) => ({ ...c, isInit: true })),
                        ...spec.containers.map((c: any) => ({ ...c, isInit: false }))
                    ].filter((c: any) => showAllContainers || !c.isInit).map((c: any) => (
                        <div key={c.name} className="bg-white/5 border border-white/10 rounded-md p-4 relative overflow-hidden">
                            {c.isInit && (
                                <div className="absolute top-0 right-0 bg-purple-500/20 text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded-bl-md border-b border-l border-purple-500/30">
                                    INIT CONTAINER
                                </div>
                            )}

                            {/* Header Row: Title */}
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`w-2.5 h-2.5 rounded-full ${c.isInit ? 'bg-purple-500' : 'bg-green-500'}`}></div>
                                <span className="font-bold text-white text-lg tracking-tight">{c.name}</span>
                            </div>

                            {/* Details Row: Image & Actions */}
                            <div className="flex items-center justify-between mb-4 bg-black/20 rounded-md p-2 border border-white/5">
                                <div className="flex items-center gap-2 flex-1 min-w-0 mr-4">
                                    <span className="text-gray-500 text-xs font-bold uppercase tracking-wider shrink-0">Image:</span>
                                    <span className="text-gray-300 text-xs font-mono truncate" title={c.image}>{c.image}</span>
                                    <button
                                        onClick={() => handleCopyImage(c.image)}
                                        className="text-gray-500 hover:text-white transition-colors p-1 shrink-0"
                                        title="Copy Image"
                                    >
                                        {copiedImage === c.image ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                    </button>
                                </div>
                                <button
                                    onClick={() => onOpenLogs(c.name)}
                                    className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:border-blue-500/50 rounded px-3 py-1.5 flex items-center gap-1.5 transition-all duration-200 group shrink-0"
                                    title="View Logs"
                                >
                                    <Server size={14} />
                                    <span className="text-xs font-mono font-bold">LOGS</span>
                                </button>
                            </div>

                            {/* Ports */}
                            {c.ports && (
                                <div className="mb-4">
                                    <span className="text-gray-500 text-xs uppercase font-bold block mb-2">Exposed Ports</span>
                                    <div className="flex flex-wrap gap-2">
                                        {c.ports.map((p: any) => {
                                            const active = activeForwards[`${p.containerPort}`];
                                            return (
                                                <div key={p.containerPort} className="bg-white/10 text-gray-300 px-2 py-1 rounded text-xs font-mono flex items-center gap-2">
                                                    <Server size={12} className="text-gray-500" />
                                                    <span>{p.containerPort}/{p.protocol}</span>
                                                    {p.name && <span className="text-gray-500">({p.name})</span>}
                                                    <div className="ml-1 pl-2 border-l border-white/20">
                                                        <PortActions
                                                            port={p}
                                                            targetPortVal={p.containerPort} // For pods, containerPort is the target
                                                            activeForward={active}
                                                            onForward={() => setSelectedPort({ port: p.containerPort, targetPort: p.containerPort })}
                                                            onStop={() => handleStopForward(p.containerPort)}
                                                        />
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Env Vars */}
                            {c.env && (
                                <div>
                                    <span className="text-gray-500 text-xs uppercase font-bold block mb-2">Environment</span>
                                    <div className="grid grid-cols-1 gap-1 bg-black/40 p-2 rounded border border-white/10 max-h-40 overflow-y-auto">
                                        {c.env.map((e: any) => (
                                            <div key={e.name} className="flex gap-2 text-xs font-mono border-b border-white/10 last:border-0 py-1">
                                                <span className="text-blue-400 min-w-[120px] shrink-0">{e.name}</span>
                                                <span className="text-gray-500">=</span>
                                                <span className="text-green-400 break-all">{e.value || (e.valueFrom ? "from reference..." : "")}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Resources */}
                            <ContainerResources container={c} />

                            {(() => {
                                // Find status: check both initContainerStatuses and containerStatuses
                                const containerStatus =
                                    (status.containerStatuses?.find((s: any) => s.name === c.name)) ||
                                    (status.initContainerStatuses?.find((s: any) => s.name === c.name));

                                const lastState = containerStatus?.lastState?.terminated;
                                const restartCount = containerStatus?.restartCount || 0;

                                if (restartCount === 0 && !lastState) return null;

                                return (
                                    <div className="mt-4 p-3 rounded-md bg-red-500/10 border border-red-500/20">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-red-400 font-bold text-xs uppercase tracking-wider">
                                                Restarts: {restartCount}
                                            </span>
                                        </div>
                                        {lastState && (
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div>
                                                    <span className="text-gray-500 block">Last Exit Reason</span>
                                                    <span className="text-white font-mono">{lastState.reason}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500 block">Exit Code</span>
                                                    <span className="text-white font-mono">{lastState.exitCode}</span>
                                                </div>
                                                {lastState.message && (
                                                    <div className="col-span-2">
                                                        <span className="text-gray-500 block">Message</span>
                                                        <span className="text-gray-300 font-mono break-all">{lastState.message}</span>
                                                    </div>
                                                )}
                                                <div className="col-span-2">
                                                    <span className="text-gray-500 block">Finished At</span>
                                                    <span className="text-gray-300">{new Date(lastState.finishedAt).toLocaleString()}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    ))}
                </div>
            </div>

            {/* Events Section */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider flex items-center gap-2">
                        <AlertCircle size={14} /> Events
                    </h3>
                    <ToggleGroup
                        value={activeTab}
                        onChange={(v) => setActiveTab(v as any)}
                        options={[
                            { value: 'all', label: 'All', icon: List },
                            { value: 'unhealthy', label: 'Unhealthy', icon: AlertCircle },
                            { value: 'policy', label: 'Policy', icon: ShieldAlert },
                            { value: 'generic', label: 'Generic', icon: Info },
                        ]}
                    />
                </div>

                {paginatedEvents.length === 0 ? (
                    <div className="bg-white/5 rounded-md p-4 border border-white/10 text-gray-500 italic text-center text-xs">
                        {events.length === 0 ? "No events found for this pod." : "No events match this filter."}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {paginatedEvents.map((event, i) => (
                            <div key={i} className="bg-white/5 border border-white/10 rounded-md p-3 text-xs">
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`font-bold ${event.reason === 'PolicyViolation' ? 'text-purple-400' :
                                        event.type === 'Warning' ? 'text-yellow-400' :
                                            'text-blue-400'
                                        }`}>
                                        {event.reason}
                                    </span>
                                    <div className="flex items-center gap-2 text-gray-500">
                                        {event.count > 1 && (
                                            <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-gray-400">
                                                {event.count}x
                                            </span>
                                        )}
                                        <TimeAgo timestamp={event.lastTimestamp} />
                                    </div>
                                </div>
                                <div className="text-gray-300 break-words leading-relaxed">
                                    {event.message}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-4">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="text-xs text-gray-400">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}
            </div>

            {/* Modal */}
            <PortForwardModal
                isOpen={!!selectedPort}
                onClose={() => setSelectedPort(null)}
                onStart={handleStartForward}
                serviceName={pod.metadata?.name}
                targetPort={selectedPort?.port || 0}
            />
        </div>
    );
};
