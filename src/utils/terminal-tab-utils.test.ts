import { describe, it, expect } from 'vitest';
import type { PanelTab } from '../components/features/logs/LogViewer';
import { createLocalTerminalTab, findReusableLocalTerminal } from './terminal-tab-utils';

describe('createLocalTerminalTab', () => {
    it('binds the tab to the given context', () => {
        expect(createLocalTerminalTab(2, 'prod')).toEqual({
            id: 'local-terminal-2',
            type: 'terminal',
            title: 'Terminal 2',
            subtitle: 'prod',
            clusterContext: 'prod',
        });
    });

    it('uses the default context label when no cluster is selected', () => {
        const tab = createLocalTerminalTab(1, null);
        expect(tab.subtitle).toBe('default context');
        expect(tab.clusterContext).toBeUndefined();
    });
});

describe('findReusableLocalTerminal', () => {
    const exec: PanelTab = { id: 'exec-ns-pod-c', type: 'terminal', title: 'pod', clusterContext: 'prod' };
    const drain: PanelTab = { id: 'cordon-drain-n1', type: 'terminal', title: 'Drain', clusterContext: 'prod' };
    const log: PanelTab = { id: 'ns-pod', type: 'log', title: 'pod', clusterContext: 'prod' };
    const t1 = createLocalTerminalTab(1, 'prod');
    const t2 = createLocalTerminalTab(2, 'staging');
    const t3 = createLocalTerminalTab(3, 'prod');
    const t4 = createLocalTerminalTab(4, null);

    it('picks the most recent same-context local terminal', () => {
        expect(findReusableLocalTerminal([t1, t2, t3, exec, drain, log], 'prod')).toBe(t3);
    });

    it('ignores exec, drain, log and other-context tabs', () => {
        expect(findReusableLocalTerminal([exec, drain, log, t2], 'prod')).toBeUndefined();
    });

    it('matches unbound terminals when no cluster is selected', () => {
        expect(findReusableLocalTerminal([t1, t4], null)).toBe(t4);
        expect(findReusableLocalTerminal([t1, t2], null)).toBeUndefined();
    });
});
