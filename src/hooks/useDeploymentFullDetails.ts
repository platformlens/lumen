/**
 * Lazy, race-safe loader for the Deployment Full View.
 *
 * - One aggregated IPC call (`k8s:getDeploymentFullDetails`) per fetch.
 * - Module-level stale-while-revalidate LRU cache (max 5) keyed `${cluster}|${ns}|${name}`.
 * - Late responses are dropped (IPC can't be cancelled) via `shouldApplyResponse`.
 * - Live refresh is driven by *changes* of the session deployment watcher's resourceVersion
 *   (`decideLiveRefresh`), debounced 1.5 s. No polling, no new watchers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeploymentFullDetails } from '../types/deployment-details';
import { decideLiveRefresh, shouldApplyResponse, type LiveRefreshState } from './live-refresh-decision';

export type DeploymentFullDetailsState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

export interface UseDeploymentFullDetailsResult {
    state: DeploymentFullDetailsState;
    details: DeploymentFullDetails | null;
    error: string | null;          // fatal error (state 'error') or last refresh error (state 'ready')
    isRefreshing: boolean;
    lastFetchedAt: number | null;
    liveUpdates: boolean;          // false when liveResourceVersion is undefined (namespace not watched)
    refresh: () => void;
    dismissError: () => void;
}

interface Identity { key: string; clusterName: string; namespace: string; name: string }

interface HookState {
    state: DeploymentFullDetailsState;
    details: DeploymentFullDetails | null;
    error: string | null;
    isRefreshing: boolean;
    lastFetchedAt: number | null;
}

const CACHE_MAX_ENTRIES = 5;
const LIVE_DEBOUNCE_MS = 1500;

/** Module-level LRU (Map insertion order = recency). */
const detailsCache = new Map<string, DeploymentFullDetails>();

function cachePut(key: string, details: DeploymentFullDetails): void {
    detailsCache.delete(key);
    detailsCache.set(key, details);
    while (detailsCache.size > CACHE_MAX_ENTRIES) {
        const oldest = detailsCache.keys().next().value;
        if (oldest === undefined) break;
        detailsCache.delete(oldest);
    }
}

const toKey = (clusterName: string, namespace: string, name: string) => `${clusterName}|${namespace}|${name}`;

function initialStateFor(key: string): HookState {
    const hit = detailsCache.get(key);
    return hit
        ? { state: 'ready', details: hit, error: null, isRefreshing: true, lastFetchedAt: Date.parse(hit.fetchedAt) || null }
        : { state: 'loading', details: null, error: null, isRefreshing: false, lastFetchedAt: null };
}

function errorMessage(err: unknown): string {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === 'string' && err) return err;
    return 'Failed to load deployment details';
}

