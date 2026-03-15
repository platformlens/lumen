import React, { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Node, Edge, useNodesState, useEdgesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TopologyNode } from './TopologyNode';

// --- Interfaces ---

interface ManifestResource {
    apiVersion: string;
    kind: string;
    name: string;
    namespace?: string;
}

interface HelmReleaseTopologyProps {
    clusterName: string;
    releaseName: string;
    namespace: string;
    resources: ManifestResource[];
}

// --- Constants ---

const COL_SPACING = 360;
const ROW_SPACING = 130;

// --- Helpers ---

function nid(kind: string, name: string): string {
    return `${kind}/${name}`;
}

const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']);

function getStatusFromLive(live: any, kind: string): string {
    if (!live) return '';
    if (live.status?.phase) return live.status.phase;
    if (kind === 'Deployment' || kind === 'StatefulSet') {
        const ready = live.status?.readyReplicas ?? live.availableReplicas ?? 0;
        const total = live.status?.replicas ?? live.replicas ?? 0;
        return `${ready}/${total} Ready`;
    }
    if (kind === 'DaemonSet') {
        const ready = live.status?.numberReady ?? 0;
        const desired = live.status?.desiredNumberScheduled ?? 0;
        return `${ready}/${desired} Ready`;
    }
    if (kind === 'Service') return 'Active';
    return '';
}

function findLive(kind: string, name: string, arrays: Record<string, any[]>): any | undefined {
    const items = arrays[kind];
    if (!items) return undefined;
    return items.find((i: any) => (i.metadata?.name || i.name) === name);
}

/**
 * Build the full topology graph.
 *
 * Layout (left → right):
 *   Col 0: Helm Release node
 *   Col 1: Manifest resources
 *   Col 2: ReplicaSets owned by Deployments
 *   Col 3: Pods owned by ReplicaSets (or directly by StatefulSet/DaemonSet)
 */
function buildGraph(
    releaseName: string,
    resources: ManifestResource[],
    liveArrays: Record<string, any[]>,
): { nodes: Node[]; edges: Edge[] } {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const seen = new Set<string>();

    const addNode = (id: string, kind: string, name: string, col: number, row: number, status: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        nodes.push({
            id,
            type: 'custom',
            data: { label: name, type: kind, status },
            position: { x: col * COL_SPACING, y: row * ROW_SPACING },
            draggable: false,
        });
    };

    const addEdge = (source: string, target: string, color = '#3b82f6', dashed = false) => {
        const id = `e-${source}-${target}`;
        edges.push({
            id,
            source,
            target,
            animated: true,
            style: { stroke: color, ...(dashed ? { strokeDasharray: '5,5' } : {}) },
        });
    };

    // --- Col 0: Release node ---
    const releaseId = 'HelmRelease/root';
    addNode(releaseId, 'HelmRelease', releaseName, 0, 0, 'deployed');

    // --- Categorize manifest resources ---
    const workloads: ManifestResource[] = [];
    const serviceResources: ManifestResource[] = [];
    const istioGateways: ManifestResource[] = [];
    const istioVirtualServices: ManifestResource[] = [];
    const otherResources: ManifestResource[] = [];

    for (const r of resources) {
        if (WORKLOAD_KINDS.has(r.kind)) workloads.push(r);
        else if (r.kind === 'Service') serviceResources.push(r);
        else if (r.kind === 'Gateway') istioGateways.push(r);
        else if (r.kind === 'VirtualService') istioVirtualServices.push(r);
        else otherResources.push(r);
    }

    // --- Col 1: All manifest resources ---
    const col1Order = [...serviceResources, ...istioGateways, ...istioVirtualServices, ...workloads, ...otherResources];
    let col1Row = 0;

    for (const r of col1Order) {
        const id = nid(r.kind, r.name);
        const live = findLive(r.kind, r.name, liveArrays);
        const status = getStatusFromLive(live, r.kind);
        addNode(id, r.kind, r.name, 1, col1Row, status);
        addEdge(releaseId, id, '#6366f1');
        col1Row++;
    }

    // --- Istio edges: Gateway ↔ VirtualService ---
    for (const gw of istioGateways) {
        for (const vs of istioVirtualServices) {
            addEdge(nid(gw.kind, gw.name), nid(vs.kind, vs.name), '#a855f7');
        }
    }

    // --- Col 2+3: ReplicaSets and Pods for workloads ---
    let col2Row = 0;
    let col3Row = 0;

    for (const w of workloads) {
        const wId = nid(w.kind, w.name);

        if (w.kind === 'Deployment') {
            // Find ReplicaSets owned by this deployment
            const ownedRS = (liveArrays['ReplicaSet'] || []).filter((rs: any) => {
                const owners = rs.metadata?.ownerReferences || [];
                return owners.some((o: any) => o.kind === 'Deployment' && o.name === w.name);
            });

            for (const rs of ownedRS) {
                const rsName = rs.metadata?.name || rs.name;
                const rsId = nid('ReplicaSet', rsName);
                const rsStatus = getStatusFromLive(rs, 'ReplicaSet');
                addNode(rsId, 'ReplicaSet', rsName, 2, col2Row, rsStatus);
                addEdge(wId, rsId);
                col2Row++;

                // Find Pods owned by this ReplicaSet
                const ownedPods = (liveArrays['Pod'] || []).filter((pod: any) => {
                    const owners = pod.metadata?.ownerReferences || [];
                    return owners.some((o: any) => o.kind === 'ReplicaSet' && o.name === rsName);
                });

                for (const pod of ownedPods) {
                    const podName = pod.metadata?.name || pod.name;
                    const podId = nid('Pod', podName);
                    const podStatus = getStatusFromLive(pod, 'Pod');
                    addNode(podId, 'Pod', podName, 3, col3Row, podStatus);
                    addEdge(rsId, podId, '#22c55e');
                    col3Row++;
                }
            }
        } else {
            // StatefulSet, DaemonSet, Job — pods owned directly
            const ownedPods = (liveArrays['Pod'] || []).filter((pod: any) => {
                const owners = pod.metadata?.ownerReferences || [];
                return owners.some((o: any) => o.kind === w.kind && o.name === w.name);
            });

            for (const pod of ownedPods) {
                const podName = pod.metadata?.name || pod.name;
                const podId = nid('Pod', podName);
                const podStatus = getStatusFromLive(pod, 'Pod');
                addNode(podId, 'Pod', podName, 3, col3Row, podStatus);
                addEdge(wId, podId, '#22c55e');
                col3Row++;
            }
        }
    }

    // --- Service → Pod selector edges ---
    for (const svc of serviceResources) {
        const svcLive = findLive('Service', svc.name, liveArrays);
        const selector = svcLive?.spec?.selector;
        if (!selector || Object.keys(selector).length === 0) continue;

        for (const pod of (liveArrays['Pod'] || [])) {
            const podName = pod.metadata?.name || pod.name;
            const podId = nid('Pod', podName);
            if (!seen.has(podId)) continue;
            const podLabels = pod.metadata?.labels || {};
            const matches = Object.entries(selector).every(([k, v]) => podLabels[k] === v);
            if (matches) {
                addEdge(nid('Service', svc.name), podId, '#eab308', true);
            }
        }
    }

    // --- Center the release node vertically relative to col 1 ---
    const releaseNode = nodes.find(n => n.id === releaseId);
    if (releaseNode && col1Row > 0) {
        releaseNode.position.y = ((col1Row - 1) * ROW_SPACING) / 2;
    }

    return { nodes, edges };
}

