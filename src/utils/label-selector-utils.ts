/**
 * Kubernetes label selector helpers. Pure: imported by both the main process and the renderer.
 */
import type { LabelSelector } from '../types/deployment-details';

function isEmptySelector(sel: LabelSelector): boolean {
    return Object.keys(sel.matchLabels ?? {}).length === 0 && (sel.matchExpressions ?? []).length === 0;
}

/**
 * Converts a selector to the `labelSelector` query string format.
 * Returns null for a nil or empty selector (callers must not list unfiltered).
 */
export function selectorToQueryString(sel: LabelSelector | null | undefined): string | null {
    if (!sel || isEmptySelector(sel)) return null;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(sel.matchLabels ?? {})) parts.push(`${k}=${v}`);
    for (const expr of sel.matchExpressions ?? []) {
        const values = (expr.values ?? []).join(',');
        switch (expr.operator) {
            case 'In': parts.push(`${expr.key} in (${values})`); break;
            case 'NotIn': parts.push(`${expr.key} notin (${values})`); break;
            case 'Exists': parts.push(expr.key); break;
            case 'DoesNotExist': parts.push(`!${expr.key}`); break;
            default: break;
        }
    }
    return parts.length > 0 ? parts.join(',') : null;
}

/**
 * Evaluates a LabelSelector against a label set.
 * nil -> false; {} -> opts.emptyMatchesAll; otherwise all matchLabels AND all matchExpressions must hold.
 */
export function matchesLabelSelector(
    sel: LabelSelector | null | undefined,
    labels: Record<string, string> | undefined,
    opts: { emptyMatchesAll: boolean },
): boolean {
    if (!sel) return false;
    if (isEmptySelector(sel)) return opts.emptyMatchesAll;
    const l = labels ?? {};
    for (const [k, v] of Object.entries(sel.matchLabels ?? {})) {
        if (l[k] !== v) return false;
    }
    for (const expr of sel.matchExpressions ?? []) {
        const has = Object.prototype.hasOwnProperty.call(l, expr.key);
        const values = expr.values ?? [];
        switch (expr.operator) {
            case 'In': if (!has || !values.includes(l[expr.key])) return false; break;
            case 'NotIn': if (has && values.includes(l[expr.key])) return false; break;
            case 'Exists': if (!has) return false; break;
            case 'DoesNotExist': if (has) return false; break;
            default: return false; // unknown operator never matches
        }
    }
    return true;
}

/** Service selectors: a selectorless service (nil or {}) matches nothing; otherwise every k=v must be present. */
export function matchesServiceSelector(
    sel: Record<string, string> | null | undefined,
    labels: Record<string, string> | undefined,
): boolean {
    if (!sel) return false;
    const entries = Object.entries(sel);
    if (entries.length === 0) return false;
    const l = labels ?? {};
    return entries.every(([k, v]) => l[k] === v);
}
