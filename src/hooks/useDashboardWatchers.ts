import { useEffect } from 'react';

/**
 * Custom hook for managing Kubernetes resource watchers
 * Handles pod and deployment watchers with batching and conditional activation
 */

interface WatcherConfig {
    clusterName: string;
    activeView: string;
    selectedNamespaces: string[];
    setPods: React.Dispatch<React.SetStateAction<any[]>>;
    setDeployments: React.Dispatch<React.SetStateAction<any[]>>;
    startTransition: (callback: () => void) => void;
}

export function useDashboardWatchers({
    clusterName,
    activeView,
    selectedNamespaces,
    setPods,
    setDeployments,
    startTransition,
}: WatcherConfig) {

    // Pod Watcher Effect - Performance: Only watch when view is active
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        let batchTimeout: ReturnType<typeof setTimeout> | null = null;
        const pendingUpdates = new Map<string, { type: string; pod: any }>();

        // Performance: Only watch if we are in a view that needs pods
        const needsPods = activeView === 'overview' || activeView === 'pods';

        if (needsPods) {
            const nsToWatch = selectedNamespaces;

            // Start watching
            window.k8s.watchPods(clusterName, nsToWatch);

            const processBatch = () => {
                if (pendingUpdates.size === 0) {
                    batchTimeout = null;
                    return;
                }

                const updates = new Map(pendingUpdates);
                pendingUpdates.clear();
                batchTimeout = null;

                // Performance: Use startTransition to mark updates as non-urgent
                startTransition(() => {
                    setPods(prev => {
                        // Performance: Only create Map if we have updates
                        if (updates.size === 0) return prev;

                        // Use a Map for O(1) updates instead of O(N) array scans
                        const podMap = new Map(prev.map(p => [`${p.namespace}/${p.name}`, p]));

                        updates.forEach(({ type, pod }) => {
                            const key = `${pod.namespace}/${pod.name}`;

                            // Strict Filtering: If not viewing 'all' namespaces, check if pod belongs to selected namespaces
                            const isSelected = selectedNamespaces.includes('all') || selectedNamespaces.includes(pod.namespace);

                            if (type === 'ADDED' || type === 'MODIFIED') {
                                if (isSelected) {
                                    podMap.set(key, pod);
                                } else {
                                    if (podMap.has(key)) podMap.delete(key);
                                }
                            } else if (type === 'DELETED') {
                                podMap.delete(key);
                            }
                        });

                        return Array.from(podMap.values());
                    });
                });
            };

            // Listen for changes
            cleanup = window.k8s.onPodChange((type, pod) => {
                // Buffer updates
                const key = `${pod.namespace}/${pod.name}`;
                pendingUpdates.set(key, { type, pod });

                // Debounce/Batch updates every 650ms
                if (!batchTimeout) {
                    batchTimeout = setTimeout(processBatch, 650);
                }
            });
        }

        return () => {
            // Performance: Clean up watchers when view changes or component unmounts
            if (cleanup) cleanup();
            if (batchTimeout) clearTimeout(batchTimeout);
            if (needsPods) {
                window.k8s.stopWatchPods();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, selectedNamespaces, activeView]); // Performance: Restart when switching to/from pods/overview

    // Deployment Watcher Effect - Separate to avoid unnecessary restarts
    useEffect(() => {
        let depCleanup: (() => void) | undefined;
        let depBatchTimeout: ReturnType<typeof setTimeout> | null = null;
        const pendingDepUpdates = new Map<string, { type: string; deployment: any }>();
        const needsDeployments = activeView === 'overview' || activeView === 'deployments';

        if (needsDeployments) {
            const nsToWatch = selectedNamespaces;
            window.k8s.watchDeployments(clusterName, nsToWatch);

            const processDepBatch = () => {
                if (pendingDepUpdates.size === 0) {
                    depBatchTimeout = null;
                    return;
                }

                const updates = new Map(pendingDepUpdates);
                pendingDepUpdates.clear();
                depBatchTimeout = null;

                // Performance: Use startTransition to mark updates as non-urgent
                startTransition(() => {
                    setDeployments(prev => {
                        if (updates.size === 0) return prev;

                        const depMap = new Map(prev.map(d => [`${d.metadata.namespace}/${d.metadata.name}`, d]));

                        updates.forEach(({ type, deployment }) => {
                            const key = `${deployment.metadata.namespace}/${deployment.metadata.name}`;

                            const mappedDep = {
                                name: deployment.metadata.name,
                                namespace: deployment.metadata.namespace,
                                replicas: deployment.spec.replicas,
                                availableReplicas: deployment.status.availableReplicas || 0,
                                readyReplicas: deployment.status.readyReplicas || 0,
                                unavailableReplicas: deployment.status.unavailableReplicas || 0,
                                updatedReplicas: deployment.status.updatedReplicas || 0,
                                conditions: deployment.status.conditions,
                                age: deployment.metadata.creationTimestamp,
                                metadata: deployment.metadata,
                                spec: deployment.spec,
                                status: deployment.status
                            };

                            const isSelected = selectedNamespaces.includes('all') || selectedNamespaces.includes(mappedDep.namespace);

                            if (type === 'ADDED' || type === 'MODIFIED') {
                                if (isSelected) {
                                    depMap.set(key, mappedDep);
                                } else if (depMap.has(key)) {
                                    depMap.delete(key);
                                }
                            } else if (type === 'DELETED') {
                                depMap.delete(key);
                            }
                        });

                        return Array.from(depMap.values());
                    });
                });
            };

            depCleanup = window.k8s.onDeploymentChange((type, dep) => {
                const key = `${dep.metadata.namespace}/${dep.metadata.name}`;
                pendingDepUpdates.set(key, { type, deployment: dep });
                if (!depBatchTimeout) {
                    depBatchTimeout = setTimeout(processDepBatch, 650);
                }
            });
        }

        return () => {
            // Performance: Clean up watchers when view changes or component unmounts
            if (depCleanup) depCleanup();
            if (depBatchTimeout) clearTimeout(depBatchTimeout);
            if (needsDeployments) {
                window.k8s.stopWatchDeployments();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, selectedNamespaces, activeView]); // Performance: Restart when switching to/from deployments/overview
}
