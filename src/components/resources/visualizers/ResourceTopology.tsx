import React, { useEffect, useState, useMemo } from 'react';
import { ReactFlow, Background, Controls, Node, Edge, useNodesState, useEdgesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TopologyNode } from './TopologyNode';
import { buildTopology } from '../../../utils/topologyBuilder';

interface ResourceTopologyProps {
    clusterName: string;
    resource: any;
}

export const ResourceTopology: React.FC<ResourceTopologyProps> = ({ clusterName, resource }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [loading, setLoading] = useState(false);

    const nodeTypes = useMemo(() => ({ custom: TopologyNode }), []);

    useEffect(() => {
        const fetchTopology = async () => {
            if (!resource) return;
            setLoading(true);
            try {
                const { nodes: newNodes, edges: newEdges } = await buildTopology(clusterName, resource, window.k8s);
                setNodes(newNodes);
                setEdges(newEdges);
            } catch (err) {
                console.error("Failed to load topology", err);
            } finally {
                setLoading(false);
            }
        };

        fetchTopology();
    }, [clusterName, resource, setNodes, setEdges]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-gray-500 gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-sm">Mapping Resource Topology...</div>
            </div>
        );
    }

    if (nodes.length === 0) {
        return (
             <div className="flex flex-col items-center justify-center h-96 text-gray-500 gap-3">
                <div className="text-sm">No relationships found.</div>
            </div>
        );
    }

    return (
        <div className="w-full h-[500px] border border-white/10 rounded-xl bg-[#111] overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.5}
                maxZoom={2}
                defaultEdgeOptions={{
                    type: 'smoothstep',
                    animated: true,
                }}
            >
                <Background color="#333" gap={16} size={1} />
                <Controls className="!bg-[#1e1e1e] !border-white/10 !text-gray-400 [&>button]:!border-b-white/10 hover:[&>button]:!bg-white/10" />
            </ReactFlow>
        </div>
    );
};
