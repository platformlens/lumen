/**
 * Pure decision logic for useDeploymentFullDetails, extracted so it can be unit tested without React.
 */

export interface LiveRefreshState { lastLiveRv?: string; hadLive: boolean }

/**
 * Decides whether a change in the watcher's live resourceVersion should schedule a debounced refetch.
 * Triggers only on a change of the live rv (not a mismatch with the fetched rv), so a lagging watcher
 * can't cause a refetch loop. present -> absent debounces (possible delete or watcher re-seed).
 */
export function decideLiveRefresh(
    prev: LiveRefreshState, liveRv: string | undefined, fetchedRv: string | undefined,
): { action: 'none' | 'debounce'; next: LiveRefreshState } {
    if (liveRv === undefined) {
        if (prev.hadLive) return { action: 'debounce', next: { hadLive: false } };
        return { action: 'none', next: prev };
    }
    if (prev.lastLiveRv === undefined) return { action: 'none', next: { lastLiveRv: liveRv, hadLive: true } };
    if (liveRv === prev.lastLiveRv) return { action: 'none', next: { lastLiveRv: liveRv, hadLive: true } };
    const next = { lastLiveRv: liveRv, hadLive: true };
    if (liveRv === fetchedRv) return { action: 'none', next };
    return { action: 'debounce', next };
}

/** A response is applied to state only if it's the latest request, for the current key, on a mounted hook. */
export function shouldApplyResponse(
    req: { id: number; key: string },
    current: { id: number; key: string; mounted: boolean },
): boolean {
    return req.id === current.id && req.key === current.key && current.mounted;
}
