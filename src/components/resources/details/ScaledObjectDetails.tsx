import React from 'react';
import { Gauge, Target, Zap, Activity, Check, X, HelpCircle } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface ScaledObjectDetailsProps {
    scaledObject: any;
    onExplain?: () => void;
    onOpenYaml?: () => void;
    onNavigate?: (kind: string, name: string, namespace?: string) => void;
}

export const ScaledObjectDetails: React.FC<ScaledObjectDetailsProps> = ({ scaledObject, onExplain: _onExplain, onOpenYaml: _onOpenYaml, onNavigate }) => {
    if (!scaledObject) return null;

    const metadata = scaledObject.metadata || {};
    const spec = scaledObject.spec || {};
    const status = scaledObject.status || {};
    const triggers: any[] = spec.triggers || [];
    const conditions: any[] = status.conditions || [];
    const scaleTargetRef = spec.scaleTargetRef || {};
    const hpaConfig = spec.advanced?.horizontalPodAutoscalerConfig || {};

    const conditionIcon = (s: string) => {
        if (s === 'True') return <Check size={14} className="text-green-400" />;
        if (s === 'False') return <X size={14} className="text-red-400" />;
        return <HelpCircle size={14} className="text-gray-500" />;
    };

    const conditionColor = (s: string) => {
        if (s === 'True') return 'bg-green-500/10 text-green-400 border-green-500/20';
        if (s === 'False') return 'bg-red-500/10 text-red-400 border-red-500/20';
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    };

    return (
        <div className="space-y-6 text-sm">
            {/* Metadata */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Metadata</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Namespace</div>
                        <div className="col-span-2 text-white font-mono text-sm">{metadata.namespace}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">API Version</div>
                        <div className="col-span-2 text-white font-mono text-sm">{scaledObject.apiVersion}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {metadata.creationTimestamp ? <TimeAgo timestamp={metadata.creationTimestamp} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Scale Target */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Target size={14} />
                    Scale Target
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Target</div>
                        <div className="col-span-2">
                            <button
                                onClick={() => onNavigate?.(status.scaleTargetGVKR?.kind || 'Deployment', scaleTargetRef.name, metadata.namespace)}
                                className="font-mono text-blue-400 hover:text-blue-300 hover:underline transition-colors cursor-pointer"
                            >
                                {scaleTargetRef.name}
                            </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Kind</div>
                        <div className="col-span-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                {status.scaleTargetKind || 'Deployment'}
                            </span>
                        </div>
                    </div>
                    {hpaConfig.name && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">HPA Name</div>
                            <div className="col-span-2 text-white font-mono text-sm">{hpaConfig.name}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Scaling Config */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Gauge size={14} />
                    Scaling
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10">
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="p-3 bg-black/20 rounded-lg">
                            <div className="text-xs text-gray-500 mb-1">Min Replicas</div>
                            <div className="font-mono text-lg text-blue-400">{spec.minReplicaCount ?? '-'}</div>
                        </div>
                        <div className="p-3 bg-black/20 rounded-lg">
                            <div className="text-xs text-gray-500 mb-1">Max Replicas</div>
                            <div className="font-mono text-lg text-yellow-400">{spec.maxReplicaCount ?? '-'}</div>
                        </div>
                        <div className="p-3 bg-black/20 rounded-lg">
                            <div className="text-xs text-gray-500 mb-1">Original</div>
                            <div className="font-mono text-lg text-gray-300">{status.originalReplicaCount ?? '-'}</div>
                        </div>
                    </div>
                    {status.lastActiveTime && (
                        <div className="mt-3 text-xs text-gray-500 text-center">
                            Last active: <TimeAgo timestamp={status.lastActiveTime} />
                        </div>
                    )}
                </div>
            </div>

            {/* Triggers */}
            {triggers.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Zap size={14} />
                        Triggers ({triggers.length})
                    </h3>
                    <div className="space-y-2">
                        {triggers.map((trigger: any, idx: number) => (
                            <div key={idx} className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-gray-400">Type</div>
                                    <div className="col-span-2">
                                        <span className="px-2 py-0.5 rounded text-xs font-medium border bg-purple-500/10 text-purple-400 border-purple-500/20">
                                            {trigger.type}
                                        </span>
                                    </div>
                                </div>
                                {trigger.metricType && (
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="text-gray-400">Metric Type</div>
                                        <div className="col-span-2 text-white text-sm">{trigger.metricType}</div>
                                    </div>
                                )}
                                {trigger.metadata && Object.entries(trigger.metadata).map(([k, v]) => (
                                    <div key={k} className="grid grid-cols-3 gap-4">
                                        <div className="text-gray-400">{k}</div>
                                        <div className="col-span-2 text-white font-mono text-sm">{String(v)}</div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Conditions */}
            {conditions.length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Activity size={14} />
                        Conditions
                    </h3>
                    <div className="space-y-2">
                        {conditions.map((cond: any, idx: number) => (
                            <div key={idx} className="bg-white/5 rounded-md p-3 border border-white/10 flex items-start gap-3">
                                {conditionIcon(cond.status)}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-white font-medium text-sm">{cond.type}</span>
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${conditionColor(cond.status)}`}>
                                            {cond.status}
                                        </span>
                                    </div>
                                    {cond.message && (
                                        <div className="text-gray-400 text-xs mt-1">{cond.message}</div>
                                    )}
                                    {cond.reason && (
                                        <div className="text-gray-500 text-xs mt-0.5 font-mono">{cond.reason}</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Labels */}
            {metadata.labels && Object.keys(metadata.labels).length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Labels</h3>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(metadata.labels).map(([k, v]) => (
                            <span key={k} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                                {k}: {String(v)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
