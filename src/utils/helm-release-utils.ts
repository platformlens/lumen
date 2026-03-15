/**
 * Pure utility for applying Helm release batch events with latest-revision deduplication.
 *
 * Key: `${namespace}/${name}` (release name, not secret name)
 * - ADDED/MODIFIED: update only if new revision >= existing revision
 * - DELETED: remove only if deleted revision equals stored revision
 */

export interface HelmRelease {
    name: string;
    namespace: string;
    revision: number;
    status: string;
    chart: string;
    chartVersion: string;
    appVersion: string;
    lastUpdated: string;
    description: string;
    secretName?: string;
}

export interface HelmReleaseEvent {
    type: string;
    resource: HelmRelease;
}

/**
 * Applies a batch of Helm release events to the current state map,
 * returning a new Map with latest-revision deduplication applied.
 */
export function applyHelmReleaseEvents(
    currentMap: Map<string, HelmRelease>,
    events: HelmReleaseEvent[]
): Map<string, HelmRelease> {
    const newMap = new Map(currentMap);

    for (const { type, resource } of events) {
        const key = `${resource.namespace}/${resource.name}`;
        const existing = newMap.get(key);

        if (type === 'ADDED' || type === 'MODIFIED') {
            // Only update if new revision >= existing revision
            if (!existing || resource.revision >= existing.revision) {
                newMap.set(key, resource);
            }
        } else if (type === 'DELETED') {
            // Remove only if the deleted revision equals the stored revision
            if (existing && existing.revision === resource.revision) {
                newMap.delete(key);
            }
        }
    }

    return newMap;
}
