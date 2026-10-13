import React, { useCallback, useMemo, useState } from 'react';
import { GenericResourceView } from '../GenericResourceView';
import type { IColumn } from '../../../shared/VirtualizedTable';
import { useCrossplaneQuery } from '../../../../hooks/useCrossplaneQuery';
import { CrossplaneKindTree } from './CrossplaneKindTree';
import { CrossplaneSectionErrors } from './CrossplaneSectionErrors';
import { ageColumn, conditionColumn, healthColumn, textColumn } from './crossplane-columns';
import {
    MANAGED_SELECTION_KEY, MANAGED_SELECTION_UNHEALTHY, readSession, useRefreshSignal, useReportStatus, writeSession,
    type CrossplaneSubViewProps,
} from './crossplane-view-state';
import type { CrossplaneSectionError, ManagedItemsPayload, ManagedKindInfo, ManagedRow } from '../../../../types/crossplane';

const FIVE_MINUTES_MS = 300_000;

const MANAGED_COLUMNS: IColumn[] = [
    healthColumn<ManagedRow>(),
    textColumn<ManagedRow>('Name', 'name', 240),
    textColumn<ManagedRow>('Namespace', 'namespace', 130),
    conditionColumn<ManagedRow>('Synced', 'synced'),
    conditionColumn<ManagedRow>('Ready', 'ready'),
    textColumn<ManagedRow>('External Name', 'externalName', 220, { mono: true, flexGrow: 1 }),
    textColumn<ManagedRow>('Provider Config', 'providerConfigName', 150),
    textColumn<ManagedRow>('Composite', 'compositeName', 200),
    textColumn<ManagedRow>('Claim', 'claim', 160),
    ageColumn<ManagedRow>(),
];

// "All unhealthy" also shows the kind, since rows come from many kinds
const UNHEALTHY_COLUMNS: IColumn[] = [
    MANAGED_COLUMNS[0],
    textColumn<ManagedRow>('Kind', 'kind', 160),
    ...MANAGED_COLUMNS.slice(1),
];

