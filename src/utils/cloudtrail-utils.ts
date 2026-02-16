// Pure utility functions for CloudTrail event transformation, filtering, and time range computation.

export interface AuditEvent {
    eventId: string;
    eventTime: string;       // ISO 8601
    eventName: string;       // e.g. "CreateNodegroup", "AccessKubernetesApi"
    username: string;        // IAM user/role/service account
    sourceIpAddress: string;
    userAgent: string;
    readOnly: boolean;
    resources: Array<{ resourceType: string; resourceName: string }>;
    rawEvent: string;        // Full JSON event for detail view
}

export interface AccessLogsFilterState {
    identityText: string;
    identityType: 'all' | 'iam-user' | 'iam-role' | 'service-account';
    eventTypes: string[];
    timeRange: '1h' | '24h' | '7d' | 'custom';
    customStartDate?: Date;
    customEndDate?: Date;
}

export type IdentityType = 'iam-user' | 'iam-role' | 'service-account' | 'unknown';

/**
 * Parses a raw CloudTrail event JSON string into an AuditEvent.
 */
export function transformCloudTrailEvent(raw: string): AuditEvent {
    const parsed = JSON.parse(raw);

    const username =
        parsed.userIdentity?.userName ||
        parsed.userIdentity?.arn ||
        '';

    const resources = (parsed.resources ?? []).map((r: any) => ({
        resourceType: r.resourceType ?? r.ResourceType ?? '',
        resourceName: r.resourceName ?? r.ResourceName ?? '',
    }));

    return {
        eventId: parsed.eventID ?? '',
        eventTime: parsed.eventTime ?? '',
        eventName: parsed.eventName ?? '',
        username,
        sourceIpAddress: parsed.sourceIPAddress ?? '',
        userAgent: parsed.userAgent ?? '',
        readOnly: parsed.readOnly ?? false,
        resources,
        rawEvent: raw,
    };
}

/**
 * Classifies a username into an identity type based on pattern matching.
 * - IAM Role: contains "assumed-role/" or ":role/"
 * - Service Account: contains "system:serviceaccount:"
 * - IAM User: plain username (no role/SA pattern)
 * - Unknown: empty or unrecognized
 */
export function classifyIdentityType(username: string): IdentityType {
    if (!username) return 'unknown';
    if (username.includes('assumed-role/') || username.includes(':role/')) return 'iam-role';
    if (username.includes('system:serviceaccount:')) return 'service-account';
    // Plain username with no role/SA markers → IAM user
    if (username.length > 0) return 'iam-user';
    return 'unknown';
}

/**
 * Filters events by identity text (case-insensitive contains) AND identity type.
 * Both conditions must be satisfied.
 */
export function filterByIdentity(
    events: AuditEvent[],
    text: string,
    type: 'all' | IdentityType,
): AuditEvent[] {
    return events.filter((e) => {
        if (text && !e.username.toLowerCase().includes(text.toLowerCase())) return false;
        if (type !== 'all' && classifyIdentityType(e.username) !== type) return false;
        return true;
    });
}

/**
 * Filters events by event name set.
 * If selectedTypes is empty, returns all events (no filter applied).
 */
export function filterByEventType(events: AuditEvent[], selectedTypes: string[]): AuditEvent[] {
    if (selectedTypes.length === 0) return events;
    const typeSet = new Set(selectedTypes);
    return events.filter((e) => typeSet.has(e.eventName));
}

/**
 * Computes a time range from a preset value.
 * Returns { startTime, endTime } where endTime = now and startTime = now - duration.
 */
export function computeTimeRange(
    preset: '1h' | '24h' | '7d',
    now: Date = new Date(),
): { startTime: Date; endTime: Date } {
    const endTime = new Date(now.getTime());
    let startTime: Date;

    switch (preset) {
        case '1h':
            startTime = new Date(now.getTime() - 60 * 60 * 1000);
            break;
        case '24h':
            startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
        case '7d':
            startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
    }

    return { startTime, endTime };
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Returns true if the date range exceeds 90 days.
 */
export function isDateRangeExceeding90Days(start: Date, end: Date): boolean {
    return Math.abs(end.getTime() - start.getTime()) > NINETY_DAYS_MS;
}

/**
 * Sorts AuditEvent[] by a given column key and direction.
 */
export function sortEvents(
    events: AuditEvent[],
    sortKey: keyof AuditEvent,
    direction: 'asc' | 'desc',
): AuditEvent[] {
    const sorted = [...events].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];

        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return aVal.localeCompare(bVal);
        }
        if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
            return aVal === bVal ? 0 : aVal ? 1 : -1;
        }
        return String(aVal).localeCompare(String(bVal));
    });

    return direction === 'desc' ? sorted.reverse() : sorted;
}
