import React, { useCallback, useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { MANAGED_SELECTION_UNHEALTHY as UNHEALTHY_SELECTION } from './crossplane-view-state';
import type {
    CrossplaneHealth, ManagedKindInfo, ManagedKindScan, ManagedKindsPayload, ManagedScanSummary,
} from '../../../../types/crossplane';

const UNATTRIBUTED = '__unattributed__';

type TreeRow =
    | { type: 'pseudo'; id: string; label: string; count: number }
    | { type: 'group'; id: string; label: string; health?: CrossplaneHealth; total: number | null; collapsed: boolean }
    | { type: 'kind'; id: string; info: ManagedKindInfo; scan?: ManagedKindScan };

const DOT: Record<CrossplaneHealth, string> = {
    healthy: 'bg-green-400', progressing: 'bg-yellow-400', unhealthy: 'bg-red-400',
    unknown: 'bg-gray-400', paused: 'bg-gray-400', none: 'bg-gray-600',
};

interface CrossplaneKindTreeProps {
    kinds: ManagedKindsPayload | null;
    summary: ManagedScanSummary | null;
    scanning: boolean;
    selected: string | null;
    onSelect: (selection: string) => void;
    unhealthyCount: number;
}

/** Provider → kind list for the Managed view (B.4.5), flattened into one virtualised list. */
export const CrossplaneKindTree: React.FC<CrossplaneKindTreeProps> = ({ kinds, summary, scanning, selected, onSelect, unhealthyCount }) => {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [showEmpty, setShowEmpty] = useState(false);
    // Counts are unknown until the scan completes, so empty kinds are only hidden once it has
    const hideEmpty = !showEmpty && summary?.status === 'complete';

    const scanByKey = useMemo(() => new Map((summary?.kinds ?? []).map(k => [k.kindKey, k])), [summary]);

    const rows = useMemo<TreeRow[]>(() => {
        const out: TreeRow[] = [{ type: 'pseudo', id: UNHEALTHY_SELECTION, label: 'All unhealthy', count: unhealthyCount }];
        const groups: { id: string; label: string; health?: CrossplaneHealth; kinds: ManagedKindInfo[] }[] = [
            ...(kinds?.providers ?? []).map(p => ({ id: `provider:${p.name}`, label: p.name, health: p.health, kinds: p.kinds })),
        ];
        if ((kinds?.unattributed.length ?? 0) > 0) groups.push({ id: UNATTRIBUTED, label: 'Unattributed', kinds: kinds?.unattributed ?? [] });
        for (const g of groups) {
            const visible = g.kinds.filter(k => !hideEmpty || (scanByKey.get(k.kindKey)?.count ?? 0) > 0)
                .sort((a, b) => (a.kind ?? a.plural).localeCompare(b.kind ?? b.plural));
            if (hideEmpty && visible.length === 0) continue;
            const isCollapsed = collapsed[g.id] ?? false;
            const total = summary ? g.kinds.reduce((n, k) => n + (scanByKey.get(k.kindKey)?.count ?? 0), 0) : null;
            out.push({ type: 'group', id: g.id, label: g.label, health: g.health, total, collapsed: isCollapsed });
            if (!isCollapsed) for (const k of visible) out.push({ type: 'kind', id: k.kindKey, info: k, scan: scanByKey.get(k.kindKey) });
        }
        return out;
    }, [kinds, summary, scanByKey, hideEmpty, collapsed, unhealthyCount]);

    const toggle = useCallback((id: string) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] })), []);

    const renderRow = useCallback((_: number, row: TreeRow) => {
        if (row.type === 'pseudo') {
            const active = selected === row.id;
            return (
                <button type="button" onClick={() => onSelect(row.id)} aria-pressed={active}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${active ? 'bg-white/10 text-blue-400' : 'text-gray-300 hover:bg-white/5'}`}>
                    <AlertTriangle size={14} className="text-red-400 shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-left truncate">{row.label}</span>
                    <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white tabular-nums">{row.count}</span>
                </button>
            );
        }
        if (row.type === 'group') {
            return (
                <button type="button" onClick={() => toggle(row.id)} aria-expanded={!row.collapsed}
                    className="w-full flex items-center gap-2 px-2 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white">
                    {row.collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                    {row.health && <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[row.health]}`} title={row.health} />}
                    <span className="flex-1 text-left truncate normal-case" title={row.label}>{row.label}</span>
                    <span className="tabular-nums normal-case">{row.total ?? ''}</span>
                </button>
            );
        }
        const { info, scan } = row;
        const active = selected === row.id;
        const label = info.kind ?? info.plural;
        const unhealthy = scan?.byHealth.unhealthy ?? 0;
        const progressing = scan?.byHealth.progressing ?? 0;
        return (
            <button type="button" onClick={() => onSelect(row.id)} aria-pressed={active} title={`${info.plural}.${info.group}`}
                className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-sm rounded-lg transition-colors ${active ? 'bg-white/10 text-blue-400' : info.active ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-white/5'}`}>
                <span className="flex-1 text-left truncate">{label}</span>
                {!info.active ? (
                    <span className="text-[10px] text-gray-600">inactive</span>
                ) : scan ? (
                    <span className="flex items-center gap-1.5 text-xs tabular-nums">
                        {unhealthy > 0 && <span className="text-red-400">{unhealthy}</span>}
                        {progressing > 0 && <span className="text-yellow-400">{progressing}</span>}
                        <span className={scan.error ? 'text-yellow-400' : 'text-gray-400'} title={scan.error?.message}>
                            {scan.error ? '!' : `${scan.count}${scan.truncated ? '+' : ''}`}
                        </span>
                    </span>
                ) : scanning ? (
                    <Loader2 size={12} className="animate-spin text-gray-500" aria-label="Counting" />
                ) : null}
            </button>
        );
    }, [selected, onSelect, toggle, scanning]);

    return (
        <div className="w-72 shrink-0 flex flex-col bg-white/5 border border-white/10 backdrop-blur-xl rounded-xl overflow-hidden">
            <div className="flex-1 min-h-0 p-2">
                {kinds ? (
                    <Virtuoso data={rows} itemContent={renderRow} style={{ height: '100%' }} computeItemKey={(_, r) => `${r.type}:${r.id}`} />
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-gray-500 gap-2" role="status">
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Discovering managed resource kinds…
                    </div>
                )}
            </div>
            <label className="flex items-center gap-2 px-3 py-2 border-t border-white/10 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" checked={showEmpty || summary?.status !== 'complete'} disabled={summary?.status !== 'complete'}
                    onChange={e => setShowEmpty(e.target.checked)} className="accent-blue-500" />
                Show empty kinds
            </label>
        </div>
    );
};
