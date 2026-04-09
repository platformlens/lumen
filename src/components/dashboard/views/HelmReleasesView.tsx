import React, { useState, useCallback, useMemo } from 'react';
import { Eye, Trash2 } from 'lucide-react';
import { GenericResourceView } from './GenericResourceView';
import { GlassButton } from '../../shared/GlassButton';
import { ConfirmModal } from '../../shared/ConfirmModal';
import { TimeAgo } from '../../shared/TimeAgo';
import { IColumn } from '../../shared/VirtualizedTable';

interface HelmRelease {
    name: string;
    namespace: string;
    revision: number;
    status: string;
    chart: string;
    chartVersion: string;
    appVersion: string;
    lastUpdated: string;
    description: string;
    manifest?: string;
}

interface HelmReleasesViewProps {
    clusterName: string;
    selectedNamespaces: string[];
    searchQuery: string;
    onNavigateToDetail: (namespace: string, name: string) => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    helmReleases: HelmRelease[];
    isLoading: boolean;
}

function getStatusBadgeClasses(status: string): string {
    if (status === 'deployed') {
        return 'bg-green-500/10 text-green-400';
    }
    if (status.startsWith('pending-')) {
        return 'bg-yellow-500/10 text-yellow-400';
    }
    if (status === 'failed' || status === 'superseded') {
        return 'bg-red-500/10 text-red-400';
    }
    return 'bg-gray-500/20 text-gray-300';
}

export const HelmReleasesView: React.FC<HelmReleasesViewProps> = ({
    clusterName,
    searchQuery,
    onNavigateToDetail,
    showToast,
    helmReleases,
}) => {
    const [deleteTarget, setDeleteTarget] = useState<HelmRelease | null>(null);

    const handleUninstall = useCallback(async () => {
        if (!deleteTarget) return;
        try {
            await (window as any).k8s.helm.uninstallRelease(clusterName, deleteTarget.namespace, deleteTarget.name);
            showToast(`Successfully uninstalled "${deleteTarget.name}"`, 'success');
        } catch (err) {
            console.error('[HelmReleasesView] Uninstall failed:', err);
            showToast(`Failed to uninstall "${deleteTarget.name}"`, 'error');
        } finally {
            setDeleteTarget(null);
        }
    }, [clusterName, deleteTarget, showToast]);

    const rowData = useMemo(() =>
        helmReleases.map(r => ({
            ...r,
            chart: `${r.chart}-${r.chartVersion}`,
        })),
        [helmReleases]);

    const columns: IColumn[] = useMemo(() => [
        {
            label: 'Name',
            dataKey: 'name',
            sortable: true,
            flexGrow: 1,
            width: 180,
            cellRenderer: (cellData: any) => (
                <span className="font-medium text-gray-200 text-sm truncate">{cellData}</span>
            ),
        },
        {
            label: 'Namespace',
            dataKey: 'namespace',
            sortable: true,
            width: 140,
            cellRenderer: (cellData: any) => (
                <span className="text-gray-400 text-sm truncate">{cellData}</span>
            ),
        },
        {
            label: 'Chart',
            dataKey: 'chart',
            sortable: true,
            width: 180,
            cellRenderer: (cellData: any) => (
                <span className="text-gray-400 text-sm truncate">{cellData}</span>
            ),
        },
        {
            label: 'App Version',
            dataKey: 'appVersion',
            sortable: true,
            width: 120,
            cellRenderer: (cellData: any) => (
                <span className="text-gray-400 font-mono text-xs truncate">{cellData}</span>
            ),
        },
        {
            label: 'Revision',
            dataKey: 'revision',
            sortable: true,
            width: 90,
            cellRenderer: (cellData: any) => (
                <span className="text-gray-400 text-sm">{cellData}</span>
            ),
        },
        {
            label: 'Status',
            dataKey: 'status',
            sortable: true,
            width: 130,
            cellRenderer: (cellData: any) => (
                <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadgeClasses(cellData)}`}>
                    {cellData}
                </span>
            ),
        },
        {
            label: 'Last Updated',
            dataKey: 'lastUpdated',
            sortable: true,
            width: 120,
            cellRenderer: (cellData: any) => (
                <span className="text-gray-400 text-sm">
                    {cellData ? <TimeAgo timestamp={cellData} /> : '-'}
                </span>
            ),
        },
        {
            label: 'Actions',
            dataKey: 'actions',
            sortable: false,
            width: 120,
            cellRenderer: (_cellData: any, rowData: any) => (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <GlassButton
                        variant="secondary"
                        className="!px-2 !py-1 !rounded-lg"
                        icon={<Eye size={14} />}
                        onClick={() => onNavigateToDetail(rowData.namespace, rowData.name)}
                    />
                    <GlassButton
                        variant="danger"
                        className="!px-2 !py-1 !rounded-lg"
                        icon={<Trash2 size={14} />}
                        onClick={() => {
                            const release = helmReleases.find(
                                r => r.name === rowData.name && r.namespace === rowData.namespace
                            );
                            if (release) setDeleteTarget(release);
                        }}
                    />
                </div>
            ),
        },
    ], [onNavigateToDetail, helmReleases]);

    return (
        <>
            <GenericResourceView
                columns={columns}
                data={rowData}
                viewKey="helm-releases"
                searchQuery={searchQuery}
                isLoading={false}
                onRowClick={(row) => onNavigateToDetail(row.namespace, row.name)}
            />
            <ConfirmModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleUninstall}
                title="Uninstall Helm Release"
                message={deleteTarget
                    ? `Are you sure you want to uninstall "${deleteTarget.name}" from namespace "${deleteTarget.namespace}"? This will delete all associated resources and cannot be undone.`
                    : ''}
                confirmText="Uninstall"
                cancelText="Cancel"
                variant="danger"
            />
        </>
    );
};
