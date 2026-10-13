/**
 * Helpers for hiding sensitive-looking values (env literals, large annotations).
 * Pure and environment-agnostic: imported by both the main process and the renderer.
 */
import type { PodTemplate } from '../types/deployment-details';

export const MASK = '••••••••';
export const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration';
export const HIDDEN_ANNOTATIONS: readonly string[] = [LAST_APPLIED];

const SENSITIVE_NAME_RE = /(PASS(WORD)?|PASSWD|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH|DSN|CONN(ECTION)?_?STR)/i;
const SENSITIVE_VALUE_RE = /^(eyJ|AKIA|ASIA|sk-|ghp_|gho_|github_pat_|xox[bpas]-|Bearer\s)/i;
/** "scheme://user:pass@host" style credentials embedded in a URL. */
const URL_CREDENTIALS_RE = /:\/\/[^/\s:@]+:[^/\s@]+@/;

/** True when an env var's name or literal value looks like it carries a credential. */
export function isSensitiveEnv(name: string, value: string): boolean {
    if (SENSITIVE_NAME_RE.test(name)) return true;
    if (!value) return false;
    return SENSITIVE_VALUE_RE.test(value) || URL_CREDENTIALS_RE.test(value);
}

/** Structural deep clone that preserves Date instances (keeps YAML output identical to the input's). */
function deepClone<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
    if (Array.isArray(value)) return value.map(v => deepClone(v)) as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepClone(v);
    return out as T;
}

interface EnvLike { name?: string; value?: string; valueFrom?: unknown }
interface ContainerLike { env?: EnvLike[] }

function maskContainers(containers: ContainerLike[] | undefined): void {
    if (!Array.isArray(containers)) return;
    for (const c of containers) {
        if (!Array.isArray(c?.env)) continue;
        for (const e of c.env) {
            if (typeof e?.value === 'string' && isSensitiveEnv(e.name ?? '', e.value)) e.value = MASK;
        }
    }
}

/** Deep-clones the template and masks sensitive literal env values. The input is never mutated. */
export function maskTemplateEnv(template: PodTemplate): PodTemplate {
    const clone = deepClone(template);
    const spec = clone?.spec as { containers?: ContainerLike[]; initContainers?: ContainerLike[] } | undefined;
    if (spec) {
        maskContainers(spec.containers);
        maskContainers(spec.initContainers);
    }
    return clone;
}

function byteLength(v: string): number {
    return new TextEncoder().encode(v).length;
}

function hiddenPlaceholder(bytes: number): string {
    return `(${bytes} bytes, hidden; use Edit YAML)`;
}

/**
 * Annotations prepared for display. Keys in HIDDEN_ANNOTATIONS show a byte-count placeholder.
 * `strippedBytes` covers keys main already removed (absent from `annotations`). Sorted by key, one entry per key.
 */
export function displayAnnotations(
    annotations: Record<string, string> | undefined,
    opts?: { strippedBytes?: Record<string, number> },
): { key: string; value: string; hidden: boolean }[] {
    const entries = new Map<string, { key: string; value: string; hidden: boolean }>();
    for (const [key, value] of Object.entries(annotations ?? {})) {
        if (HIDDEN_ANNOTATIONS.includes(key)) {
            entries.set(key, { key, value: hiddenPlaceholder(byteLength(String(value ?? ''))), hidden: true });
        } else {
            entries.set(key, { key, value: String(value ?? ''), hidden: false });
        }
    }
    for (const [key, bytes] of Object.entries(opts?.strippedBytes ?? {})) {
        if (entries.has(key)) continue; // present value wins
        entries.set(key, { key, value: hiddenPlaceholder(bytes), hidden: true });
    }
    return [...entries.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
