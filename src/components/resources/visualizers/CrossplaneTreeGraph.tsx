import React, { useCallback, useEffect, useMemo } from 'react';
import { Background, Controls, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';
import type { NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CrossplaneObjectRef, CrossplaneTree } from '../../../types/crossplane';
import { buildCrossplaneFlow } from '../../../utils/crossplane-graph';
import type { CrossplaneFlowEdge, CrossplaneFlowNode } from '../../../utils/crossplane-graph';
import { isValidCrossplaneRef, toCrossplaneRef } from '../../../utils/crossplane-utils';
import { CrossplaneGraphNode } from './CrossplaneGraphNode';

const TREE_TRUNCATION_NOTE = 'Showing first 300 resources';

interface CrossplaneTreeGraphProps {
    tree: CrossplaneTree | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    onOpenResource: (ref: CrossplaneObjectRef) => void;
}

/** Shared loading / root-failure / notes wrapper for the Graph and List relationship modes. */
export const CrossplaneTreeStatus: React.FC<Omit<CrossplaneTreeGraphProps, 'onOpenResource'> & { children: (tree: CrossplaneTree) => React.ReactNode }> = ({
    tree, loading, error, onRetry, children,
}) => {
    if (error && !tree) {
        return (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm space-y-3" role="alert">
                <p className="break-words">Failed to load relationships: {error}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors text-xs"
                >
                    Retry
                </button>
            </div>
        );
    }
    if (!tree || (loading && tree.nodes.length === 0)) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
                <div className="text-sm">Mapping Crossplane relationships...</div>
            </div>
        );
    }
    return (
        <div className="space-y-2">
            {tree.truncated && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 px-3 py-2 text-xs" role="status">
                    {TREE_TRUNCATION_NOTE}
                </div>
            )}
            {tree.warnings.map(w => <p key={w} className="text-xs text-gray-500">{w}</p>)}
            {children(tree)}
        </div>
    );
};

function canOpen(node: CrossplaneFlowNode): CrossplaneObjectRef | null {
    const { data } = node;
    if (!data.clickable || !data.ref || data.state === 'summary' || data.state === 'notFetched') return null;
    const ref = toCrossplaneRef(data.ref);
    return isValidCrossplaneRef(ref) ? ref : null;
}

const FlowCanvas: React.FC<{ tree: CrossplaneTree; onOpenResource: (ref: CrossplaneObjectRef) => void }> = ({ tree, onOpenResource }) => {
    const flow = useMemo(() => buildCrossplaneFlow(tree), [tree]);
    const [nodes, setNodes, onNodesChange] = useNodesState<CrossplaneFlowNode>(flow.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<CrossplaneFlowEdge>(flow.edges);
    const nodeTypes = useMemo(() => ({ crossplane: CrossplaneGraphNode }), []);

    useEffect(() => {
        setNodes(flow.nodes);
        setEdges(flow.edges);
    }, [flow, setNodes, setEdges]);

    const onNodeClick = useCallback<NodeMouseHandler<CrossplaneFlowNode>>((_, node) => {
        const ref = canOpen(node);
        if (ref) onOpenResource(ref);
    }, [onOpenResource]);

    return (
        <div className="w-full h-[500px] border border-white/10 rounded-xl bg-[#111] overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                nodesConnectable={false}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.2}
                maxZoom={2}
            >
                <Background color="#333" gap={16} size={1} />
                <Controls className="!bg-[#1e1e1e] !border-white/10 !text-gray-400 [&>button]:!border-b-white/10 hover:[&>button]:!bg-white/10" />
            </ReactFlow>
        </div>
    );
};

/** Relationship graph for a claim / XR / MR (design B.7). */
export const CrossplaneTreeGraph: React.FC<CrossplaneTreeGraphProps> = ({ onOpenResource, ...status }) => (
    <CrossplaneTreeStatus {...status}>
        {(tree) => <FlowCanvas tree={tree} onOpenResource={onOpenResource} />}
    </CrossplaneTreeStatus>
);
