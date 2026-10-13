/**
 * Pure helpers for binding a local terminal session to a kube context
 * without mutating the user's global kubeconfig.
 *
 * A per-terminal "override" kubeconfig containing only `current-context` is
 * prepended to KUBECONFIG. kubectl takes `current-context` from the first file
 * in the chain that sets it, so the shell targets the bound context while the
 * user's ~/.kube/config stays untouched.
 *
 * No node-pty / electron imports so this module is unit-testable.
 */
import * as path from 'path';
import * as yaml from 'js-yaml';

const MAX_CONTEXT_LENGTH = 512;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** Returns true when `ctx` is a non-empty, bounded string with no control characters. */
export function isValidTerminalContext(ctx: unknown): ctx is string {
    return typeof ctx === 'string'
        && ctx.length > 0
        && ctx.length <= MAX_CONTEXT_LENGTH
        && !CONTROL_CHARS.test(ctx);
}

/** Builds the contents of an override kubeconfig that only sets `current-context`. */
export function buildContextKubeconfig(context: string): string {
    return yaml.dump({
        apiVersion: 'v1',
        kind: 'Config',
        preferences: {},
        'current-context': context,
    });
}

/**
 * Builds the KUBECONFIG value for a terminal: the override file first, followed by
 * the user's existing KUBECONFIG chain (or the default ~/.kube/config when unset).
 */
export function buildKubeconfigEnv(
    overrideFile: string,
    existing: string | undefined,
    homedir: string,
    delimiter: string,
): string {
    const base = existing
        ? existing.split(delimiter).filter(Boolean)
        : [path.join(homedir, '.kube', 'config')];
    return [overrideFile, ...base].join(delimiter);
}
