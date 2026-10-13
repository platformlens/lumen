import React, { useCallback, useMemo } from 'react';
import { GenericResourceView } from '../GenericResourceView';
import type { IColumn } from '../../../shared/VirtualizedTable';
import { ToggleGroup, type ToggleOption } from '../../../shared/ToggleGroup';
import { useCrossplaneQuery } from '../../../../hooks/useCrossplaneQuery';
import { apiGroupOf } from '../../../../utils/crossplane-utils';
import { CrossplaneSectionErrors } from './CrossplaneSectionErrors';
import { ageColumn, col, conditionColumn, countColumn, healthColumn, textColumn } from './crossplane-columns';
import { useCrossplaneTab, useRefreshSignal, useReportStatus, type CrossplaneSubViewProps } from './crossplane-view-state';
import type { CompositionRow, CrossplaneRowBase, EnvironmentConfigRow, XrdRow } from '../../../../types/crossplane';

type DefinitionsTab = 'xrds' | 'compositions' | 'environmentConfigs';
const TABS: readonly DefinitionsTab[] = ['xrds', 'compositions', 'environmentConfigs'];
const TAB_LABELS: Record<DefinitionsTab, string> = { xrds: 'XRDs', compositions: 'Compositions', environmentConfigs: 'Environment Configs' };

// AM-5: the Definitions view only needs composites for instance/usage counts, so it refreshes them slowly.
const COMPOSITES_MIN_INTERVAL_MS = 120_000;

/** Renderer-side joins (B.10): undefined while composites are not loaded, so the cell shows "—". */
interface XrdViewRow extends XrdRow { compositionCount: number; instanceCount?: number; }
interface CompositionViewRow extends CompositionRow { xrCount?: number; }

const XRD_COLUMNS: IColumn[] = [
    healthColumn<XrdViewRow>(),
    textColumn<XrdViewRow>('Name', 'name', 260),
    textColumn<XrdViewRow>('XR Kind', 'xrKind', 170),
    textColumn<XrdViewRow>('Group', 'group', 200, { mono: true }),
    textColumn<XrdViewRow>('Version', 'version', 90, { mono: true }),
    textColumn<XrdViewRow>('Scope', 'scope', 120),
    textColumn<XrdViewRow>('Claim Kind', 'claimKind', 150),
    conditionColumn<XrdViewRow>('Established', 'established', 110),
    conditionColumn<XrdViewRow>('Offered', 'offered'),
    countColumn<XrdViewRow>('Compositions', 'compositionCount', 120),
    countColumn<XrdViewRow>('Instances', 'instanceCount', 100),
    ageColumn<XrdViewRow>(),
];

const COMPOSITION_COLUMNS: IColumn[] = [
    textColumn<CompositionViewRow>('Name', 'name', 260),
    col<CompositionViewRow>({
        label: 'Composite Type', dataKey: 'compositeKind', width: 200, sortable: true,
        cellRenderer: (_, row) => <span className="text-gray-300" title={`${row.compositeApiVersion} ${row.compositeKind}`}>{row.compositeKind || '—'}</span>,
    }),
    textColumn<CompositionViewRow>('Mode', 'mode', 100),
    col<CompositionViewRow>({
        label: 'Steps', dataKey: 'stepCount', width: 280, sortable: true, flexGrow: 1,
        cellRenderer: (_, row) => {
            const names = row.steps.map(s => s.functionName ?? s.step).join(', ');
            return (
                <span className="text-gray-300" title={names}>
                    <span className="tabular-nums">{row.stepCount}</span>
                    {names && <span className="text-gray-500 ml-2">{names}</span>}
                </span>
            );
        },
    }),
    countColumn<CompositionViewRow>('Revisions', 'revisionCount', 100),
    countColumn<CompositionViewRow>('XRs', 'xrCount', 80),
    ageColumn<CompositionViewRow>(),
];

const ENVIRONMENT_CONFIG_COLUMNS: IColumn[] = [
    textColumn<EnvironmentConfigRow>('Name', 'name', 300, { flexGrow: 1 }),
    countColumn<EnvironmentConfigRow>('Keys', 'keyCount', 100),
    ageColumn<EnvironmentConfigRow>(),
];

