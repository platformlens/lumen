/** Pure parts of useCrossplaneQuery (design B.11), extracted so they can be unit-tested without a DOM. */

export const MIN_REFRESH_MS = 15_000;
export const DEFAULT_REFRESH_SECONDS = 30;

/** max(settings interval, 15 s, per-query minimum). Invalid settings fall back to 30 s. */
export function resolveIntervalMs(settingsSeconds: number | null | undefined, minIntervalMs?: number): number {
    const secs = typeof settingsSeconds === 'number' && Number.isFinite(settingsSeconds) && settingsSeconds > 0
        ? settingsSeconds : DEFAULT_REFRESH_SECONDS;
    return Math.max(secs * 1000, MIN_REFRESH_MS, minIntervalMs ?? 0);
}

/** On becoming visible, fetch when nothing was fetched yet or at least one interval has passed. */
export function shouldFetchOnVisible(lastFetchedAt: number | null | undefined, now: number, intervalMs: number): boolean {
    return lastFetchedAt == null || now - lastFetchedAt >= intervalMs;
}
