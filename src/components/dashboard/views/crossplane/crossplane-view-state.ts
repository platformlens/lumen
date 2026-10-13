import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    CrossplaneDetection, CrossplaneObjectRef,
} from '../../../../types/crossplane';

/** Sub-view ids: the part after `crossplane-` in the view id. */
export type CrossplaneSubView = 'overview' | 'packages' | 'definitions' | 'composites' | 'managed';
export const CROSSPLANE_SUB_VIEWS: readonly CrossplaneSubView[] = ['overview', 'packages', 'definitions', 'composites', 'managed'];

/** sessionStorage keys (design B.9 DashboardContent row). */
export const crossplaneTabKey = (subView: CrossplaneSubView) => `lumen.crossplane.${subView}.tab`;
export const MANAGED_SELECTION_KEY = 'lumen.crossplane.managed.selection';
export const MANAGED_SELECTION_UNHEALTHY = 'unhealthy';

export function readSession(key: string): string | null {
    try { return window.sessionStorage.getItem(key); } catch { return null; }
}
export function writeSession(key: string, value: string): void {
    try { window.sessionStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export interface CrossplaneStatus { fetchedAt: string | null; busy: boolean; }

/** Props every sub-view receives from CrossplaneView. */
export interface CrossplaneSubViewProps {
    clusterName: string;
    detection: CrossplaneDetection;
    searchQuery: string;
    selectedNamespaces: string[];
    onResourceClick: (resource: CrossplaneObjectRef, type: 'crossplane') => void;
    onNavigate?: (view: string) => void;
    /** Incremented by the header Refresh button; each change forces the sub-view's queries. */
    refreshSignal: number;
    /** Reports the newest payload `fetchedAt` and whether any query is loading, for the header. */
    onStatus: (status: CrossplaneStatus) => void;
}

/**
 * Tab state persisted under `lumen.crossplane.<subView>.tab`. A stored tab that is unknown or
 * currently hidden falls back to the first visible tab (without overwriting the stored value).
 */
export function useCrossplaneTab<T extends string>(subView: CrossplaneSubView, visibleTabs: readonly T[]): [T, (tab: T) => void] {
    const storageKey = crossplaneTabKey(subView);
    const [stored, setStored] = useState<string | null>(() => readSession(storageKey));
    const tab = (visibleTabs.find(t => t === stored) ?? visibleTabs[0]) as T;
    const setTab = useCallback((next: T) => {
        writeSession(storageKey, next);
        setStored(next);
    }, [storageKey]);
    return [tab, setTab];
}

/** Calls `onRefresh` whenever `signal` changes after mount (never on the initial render). */
export function useRefreshSignal(signal: number, onRefresh: () => void): void {
    const seenRef = useRef(signal);
    const cbRef = useRef(onRefresh);
    cbRef.current = onRefresh;
    useEffect(() => {
        if (signal === seenRef.current) return;
        seenRef.current = signal;
        cbRef.current();
    }, [signal]);
}

/** Reports header status from a sub-view: newest fetchedAt among its payloads and a busy flag. */
export function useReportStatus(onStatus: (s: CrossplaneStatus) => void, fetchedAts: readonly (string | undefined)[], busy: boolean): void {
    const newest = fetchedAts.reduce<string | null>((acc, v) => (v && (!acc || v > acc) ? v : acc), null);
    useEffect(() => { onStatus({ fetchedAt: newest, busy }); }, [onStatus, newest, busy]);
}