export function useDeploymentFullDetails(args: {
    clusterName: string; namespace: string; name: string; liveResourceVersion: string | undefined;
}): UseDeploymentFullDetailsResult {
    const { clusterName, namespace, name, liveResourceVersion } = args;
    const key = toKey(clusterName, namespace, name);

    const [s, setS] = useState<HookState>(() => initialStateFor(key));

    // Latest-ref identity snapshot; fetches read cluster/ns/name from the same snapshot as the key.
    const identityRef = useRef<Identity>({ key, clusterName, namespace, name });
    identityRef.current = { key, clusterName, namespace, name };

    const detailsRef = useRef<DeploymentFullDetails | null>(s.details);
    detailsRef.current = s.details;

    const requestIdRef = useRef(0);
    const mountedRef = useRef(false);
    const inFlightRef = useRef<{ id: number; key: string } | null>(null);
    const pendingKeyRef = useRef<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const liveStateRef = useRef<LiveRefreshState>({ hadLive: false });
    const fetchRef = useRef<() => void>(() => undefined);

    fetchRef.current = () => {
        if (!mountedRef.current) return;
        const ident = identityRef.current;
        // Coalesce: one follow-up fetch for the same key while a request is in flight.
        if (inFlightRef.current && inFlightRef.current.key === ident.key) {
            pendingKeyRef.current = ident.key;
            return;
        }
        const id = ++requestIdRef.current;
        const reqKey = ident.key;
        inFlightRef.current = { id, key: reqKey };
        setS(prev => prev.details
            ? { ...prev, isRefreshing: true }
            : { ...prev, state: 'loading', error: null, isRefreshing: true });

        const canApply = () => shouldApplyResponse(
            { id, key: reqKey },
            { id: requestIdRef.current, key: identityRef.current.key, mounted: mountedRef.current },
        );

        const settle = () => {
            if (inFlightRef.current?.id === id) inFlightRef.current = null;
            const pending = pendingKeyRef.current;
            if (pending !== null && pending === reqKey) {
                pendingKeyRef.current = null;
                if (pending === identityRef.current.key && mountedRef.current) fetchRef.current();
            }
        };

        window.k8s.getDeploymentFullDetails(ident.clusterName, ident.namespace, ident.name).then(res => {
            // Cache writes always use the captured key, so a late response only touches its own entry.
            if (res.found) cachePut(reqKey, res.details);
            else detailsCache.delete(reqKey);
            if (canApply()) {
                setS(res.found
                    ? { state: 'ready', details: res.details, error: null, isRefreshing: false, lastFetchedAt: Date.now() }
                    : { state: res.reason, details: null, error: res.message, isRefreshing: false, lastFetchedAt: Date.now() });
            }
            settle();
        }, (err: unknown) => {
            if (canApply()) {
                const message = errorMessage(err);
                if (detailsRef.current === null) {
                    detailsCache.delete(reqKey);
                    setS(prev => ({ ...prev, state: 'error', details: null, error: message, isRefreshing: false }));
                } else {
                    // Refresh failure keeps the existing details (and the cache entry).
                    setS(prev => ({ ...prev, error: message, isRefreshing: false }));
                }
            }
            settle();
        });
    };

    const clearDebounce = useCallback(() => {
        if (debounceRef.current !== null) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
    }, []);

    const scheduleDebouncedRefetch = useCallback((ms: number) => {
        clearDebounce();
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            fetchRef.current();
        }, ms);
    }, [clearDebounce]);

    // Key-change reset (declared first so it runs before the live trigger). Skipped on mount.
    const prevKeyRef = useRef(key);
    useEffect(() => {
        if (prevKeyRef.current === key) return;
        prevKeyRef.current = key;
        if (import.meta.env.DEV) {
            console.error('[DeploymentFullView] identity props changed on a mounted instance');
        }
        requestIdRef.current++;
        inFlightRef.current = null;
        pendingKeyRef.current = null;
        clearDebounce();
        liveStateRef.current = { hadLive: false };
        setS(initialStateFor(key));
        detailsRef.current = detailsCache.get(key) ?? null;
        fetchRef.current();
    }, [key, clearDebounce]);

    // Live trigger: delegates entirely to decideLiveRefresh.
    useEffect(() => {
        const { action, next } = decideLiveRefresh(
            liveStateRef.current, liveResourceVersion, detailsRef.current?.deployment.metadata?.resourceVersion);
        liveStateRef.current = next;
        if (action === 'debounce') scheduleDebouncedRefetch(LIVE_DEBOUNCE_MS);
    }, [liveResourceVersion, scheduleDebouncedRefetch]);

    // Mount: initial fetch (renders cached details meanwhile). Unmount: drop in-flight results and timers.
    useEffect(() => {
        mountedRef.current = true;
        fetchRef.current();
        return () => {
            mountedRef.current = false;
            pendingKeyRef.current = null;
            inFlightRef.current = null;
            clearDebounce();
        };
    }, [clearDebounce]);

    const refresh = useCallback(() => {
        clearDebounce();
        fetchRef.current();
    }, [clearDebounce]);

    const dismissError = useCallback(() => {
        setS(prev => (prev.state === 'ready' ? { ...prev, error: null } : prev));
    }, []);

    return {
        state: s.state,
        details: s.details,
        error: s.error,
        isRefreshing: s.isRefreshing,
        lastFetchedAt: s.lastFetchedAt,
        liveUpdates: liveResourceVersion !== undefined,
        refresh,
        dismissError,
    };
}
