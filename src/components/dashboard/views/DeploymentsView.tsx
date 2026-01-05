import React, { useState, useEffect } from 'react';
import { GenericResourceView } from './GenericResourceView';
import { getDeploymentStatus } from '../../../utils/resource-utils';
import { useResourceSorting } from '../../../hooks/useResourceSorting';

interface DeploymentsViewProps {
    clusterName: string;
    selectedNamespaces: string[];
    searchQuery: string;
    onRowClick: (dep: any) => void;
}

export const DeploymentsView: React.FC<DeploymentsViewProps> = ({
    clusterName,
    selectedNamespaces,
    searchQuery,
    onRowClick
}) => {
    const [deployments, setDeployments] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { sortConfig, handleSort, getSortedData } = useResourceSorting();

    useEffect(() => {
        if (clusterName) {
            setIsLoading(true);
            // Initial load (optional if watcher sends everything, but good for immediate feedback)
            window.k8s.getDeployments(clusterName, selectedNamespaces)
                .then(data => {
                    setDeployments(data);
                    setIsLoading(false);
                })
                .catch(err => {
                    console.error(err);
                    setIsLoading(false);
                });

            // Start watcher
            window.k8s.watchDeployments(clusterName, selectedNamespaces);

            // Listen for changes
            const unsubscribe = window.k8s.onDeploymentChange((type, deployment) => {
                setDeployments(prev => {
                    const matchIndex = prev.findIndex(d =>
                        d.metadata?.uid === deployment.metadata?.uid ||
                        (d.name === deployment.name && d.namespace === deployment.namespace)
                    );

                    if (type === 'DELETED') {
                        if (matchIndex === -1) return prev;
                        return prev.filter((_, i) => i !== matchIndex);
                    } else {
                        // ADDED or MODIFIED
                        if (matchIndex !== -1) {
                            // Check for actual changes to avoid render checking if possible, 
                            // but for now, we assume the event implies a change or at least a sync.
                            // However, strictly, we could use hasResourceChanged logic here too if we diff against prev[matchIndex]
                            const newArr = [...prev];
                            newArr[matchIndex] = deployment;
                            return newArr;
                        } else {
                            return [...prev, deployment];
                        }
                    }
                });
            });

            return () => {
                unsubscribe();
                window.k8s.stopWatchDeployments();
            };
        }
    }, [clusterName, selectedNamespaces]);

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
