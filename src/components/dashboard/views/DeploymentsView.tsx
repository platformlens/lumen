import React from 'react';
import { Maximize2 } from 'lucide-react';
import { GenericResourceView } from './GenericResourceView';
import { getDeploymentStatus } from '../../../utils/resource-utils';
import { useResourceSorting } from '../../../hooks/useResourceSorting';
import { TimeAgo } from '../../shared/TimeAgo';

interface DeploymentsViewProps {
    deployments: any[];
    isLoading: boolean;
    clusterName: string;
    selectedNamespaces: string[];
    searchQuery: string;
    onRowClick: (dep: any) => void;
    isUpdating?: boolean;
    /** When set, appends a trailing actions column with a "Full view" button. */
    onOpenFullView?: (namespace: string, name: string) => void;
}

const DeploymentsViewInner: React.FC<DeploymentsViewProps> = ({
    deployments,
    isLoading,
    selectedNamespaces,
    searchQuery,
    onRowClick,
    isUpdating,
    onOpenFullView
}) => {
    const { sortConfig, handleSort, getSortedData } = useResourceSorting();

    const sortedDeployments = getSortedData(deployments);

    const columns = React.useMemo(() => {
        const baseColumns = [
            { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name: any) => <span className="font-medium text-gray-200">{name}</span> },
            { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns: any) => <span className="text-gray-400">{ns}</span> },
            { label: 'Replicas', dataKey: 'replicas', sortable: true, width: 100, flexGrow: 0, cellRenderer: (_: any, dep: any) => <span className="text-gray-400">{dep.availableReplicas || 0} / {dep.replicas || 0}</span> },
            {
                label: 'Status', dataKey: 'status', sortable: true, width: 120, flexGrow: 0, cellRenderer: (_: any, dep: any) => {
                    const { status, color } = getDeploymentStatus(dep);
                    return (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium bg-${color}-500/10 text-${color}-400 border border-${color}-500/20`}>
                            {status}
                        </span>
                    );
                }
            },
            { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age: any) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
        ];
        if (!onOpenFullView) return baseColumns;
        const actionsCol = {
            label: '', dataKey: 'actions', sortable: false, width: 44, flexGrow: 0, compact: true,
            cellRenderer: (_: unknown, dep: { namespace: string; name: string }) => (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenFullView(dep.namespace, dep.name);
                    }}
                    aria-label={`Open full view for ${dep.name}`}
                    title="Full view"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                >
                    <Maximize2 size={14} />
                </button>
            )
        };
        return [...baseColumns, actionsCol];
    }, [onOpenFullView]);

    return (
        <GenericResourceView
            viewKey="deployments"
            description="Manage your application deployments and scaling strategies."
            columns={columns}
            data={sortedDeployments}
            onRowClick={(dep) => onRowClick({ ...dep, type: 'deployment' })}
            sortConfig={sortConfig}
            onSort={handleSort}
            searchQuery={searchQuery}
            selectedNamespaces={selectedNamespaces}
            isLoading={isLoading}
            isUpdating={isUpdating}
        />
    );
};

export const DeploymentsView = React.memo(DeploymentsViewInner);