/** B.4.3: XRDs, Compositions, Environment Configs with renderer-side counts. */
export const CrossplaneDefinitionsView: React.FC<CrossplaneSubViewProps> = ({
    clusterName, searchQuery, selectedNamespaces, onResourceClick, refreshSignal, onStatus,
}) => {
    const definitions = useCrossplaneQuery(f => window.k8s.crossplane.getDefinitions(clusterName, { force: f }), `${clusterName}|definitions`);
    const composites = useCrossplaneQuery(f => window.k8s.crossplane.getComposites(clusterName, { force: f }), `${clusterName}|composites`,
        { minIntervalMs: COMPOSITES_MIN_INTERVAL_MS });
    useRefreshSignal(refreshSignal, () => { definitions.refresh(); composites.refresh(); });
    useReportStatus(onStatus, [definitions.data?.fetchedAt, composites.data?.fetchedAt],
        definitions.loading || definitions.refreshing || composites.loading || composites.refreshing);

    const [tab, setTab] = useCrossplaneTab<DefinitionsTab>('definitions', TABS);
    const d = definitions.data;
    const c = composites.data;

    const xrdRows = useMemo<XrdViewRow[]>(() => {
        const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
        const compositionsByType = new Map<string, number>();
        for (const cp of d?.compositions ?? []) bump(compositionsByType, `${apiGroupOf(cp.compositeApiVersion)}|${cp.compositeKind}`);
        const instancesByType = new Map<string, number>();
        for (const xr of c?.composites ?? []) bump(instancesByType, `${apiGroupOf(xr.apiVersion)}|${xr.kind}`);
        return (d?.xrds ?? []).map(x => {
            const typeKey = `${x.group}|${x.xrKind}`;
            return {
                ...x,
                compositionCount: compositionsByType.get(typeKey) ?? 0,
                instanceCount: c ? instancesByType.get(typeKey) ?? 0 : undefined,
            };
        });
    }, [d, c]);

    const compositionRows = useMemo<CompositionViewRow[]>(() => {
        if (!c) return d?.compositions ?? [];
        const byComposition = new Map<string, number>();
        for (const xr of c.composites) {
            if (xr.compositionName) byComposition.set(xr.compositionName, (byComposition.get(xr.compositionName) ?? 0) + 1);
        }
        return (d?.compositions ?? []).map(cp => ({ ...cp, xrCount: byComposition.get(cp.name) ?? 0 }));
    }, [d, c]);

    const tabData = useMemo<Record<DefinitionsTab, { columns: IColumn[]; data: CrossplaneRowBase[] }>>(() => ({
        xrds: { columns: XRD_COLUMNS, data: xrdRows },
        compositions: { columns: COMPOSITION_COLUMNS, data: compositionRows },
        environmentConfigs: { columns: ENVIRONMENT_CONFIG_COLUMNS, data: d?.environmentConfigs ?? [] },
    }), [xrdRows, compositionRows, d]);

    const options = useMemo<ToggleOption<DefinitionsTab>[]>(() => TABS.map(t => ({
        value: t,
        label: <>{TAB_LABELS[t]} <span className="text-gray-500 tabular-nums">{d ? tabData[t].data.length : ''}</span></>,
    })), [tabData, d]);

    const handleRowClick = useCallback((row: CrossplaneRowBase) => onResourceClick(row, 'crossplane'), [onResourceClick]);
    const current = tabData[tab];

    return (
        <div className="space-y-4">
            <ToggleGroup options={options} value={tab} onChange={setTab} className="w-fit flex-wrap" />
            <CrossplaneSectionErrors errors={d?.errors} queryError={definitions.error} />
            <div className="h-[calc(100vh-280px)] min-h-[400px]">
                <GenericResourceView
                    key={tab}
                    viewKey={`crossplane-definitions-${tab}`}
                    columns={current.columns}
                    data={current.data}
                    onRowClick={handleRowClick}
                    searchQuery={searchQuery}
                    selectedNamespaces={selectedNamespaces}
                    isLoading={!d && definitions.loading}
                    isUpdating={definitions.refreshing}
                />
            </div>
        </div>
    );
};
