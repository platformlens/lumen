import { useState } from 'react';

/** Parse CPU string (e.g. "250m", "1", "0.5") to nanocores for numeric comparison */
function parseCpuToNanocores(cpu: string | undefined | null): number {
    if (!cpu) return 0;
    const trimmed = cpu.trim();
    if (!trimmed || trimmed === '-') return 0;
    if (trimmed.endsWith('n')) return parseFloat(trimmed) || 0;
    if (trimmed.endsWith('m')) return (parseFloat(trimmed) || 0) * 1_000_000;
    return (parseFloat(trimmed) || 0) * 1_000_000_000;
}

/** Parse memory string (e.g. "128Mi", "1Gi", "512Ki") to bytes for numeric comparison */
function parseMemoryToBytes(mem: string | undefined | null): number {
    if (!mem) return 0;
    const trimmed = mem.trim();
    if (!trimmed || trimmed === '-') return 0;
    const units: Record<string, number> = {
        'Ki': 1024,
        'Mi': 1024 ** 2,
        'Gi': 1024 ** 3,
        'Ti': 1024 ** 4,
        'K': 1000,
        'M': 1000 ** 2,
        'G': 1000 ** 3,
        'T': 1000 ** 4,
    };
    for (const [suffix, multiplier] of Object.entries(units)) {
        if (trimmed.endsWith(suffix)) {
            return (parseFloat(trimmed) || 0) * multiplier;
        }
    }
    return parseFloat(trimmed) || 0;
}

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
            if (sortConfig.key === 'cpu') {
                const cpuA = parseCpuToNanocores(a.cpu);
                const cpuB = parseCpuToNanocores(b.cpu);
                return sortConfig.direction === 'asc' ? cpuA - cpuB : cpuB - cpuA;
            }
            if (sortConfig.key === 'memory') {
                const memA = parseMemoryToBytes(a.memory);
                const memB = parseMemoryToBytes(b.memory);
                return sortConfig.direction === 'asc' ? memA - memB : memB - memA;
            }
            if (sortConfig.key === 'replicas') {
                // Sort by total replicas (desired count)
                const replicasA = a.replicas || 0;
                const replicasB = b.replicas || 0;
                return sortConfig.direction === 'asc' ? replicasA - replicasB : replicasB - replicasA;
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
