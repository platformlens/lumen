import React, { useCallback, useMemo, useState } from 'react';
import { GenericResourceView } from '../GenericResourceView';
import type { IColumn } from '../../../shared/VirtualizedTable';
import { ToggleGroup, type ToggleOption } from '../../../shared/ToggleGroup';
import { useCrossplaneQuery } from '../../../../hooks/useCrossplaneQuery';
import { apiGroupOf } from '../../../../utils/crossplane-utils';
import { CrossplaneSectionErrors } from './CrossplaneSectionErrors';
import { ageColumn, col, conditionColumn, countColumn, healthColumn, textColumn, timeColumn } from './crossplane-columns';
import { useCrossplaneTab, useRefreshSignal, useReportStatus, type CrossplaneSubViewProps } from './crossplane-view-state';
import type { ClaimRow, CompositeRow, CrossplaneRowBase, OperationRow, UsageRow } from '../../../../types/crossplane';

type CompositesTab = 'composites' | 'claims' | 'usages' | 'operations';
type OperationsKind = 'Operation' | 'CronOperation' | 'WatchOperation';
const TAB_LABELS: Record<CompositesTab, string> = { composites: 'Composite Resources', claims: 'Claims', usages: 'Usages', operations: 'Operations' };
const OPERATION_OPTIONS: ToggleOption<OperationsKind>[] = [
    { value: 'Operation', label: 'Operations' },
    { value: 'CronOperation', label: 'Cron' },
    { value: 'WatchOperation', label: 'Watch' },
];
const ALL_KINDS = 'all';

const COMPOSITE_COLUMNS: IColumn[] = [
    healthColumn<CompositeRow>(),
    textColumn<CompositeRow>('Name', 'name', 240),
    textColumn<CompositeRow>('Namespace', 'namespace', 140),
    textColumn<CompositeRow>('Kind', 'kind', 170),
    textColumn<CompositeRow>('Composition', 'compositionName', 200),
    conditionColumn<CompositeRow>('Synced', 'synced'),
    conditionColumn<CompositeRow>('Ready', 'ready'),
    countColumn<CompositeRow>('Composed', 'resourceRefCount', 100),
    col<CompositeRow>({
        label: 'Claim', dataKey: 'claimName', width: 200, sortable: true, flexGrow: 1,
        cellRenderer: (_, row) => {
            if (!row.claimName) return <span className="text-gray-500">—</span>;
            const text = row.claimNamespace ? `${row.claimNamespace}/${row.claimName}` : row.claimName;
            return <span className="text-gray-300" title={text}>{text}</span>;
        },
    }),
    ageColumn<CompositeRow>(),
];

const CLAIM_COLUMNS: IColumn[] = [
    healthColumn<ClaimRow>(),
    textColumn<ClaimRow>('Name', 'name', 240),
    textColumn<ClaimRow>('Namespace', 'namespace', 140),
    textColumn<ClaimRow>('Kind', 'kind', 170),
    col<ClaimRow>({
        label: 'XR', dataKey: 'compositeRef', width: 240, flexGrow: 1,
        cellRenderer: (_, row) => row.compositeRef
            ? <span className="text-gray-300" title={`${row.compositeRef.kind}/${row.compositeRef.name}`}>{row.compositeRef.name}</span>
            : <span className="text-gray-500">—</span>,
    }),
    conditionColumn<ClaimRow>('Synced', 'synced'),
    conditionColumn<ClaimRow>('Ready', 'ready'),
    textColumn<ClaimRow>('Connection Secret', 'connectionSecretName', 180, { mono: true }),
    ageColumn<ClaimRow>(),
];

const USAGE_COLUMNS: IColumn[] = [
    healthColumn<UsageRow>(),
    textColumn<UsageRow>('Name', 'name', 220),
    textColumn<UsageRow>('Namespace', 'namespace', 140),
    textColumn<UsageRow>('Of', 'of', 220, { mono: true }),
    textColumn<UsageRow>('By', 'by', 220, { mono: true }),
    textColumn<UsageRow>('Reason', 'reason', 200, { flexGrow: 1 }),
    ageColumn<UsageRow>(),
];

