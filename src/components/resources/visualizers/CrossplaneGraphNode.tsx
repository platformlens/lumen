import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { CrossplaneHealth } from '../../../types/crossplane';
import type { CrossplaneFlowNode, CrossplaneFlowNodeData } from '../../../utils/crossplane-graph';
import { CrossplaneConditionPill } from '../../dashboard/views/crossplane/CrossplaneHealthBadge';

const BORDER_BY_HEALTH: Record<CrossplaneHealth, string> = {
    unhealthy: 'border-l-red-500',
    progressing: 'border-l-yellow-500',
    healthy: 'border-l-green-500',
    paused: 'border-l-gray-500',
    unknown: 'border-l-gray-500',
    none: 'border-l-gray-600',
};

const STATE_LABELS: Partial<Record<CrossplaneFlowNodeData['state'], { label: string; className: string }>> = {
    missing: { label: 'Missing', className: 'bg-red-500/10 text-red-400' },
    forbidden: { label: 'Forbidden', className: 'bg-yellow-500/10 text-yellow-400' },
    error: { label: 'Error', className: 'bg-red-500/10 text-red-400' },
    notFetched: { label: 'Not fetched', className: 'bg-gray-500/20 text-gray-300' },
};

/** 220 px graph card. Status is always written as text (pills/badges), never colour alone. */
export const CrossplaneGraphNode = memo(({ data }: NodeProps<CrossplaneFlowNode>) => {
    const stateBadge = STATE_LABELS[data.state];
    const isSummary = data.state === 'summary';
    return (
        <div className="relative">
            <Handle type="target" position={Position.Left} className="!bg-blue-500 !w-2 !h-2 border-none" />
            <div
                className={`w-[220px] px-3 py-2 rounded-lg bg-[#1e1e1e] border border-white/10 border-l-4 ${BORDER_BY_HEALTH[data.health]} shadow-lg transition-colors ${data.clickable ? 'cursor-pointer hover:border-blue-500/50' : 'cursor-default'} ${data.focus ? 'ring-2 ring-blue-500/60' : ''}`}
                title={data.healthMessage ?? data.name}
            >
                {isSummary ? (
                    <div className="text-xs text-gray-400">{data.name}</div>
                ) : (
                    <>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate">{data.kind}</div>
                        <div className="text-sm font-medium text-gray-200 truncate" title={data.name}>{data.name}</div>
                        {data.namespace && <div className="text-[11px] text-gray-500 truncate">{data.namespace}</div>}
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-500">
                            {stateBadge ? (
                                <span className={`px-2 py-0.5 rounded text-xs ${stateBadge.className}`}>{stateBadge.label}</span>
                            ) : (
                                <>
                                    <span>Synced</span><CrossplaneConditionPill status={data.synced} />
                                    <span className="ml-1">Ready</span><CrossplaneConditionPill status={data.ready} />
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>
            <Handle type="source" position={Position.Right} className="!bg-blue-500 !w-2 !h-2 border-none" />
        </div>
    );
});

CrossplaneGraphNode.displayName = 'CrossplaneGraphNode';
