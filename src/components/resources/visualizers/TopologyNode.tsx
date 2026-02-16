import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Box, Layers, Copy, Network, Shield, Users, Server, AlertCircle, CheckCircle, Clock } from 'lucide-react';

const StatusIcon = ({ status }: { status?: string }) => {
    if (!status) return null;
    const lower = status.toLowerCase();
    
    // Check for "X/Y Ready" pattern
    if (lower.includes('ready') && lower.includes('/')) {
        const [counts] = lower.split(' ');
        const [ready, total] = counts.split('/').map(Number);
        if (!isNaN(ready) && !isNaN(total) && ready === total && total > 0) {
            return <CheckCircle size={14} className="text-green-500" />;
        }
        // If 0/0 or mismatch
        return <AlertCircle size={14} className="text-amber-500" />;
    }

    if (lower === 'running' || lower === 'active' || lower === 'ready' || lower === 'bound' || lower === 'succeeded') return <CheckCircle size={14} className="text-green-500" />;
    if (lower === 'pending' || lower === 'containercreating') return <Clock size={14} className="text-amber-500" />;
    if (lower === 'failed' || lower === 'error') return <AlertCircle size={14} className="text-red-500" />;
    
    // Default fallback
    return <AlertCircle size={14} className="text-gray-500" />;
};

const ResourceIcon = ({ type }: { type: string }) => {
    const p = { size: 18, className: "text-blue-400" };
    switch (type.toLowerCase()) {
        case 'deployment': return <Layers {...p} />;
        case 'pod': return <Box {...p} />;
        case 'replicaset': return <Copy {...p} />;
        case 'service': return <Network {...p} />;
        case 'clusterrolebinding':
        case 'rolebinding': return <Shield {...p} />;
        case 'serviceaccount': return <Users {...p} />;
        case 'node': return <Server {...p} />;
        default: return <Box {...p} />;
    }
};

export const TopologyNode = memo(({ data }: any) => {
    return (
        <div className="relative group">
            {/* Input Handle */}
            <Handle type="target" position={Position.Left} className="!bg-blue-500 !w-2 !h-2 border-none" />
            
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[#1e1e1e] border border-white/10 shadow-lg min-w-[200px] hover:border-blue-500/50 transition-colors">
                <div className="p-2 rounded bg-white/5 border border-white/10">
                    <ResourceIcon type={data.type} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">{data.type}</div>
                    <div className="text-sm font-medium text-gray-200 truncate" title={data.label}>{data.label}</div>
                    {data.status && (
                        <div className="flex items-center gap-1.5 mt-1">
                            <StatusIcon status={data.status} />
                            <span className="text-xs text-gray-500 capitalize">{data.status}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Output Handle */}
            <Handle type="source" position={Position.Right} className="!bg-blue-500 !w-2 !h-2 border-none" />
        </div>
    );
});
