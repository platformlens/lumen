import React from 'react';
import { Server, Cpu, HardDrive, Box, Activity, Settings, AlertTriangle, CheckCircle, List } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';
import ReactMarkdown from 'react-markdown';

interface NodePoolDetailsProps {
    nodePool: any;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
    onOpenYaml?: () => void;
}

export const NodePoolDetails: React.FC<NodePoolDetailsProps> = ({ nodePool, explanation, onExplain, isExplaining }) => {
    if (!nodePool) return null;

    const { spec, status, metadata } = nodePool;
    const templateSpec = spec?.template?.spec || {};
    const requirements = templateSpec.requirements || [];
    const limits = spec?.limits || {};
    const disruption = spec?.disruption || {};

    // Calculate Status
    const conditions = status?.conditions || [];
    const readyCondition = conditions.find((c: any) => c.type === 'Ready');
    const isReady = readyCondition?.status === 'True';

    return (
        <div className="space-y-6">
            {/* Header Status */}
            <div className="flex items-center gap-4">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${isReady ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'}`}>
                    {isReady ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                    <span className="font-bold text-sm">{isReady ? 'Ready' : 'Not Ready'}</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-gray-500 text-xs">
                        Created <TimeAgo timestamp={metadata?.creationTimestamp} />
                    </div>
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

            {/* AI Explanation Section */}
            {explanation && (
                <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-lg p-4 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500"></div>
                    <h3 className="text-blue-400 font-bold text-sm mb-2 flex items-center gap-2">
                        <span className="text-lg">✨</span> AI Explanation
                    </h3>
                    <div className="text-gray-200 leading-relaxed font-sans text-sm prose prose-invert max-w-none">
                        <ReactMarkdown>{explanation}</ReactMarkdown>
                    </div>
                </div>
            )}

            {/* Stats Overview */}
            {status?.resources && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label="Nodes" value={status.resources.nodes || '0'} icon={<Server size={14} />} />
                    <StatCard label="Pods" value={status.resources.pods || '0'} icon={<Box size={14} />} />
                    <StatCard label="CPU" value={formatCpu(status.resources.cpu)} icon={<Cpu size={14} />} />
                    <StatCard label="Memory" value={formatMemory(status.resources.memory)} icon={<HardDrive size={14} />} />
                </div>
            )}

            {/* Limits & Disruption */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Activity size={14} /> Limits
                    </h3>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-gray-400 text-sm">CPU</span>
                            <span className="text-gray-200 font-mono text-sm">{limits.cpu || 'Unlimited'}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-gray-400 text-sm">Memory</span>
                            <span className="text-gray-200 font-mono text-sm">{limits.memory || 'Unlimited'}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Settings size={14} /> Disruption Policy
                    </h3>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-gray-400 text-sm">Policy</span>
                            <span className="text-gray-200 font-mono text-sm">{disruption.consolidationPolicy || '-'}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-gray-400 text-sm">Consolidate After</span>
                            <span className="text-gray-200 font-mono text-sm">{disruption.consolidateAfter || '-'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Node Requirements */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <List size={14} /> Node Requirements
                </h3>
                <div className="space-y-2">
                    {requirements.map((req: any, i: number) => (
                        <div key={i} className="flex flex-col gap-1.5 p-3 bg-black/20 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                            <div className="flex items-center gap-2">
                                <span className="text-blue-400 font-mono text-xs">{req.key}</span>
                                <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-gray-400 font-mono">{req.operator}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pl-4">
                                {req.values?.map((v: string) => (
                                    <span key={v} className="text-xs text-gray-300 bg-white/5 px-2 py-0.5 rounded border border-white/5 font-mono">
                                        {v}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Node Class Ref */}
            {templateSpec.nodeClassRef && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Node Class Reference</h3>
                    <div className="flex items-center gap-3 text-sm">
                        <span className="text-gray-400">Group:</span> <span className="text-gray-200 font-mono">{templateSpec.nodeClassRef.group}</span>
                        <span className="text-gray-600">|</span>
                        <span className="text-gray-400">Kind:</span> <span className="text-gray-200 font-mono">{templateSpec.nodeClassRef.kind}</span>
                        <span className="text-gray-600">|</span>
                        <span className="text-gray-400">Name:</span> <span className="text-gray-200 font-mono text-blue-400">{templateSpec.nodeClassRef.name}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

const StatCard = ({ label, value, icon }: any) => (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3 flex flex-col items-center justify-center gap-1">
        <div className="text-gray-400 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
            {icon} {label}
        </div>
        <div className="text-lg font-bold text-gray-200">
            {value}
        </div>
    </div>
);

function formatCpu(cpu: string) {
    if (!cpu) return '-';
    // If it's pure number (millicores) or ends with 'm'
    if (cpu.endsWith('m')) return `${Math.round(parseInt(cpu) / 1000)} Cores`;
    return `${cpu} Cores`; // Mock formatter, refine if needed
}

function formatMemory(mem: string) {
    if (!mem) return '-';
    // Basic formatting for Ki/Mi/Gi
    if (mem.endsWith('Ki')) return `${(parseInt(mem) / 1024 / 1024).toFixed(1)} GiB`; // Example logic
    return mem;
}
