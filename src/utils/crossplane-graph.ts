/**
 * CrossplaneTree → React Flow nodes/edges (design B.7 renderer layout). Pure, deterministic, no dagre/elk.
 * Left-to-right tidy tree: x = depth × 260, leaves take consecutive 84 px slots in DFS order,
 * a parent sits at the midpoint of its first and last child, failures sort first.
 */
import type { Edge, Node } from '@xyflow/react';
import { HEALTH_ORDER } from '../types/crossplane';
import type {
    ConditionStatus, CrossplaneHealth, CrossplaneObjectRef, CrossplaneTree, CrossplaneTreeNode, CrossplaneTreeNodeState,
} from '../types/crossplane';

export const GRAPH_COLUMN_WIDTH = 260;
export const GRAPH_ROW_HEIGHT = 84;
export const GRAPH_MAX_CHILDREN = 50;

export const HEALTH_EDGE_COLORS: Record<CrossplaneHealth, string> = {
    unhealthy: '#ef4444', progressing: '#f59e0b', healthy: '#22c55e',
    paused: '#6b7280', unknown: '#6b7280', none: '#6b7280',
};

export type CrossplaneFlowNodeData = {
    key: string;
    ref?: CrossplaneObjectRef;
    kind: string;
    name: string;
    namespace?: string;
    health: CrossplaneHealth;
    synced?: ConditionStatus;
    ready?: ConditionStatus;
    healthMessage?: string;
    state: CrossplaneTreeNodeState | 'summary';
    focus: boolean;
    /** false for summary and notFetched nodes */
    clickable: boolean;
    hiddenCount?: number;
    hiddenUnhealthy?: number;
};

export type CrossplaneFlowNode = Node<CrossplaneFlowNodeData, 'crossplane'>;
export type CrossplaneFlowEdge = Edge;

export interface BuildFlowOptions { maxChildren?: number; }

function compareNodes(a: CrossplaneTreeNode, b: CrossplaneTreeNode): number {
    const h = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    if (h !== 0) return h;
    const k = a.ref.kind.localeCompare(b.ref.kind);
    return k !== 0 ? k : a.ref.name.localeCompare(b.ref.name);
}

export function buildCrossplaneFlow(tree: CrossplaneTree, opts: BuildFlowOptions = {}): { nodes: CrossplaneFlowNode[]; edges: CrossplaneFlowEdge[] } {
    const maxChildren = opts.maxChildren ?? GRAPH_MAX_CHILDREN;
    const byKey = new Map(tree.nodes.map(n => [n.key, n]));
    const children = new Map<string, CrossplaneTreeNode[]>();
    for (const n of tree.nodes) {
        if (n.parentKey === null || !byKey.has(n.parentKey)) continue;
        const list = children.get(n.parentKey) ?? [];
        list.push(n);
        children.set(n.parentKey, list);
    }
    for (const list of children.values()) list.sort(compareNodes);

    const nodes: CrossplaneFlowNode[] = [];
    const edges: CrossplaneFlowEdge[] = [];
    const visited = new Set<string>();
    let slot = 0;

    const pushEdge = (source: string, target: string, health: CrossplaneHealth) => {
        edges.push({
            id: `${source}->${target}`, source, target, type: 'smoothstep',
            animated: health === 'progressing', style: { stroke: HEALTH_EDGE_COLORS[health] },
        });
    };

    const place = (n: CrossplaneTreeNode, depth: number): number => {
        visited.add(n.key);
        const kids = (children.get(n.key) ?? []).filter(c => !visited.has(c.key));
        const shown = kids.slice(0, maxChildren);
        const hidden = kids.slice(maxChildren);
        const ys: number[] = [];
        for (const c of shown) {
            ys.push(place(c, depth + 1));
            pushEdge(n.key, c.key, c.health);
        }
        if (hidden.length > 0) {
            const id = `${n.key}::more`;
            const hiddenUnhealthy = hidden.filter(c => c.health === 'unhealthy').length;
            const y = slot++ * GRAPH_ROW_HEIGHT;
            ys.push(y);
            nodes.push({
                id, type: 'crossplane', position: { x: (depth + 1) * GRAPH_COLUMN_WIDTH, y },
                data: {
                    key: id, kind: '', name: `+${hidden.length} more (${hiddenUnhealthy} unhealthy)`,
                    health: hiddenUnhealthy > 0 ? 'unhealthy' : 'none', state: 'summary', focus: false, clickable: false,
                    hiddenCount: hidden.length, hiddenUnhealthy,
                },
            });
            pushEdge(n.key, id, hiddenUnhealthy > 0 ? 'unhealthy' : 'none');
        }
        const y = ys.length > 0 ? (ys[0] + ys[ys.length - 1]) / 2 : slot++ * GRAPH_ROW_HEIGHT;
        const data: CrossplaneFlowNodeData = {
            key: n.key, ref: n.ref, kind: n.ref.kind, name: n.ref.name, health: n.health, state: n.state,
            focus: n.key === tree.focusKey, clickable: n.state !== 'notFetched',
        };
        if (n.ref.namespace) data.namespace = n.ref.namespace;
        if (n.synced) data.synced = n.synced;
        if (n.ready) data.ready = n.ready;
        if (n.healthMessage) data.healthMessage = n.healthMessage;
        nodes.push({ id: n.key, type: 'crossplane', position: { x: depth * GRAPH_COLUMN_WIDTH, y }, data });
        return y;
    };

    const root = byKey.get(tree.rootKey);
    if (root) place(root, 0);
    // Orphans (parent missing from the payload) are laid out as extra roots, in stable order.
    for (const n of [...tree.nodes].sort(compareNodes)) {
        if (!visited.has(n.key) && (n.parentKey === null || !byKey.has(n.parentKey))) place(n, 0);
    }
    return { nodes, edges };
}
