// Pure utility functions for Kubernetes audit log parsing, filtering, and sorting.

export interface AuditLogEntry {
    id: string;           // Generated: `${requestReceivedTimestamp}-${verb}-${resource}-${resourceName}`
    timestamp: string;    // ISO 8601 from requestReceivedTimestamp, fallback stageTimestamp
    verb: string;         // create, update, patch, delete, get, list, watch, deletecollection
    username: string;     // From user.username
    groups: string[];     // From user.groups
    namespace: string;    // From objectRef.namespace, defaults to "cluster-scoped"
    resource: string;     // From objectRef.resource
    resourceName: string; // From objectRef.name
    statusCode: number;   // From responseStatus.code
    sourceIP: string;     // From sourceIPs[0]
    userAgent: string;    // From userAgent
    rawEvent: string;     // Full JSON string
}

export interface AuditLogsFilterState {
    namespaceText: string;
    usernameText: string;
    verbs: string[];
    timeRange: '1h' | '24h' | '7d' | 'custom';
    customStartDate?: Date;
    customEndDate?: Date;
}

export const KUBERNETES_VERBS = [
    'create', 'update', 'patch', 'delete',
    'get', 'list', 'watch', 'deletecollection',
] as const;

/**
 * Parses a raw Kubernetes audit log JSON string into an AuditLogEntry.
 * Returns null for malformed JSON.
 */
export function parseAuditLogEvent(rawJson: string): AuditLogEntry | null {
    try {
        const parsed = JSON.parse(rawJson);

        const timestamp = parsed.requestReceivedTimestamp ?? parsed.stageTimestamp ?? '';
        const verb = parsed.verb ?? '';
        const username = parsed.user?.username ?? '';
        const groups: string[] = parsed.user?.groups ?? [];
        const namespace = parsed.objectRef?.namespace ?? 'cluster-scoped';
        const resource = parsed.objectRef?.resource ?? '';
        const resourceName = parsed.objectRef?.name ?? '';
        const statusCode = parsed.responseStatus?.code ?? 0;
        const sourceIP = parsed.sourceIPs?.[0] ?? '';
        const userAgent = parsed.userAgent ?? '';

        const id = `${timestamp}-${verb}-${resource}-${resourceName}`;

        return {
            id,
            timestamp,
            verb,
            username,
            groups,
            namespace,
            resource,
            resourceName,
            statusCode,
            sourceIP,
            userAgent,
            rawEvent: rawJson,
        };
    } catch {
        return null;
    }
}

/**
 * Filters audit log entries by namespace text (case-insensitive substring match).
 * Returns all entries when text is empty.
 */
export function filterByNamespace(entries: AuditLogEntry[], text: string): AuditLogEntry[] {
    if (!text) return entries;
    const lower = text.toLowerCase();
    return entries.filter((e) => e.namespace.toLowerCase().includes(lower));
}

/**
 * Filters audit log entries by username text (case-insensitive substring match).
 * Returns all entries when text is empty.
 */
export function filterByUsername(entries: AuditLogEntry[], text: string): AuditLogEntry[] {
    if (!text) return entries;
    const lower = text.toLowerCase();
    return entries.filter((e) => e.username.toLowerCase().includes(lower));
}

/**
 * Filters audit log entries by verb set.
 * Returns all entries when selectedVerbs is empty.
 */
export function filterByVerbs(entries: AuditLogEntry[], selectedVerbs: string[]): AuditLogEntry[] {
    if (selectedVerbs.length === 0) return entries;
    const verbSet = new Set(selectedVerbs);
    return entries.filter((e) => verbSet.has(e.verb));
}

/**
 * Sorts AuditLogEntry[] by a given column key and direction.
 */
export function sortAuditEntries(
    entries: AuditLogEntry[],
    key: keyof AuditLogEntry,
    direction: 'asc' | 'desc',
): AuditLogEntry[] {
    const sorted = [...entries].sort((a, b) => {
        const aVal = a[key];
        const bVal = b[key];

        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return aVal - bVal;
        }
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return aVal.localeCompare(bVal);
        }
        return String(aVal).localeCompare(String(bVal));
    });

    return direction === 'desc' ? sorted.reverse() : sorted;
}

/**
 * Constructs the CloudWatch log group path for an EKS cluster.
 */
export function buildLogGroupPath(clusterName: string): string {
    return `/aws/eks/${clusterName}/cluster`;
}