// --- Component ---

export const HelmReleaseTopology: React.FC<HelmReleaseTopologyProps> = ({
    clusterName,
    releaseName,
    namespace,
    resources,
}) => {
    const nodeTypes = useMemo(() => ({ custom: TopologyNode }), []);

    // Fetch live resources directly from the cluster for this namespace
    const [liveData, setLiveData] = useState<Record<string, any[]>>({
        Pod: [],
        Deployment: [],
        ReplicaSet: [],
        Service: [],
        StatefulSet: [],
        DaemonSet: [],
    });
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!clusterName || !namespace) return;
        let cancelled = false;
        const ns = [namespace];

        const fetchAll = async () => {
            try {
                const k8s = (window as any).k8s;
                const [pods, deployments, replicaSets, services, statefulSets, daemonSets] = await Promise.all([
                    k8s.getPods(clusterName, ns).catch(() => []),
                    k8s.getDeployments(clusterName, ns).catch(() => []),
                    k8s.getReplicaSets(clusterName, ns).catch(() => []),
                    k8s.getServices(clusterName, ns).catch(() => []),
                    k8s.getStatefulSets(clusterName, ns).catch(() => []),
                    k8s.getDaemonSets(clusterName, ns).catch(() => []),
                ]);
                if (!cancelled) {
                    setLiveData({
                        Pod: pods || [],
                        Deployment: deployments || [],
                        ReplicaSet: replicaSets || [],
                        Service: services || [],
                        StatefulSet: statefulSets || [],
                        DaemonSet: daemonSets || [],
                    });
                    setLoaded(true);
                }
            } catch (err) {
                console.error('[HelmTopology] Failed to fetch live resources:', err);
                if (!cancelled) setLoaded(true);
            }
        };

        fetchAll();
        return () => { cancelled = true; };
    }, [clusterName, namespace]);

    const { nodes: initialNodes, edges: initialEdges } = useMemo(
        () => buildGraph(releaseName, resources, liveData),
        [releaseName, resources, liveData]
    );

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    if (!resources || resources.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-gray-500 gap-3">
                <div className="text-sm">No resources found in this release.</div>
            </div>
        );
    }

    if (!loaded) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-gray-500 gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
                <div className="text-sm text-gray-400">Loading topology...</div>
            </div>
        );
    }

    return (
        <div className="w-full h-full min-h-[400px] border border-white/10 rounded-xl bg-[#111] overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.3}
                maxZoom={2}
                defaultEdgeOptions={{
                    type: 'smoothstep',
                    animated: true,
                }}
            >
                <Background color="#333" gap={16} size={1} />
                <Controls className="!bg-[#1e1e1e] !border-white/10 !shadow-xl [&>button]:!bg-[#1e1e1e] [&>button]:!border-white/10 [&>button]:!text-gray-400 [&>button]:hover:!bg-white/10 [&>button>svg]:!fill-gray-400" />
            </ReactFlow>
        </div>
    );
};
