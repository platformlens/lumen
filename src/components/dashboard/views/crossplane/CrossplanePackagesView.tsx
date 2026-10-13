import React, { useCallback, useMemo } from 'react';
import { GenericResourceView } from '../GenericResourceView';
import type { IColumn } from '../../../shared/VirtualizedTable';
import { ToggleGroup, type ToggleOption } from '../../../shared/ToggleGroup';
import { useCrossplaneQuery } from '../../../../hooks/useCrossplaneQuery';
import { CrossplaneSectionErrors } from './CrossplaneSectionErrors';
import { ageColumn, col, conditionColumn, countColumn, healthColumn, textColumn } from './crossplane-columns';
import { useCrossplaneTab, useRefreshSignal, useReportStatus, type CrossplaneSubViewProps } from './crossplane-view-state';
import type {
    ActivationPolicyRow, CrossplaneRowBase, PackageRow, ProviderConfigRow, RuntimeConfigRow,
} from '../../../../types/crossplane';

type PackagesTab = 'providers' | 'functions' | 'configurations' | 'providerConfigs' | 'runtimeConfigs' | 'activationPolicies';

const packageBase = (): IColumn[] => [
    healthColumn<PackageRow>(),
    textColumn<PackageRow>('Name', 'name', 220),
    textColumn<PackageRow>('Package', 'packageRef', 320, { mono: true, flexGrow: 1 }),
    conditionColumn<PackageRow>('Installed', 'installed'),
    conditionColumn<PackageRow>('Healthy', 'healthy'),
    textColumn<PackageRow>('Revision', 'currentRevision', 200, { mono: true }),
];

const PROVIDER_COLUMNS: IColumn[] = [
    ...packageBase(),
    healthColumn<PackageRow>('Rev. Health', 'revisionHealthOrder', row => ({ health: row.revisionHealth ?? 'none' })),
    countColumn<PackageRow>('CRDs', 'installedDefinitionCount', 90),
    ageColumn<PackageRow>(),
];

const FUNCTION_COLUMNS: IColumn[] = [
    ...packageBase(),
    countColumn<PackageRow>('Used by', 'usedByCount', 100),
    ageColumn<PackageRow>(),
];

const CONFIGURATION_COLUMNS: IColumn[] = [
    ...packageBase(),
    col<PackageRow>({
        label: 'Deps', dataKey: 'depsInstalled', width: 100, sortable: true,
        cellRenderer: (_, row) => (
            <span className="text-gray-300 tabular-nums" title={`${row.depsInstalled} installed of ${row.depsFound} found`}>
                {row.depsInstalled}/{row.depsFound}
            </span>
        ),
    }),
    ageColumn<PackageRow>(),
];

const PROVIDER_CONFIG_COLUMNS: IColumn[] = [
    textColumn<ProviderConfigRow>('Provider', 'providerName', 180),
    textColumn<ProviderConfigRow>('Kind', 'kind', 170),
    textColumn<ProviderConfigRow>('Name', 'name', 200),
    textColumn<ProviderConfigRow>('Namespace', 'namespace', 140),
    textColumn<ProviderConfigRow>('Credentials source', 'credentialsSource', 160, { flexGrow: 1 }),
    countColumn<ProviderConfigRow>('Users', 'userCount', 90),
    ageColumn<ProviderConfigRow>(),
];

const RUNTIME_CONFIG_COLUMNS: IColumn[] = [
    textColumn<RuntimeConfigRow>('Name', 'name', 260, { flexGrow: 1 }),
    col<RuntimeConfigRow>({
        label: 'Used by', dataKey: 'usedByCount', width: 260, sortable: true,
        cellRenderer: (_, row) => (
            <span className="text-gray-300" title={row.usedBy.map(r => `${r.kind}/${r.name}`).join(', ')}>
                <span className="tabular-nums">{row.usedByCount}</span>
                {row.usedBy.length > 0 && <span className="text-gray-500 ml-2">{row.usedBy.map(r => r.name).join(', ')}</span>}
            </span>
        ),
    }),
    ageColumn<RuntimeConfigRow>(),
];

