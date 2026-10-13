/** Type guards and accessors for untyped Kubernetes objects (Crossplane view). Pure, no Node/Electron imports. */

export type UnknownRecord = Record<string, unknown>;

export function asRecord(v: unknown): UnknownRecord | undefined {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as UnknownRecord : undefined;
}
export function asString(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}
export function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
}
export function asNumber(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
/** Read a nested path such as get(obj, 'spec', 'crossplane', 'resourceRefs'). */
export function getPath(obj: unknown, ...path: string[]): unknown {
    let cur: unknown = obj;
    for (const p of path) {
        const r = asRecord(cur);
        if (!r) return undefined;
        cur = r[p];
    }
    return cur;
}
function asStringMap(v: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    const r = asRecord(v);
    if (r) for (const [k, val] of Object.entries(r)) if (typeof val === 'string') out[k] = val;
    return out;
}
export function getLabels(obj: unknown): Record<string, string> { return asStringMap(getPath(obj, 'metadata', 'labels')); }
export function getAnnotations(obj: unknown): Record<string, string> { return asStringMap(getPath(obj, 'metadata', 'annotations')); }
/** Group part of an apiVersion: text before '/', or '' for core. */
export function apiGroupOf(apiVersion: string): string {
    const i = apiVersion.indexOf('/');
    return i === -1 ? '' : apiVersion.slice(0, i);
}
