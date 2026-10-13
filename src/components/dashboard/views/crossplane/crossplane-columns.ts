import { createElement, type ReactNode } from 'react';
import type { IColumn } from '../../../shared/VirtualizedTable';
import { TimeAgo } from '../../../shared/TimeAgo';
import { CrossplaneConditionPill, CrossplaneHealthBadge } from './CrossplaneHealthBadge';
import type { ConditionStatus, CrossplaneHealth, CrossplaneRowBase } from '../../../../types/crossplane';

/**
 * Typed column helpers (design B.4 "Column conventions").
 * This is a `.ts` file on purpose (react-refresh/only-export-components), so renderers use createElement.
 */
type TypedColumn<R> = Omit<IColumn, 'cellRenderer'> & { cellRenderer?: (value: unknown, row: R) => ReactNode };

// GenericResourceView renders rows from the `data: R[]` it is given, so the row passed back is an R.
// This cast is the single trust point; views never annotate renderer params themselves.
export function col<R>(c: TypedColumn<R>): IColumn {
    const { cellRenderer, ...rest } = c;
    return cellRenderer ? { ...rest, cellRenderer: (v: unknown, r: unknown) => cellRenderer(v, r as R) } : rest;
}

/** Health column, sorted by the numeric `healthOrder` (or `revisionHealthOrder`). */
export function healthColumn<R extends CrossplaneRowBase>(
    label = 'Health',
    dataKey = 'healthOrder',
    pick: (row: R) => { health: CrossplaneHealth; reason?: string } = row => ({ health: row.health, reason: row.healthReason }),
): IColumn {
    return col<R>({
        label, dataKey, width: 120, sortable: true,
        cellRenderer: (_, row) => {
            const { health, reason } = pick(row);
            return createElement(CrossplaneHealthBadge, { health, reason });
        },
    });
}

/** Condition status column (Synced, Ready, Installed, …). */
export function conditionColumn<R>(label: string, dataKey: string, width = 100): IColumn {
    return col<R>({
        label, dataKey, width, sortable: true,
        cellRenderer: v => createElement(CrossplaneConditionPill, { status: v as ConditionStatus | undefined }),
    });
}

/** Age column from the `age` (creationTimestamp) field. */
export function ageColumn<R>(): IColumn {
    return col<R>({
        label: 'Age', dataKey: 'age', width: 100, sortable: true,
        cellRenderer: v => (typeof v === 'string' && v ? createElement(TimeAgo, { timestamp: v }) : '—'),
    });
}

/** Plain text column with an em-dash for empty values; `mono` for IDs and images. */
export function textColumn<R>(label: string, dataKey: string, width = 160, opts: { mono?: boolean; flexGrow?: number } = {}): IColumn {
    return col<R>({
        label, dataKey, width, sortable: true, flexGrow: opts.flexGrow,
        cellRenderer: v => {
            const text = v === undefined || v === null || v === '' ? '—' : String(v);
            return createElement('span', { className: opts.mono ? 'font-mono text-xs text-gray-300' : 'text-gray-300', title: text }, text);
        },
    });
}

/** Numeric count column; the field is a number so it sorts numerically. */
export function countColumn<R>(label: string, dataKey: string, width = 100): IColumn {
    return col<R>({
        label, dataKey, width, sortable: true,
        cellRenderer: v => createElement('span', { className: 'text-gray-300 tabular-nums' }, typeof v === 'number' ? String(v) : '—'),
    });
}

/** ISO timestamp column (Since, Last schedule, …) rendered as relative time. */
export function timeColumn<R>(label: string, dataKey: string, width = 120): IColumn {
    return col<R>({
        label, dataKey, width, sortable: true,
        cellRenderer: v => (typeof v === 'string' && v ? createElement(TimeAgo, { timestamp: v }) : '—'),
    });
}