const OPERATION_COLUMNS: IColumn[] = [
    healthColumn<OperationRow>(),
    textColumn<OperationRow>('Name', 'name', 260, { flexGrow: 1 }),
    textColumn<OperationRow>('Mode', 'mode', 120),
    countColumn<OperationRow>('Steps', 'stepCount', 90),
    conditionColumn<OperationRow>('Synced', 'synced'),
    conditionColumn<OperationRow>('Succeeded', 'succeeded', 110),
    ageColumn<OperationRow>(),
];

const CRON_COLUMNS: IColumn[] = [
    healthColumn<OperationRow>(),
    textColumn<OperationRow>('Name', 'name', 240, { flexGrow: 1 }),
    textColumn<OperationRow>('Schedule', 'schedule', 140, { mono: true }),
    conditionColumn<OperationRow>('Synced', 'synced'),
    conditionColumn<OperationRow>('Scheduling', 'scheduling', 110),
    countColumn<OperationRow>('Running', 'runningCount', 90),
    timeColumn<OperationRow>('Last schedule', 'lastScheduleTime'),
    timeColumn<OperationRow>('Last success', 'lastSuccessfulTime'),
    ageColumn<OperationRow>(),
];

const WATCH_COLUMNS: IColumn[] = [
    healthColumn<OperationRow>(),
    textColumn<OperationRow>('Name', 'name', 240, { flexGrow: 1 }),
    col<OperationRow>({
        label: 'Watched kind', dataKey: 'watchedKind', width: 180, sortable: true,
        cellRenderer: (_, row) => <span className="text-gray-300" title={row.watchedApiVersion ?? ''}>{row.watchedKind ?? '—'}</span>,
    }),
    countColumn<OperationRow>('Count', 'watchingResources', 90),
    conditionColumn<OperationRow>('Synced', 'synced'),
    conditionColumn<OperationRow>('Watching', 'watching', 110),
    timeColumn<OperationRow>('Last schedule', 'lastScheduleTime'),
    ageColumn<OperationRow>(),
];

const OPERATION_KIND_COLUMNS: Record<OperationsKind, IColumn[]> = {
    Operation: OPERATION_COLUMNS, CronOperation: CRON_COLUMNS, WatchOperation: WATCH_COLUMNS,
};

const kindKeyOf = (r: { apiVersion: string; kind: string }) => `${apiGroupOf(r.apiVersion)}|${r.kind}`;

