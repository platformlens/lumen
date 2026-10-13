import { describe, it, expect } from 'vitest';
import type { CrossplaneHealth, CrossplaneTree, CrossplaneTreeNode, CrossplaneTreeNodeState } from '../types/crossplane';
import { buildCrossplaneFlow, GRAPH_COLUMN_WIDTH, GRAPH_ROW_HEIGHT, HEALTH_EDGE_COLORS } from './crossplane-graph';

const node = (key: string, parentKey: string | null, depth: number, health: CrossplaneHealth = 'healthy',
    kind = 'Instance', state: CrossplaneTreeNodeState = 'ok'): CrossplaneTreeNode => ({
    key, parentKey, depth, health, state, ref: { apiVersion: 'a.io/v1', kind, name: key },
});
const tree = (nodes: CrossplaneTreeNode[], focusKey = 'root'): CrossplaneTree => ({ rootKey: 'root', focusKey, nodes, truncated: false, warnings: [] });

describe('buildCrossplaneFlow', () => {
    const t = tree([
        node('root', null, 0, 'unhealthy', 'Database'),
        node('xr', 'root', 1, 'unhealthy', 'XDatabase'),
        node('b-ok', 'xr', 2, 'healthy'),
        node('a-bad', 'xr', 2, 'unhealthy'),
        node('c-prog', 'xr', 2, 'progressing'),
        node('secret', 'xr', 2, 'none', 'Secret', 'notFetched'),
    ], 'xr');

    it('lays out deterministically left to right with unhealthy-first children', () => {
        const a = buildCrossplaneFlow(t);
        expect(buildCrossplaneFlow(t)).toEqual(a);
        const pos = Object.fromEntries(a.nodes.map(n => [n.id, n.position]));
        expect(pos['a-bad']).toEqual({ x: 2 * GRAPH_COLUMN_WIDTH, y: 0 });
        expect(pos['c-prog']).toEqual({ x: 2 * GRAPH_COLUMN_WIDTH, y: GRAPH_ROW_HEIGHT });
        expect(pos['b-ok']).toEqual({ x: 2 * GRAPH_COLUMN_WIDTH, y: 2 * GRAPH_ROW_HEIGHT });
        expect(pos.secret).toEqual({ x: 2 * GRAPH_COLUMN_WIDTH, y: 3 * GRAPH_ROW_HEIGHT });
        expect(pos.xr).toEqual({ x: GRAPH_COLUMN_WIDTH, y: 1.5 * GRAPH_ROW_HEIGHT });
        expect(pos.root).toEqual({ x: 0, y: 1.5 * GRAPH_ROW_HEIGHT });
    });
    it('marks focus, clickable, and colours/animates edges by child health', () => {
        const { nodes, edges } = buildCrossplaneFlow(t);
        const data = Object.fromEntries(nodes.map(n => [n.id, n.data]));
        expect(data.xr.focus).toBe(true);
        expect(data.root.focus).toBe(false);
        expect(data.secret.clickable).toBe(false);
        expect(data['a-bad'].clickable).toBe(true);
        const e = Object.fromEntries(edges.map(x => [x.target, x]));
        expect(e['a-bad'].style?.stroke).toBe(HEALTH_EDGE_COLORS.unhealthy);
        expect(e['c-prog'].style?.stroke).toBe('#f59e0b');
        expect(e['c-prog'].animated).toBe(true);
        expect(e['b-ok'].style?.stroke).toBe('#22c55e');
        expect(e['b-ok'].animated).toBe(false);
        expect(e.secret.style?.stroke).toBe('#6b7280');
        expect(e.xr.type).toBe('smoothstep');
        expect(edges).toHaveLength(5);
    });
    it('collapses more than 50 children into a summary node with a correct count', () => {
        const kids = Array.from({ length: 60 }, (_, i) => node(`k${String(i).padStart(2, '0')}`, 'root', 1, i % 10 === 0 ? 'unhealthy' : 'healthy'));
        const { nodes, edges } = buildCrossplaneFlow(tree([node('root', null, 0), ...kids]));
        const summary = nodes.find(n => n.data.state === 'summary');
        expect(nodes).toHaveLength(1 + 50 + 1);
        // 6 unhealthy sort first, so all hidden children are healthy
        expect(summary?.data).toMatchObject({ name: '+10 more (0 unhealthy)', clickable: false, hiddenCount: 10, hiddenUnhealthy: 0 });
        expect(summary?.position).toEqual({ x: GRAPH_COLUMN_WIDTH, y: 50 * GRAPH_ROW_HEIGHT });
        expect(edges).toHaveLength(51);
        const small = buildCrossplaneFlow(tree([node('root', null, 0), ...kids.slice(0, 4)]), { maxChildren: 2 });
        expect(small.nodes.find(n => n.data.state === 'summary')?.data.name).toBe('+2 more (0 unhealthy)');
    });
    it('handles orphans, missing root and cycles without looping', () => {
        const out = buildCrossplaneFlow({ rootKey: 'gone', focusKey: 'x', truncated: false, warnings: [], nodes: [node('orphan', 'nowhere', 1), node('child', 'orphan', 2)] });
        expect(out.nodes.map(n => n.id).sort()).toEqual(['child', 'orphan']);
        const cyc = buildCrossplaneFlow(tree([node('root', null, 0), node('a', 'b', 1), node('b', 'a', 2)]));
        expect(cyc.nodes.map(n => n.id)).toEqual(['root']);
    });
});
