import React, { useCallback, useMemo, useRef, useState } from 'react';
import { HEALTH_ORDER } from '../../../types/crossplane';
import type { CrossplaneObjectRef, CrossplaneTree, CrossplaneTreeNode } from '../../../types/crossplane';
import { isValidCrossplaneRef, toCrossplaneRef } from '../../../utils/crossplane-utils';
import { CrossplaneConditionPill, CrossplaneHealthBadge } from '../../dashboard/views/crossplane/CrossplaneHealthBadge';

interface CrossplaneTreeListProps {
    tree: CrossplaneTree;
    onOpenResource: (ref: CrossplaneObjectRef) => void;
}

interface ListItem { node: CrossplaneTreeNode; level: number; hasChildren: boolean; setSize: number; posInSet: number; }

const STATE_TEXT: Partial<Record<CrossplaneTreeNode['state'], string>> = {
    missing: 'Missing', forbidden: 'Forbidden', error: 'Error', notFetched: 'Not fetched',
};

function compareNodes(a: CrossplaneTreeNode, b: CrossplaneTreeNode): number {
    const h = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    if (h !== 0) return h;
    const k = a.ref.kind.localeCompare(b.ref.kind);
    return k !== 0 ? k : a.ref.name.localeCompare(b.ref.name);
}

/** DFS order from the root (failures first among siblings), then any orphans. Cycle-safe. */
function flatten(tree: CrossplaneTree): ListItem[] {
    const byKey = new Map(tree.nodes.map(n => [n.key, n]));
    const children = new Map<string, CrossplaneTreeNode[]>();
    for (const n of tree.nodes) {
        if (n.parentKey === null || !byKey.has(n.parentKey)) continue;
        const list = children.get(n.parentKey) ?? [];
        list.push(n);
        children.set(n.parentKey, list);
    }
    for (const list of children.values()) list.sort(compareNodes);
    const out: ListItem[] = [];
    const seen = new Set<string>();
    const visit = (n: CrossplaneTreeNode, level: number, setSize: number, posInSet: number) => {
        if (seen.has(n.key)) return;
        seen.add(n.key);
        const kids = (children.get(n.key) ?? []).filter(c => !seen.has(c.key));
        out.push({ node: n, level, hasChildren: kids.length > 0, setSize, posInSet });
        kids.forEach((c, i) => visit(c, level + 1, kids.length, i + 1));
    };
    const roots = [byKey.get(tree.rootKey), ...[...tree.nodes].sort(compareNodes)
        .filter(n => n.key !== tree.rootKey && (n.parentKey === null || !byKey.has(n.parentKey)))]
        .filter((n): n is CrossplaneTreeNode => !!n);
    roots.forEach((r, i) => visit(r, 1, roots.length, i + 1));
    return out;
}

function openableRef(node: CrossplaneTreeNode): CrossplaneObjectRef | null {
    if (node.state === 'notFetched') return null;
    const ref = toCrossplaneRef(node.ref);
    return isValidCrossplaneRef(ref) ? ref : null;
}

/** Accessible, keyboard-navigable alternative to the graph (role="tree"). Not virtualised: the tree is capped at 300 nodes. */
export const CrossplaneTreeList: React.FC<CrossplaneTreeListProps> = ({ tree, onOpenResource }) => {
    const items = useMemo(() => flatten(tree), [tree]);
    const [active, setActive] = useState(0);
    const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
    const current = Math.min(active, Math.max(items.length - 1, 0));

    const focusIndex = useCallback((i: number) => {
        const next = Math.max(0, Math.min(i, items.length - 1));
        setActive(next);
        itemRefs.current[next]?.focus();
    }, [items.length]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLLIElement>, i: number) => {
        const item = items[i];
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); focusIndex(i + 1); break;
            case 'ArrowUp': e.preventDefault(); focusIndex(i - 1); break;
            case 'Home': e.preventDefault(); focusIndex(0); break;
            case 'End': e.preventDefault(); focusIndex(items.length - 1); break;
            case 'ArrowRight':
                if (item.hasChildren) { e.preventDefault(); focusIndex(i + 1); }
                break;
            case 'ArrowLeft': {
                e.preventDefault();
                const parent = items.findIndex(x => x.node.key === item.node.parentKey);
                if (parent >= 0) focusIndex(parent);
                break;
            }
            case 'Enter': case ' ': {
                const ref = openableRef(item.node);
                if (ref) { e.preventDefault(); onOpenResource(ref); }
                break;
            }
            default: break;
        }
    };

    if (items.length === 0) return <p className="text-sm text-gray-500">No relationships found.</p>;

    return (
        <ul role="tree" aria-label="Crossplane relationships" className="bg-white/5 border border-white/10 rounded-xl p-2 space-y-0.5">
            {items.map((item, i) => {
                const { node } = item;
                const ref = openableRef(node);
                const stateText = STATE_TEXT[node.state];
                return (
                    <li
                        key={node.key}
                        ref={el => { itemRefs.current[i] = el; }}
                        role="treeitem"
                        aria-level={item.level}
                        aria-setsize={item.setSize}
                        aria-posinset={item.posInSet}
                        aria-expanded={item.hasChildren ? true : undefined}
                        aria-selected={i === current}
                        aria-current={node.key === tree.focusKey ? 'true' : undefined}
                        tabIndex={i === current ? 0 : -1}
                        onKeyDown={e => onKeyDown(e, i)}
                        onFocus={() => setActive(i)}
                        onClick={() => { setActive(i); if (ref) onOpenResource(ref); }}
                        style={{ paddingLeft: `${(item.level - 1) * 16 + 8}px` }}
                        className={`flex items-center gap-2 py-1.5 pr-2 rounded-lg text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/60 ${ref ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'} ${node.key === tree.focusKey ? 'bg-blue-500/10' : ''}`}
                        title={node.healthMessage ?? node.error}
                    >
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider shrink-0">{node.ref.kind}</span>
                        <span className="font-mono text-xs text-gray-200 truncate min-w-0">
                            {node.ref.namespace ? `${node.ref.namespace}/` : ''}{node.ref.name}
                        </span>
                        <span className="ml-auto flex items-center gap-1 shrink-0">
                            {stateText ? (
                                <span className="px-2 py-0.5 rounded text-xs bg-gray-500/20 text-gray-300">{stateText}</span>
                            ) : (
                                <>
                                    <span className="text-[10px] text-gray-500">Synced</span>
                                    <CrossplaneConditionPill status={node.synced} />
                                    <span className="text-[10px] text-gray-500">Ready</span>
                                    <CrossplaneConditionPill status={node.ready} />
                                    <CrossplaneHealthBadge health={node.health} />
                                </>
                            )}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
};
