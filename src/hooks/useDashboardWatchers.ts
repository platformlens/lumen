import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * Custom hook for managing Kubernetes resource watchers
 * Handles pod and deployment watchers with batched IPC consumption and conditional activation
 * 
 * Batching now happens in the main process (WatcherBatchBuffer + Worker Thread).
 * This hook consumes pre-batched events via onPodBatchChange / onDeploymentBatchChange,
 * applies them with startTransition + Map-based merge, and exposes an isUpdating flag
 * for the spinner (resets after 1s of no batches).
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
}: WatcherConfig): { isUpdating: boolean } {

    const [isUpdating, setIsUpdating] = useState(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const resetIdleTimer = useCallback(() => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            setIsUpdating(false);
            idleTimerRef.current = null;
        }, 1000);
    }, []);

    // Pod Watcher Effect - Performance: Only watch when view is active
    useEffect(() => {
        let cleanup: (() => void) | undefined;

        // Performance: Only watch if we are in a view that needs pods
        const needsPods = activeView === 'overview' || activeView === 'pods';

        if (needsPods) {
            const nsToWatch = selectedNamespaces;

            // Clear stale pods from previously selected namespaces before restarting watcher.
            // The Map-based merge only processes incoming events (ADDED/MODIFIED/DELETED) and
            // never removes resources from namespaces that are no longer selected.
            setPods(prev => {
                if (nsToWatch.includes('all')) return prev;
                return prev.filter(p => nsToWatch.includes(p.namespace));
            });

            // Start watching
            window.k8s.watchPods(clusterName, nsToWatch);

            // Listen for pre-batched events from main process
            cleanup = window.k8s.onPodBatchChange((events) => {
                startTransition(() => {
                    setPods(prev => {
                        const podMap = new Map(prev.map(p => [`${p.namespace}/${p.name}`, p]));
                        for (const { type, pod } of events) {
                            const key = `${pod.namespace}/${pod.name}`;
                            const isSelected = selectedNamespaces.includes('all') || selectedNamespaces.includes(pod.namespace);
                            if (type === 'DELETED') {
                                podMap.delete(key);
                            } else if (isSelected) {
                                podMap.set(key, pod);
                            } else if (podMap.has(key)) {
                                podMap.delete(key);
                            }
                        }
                        return Array.from(podMap.values());
                    });
                });
                setIsUpdating(true);
                resetIdleTimer();
            });
        }

        return () => {
            if (cleanup) cleanup();
            if (needsPods) {
                window.k8s.stopWatchPods();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, selectedNamespaces, activeView]);

    // Deployment Watcher Effect - Separate to avoid unnecessary restarts
    useEffect(() => {
        let depCleanup: (() => void) | undefined;
        const needsDeployments = activeView === 'overview' || activeView === 'deployments';

        if (needsDeployments) {
            const nsToWatch = selectedNamespaces;

            // Clear stale deployments from previously selected namespaces before restarting watcher.
            setDeployments(prev => {
                if (nsToWatch.includes('all')) return prev;
                return prev.filter(d => nsToWatch.includes(d.namespace));
            });

            window.k8s.watchDeployments(clusterName, nsToWatch);

            // Listen for pre-batched events from main process
            // Worker thread already transforms raw K8s objects to UI-ready format
            depCleanup = window.k8s.onDeploymentBatchChange((events) => {
                startTransition(() => {
                    setDeployments(prev => {
                        const depMap = new Map(prev.map(d => [`${d.namespace}/${d.name}`, d]));
                        for (const { type, deployment } of events) {
                            const key = `${deployment.namespace}/${deployment.name}`;
                            const isSelected = selectedNamespaces.includes('all') || selectedNamespaces.includes(deployment.namespace);
                            if (type === 'DELETED') {
                                depMap.delete(key);
                            } else if (isSelected) {
                                depMap.set(key, deployment);
                            } else if (depMap.has(key)) {
                                depMap.delete(key);
                            }
                        }
                        return Array.from(depMap.values());
                    });
                });
                setIsUpdating(true);
                resetIdleTimer();
            });
        }

        return () => {
            if (depCleanup) depCleanup();
            if (needsDeployments) {
                window.k8s.stopWatchDeployments();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, selectedNamespaces, activeView]);

    // Clean up idle timer on unmount
    useEffect(() => {
        return () => {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        };
    }, []);

    return { isUpdating };
}
