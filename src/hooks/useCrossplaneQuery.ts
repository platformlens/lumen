import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveIntervalMs, shouldFetchOnVisible } from '../utils/crossplane-query-utils';
import { asNumber, asRecord } from '../utils/crossplane-guards';

/**
 * Generic fetch + interval refresh hook for the Crossplane views (design B.11).
 * - `fetcher` is kept in a ref, so inline closures never restart the interval.
 * - `key` (a primitive) replaces a deps array: a change discards in-flight results and triggers a fresh load.
 * - Initial load and interval ticks call `fetcher(false)`; only `refresh()` calls `fetcher(true)`.
 */
export interface CrossplaneQueryOptions {
    autoRefresh?: boolean;
    minIntervalMs?: number;
    enabled?: boolean;
}

export interface CrossplaneQueryResult<T> {
    data: T | null;
    error: string | null;
    loading: boolean;
    refreshing: boolean;
    refresh: () => void;
}

// Shared by every hook instance: settings are read once per renderer session.
let settingsIntervalPromise: Promise<number | null> | null = null;
function getSettingsRefreshSeconds(): Promise<number | null> {
    if (!settingsIntervalPromise) {
        settingsIntervalPromise = Promise.resolve()
            .then(() => window.k8s.settings.getAll())
            .then((s: unknown) => asNumber(asRecord(s)?.refreshInterval) ?? null)
            .catch(() => null);
    }
    return settingsIntervalPromise;
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return typeof err === 'string' ? err : 'Unknown error';
}

export function useCrossplaneQuery<T>(
    fetcher: (force: boolean) => Promise<T>,
    key: string,
    opts: CrossplaneQueryOptions = {},
): CrossplaneQueryResult<T> {
    const { autoRefresh = true, minIntervalMs, enabled = true } = opts;

    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [settingsSeconds, setSettingsSeconds] = useState<number | null>(null);

    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const requestIdRef = useRef(0);
    const hasDataRef = useRef(false);
    const lastFetchedAtRef = useRef<number | null>(null);

    const intervalMs = resolveIntervalMs(settingsSeconds, minIntervalMs);

    useEffect(() => {
        let alive = true;
        getSettingsRefreshSeconds().then(s => { if (alive) setSettingsSeconds(s); });
        return () => { alive = false; };
    }, []);

    const run = useCallback(async (force: boolean) => {
        if (!enabledRef.current) return;
        const id = ++requestIdRef.current;
        lastFetchedAtRef.current = Date.now();
        if (hasDataRef.current) setRefreshing(true); else setLoading(true);
        try {
            const result = await fetcherRef.current(force);
            if (id !== requestIdRef.current) return;
            hasDataRef.current = true;
            setData(result);
            setError(null);
        } catch (err) {
            if (id !== requestIdRef.current) return;
            // Previous data is kept on error
            setError(errorMessage(err));
        } finally {
            if (id === requestIdRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    const invalidate = useCallback(() => { requestIdRef.current++; }, []);

    // Initial load, and a fresh load whenever the key changes
    useEffect(() => {
        hasDataRef.current = false;
        lastFetchedAtRef.current = null;
        setData(null);
        setError(null);
        setLoading(false);
        setRefreshing(false);
        if (enabled) void run(false);
        // Discard anything still in flight for the previous key (or after unmount)
        return invalidate;
    }, [key, enabled, run, invalidate]);

    // Interval ticks (skipped while hidden) and a catch-up fetch when the window becomes visible
    useEffect(() => {
        if (!enabled || !autoRefresh) return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            void run(false);
        }, intervalMs);
        const onVisibility = () => {
            if (document.visibilityState !== 'visible') return;
            if (shouldFetchOnVisible(lastFetchedAtRef.current, Date.now(), intervalMs)) void run(false);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [key, enabled, autoRefresh, intervalMs, run]);

    const refresh = useCallback(() => { void run(true); }, [run]);

    return { data, error, loading, refreshing, refresh };
}
