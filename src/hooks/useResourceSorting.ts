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

export interface SortConfig { key: string; direction: 'asc' | 'desc' }

/** Rows are read as loose records; values keep the same JS coercion semantics as before the extraction. */
type SortRow = Record<string, unknown>;

/**
 * Pure comparator body of useResourceSorting (single source of truth for table sorting).
 * Special keys first (age, restarts, cpu, memory, replicas, status), then a numeric branch when both
 * values are numbers, then the default case-insensitive string comparison.
 */
export function sortResourceData<T>(data: T[], sortConfig: SortConfig | null): T[] {
    if (!sortConfig) return data;

    return [...data].sort((rowA, rowB) => {
        const a = rowA as unknown as SortRow;
        const b = rowB as unknown as SortRow;
        if (sortConfig.key === 'age') {
            // Age is timestamp string
            const dateA = new Date(a.age as string).getTime();
            const dateB = new Date(b.age as string).getTime();
            return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
        }
        if (sortConfig.key === 'restarts') {
            const restartsA = a.restarts as number;
            const restartsB = b.restarts as number;
            return sortConfig.direction === 'asc' ? restartsA - restartsB : restartsB - restartsA;
        }
        if (sortConfig.key === 'cpu') {
            const cpuA = parseCpuToNanocores(a.cpu as string | undefined);
            const cpuB = parseCpuToNanocores(b.cpu as string | undefined);
            return sortConfig.direction === 'asc' ? cpuA - cpuB : cpuB - cpuA;
        }
        if (sortConfig.key === 'memory') {
            const memA = parseMemoryToBytes(a.memory as string | undefined);
            const memB = parseMemoryToBytes(b.memory as string | undefined);
            return sortConfig.direction === 'asc' ? memA - memB : memB - memA;
        }
        if (sortConfig.key === 'replicas') {
            // Sort by total replicas (desired count)
            const replicasA = (a.replicas as number) || 0;
            const replicasB = (b.replicas as number) || 0;
            return sortConfig.direction === 'asc' ? replicasA - replicasB : replicasB - replicasA;
        }

        if (sortConfig.key === 'status') {
            // Determine health: true if available == replicas
            // We want to sort primarily by health (healthy vs not)
            // And maybe secondarily by available replicas

            // For deployments/replicasets
            if ('availableReplicas' in a) {
                const isHealthyA = (a.availableReplicas === a.replicas && (a.replicas as number) > 0);
                const isHealthyB = (b.availableReplicas === b.replicas && (b.replicas as number) > 0);

                if (isHealthyA === isHealthyB) {
                    // Tie-break with available replicas
                    const availA = (a.availableReplicas as number) || 0;
                    const availB = (b.availableReplicas as number) || 0;
                    return sortConfig.direction === 'asc' ? availA - availB : availB - availA;
                }

                // Healthy (true) > Unhealthy (false)
                // ASC: false, true
                // DESC: true, false
                return sortConfig.direction === 'asc'
                    ? (isHealthyA ? 1 : -1)
                    : (isHealthyA ? -1 : 1);
            }
        }

        // Generic numeric comparison (e.g. healthOrder, counts), so 9 sorts before 10
        const rawA = a[sortConfig.key];
        const rawB = b[sortConfig.key];
        if (typeof rawA === 'number' && typeof rawB === 'number') {
            return sortConfig.direction === 'asc' ? rawA - rawB : rawB - rawA;
        }

        // Default string comparison
        const valA = (rawA as { toString(): string } | null | undefined)?.toString().toLowerCase() || '';
        const valB = (rawB as { toString(): string } | null | undefined)?.toString().toLowerCase() || '';

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });
}

export const useResourceSorting = () => {
    const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedData = <T,>(data: T[]): T[] => sortResourceData(data, sortConfig);

    return { sortConfig, handleSort, getSortedData: sortedData };
};
