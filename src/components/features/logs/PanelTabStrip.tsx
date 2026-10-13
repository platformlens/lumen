import React from 'react';
import { X, Terminal, FileText, PenTool } from 'lucide-react';
import type { PanelTab } from './LogViewer';

interface PanelTabStripProps {
    tabs: PanelTab[];
    activeTabId: string | null;
    dirtyTabIds: ReadonlySet<string>;
    onSwitchTab: (id: string) => void;
    onCloseTab: (id: string) => void;
}

/** Bottom-panel tab headers (logs, terminals, YAML editors). Presentational only. */
export const PanelTabStrip: React.FC<PanelTabStripProps> = React.memo(({
    tabs,
    activeTabId,
    dirtyTabIds,
    onSwitchTab,
    onCloseTab,
}) => (
    <div className="flex-1 flex overflow-x-auto no-scrollbar min-w-0">
        {tabs.length === 0 && (
            <div className="px-3 h-9 flex items-center text-xs text-gray-500 italic">
                No active sessions
            </div>
        )}
        {tabs.map(tab => {
            const isActive = activeTabId === tab.id;
            const isDirty = dirtyTabIds.has(tab.id);
            return (
                <div
                    key={tab.id}
                    title={tab.clusterContext ? `Context: ${tab.clusterContext}` : undefined}
                    className={`
                        group flex items-center gap-2 px-3 h-9 text-xs border-r border-white/10 cursor-pointer min-w-[150px] max-w-[250px] flex-shrink-0
                        ${isActive ? 'bg-white/10 text-white border-b-0 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.1)]' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border-b border-white/10'}
                    `}
                    onClick={(e) => { e.stopPropagation(); onSwitchTab(tab.id); }}
                >
                    {tab.type === 'terminal' ? (
                        <Terminal size={14} className={isActive ? 'text-green-400' : 'text-gray-500'} />
                    ) : tab.type === 'yaml' ? (
                        <PenTool size={14} className={isActive ? 'text-blue-400' : 'text-gray-500'} />
                    ) : (
                        <FileText size={14} className={isActive ? 'text-blue-400' : 'text-gray-500'} />
                    )}
                    <div className="flex flex-col truncate flex-1">
                        <span className="font-medium truncate">{tab.title}</span>
                        {tab.subtitle && <span className="text-[10px] opacity-70 truncate">{tab.subtitle}</span>}
                    </div>
                    {isDirty && (
                        <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" title="Unsaved changes" />
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                        className="opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-red-400 p-0.5 rounded transition-all"
                        aria-label={`Close ${tab.title}`}
                    >
                        <X size={14} />
                    </button>
                </div>
            );
        })}
    </div>
));
