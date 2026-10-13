import type { PanelTab } from '../components/features/logs/LogViewer';

export const LOCAL_TERMINAL_PREFIX = 'local-terminal-';

/**
 * Creates a local terminal tab bound to `context` (the kube context selected when
 * it was opened). `null` means no cluster selected: the shell uses the user's
 * default kubeconfig current-context.
 */
export function createLocalTerminalTab(n: number, context: string | null): PanelTab {
    return {
        id: `${LOCAL_TERMINAL_PREFIX}${n}`,
        type: 'terminal',
        title: `Terminal ${n}`,
        subtitle: context ?? 'default context',
        clusterContext: context ?? undefined,
    };
}

/**
 * Returns the most recently opened local terminal bound to `context`, ignoring
 * exec and cordon/drain terminals and terminals bound to other contexts.
 */
export function findReusableLocalTerminal(tabs: PanelTab[], context: string | null): PanelTab | undefined {
    const wanted = context ?? undefined;
    for (let i = tabs.length - 1; i >= 0; i--) {
        const tab = tabs[i];
        if (tab.type === 'terminal' && tab.id.startsWith(LOCAL_TERMINAL_PREFIX) && tab.clusterContext === wanted) {
            return tab;
        }
    }
    return undefined;
}
