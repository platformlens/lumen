import { useState } from 'react';

export const useResourceSorting = () => {
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedData = (data: any[]) => {
        if (!sortConfig) return data;

        return [...data].sort((a, b) => {
            if (sortConfig.key === 'age') {
                // Age is timestamp string
                const dateA = new Date(a.age).getTime();
                const dateB = new Date(b.age).getTime();
                return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
            }
            if (sortConfig.key === 'restarts') {
                return sortConfig.direction === 'asc' ? a.restarts - b.restarts : b.restarts - a.restarts;
            }

            if (sortConfig.key === 'status') {
                // Determine health: true if available == replicas
                // We want to sort primarily by health (healthy vs not)
                // And maybe secondarily by available replicas

                // For deployments/replicasets
                if ('availableReplicas' in a) {
                    const isHealthyA = (a.availableReplicas === a.replicas && a.replicas > 0);
                    const isHealthyB = (b.availableReplicas === b.replicas && b.replicas > 0);

                    if (isHealthyA === isHealthyB) {
                        // Tie-break with available replicas
                        return sortConfig.direction === 'asc'
                            ? (a.availableReplicas || 0) - (b.availableReplicas || 0)
                            : (b.availableReplicas || 0) - (a.availableReplicas || 0);
                    }

                    // Healthy (true) > Unhealthy (false)
                    // ASC: false, true
                    // DESC: true, false
                    return sortConfig.direction === 'asc'
                        ? (isHealthyA ? 1 : -1)
                        : (isHealthyA ? -1 : 1);
                }
            }

            // Default string comparison
            const valA = a[sortConfig.key]?.toString().toLowerCase() || '';
            const valB = b[sortConfig.key]?.toString().toLowerCase() || '';

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    };

    return { sortConfig, handleSort, getSortedData: sortedData };
};
