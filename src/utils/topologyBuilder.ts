import { Node, Edge } from '@xyflow/react';

const LEVEL_SPACING = 300;
const VERTICAL_SPACING = 100;

// Helper to calculate positions
const layoutNodes = (nodes: Node[]) => {
    // Simple level-based layout
    // We assume the graph flows Left -> Right based on our construction logic
    // We can group nodes by their "data.level" if we set it, or just use type hierarchy

    const levels: Record<number, Node[]> = {};
    nodes.forEach(node => {
        const level = node.data.level as number || 0;
        if (!levels[level]) levels[level] = [];
        levels[level].push(node);
    });

    return nodes.map(node => {
        const level = node.data.level as number || 0;
        const indexInLevel = levels[level].indexOf(node);
        const levelHeight = levels[level].length * VERTICAL_SPACING;
        const startY = -levelHeight / 2;

        return {
            ...node,
            position: {
                x: level * LEVEL_SPACING,
                y: startY + (indexInLevel * VERTICAL_SPACING)
            }
        };
    });
};

export const buildTopology = async (
    clusterName: string,
    rootResource: any,
    k8s: any
): Promise<{ nodes: Node[], edges: Edge[] }> => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const addedIds = new Set<string>();

    const addNode = (resource: any, level: number, type?: string) => {
        const id = resource.metadata.uid || resource.metadata.name;
        if (addedIds.has(id)) return id;

        addedIds.add(id);

        let status = '';
        if (resource.status?.phase) status = resource.status.phase;
        // For deployments
        if (resource.kind === 'Deployment' && resource.status) {
            const ready = resource.status.readyReplicas || 0;
            const total = resource.status.replicas || 0;
            status = `${ready}/${total} Ready`;
        }

        nodes.push({
            id,
            type: 'custom',
            data: {
                label: resource.metadata.name,
                type: type || resource.kind,
                status,
                level
            },
            position: { x: 0, y: 0 }, // Will be calculated later
            draggable: false, // User requested disable dragging
        });
        return id;
    };

    try {
        const namespace = rootResource.metadata.namespace;
        const rootId = addNode(rootResource, 0);
        console.log(`[Topology] Building for ${rootResource.kind}/${rootResource.metadata.name}, RootID: ${rootId}`);

        // --- DEPLOYMENT CENTRIC VIEW ---
        if (rootResource.kind === 'Deployment' || rootResource.metadata?.ownerReferences?.some((r: any) => r.kind === 'Deployment')) {
            let deployment = rootResource;
            console.log("[Topology] Processing Deployment view");

            // If root is not deployment (rare here as we click deployment), handles generic case later

            // 1. Get ReplicaSets owned by this Deployment
            // K8s API doesn't have "getReplicaSetsForDeployment", so we fetch all RS in namespace and filter by owner
            const allRS = await k8s.getReplicaSets(clusterName, [namespace]);
            console.log(`[Topology] Found ${allRS.length} RS in namespace ${namespace}`);

            const ownedRS = allRS.filter((rs: any) =>
                rs.metadata.ownerReferences?.some((ref: any) => ref.uid === deployment.metadata.uid)
            );
            console.log(`[Topology] Matched ${ownedRS.length} RS owned by deployment`);

            for (const rs of ownedRS) {
                const rsId = addNode(rs, 1, 'ReplicaSet');
                edges.push({ id: `${rootId}-${rsId}`, source: rootId, target: rsId, animated: true, style: { stroke: '#3b82f6' } });

                // 2. Get Pods owned by this RS
                const allPods = await k8s.getPods(clusterName, [namespace]);
                const ownedPods = allPods.filter((pod: any) =>
                    pod.metadata.ownerReferences?.some((ref: any) => ref.uid === rs.metadata.uid)
                );
                console.log(`[Topology] RS ${rs.metadata.name} owns ${ownedPods.length} pods`);

                for (const pod of ownedPods) {
                    const podId = addNode(pod, 2, 'Pod');
                    edges.push({ id: `${rsId}-${podId}`, source: rsId, target: podId, animated: true, style: { stroke: '#3b82f6' } });
                }
            }
        }

        // --- DAEMONSET CENTRIC VIEW ---
        else if (rootResource.kind === 'DaemonSet') {
            console.log("[Topology] Processing DaemonSet view");
            const allPods = await k8s.getPods(clusterName, [namespace]);
            const ownedPods = allPods.filter((pod: any) =>
                pod.metadata.ownerReferences?.some((ref: any) => ref.uid === rootResource.metadata.uid)
            );
            console.log(`[Topology] DaemonSet owns ${ownedPods.length} pods`);
            for (const pod of ownedPods) {
                const podId = addNode(pod, 1, 'Pod');
                edges.push({ id: `${rootId}-${podId}`, source: rootId, target: podId, animated: true, style: { stroke: '#3b82f6' } });
            }
        }

        // --- STATEFULSET CENTRIC VIEW ---
        else if (rootResource.kind === 'StatefulSet') {
            console.log("[Topology] Processing StatefulSet view");
            const allPods = await k8s.getPods(clusterName, [namespace]);
            const ownedPods = allPods.filter((pod: any) =>
                pod.metadata.ownerReferences?.some((ref: any) => ref.uid === rootResource.metadata.uid)
            );
            console.log(`[Topology] StatefulSet owns ${ownedPods.length} pods`);
            for (const pod of ownedPods) {
                const podId = addNode(pod, 1, 'Pod');
                edges.push({ id: `${rootId}-${podId}`, source: rootId, target: podId, animated: true, style: { stroke: '#3b82f6' } });
            }
        }

        // --- JOB CENTRIC VIEW ---
        else if (rootResource.kind === 'Job') {
            console.log("[Topology] Processing Job view");
            const allPods = await k8s.getPods(clusterName, [namespace]);
            const ownedPods = allPods.filter((pod: any) =>
                pod.metadata.ownerReferences?.some((ref: any) => ref.uid === rootResource.metadata.uid)
            );
            console.log(`[Topology] Job owns ${ownedPods.length} pods`);
            for (const pod of ownedPods) {
                const podId = addNode(pod, 1, 'Pod');
                edges.push({ id: `${rootId}-${podId}`, source: rootId, target: podId, animated: true, style: { stroke: '#3b82f6' } });
            }
        }

        // --- CRONJOB CENTRIC VIEW ---
        else if (rootResource.kind === 'CronJob') {
            console.log("[Topology] Processing CronJob view");
            const allJobs = await k8s.getJobs(clusterName, [namespace]);
            const ownedJobs = allJobs.filter((job: any) =>
                job.metadata.ownerReferences?.some((ref: any) => ref.uid === rootResource.metadata.uid)
            );
            console.log(`[Topology] CronJob owns ${ownedJobs.length} jobs`);

            for (const job of ownedJobs) {
                const jobId = addNode(job, 1, 'Job');
                edges.push({ id: `${rootId}-${jobId}`, source: rootId, target: jobId, animated: true, style: { stroke: '#3b82f6' } });

                const allPods = await k8s.getPods(clusterName, [namespace]);
                const ownedPods = allPods.filter((pod: any) =>
                    pod.metadata.ownerReferences?.some((ref: any) => ref.uid === job.metadata.uid)
                );
                console.log(`[Topology] Job ${job.metadata.name} owns ${ownedPods.length} pods`);
                for (const pod of ownedPods) {
                    const podId = addNode(pod, 2, 'Pod');
                    edges.push({ id: `${jobId}-${podId}`, source: jobId, target: podId, animated: true, style: { stroke: '#3b82f6' } });
                }
            }
        }

        // --- POD CENTRIC VIEW ---
        else if (rootResource.kind === 'Pod') {
            console.log("[Topology] Processing Pod view");
            // Upstream: Find Owner (RS) -> (Deployment)
            const owners = rootResource.metadata.ownerReferences || [];
            console.log("[Topology] Pod owners:", owners);
            for (const ref of owners) {
                if (ref.kind === 'ReplicaSet') {
                    // Fetch RS
                    // Need a way to get single generic resource or list
                    // Use getReplicaSets for now as we don't have getReplicaSet by UID easily without scanning
                    // Optimistically we assume we can list or get easily.
                    // For now, let's just list provided we have namespace
                    const allRS = await k8s.getReplicaSets(clusterName, [namespace]);
                    const parentRS = allRS.find((rs: any) => rs.metadata.uid === ref.uid);

                    if (parentRS) {
                        const rsId = addNode(parentRS, -1, 'ReplicaSet');
                        edges.push({ id: `${rsId}-${rootId}`, source: rsId, target: rootId, animated: true, style: { stroke: '#3b82f6' } });
                        console.log(`[Topology] Linked Pod to RS: ${parentRS.metadata.name}`);

                        // Find Deployment owning this RS
                        const rsOwners = parentRS.metadata.ownerReferences || [];
                        const depRef = rsOwners.find((r: any) => r.kind === 'Deployment');
                        if (depRef) {
                            const allDeps = await k8s.getDeployments(clusterName, [namespace]);
                            const parentDep = allDeps.find((d: any) => d.metadata.uid === depRef.uid);
                            if (parentDep) {
                                addNode(parentDep, -2, 'Deployment');
                                edges.push({ id: `${parentDep.metadata.uid}-${rsId}`, source: parentDep.metadata.uid, target: rsId, animated: true, style: { stroke: '#3b82f6' } });
                                console.log(`[Topology] Linked RS to Deployment: ${parentDep.metadata.name}`);
                            }
                        }
                    }
                }
            }

            // Downstream/Sidestream: Services selecting this Pod
            const allServices = await k8s.getServices(clusterName, [namespace]);
            const relatedServices = allServices.filter((svc: any) => {
                const selector = svc.spec?.selector;
                if (!selector) return false;
                // Check if pod labels match ALL selector labels
                const match = Object.entries(selector).every(([k, v]) => rootResource.metadata.labels?.[k] === v);
                return match;
            });
            console.log(`[Topology] Found ${relatedServices.length} related services`);

            for (const svc of relatedServices) {
                const svcId = addNode(svc, 1, 'Service');
                edges.push({ id: `${rootId}-${svcId}`, source: rootId, target: svcId, animated: true, style: { stroke: '#eab308', strokeDasharray: '5,5' } });
            }
        }

        // --- SERVICE CENTRIC VIEW ---
        else if (rootResource.kind === 'Service') {
            // Downstream: Pods selected by this service
            const selector = rootResource.spec?.selector;
            if (selector) {
                const allPods = await k8s.getPods(clusterName, [namespace]);
                const selectedPods = allPods.filter((pod: any) =>
                    Object.entries(selector).every(([k, v]) => pod.metadata.labels?.[k] === v)
                );

                for (const pod of selectedPods) {
                    const podId = addNode(pod, 1, 'Pod');
                    edges.push({ id: `${rootId}-${podId}`, source: rootId, target: podId, animated: true, style: { stroke: '#eab308', strokeDasharray: '5,5' } });

                    // Optional: Attempt to find owners of these pods to show context?
                    // Might make graph too big, keep it simple for now
                }
            }
        }

        return {
            nodes: layoutNodes(nodes),
            edges
        };

    } catch (e) {
        console.error("Error building topology:", e);
        return { nodes: [], edges: [] };
    }
};
