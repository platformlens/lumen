import type { PanelTab } from '../components/features/logs/LogViewer';

/**
 * Moves the entry stored under `oldKey` to `newKey`. Returns true when something moved.
 * Does nothing (and merges nothing) when `oldKey` is missing or `newKey` already exists.
 */
export function renameMapKey<T>(map: Map<string, T>, oldKey: string, newKey: string): boolean {
    if (oldKey === newKey || !map.has(oldKey) || map.has(newKey)) return false;
    map.set(newKey, map.get(oldKey) as T);
    map.delete(oldKey);
    return true;
}

/** Points a panel tab's kube context references (shell/YAML target and exec target) at the new name. */
export function remapPanelTab(tab: PanelTab, oldName: string, newName: string): PanelTab {
    const retargetCluster = tab.clusterContext === oldName;
    const retargetExec = tab.execContext?.context === oldName;
    if (!retargetCluster && !retargetExec) return tab;
    // Terminal tabs show the context name as their subtitle ("<ctx>" or "cordon & drain · <ctx>")
    let subtitle = tab.subtitle;
    if (retargetCluster && subtitle) {
        if (subtitle === oldName) subtitle = newName;
        else if (subtitle.endsWith(` · ${oldName}`)) subtitle = `${subtitle.slice(0, -oldName.length)}${newName}`;
    }
    return {
        ...tab,
        ...(subtitle !== tab.subtitle ? { subtitle } : {}),
        ...(retargetCluster ? { clusterContext: newName } : {}),
        ...(retargetExec && tab.execContext ? { execContext: { ...tab.execContext, context: newName } } : {}),
    };
}

/** Replaces `oldName` with `newName` in place, dropping duplicates (keeps the first occurrence). */
export function replaceInList(list: string[], oldName: string, newName: string): string[] {
    return [...new Set(list.map(item => (item === oldName ? newName : item)))];
}
