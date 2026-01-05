import React from 'react';
import { GenericResourceView } from './GenericResourceView';
import { getDeploymentStatus } from '../../../utils/resource-utils';
import { useResourceSorting } from '../../../hooks/useResourceSorting';

interface DeploymentsViewProps {
    deployments: any[];
    isLoading: boolean;
    clusterName: string;
    selectedNamespaces: string[];
    searchQuery: string;
    onRowClick: (dep: any) => void;
}

export const DeploymentsView: React.FC<DeploymentsViewProps> = ({
    deployments,
    isLoading,
    searchQuery,
    onRowClick
}) => {
    const { sortConfig, handleSort, getSortedData } = useResourceSorting();

    const sortedDeployments = getSortedData(deployments);

    const columns = React.useMemo(() => [
        { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name: any) => <span className="font-medium text-gray-200">{name}</span> },
        { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns: any) => <span className="text-gray-400">{ns}</span> },
        { label: 'Replicas', dataKey: 'replicas', width: 100, flexGrow: 0, cellRenderer: (_: any, dep: any) => <span className="text-gray-400">{dep.availableReplicas || 0} / {dep.replicas || 0}</span> },
        {
            label: 'Status', dataKey: 'status', width: 120, flexGrow: 0, cellRenderer: (_: any, dep: any) => {
                const { status, color } = getDeploymentStatus(dep);
                return (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium bg-${color}-500/10 text-${color}-400 border border-${color}-500/20`}>
                        {status}
                    </span>
                );
            }
        }
    ], []);

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
            isLoading={isLoading}
        />
    );
};