const ACTIVATION_POLICY_COLUMNS: IColumn[] = [
    healthColumn<ActivationPolicyRow>(),
    textColumn<ActivationPolicyRow>('Name', 'name', 220),
    col<ActivationPolicyRow>({
        label: 'Patterns', dataKey: 'patterns', width: 320, flexGrow: 1,
        cellRenderer: (_, row) => {
            const text = row.patterns.join(', ') || '—';
            return <span className="font-mono text-xs text-gray-300" title={text}>{text}</span>;
        },
    }),
    countColumn<ActivationPolicyRow>('Activated', 'activatedCount', 100),
    ageColumn<ActivationPolicyRow>(),
];

/** B.4.2: Providers, Functions, Configurations, Provider Configs, Runtime Configs, Activation Policies. */
export const CrossplanePackagesView: React.FC<CrossplaneSubViewProps> = ({
    clusterName, detection, searchQuery, selectedNamespaces, onResourceClick, refreshSignal, onStatus,
}) => {
    const packages = useCrossplaneQuery(f => window.k8s.crossplane.getPackages(clusterName, { force: f }), `${clusterName}|packages`);
    useRefreshSignal(refreshSignal, packages.refresh);
    useReportStatus(onStatus, [packages.data?.fetchedAt], packages.loading || packages.refreshing);

    const showPolicies = detection.features.mrds;
    const visibleTabs = useMemo<PackagesTab[]>(() => [
        'providers', 'functions', 'configurations', 'providerConfigs', 'runtimeConfigs',
        ...(showPolicies ? ['activationPolicies' as const] : []),
    ], [showPolicies]);
    const [tab, setTab] = useCrossplaneTab<PackagesTab>('packages', visibleTabs);

    const p = packages.data;
    const tabData = useMemo(() => {
        const rows: Record<PackagesTab, { label: string; columns: IColumn[]; data: CrossplaneRowBase[] }> = {
            providers: { label: 'Providers', columns: PROVIDER_COLUMNS, data: p?.providers ?? [] },
            functions: { label: 'Functions', columns: FUNCTION_COLUMNS, data: p?.functions ?? [] },
            configurations: { label: 'Configurations', columns: CONFIGURATION_COLUMNS, data: p?.configurations ?? [] },
            providerConfigs: { label: 'Provider Configs', columns: PROVIDER_CONFIG_COLUMNS, data: p?.providerConfigs ?? [] },
            runtimeConfigs: { label: 'Runtime Configs', columns: RUNTIME_CONFIG_COLUMNS, data: p?.runtimeConfigs ?? [] },
            activationPolicies: { label: 'Activation Policies', columns: ACTIVATION_POLICY_COLUMNS, data: p?.activationPolicies ?? [] },
        };
        return rows;
    }, [p]);

    const options = useMemo<ToggleOption<PackagesTab>[]>(() => visibleTabs.map(t => ({
        value: t,
        label: <>{tabData[t].label} <span className="text-gray-500 tabular-nums">{p ? tabData[t].data.length : ''}</span></>,
    })), [visibleTabs, tabData, p]);

    const handleRowClick = useCallback((row: CrossplaneRowBase) => onResourceClick(row, 'crossplane'), [onResourceClick]);
    const current = tabData[tab];

    return (
        <div className="space-y-4">
            <ToggleGroup options={options} value={tab} onChange={setTab} className="w-fit flex-wrap" />
            <CrossplaneSectionErrors errors={p?.errors} queryError={packages.error} />
            {(p?.truncatedKinds.length ?? 0) > 0 && (
                <p className="text-xs text-gray-500">Lists were capped at 5000 items for: {p?.truncatedKinds.join(', ')}</p>
            )}
            <div className="h-[calc(100vh-280px)] min-h-[400px]">
                <GenericResourceView
                    key={tab}
                    viewKey={`crossplane-packages-${tab}`}
                    columns={current.columns}
                    data={current.data}
                    onRowClick={handleRowClick}
                    searchQuery={searchQuery}
                    selectedNamespaces={selectedNamespaces}
                    isLoading={!p && packages.loading}
                    isUpdating={packages.refreshing}
                />
            </div>
        </div>
    );
};
