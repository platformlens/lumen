/**
 * Crossplane-related Warning events (design B.5 "Warning events" steps 3–6).
 * Pages `type=Warning` events cluster-wide (sequential, ≤10 pages of 500), keeps those whose
 * involvedObject API group is relevant, and returns the newest `limit`, de-duplicated by uid.
 */
import type { CrossplaneEvent, CrossplaneWarningEventsPayload } from '../src/types/crossplane';
import { apiGroupOf, asString, getPath } from '../src/utils/crossplane-guards';
import { sortAndDedupeEvents, toCrossplaneEvent } from '../src/utils/crossplane-utils';
import { toCrossplaneApiError } from './crossplane-api';
import type { CrossplaneApi } from './crossplane-api';

export const MAX_EVENT_PAGES = 10;

export async function fetchWarningEvents(
    api: Pick<CrossplaneApi, 'listWarningEventsPage'>,
    relevantGroups: ReadonlySet<string>,
    limit: number,
    now: number,
): Promise<CrossplaneWarningEventsPayload> {
    const kept: CrossplaneEvent[] = [];
    let scanned = 0;
    let truncatedScan = false;
    let token: string | undefined;
    let pages = 0;
    const fetchedAt = new Date(now).toISOString();
    do {
        try {
            const page = await api.listWarningEventsPage(token);
            pages++;
            scanned += page.items.length;
            for (const raw of page.items) {
                if (!relevantGroups.has(apiGroupOf(asString(getPath(raw, 'involvedObject', 'apiVersion')) ?? ''))) continue;
                const e = toCrossplaneEvent(raw);
                if (e) kept.push(e);
            }
            token = page.continueToken;
        } catch (e) {
            const err = toCrossplaneApiError(e);
            if (err.status === 403) {
                console.warn('[crossplane] Warning events forbidden');
                return { events: [], truncatedScan: false, scanned, fetchedAt, errors: [{ section: 'events', status: 403, message: err.message }] };
            }
            // Events churn fast: a 410 on a continue token stops paging instead of restarting.
            if (err.status === 410 && token !== undefined) {
                truncatedScan = true;
                break;
            }
            throw err;
        }
    } while (token && pages < MAX_EVENT_PAGES);
    if (token) truncatedScan = true;
    return { events: sortAndDedupeEvents(kept, limit), truncatedScan, scanned, fetchedAt, errors: [] };
}
