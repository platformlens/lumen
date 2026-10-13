import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClusterContextInfo, ContextsChangedPayload } from '../types/cluster-context';

const FOCUS_REFRESH_MIN_INTERVAL_MS = 2000;

/** Order-insensitive comparison key so state only changes when the visible list changes. */
function signature(list: ClusterContextInfo[]): string {
    return list
        .map(c => [c.name, c.cluster, c.user, c.namespace ?? ''].join('\u0001'))
        .sort()
        .join('\u0002');
}

/**
 * Single shared list of kube contexts. Loads once, then stays in sync with the kubeconfig file via the
 * main-process `k8s:contextsChanged` event and a throttled refresh whenever the window regains focus.
 */
export function useClusterContexts(onChanged?: (payload: ContextsChangedPayload) => void) {
    const [clusters, setClusters] = useState<ClusterContextInfo[]>([]);
    const signatureRef = useRef('');
    const lastFocusRefreshRef = useRef(0);
    // Bumped whenever a fresher list arrives (event / rename result) so a slower in-flight fetch can't overwrite it
    const listVersionRef = useRef(0);
    const onChangedRef = useRef(onChanged);
    onChangedRef.current = onChanged;

    /** Replace the list only when it actually differs. */
    const setIfChanged = useCallback((next: ClusterContextInfo[]) => {
        const sig = signature(next);
        if (sig === signatureRef.current) return;
        signatureRef.current = sig;
        setClusters(next);
    }, []);

    /** Apply a list pushed from main (event / rename result); supersedes any fetch still in flight. */
    const applyClusters = useCallback((next: ClusterContextInfo[]) => {
        listVersionRef.current += 1;
        setIfChanged(next);
    }, [setIfChanged]);

    const refresh = useCallback(async () => {
        const version = listVersionRef.current;
        try {
            const fetched = await window.k8s.getClusters();
            if (version === listVersionRef.current) setIfChanged(fetched);
        } catch (err) {
            console.error('Failed to refresh cluster contexts:', err);
        }
    }, [setIfChanged]);

    useEffect(() => {
        void refresh();

        const unsubscribe = window.k8s.onContextsChanged((payload) => {
            applyClusters(payload.contexts);
            onChangedRef.current?.(payload);
        });

        // DOM focus event (not app.onWindowFocused, which uses removeAllListeners and would drop other listeners)
        const handleFocus = () => {
            const now = Date.now();
            if (now - lastFocusRefreshRef.current < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
            lastFocusRefreshRef.current = now;
            void refresh();
        };
        window.addEventListener('focus', handleFocus);

        return () => {
            unsubscribe();
            window.removeEventListener('focus', handleFocus);
        };
    }, [refresh, applyClusters]);

    return { clusters, refresh, applyClusters };
}