/** B.4.5: provider → kind tree on the left, the selected kind's MRs on the right. */
export const CrossplaneManagedView: React.FC<CrossplaneSubViewProps> = ({
    clusterName, searchQuery, selectedNamespaces, onResourceClick, refreshSignal, onStatus,
}) => {
    const kinds = useCrossplaneQuery(f => window.k8s.crossplane.getManagedKinds(clusterName, { force: f }), `${clusterName}|managedKinds`,
        { minIntervalMs: FIVE_MINUTES_MS });
    const scan = useCrossplaneQuery(f => window.k8s.crossplane.scanManaged(clusterName, { force: f }), `${clusterName}|scan`,
        { minIntervalMs: FIVE_MINUTES_MS });

    // Selection: 'unhealthy' or a kindKey; the Overview footer may pre-select 'unhealthy' via sessionStorage
    const [stored, setStored] = useState<string | null>(() => readSession(MANAGED_SELECTION_KEY));
    const select = useCallback((s: string) => { writeSession(MANAGED_SELECTION_KEY, s); setStored(s); }, []);

    const kindByKey = useMemo(() => {
        const m = new Map<string, ManagedKindInfo>();
        for (const p of kinds.data?.providers ?? []) for (const k of p.kinds) m.set(k.kindKey, k);
        for (const k of kinds.data?.unattributed ?? []) m.set(k.kindKey, k);
        return m;
    }, [kinds.data]);

    const summary = scan.data;
    const unhealthyRows = useMemo(() => summary?.unhealthy ?? [], [summary]);
    const unhealthyTotal = useMemo(() => (summary?.kinds ?? []).reduce((n, k) => n + k.byHealth.unhealthy, 0), [summary]);

    const selection = useMemo(() => {
        if (stored === MANAGED_SELECTION_UNHEALTHY) return stored;
        if (stored && kindByKey.has(stored)) return stored;
        // Default: All unhealthy if non-empty, else the first kind with count > 0
        if (unhealthyRows.length > 0) return MANAGED_SELECTION_UNHEALTHY;
        const first = summary?.kinds.find(k => k.count > 0 && kindByKey.has(k.kindKey));
        return first?.kindKey ?? MANAGED_SELECTION_UNHEALTHY;
    }, [stored, kindByKey, unhealthyRows, summary]);

    const selectedKind = selection === MANAGED_SELECTION_UNHEALTHY ? undefined : kindByKey.get(selection);
    const itemsEnabled = !!selectedKind?.active;
    const items = useCrossplaneQuery<ManagedItemsPayload>(
        f => window.k8s.crossplane.getManagedItems(clusterName, [selection], { force: f }),
        `${clusterName}|items|${selection}`,
        { enabled: itemsEnabled },
    );

    useRefreshSignal(refreshSignal, () => {
        kinds.refresh(); scan.refresh();
        if (itemsEnabled) items.refresh();
    });
    useReportStatus(onStatus, [kinds.data?.fetchedAt, summary?.fetchedAt, items.data?.fetchedAt],
        [kinds, scan, items].some(q => q.loading || q.refreshing));

    const kindResult = items.data?.kinds.find(k => k.kindKey === selection);
    const rows: ManagedRow[] = selection === MANAGED_SELECTION_UNHEALTHY ? unhealthyRows : kindResult?.rows ?? [];
    const truncated = selection === MANAGED_SELECTION_UNHEALTHY ? unhealthyTotal > unhealthyRows.length : !!kindResult?.truncated;

    const errors = useMemo<CrossplaneSectionError[]>(() => [
        ...(kinds.data?.errors ?? []),
        ...(summary?.errors ?? []),
        ...(kindResult?.error ? [kindResult.error] : []),
    ], [kinds.data, summary, kindResult]);
    const queryError = kinds.error ?? scan.error ?? items.error;

    const handleRowClick = useCallback((row: ManagedRow) => onResourceClick(row, 'crossplane'), [onResourceClick]);
    const scanning = scan.loading || scan.refreshing;

    let title = 'All unhealthy';
    if (selectedKind) title = `${selectedKind.kind ?? selectedKind.plural} (${selectedKind.group})`;

    return (
        <div className="space-y-4">
            <CrossplaneSectionErrors errors={errors} queryError={queryError} />
            {kinds.data?.source === 'crdMetadata' && (
                <p className="text-xs text-gray-500">Kinds were discovered from CRD metadata because provider revisions were not readable.</p>
            )}
            <div className="flex gap-4 h-[calc(100vh-260px)] min-h-[480px]">
                <CrossplaneKindTree
                    kinds={kinds.data}
                    summary={summary}
                    scanning={scanning}
                    selected={selection}
                    onSelect={select}
                    unhealthyCount={unhealthyTotal}
                />
                <div className="flex-1 min-w-0 flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-white font-semibold truncate">{title}</span>
                        <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white tabular-nums">{rows.length}</span>
                    </div>
                    {truncated && (
                        <div role="status" className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 px-3 py-2 text-xs">
                            {selection === MANAGED_SELECTION_UNHEALTHY
                                ? `Showing the first ${unhealthyRows.length} of ${unhealthyTotal} unhealthy managed resources.`
                                : 'This kind has more than 5000 objects; only the first 5000 are listed.'}
                        </div>
                    )}
                    {selectedKind && !selectedKind.active ? (
                        <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-sm text-gray-400 text-center">
                            This kind is inactive: its ManagedResourceDefinition is not active or the API server does not serve it.
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0">
                            <GenericResourceView
                                key={selection === MANAGED_SELECTION_UNHEALTHY ? 'unhealthy' : 'kind'}
                                viewKey={selection === MANAGED_SELECTION_UNHEALTHY ? 'crossplane-managed-unhealthy' : 'crossplane-managed-kind'}
                                columns={selection === MANAGED_SELECTION_UNHEALTHY ? UNHEALTHY_COLUMNS : MANAGED_COLUMNS}
                                data={rows}
                                onRowClick={handleRowClick}
                                searchQuery={searchQuery}
                                selectedNamespaces={selectedNamespaces}
                                isLoading={selection === MANAGED_SELECTION_UNHEALTHY ? !summary && scan.loading : !items.data && items.loading}
                                isUpdating={selection === MANAGED_SELECTION_UNHEALTHY ? scan.refreshing : items.refreshing}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
