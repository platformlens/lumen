import React from 'react';
import { Layers, Network, Search, Square } from 'lucide-react';
import { ToggleGroup } from '../shared/ToggleGroup';
import { NamespaceSelector } from './NamespaceSelector';

interface DashboardHeaderProps {
    clusterName: string;
    activeView: string;
    currentCrdKind: string;
    isCrdView: boolean;
    resourceCount: number;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    namespaces: string[];
    selectedNamespaces: string[];
    onNamespaceChange: (namespaces: string[]) => void;
    podViewMode?: 'list' | 'visual';
    onPodViewModeChange?: (mode: 'list' | 'visual') => void;
}

/**
 * Dashboard header component with search, filters, and view controls
 * Memoized to prevent unnecessary re-renders
 */
export const DashboardHeader = React.memo<DashboardHeaderProps>(({
    clusterName,
    activeView,
    currentCrdKind,
    isCrdView,
    resourceCount,
    searchQuery,
    onSearchChange,
    namespaces,
    selectedNamespaces,
    onNamespaceChange,
    podViewMode,
    onPodViewModeChange,
}) => {
    return (
        <div className="flex-none p-4 sm:p-6 border border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl">
            {/* Left Section - Title and Info */}
            <div className="flex items-center gap-4 flex-none max-w-full">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-900/20 flex-none">
                    <Layers className="text-white" size={20} />
                </div>
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-white tracking-tight capitalize whitespace-nowrap truncate">
                        {isCrdView ? currentCrdKind : activeView}
                    </h1>
                    <div className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 whitespace-nowrap">
                            <Network size={12} className="text-blue-400" />
                            {clusterName}
                        </span>
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-gray-300 whitespace-nowrap">
                            {resourceCount} Total
                        </span>
                    </div>
                </div>
            </div>

            {/* Right Section - Search and Controls */}
            <div className="flex items-center gap-3 flex-wrap flex-1 justify-end min-w-[200px]">
                {/* Search Input */}
                <div className="relative group w-full sm:w-64">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-gray-500 group-focus-within:text-blue-400 transition-colors" />
                    </div>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Search resources..."
                        className="block w-full pl-10 pr-3 py-2 border border-white/10 rounded-md leading-5 bg-black/20 text-gray-300 placeholder-gray-500 focus:outline-none focus:bg-white/5 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 sm:text-sm transition-all"
                    />
                </div>

                {/* Pod View Toggle - Only show for pods view */}
                {activeView === 'pods' && podViewMode && onPodViewModeChange && (
                    <div className="flex-none">
                        <ToggleGroup
                            value={podViewMode}
                            onChange={(v) => onPodViewModeChange(v as 'list' | 'visual')}
                            options={[
                                { value: 'list', label: 'List', icon: Layers },
                                { value: 'visual', label: 'Visual', icon: Square }
                            ]}
                        />
                    </div>
                )}

                {/* Namespace Selector */}
                <div className="flex-none">
                    <NamespaceSelector
                        namespaces={namespaces}
                        selected={selectedNamespaces}
                        onChange={onNamespaceChange}
                    />
                </div>

                {/* Stop All Port Forwards - Only show for services view */}
                {activeView === 'services' && (
                    <button
                        onClick={async () => {
                            if (confirm('Stop all active port forwards?')) {
                                await window.k8s.stopAllPortForwards();
                            }
                        }}
                        className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs border border-red-500/20 rounded flex items-center gap-2 transition-colors whitespace-nowrap"
                    >
                        <Square size={14} fill="currentColor" />
                        Stop All Forwards
                    </button>
                )}
            </div>
        </div>
    );
});

DashboardHeader.displayName = 'DashboardHeader';