/** B.4.4: Composite Resources, Claims, Usages and (v2 alpha) Operations. */
export const CrossplaneCompositesView: React.FC<CrossplaneSubViewProps> = ({
    clusterName, detection, searchQuery, selectedNamespaces, onResourceClick, refreshSignal, onStatus,
}) => {
    const composites = useCrossplaneQuery(f => window.k8s.crossplane.getComposites(clusterName, { force: f }), `${clusterName}|composites`);
    const definitions = useCrossplaneQuery(f => window.k8s.crossplane.getDefinitions(clusterName, { force: f }), `${clusterName}|definitions`);
    useRefreshSignal(refreshSignal, () => { composites.refresh(); definitions.refresh(); });
    useReportStatus(onStatus, [composites.data?.fetchedAt, definitions.data?.fetchedAt],
        composites.loading || composites.refreshing || definitions.loading || definitions.refreshing);

    const { features } = detection;
    const claimsSupported = definitions.data?.claimsSupported ?? false;
    const usagesServed = features.protectionUsages || features.legacyUsages;
    const visibleTabs = useMemo<CompositesTab[]>(() => [
        'composites',
        ...(claimsSupported ? ['claims' as const] : []),
        ...(usagesServed ? ['usages' as const] : []),
        ...(features.operations ? ['operations' as const] : []),
    ], [claimsSupported, usagesServed, features.operations]);
    const [tab, setTab] = useCrossplaneTab<CompositesTab>('composites', visibleTabs);
    const [opKind, setOpKind] = useState<OperationsKind>('Operation');
    const [kindFilter, setKindFilter] = useState<string>(ALL_KINDS);

    const c = composites.data;
    const xrds = definitions.data?.xrds;

    // Kind filter options: XRD-defined kinds plus any kind present in the rows (XRDs may still be loading)
    const kindOptions = useMemo(() => {
        const opts = new Map<string, string>();
        if (tab === 'composites' || tab === 'claims') {
            for (const x of xrds ?? []) {
                const kind = tab === 'composites' ? x.xrKind : x.claimKind;
                if (kind) opts.set(`${x.group}|${kind}`, `${kind} (${x.group})`);
            }
            for (const r of (tab === 'composites' ? c?.composites : c?.claims) ?? []) {
                const k = kindKeyOf(r);
                if (!opts.has(k)) opts.set(k, `${r.kind} (${apiGroupOf(r.apiVersion)})`);
            }
        }
        return [...opts.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [tab, xrds, c]);
    const activeKind = kindOptions.some(([k]) => k === kindFilter) ? kindFilter : ALL_KINDS;

    const rows = useMemo<CrossplaneRowBase[]>(() => {
        const byKind = <R extends CrossplaneRowBase>(list: R[] | undefined): R[] =>
            activeKind === ALL_KINDS ? list ?? [] : (list ?? []).filter(r => kindKeyOf(r) === activeKind);
        switch (tab) {
            case 'composites': return byKind(c?.composites);
            case 'claims': return byKind(c?.claims);
            case 'usages': return c?.usages ?? [];
            case 'operations': return (c?.operations ?? []).filter(o => o.opKind === opKind);
        }
    }, [tab, c, activeKind, opKind]);

    const columns = tab === 'composites' ? COMPOSITE_COLUMNS
        : tab === 'claims' ? CLAIM_COLUMNS
            : tab === 'usages' ? USAGE_COLUMNS
                : OPERATION_KIND_COLUMNS[opKind];

    const options = useMemo<ToggleOption<CompositesTab>[]>(() => visibleTabs.map(t => {
        const count = c ? (t === 'composites' ? c.composites : t === 'claims' ? c.claims : t === 'usages' ? c.usages : c.operations).length : null;
        return { value: t, label: <>{TAB_LABELS[t]} <span className="text-gray-500 tabular-nums">{count ?? ''}</span></> };
    }), [visibleTabs, c]);

    const handleRowClick = useCallback((row: CrossplaneRowBase) => onResourceClick(row, 'crossplane'), [onResourceClick]);
    const tableKey = tab === 'operations' ? `operations-${opKind}` : tab;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <ToggleGroup options={options} value={tab} onChange={setTab} className="w-fit flex-wrap" />
                {tab === 'operations' && (
                    <ToggleGroup options={OPERATION_OPTIONS} value={opKind} onChange={setOpKind} className="w-fit" />
                )}
                {(tab === 'composites' || tab === 'claims') && (
                    <label className="flex items-center gap-2 text-xs text-gray-400">
                        <span>Kind</span>
                        <select
                            value={activeKind}
                            onChange={e => setKindFilter(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-blue-500/50"
                        >
                            <option value={ALL_KINDS} className="bg-gray-900">All kinds</option>
                            {kindOptions.map(([k, label]) => <option key={k} value={k} className="bg-gray-900">{label}</option>)}
                        </select>
                    </label>
                )}
            </div>
            <CrossplaneSectionErrors errors={c?.errors} queryError={composites.error} />
            {(c?.truncatedKinds.length ?? 0) > 0 && (
                <p className="text-xs text-gray-500">Lists were capped at 5000 items for: {c?.truncatedKinds.join(', ')}</p>
            )}
            <div className="h-[calc(100vh-280px)] min-h-[400px]">
                <GenericResourceView
                    key={tableKey}
                    viewKey={`crossplane-composites-${tableKey}`}
                    columns={columns}
                    data={rows}
                    onRowClick={handleRowClick}
                    searchQuery={searchQuery}
                    selectedNamespaces={selectedNamespaces}
                    isLoading={!c && composites.loading}
                    isUpdating={composites.refreshing}
                />
            </div>
        </div>
    );
};
