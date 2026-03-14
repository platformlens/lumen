import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { VirtualizedTable, IColumn } from '../../shared/VirtualizedTable';
import { SkeletonLoader } from '../../shared/SkeletonLoader';
import { useResourceSorting } from '../../../hooks/useResourceSorting';

interface GenericResourceViewProps {
    title?: string; // Optional override, usually handled by header
    description?: string;
    columns: IColumn[];
    data: any[];
    onRowClick?: (item: any) => void;
    sortConfig?: { key: string; direction: 'asc' | 'desc' } | null;
    onSort?: (key: string) => void;
    viewKey?: string; // For motion key
    searchQuery?: string;
    isLoading?: boolean;
    isUpdating?: boolean;
}

const GenericResourceViewInner: React.FC<GenericResourceViewProps> = ({
    description,
    columns,
    data,
    onRowClick,
    sortConfig: externalSortConfig,
    onSort: externalOnSort,
    viewKey = "resource-view",
    searchQuery = '',
    isLoading = false,
    isUpdating
}) => {
    // Use internal sorting when no external sort props are provided
    const internalSorting = useResourceSorting();
    const sortConfig = externalSortConfig !== undefined ? externalSortConfig : internalSorting.sortConfig;
    const onSort = externalOnSort || internalSorting.handleSort;

    const pageVariants = {
        initial: { opacity: 0, y: 10 },
        in: { opacity: 1, y: 0 },
        out: { opacity: 0, y: -10 }
    };

    const pageTransition = {
        type: "tween",
        ease: "anticipate",
        duration: 0.3
    };

    const filteredData = useMemo(() => {
        if (!searchQuery) return data;
        const lowerQuery = searchQuery.toLowerCase();
        return data.filter(item => {
            const name = item.metadata?.name?.toLowerCase() || item.name?.toLowerCase() || '';
            const namespace = item.metadata?.namespace?.toLowerCase() || item.namespace?.toLowerCase() || '';
            return name.includes(lowerQuery) || namespace.includes(lowerQuery);
        });
    }, [data, searchQuery]);

    // Apply internal sorting when no external sort is provided
    const sortedData = useMemo(() => {
        if (externalSortConfig !== undefined) return filteredData;
        return internalSorting.getSortedData(filteredData);
    }, [filteredData, externalSortConfig, internalSorting]);

    return (
        <motion.div
            key={viewKey}
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition as any}
            className="mb-8 flex flex-col h-full"
        >
            {description && (
                <p className="text-sm text-gray-400 mb-4 flex-none flex items-center justify-between">
                    <span>{description}</span>
                    {isUpdating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                </p>
            )}
            <div className="flex-1 min-h-0">
                {isLoading ? (
                    <SkeletonLoader />
                ) : (
                    <VirtualizedTable
                        columns={columns}
                        data={sortedData}
                        onRowClick={onRowClick}
                        sortConfig={sortConfig}
                        onSort={onSort}
                        tableId={viewKey}
                        isUpdating={isUpdating}
                    />
                )}
            </div>
        </motion.div>
    );
};

export const GenericResourceView = React.memo(GenericResourceViewInner);
