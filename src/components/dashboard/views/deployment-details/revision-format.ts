/** Small helpers for the revision timeline (kept out of component files for react-refresh). */
import type { RevisionEntry } from '../../../../utils/deployment-history-utils';

/** Per-revision facts precomputed by the container (keyed by `revisionKey`). */
export interface RevisionMeta {
    summary: { lines: string[]; more: number };   // summarizeChanges vs previous revision
    warningCount: number;                          // Warning events for this revision
}

/** Stable identity of a timeline entry. */
export const revisionKey = (e: RevisionEntry): string => e.replicaSetUid || e.replicaSetName;

/** Compact gap between two instants, e.g. "45s", "12m", "3h", "4d", "2mo", "1y". */
export function formatGap(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo`;
    return `${Math.floor(d / 365)}y`;
}

/** Spoken relative time for aria labels, e.g. "2 hours ago". */
export function relativeTimeText(iso: string, now: number = Date.now()): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return 'at an unknown time';
    const s = Math.max(0, Math.round((now - t) / 1000));
    const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
    if (s < 60) return unit(s, 'second');
    const m = Math.floor(s / 60);
    if (m < 60) return unit(m, 'minute');
    const h = Math.floor(m / 60);
    if (h < 24) return unit(h, 'hour');
    const d = Math.floor(h / 24);
    if (d < 30) return unit(d, 'day');
    const mo = Math.floor(d / 30);
    if (mo < 12) return unit(mo, 'month');
    return unit(Math.floor(d / 365), 'year');
}

/** Mirrors TimeAgo's 48h cutoff: true when TimeAgo would still render a relative label. */
export function isWithin48h(iso: string, now: number = Date.now()): boolean {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && now - t <= 172800 * 1000;
}

/** Absolute local time, or the raw string when unparsable. */
export function formatAbsolute(iso: string): string {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
}
