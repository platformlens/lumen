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
    selectedNamespaces: string[];
    setPods: React.Dispatch<React.SetStateAction<any[]>>;
    setDeployments: React.Dispatch<React.SetStateAction<any[]>>;
    startTransition: (callback: () => void) => void;
    watchEpoch: number;
}

export function useDashboardWatchers({
    clusterName,
    selectedNamespaces,
    setPods: _setPods,
    setDeployments,
    startTransition,
    watchEpoch,
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

    // Pod Watcher Effect — DISABLED.
    // Pod watching is now handled by the usePodWorker hook (utilityProcess-based)
    // in DashboardContent.tsx. The old main-process watcher is no longer needed.
    useEffect(() => {
        // No-op: pods are now managed by usePodWorker via the k8s-pod-worker utilityProcess.
        // This effect is kept as a placeholder so the hook's return shape doesn't change.
        return () => {};
    }, [clusterName, selectedNamespaces, watchEpoch]);

    // Deployment Watcher Effect - Runs continuously, independent of active view.
    const depMapRef = useRef<Map<string, any>>(new Map());
    useEffect(() => {
        console.log(`[DeploymentWatcher] Starting — cluster=${clusterName}, ns=${selectedNamespaces.join(',')}, epoch=${watchEpoch}`);
        const nsToWatch = selectedNamespaces;

        if (!nsToWatch.includes('all')) {
            for (const [key, dep] of depMapRef.current) {
                if (!nsToWatch.includes(dep.namespace)) depMapRef.current.delete(key);
            }
            setDeployments(Array.from(depMapRef.current.values()));
        }

        window.k8s.watchDeployments(clusterName, nsToWatch);

        const depCleanup = window.k8s.onDeploymentBatchChange((events) => {
            let changed = false;
            for (const { type, deployment } of events) {
                const key = `${deployment.namespace}/${deployment.name}`;
                const isSelected = nsToWatch.includes('all') || nsToWatch.includes(deployment.namespace);
                if (type === 'DELETED') {
                    if (depMapRef.current.delete(key)) changed = true;
                } else if (isSelected) {
                    depMapRef.current.set(key, deployment);
                    changed = true;
                } else if (depMapRef.current.has(key)) {
                    depMapRef.current.delete(key);
                    changed = true;
                }
            }
            if (changed) {
                const snapshot = Array.from(depMapRef.current.values());
                startTransition(() => setDeployments(snapshot));
            }
            setIsUpdating(true);
            resetIdleTimer();
        });

        return () => {
            console.log(`[DeploymentWatcher] Cleanup — epoch=${watchEpoch}`);
            depCleanup();
            window.k8s.stopWatchDeployments();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, selectedNamespaces, watchEpoch]);

    // Clean up idle timer on unmount
    useEffect(() => {
        return () => {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        };
    }, []);

    return { isUpdating };
}
