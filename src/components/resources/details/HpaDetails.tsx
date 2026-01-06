import React from 'react';
import { Activity, TrendingUp, Layers, Target } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface HpaDetailsProps {
    resource: any;
}

export const HpaDetails: React.FC<HpaDetailsProps> = ({ resource }) => {
    if (!resource) return null;

    const spec = resource.spec || {};
    const status = resource.status || {};
    const metrics = status.currentMetrics || [];
    const conditions = status.conditions || [];

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
                            <TrendingUp size={14} className="text-blue-400" />
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
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Target</span>
                        <div className="col-span-2 text-white flex items-center gap-2 font-mono">
                            {spec.scaleTargetRef?.kind} / <span className="text-purple-400 font-bold">{spec.scaleTargetRef?.name}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Replicas Status */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Activity size={14} /> Replicas
                </h3>
                <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white/5 rounded-md p-4 border border-white/10 text-center">
                        <div className="text-2xl font-bold text-white mb-1">{status.currentReplicas || 0}</div>
                        <div className="text-xs text-blue-400 uppercase tracking-wider font-bold">Current</div>
                    </div>
                    <div className="bg-white/5 rounded-md p-4 border border-white/10 text-center">
                        <div className="text-2xl font-bold text-white mb-1">{status.desiredReplicas || 0}</div>
                        <div className="text-xs text-green-400 uppercase tracking-wider font-bold">Desired</div>
                    </div>
                    <div className="bg-white/5 rounded-md p-4 border border-white/10 text-center flex flex-col justify-center">
                        <div className="text-sm text-gray-400 flex justify-between px-2">
                            <span>Min</span> <span className="text-white font-mono">{spec.minReplicas || 1}</span>
                        </div>
                        <div className="h-px bg-white/10 my-2 w-full"></div>
                        <div className="text-sm text-gray-400 flex justify-between px-2">
                            <span>Max</span> <span className="text-white font-mono">{spec.maxReplicas || 1}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Metrics */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Target size={14} /> Metrics
                </h3>
                <div className="space-y-2">
                    {metrics.map((m: any, idx: number) => {
                        // Attempt to match with spec to get target
                        const type = m.type;
                        const name = m.resource?.name || 'unknown';
                        const currentVal = m.resource?.current?.averageUtilization !== undefined
                            ? `${m.resource?.current?.averageUtilization}%`
                            : m.resource?.current?.averageValue;

                        // Find target in spec
                        const specMetric = spec.metrics?.find((sm: any) => sm.type === type && sm.resource?.name === name);
                        const targetVal = specMetric?.resource?.target?.averageUtilization !== undefined
                            ? `${specMetric.resource.target.averageUtilization}%`
                            : specMetric?.resource?.target?.averageValue || 'N/A';

                        return (
                            <div key={idx} className="bg-white/5 rounded-md p-3 border border-white/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-500/10 rounded text-blue-400">
                                        <Activity size={16} />
                                    </div>
                                    <div>
                                        <div className="text-white font-bold uppercase text-xs tracking-wider">{name}</div>
                                        <div className="text-xs text-gray-500">{type}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 text-sm font-mono">
                                    <span className="text-white font-bold">{currentVal}</span>
                                    <span className="text-gray-500 text-xs">vs</span>
                                    <span className="text-gray-400">{targetVal}</span>
                                </div>
                            </div>
                        );
                    })}
                    {metrics.length === 0 && (
                        <div className="bg-white/5 rounded-md p-4 border border-white/10 text-gray-500 italic text-xs text-center">
                            No active metrics.
                        </div>
                    )}
                </div>
            </div>

            {/* Conditions */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    Conditions
                </h3>
                <div className="space-y-2">
                    {conditions.map((cond: any, idx: number) => (
                        <div key={idx} className="bg-white/5 rounded-md p-3 border border-white/10 overflow-hidden">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-white font-bold text-xs">{cond.type}</span>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cond.status === 'True' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                    {cond.status}
                                </span>
                            </div>
                            <div className="text-gray-400 text-xs mb-1">
                                <span className="text-gray-500">Reason:</span> {cond.reason}
                            </div>
                            <div className="text-gray-500 text-xs italic truncate" title={cond.message}>
                                "{cond.message}"
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Data */}
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
