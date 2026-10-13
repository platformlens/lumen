/**
 * Helpers for tracking unsaved YAML editor drafts per tab.
 */

/**
 * Builds a cluster-scoped id for a YAML resource tab so the same-named resource
 * on two clusters gets two independent tabs (and two independent drafts).
 */
export function buildYamlTabId(cluster: string, kind: string, namespace: string | undefined, name: string): string {
    return `yaml-${cluster}-${kind}-${namespace || 'global'}-${name}`;
}

/**
 * Returns the draft to persist for a tab, or `undefined` when the editor value
 * matches what is displayed from the server (i.e. there are no unsaved edits).
 */
export function computeDraft(editorValue: string, displayedBase: string): string | undefined {
    return editorValue === displayedBase ? undefined : editorValue;
}
