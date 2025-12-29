import React, { useEffect, useRef } from 'react';
import { X, Terminal, Trash2, FileText, Maximize2, Minimize2, PenTool } from 'lucide-react';
import { TerminalComponent } from './TerminalComponent';
import { YamlEditor } from './YamlEditor';

export type PanelTabType = 'log' | 'terminal' | 'yaml';

export interface PanelTab {
    id: string; 
    type: PanelTabType;
    title: string;
    subtitle?: string;
    
    // Log Specific
    namespace?: string;
    podName?: string;
    containerName?: string;
    allContainers?: string[];
    logs?: string[];
    
    // YAML Specific
    yamlContent?: string;
    onSaveYaml?: (content: string) => Promise<void>;
}

interface LogViewerProps {
    tabs: PanelTab[];
    activeTabId: string | null;
    onCloseTab: (id: string) => void;
    onSwitchTab: (id: string) => void;
    onClearLogs: (id: string) => void;
    onCloseViewer: () => void;
    onChangeContainer: (tabId: string, newContainer: string) => void;
    isMinimized: boolean;
    onToggleMinimize: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ 
    tabs, 
    activeTabId, 
    onCloseTab, 
    onSwitchTab, 
    onClearLogs,
    onCloseViewer,
    onChangeContainer,
    isMinimized,
    onToggleMinimize
}) => {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const activeTab = tabs.find(t => t.id === activeTabId);

    // Auto-scroll logic for logs
    useEffect(() => {
        if (activeTab?.type === 'log' && logsEndRef.current) {
             logsEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
    }, [activeTab?.logs?.length, activeTab?.id]); 

    return (
        <div className="flex flex-col h-full w-full bg-[#0d0d0d]">
            {/* Header / Tabs */}
            <div className="flex items-center bg-white/5 border-b border-white/10 pr-2 h-9 flex-none">
                <div className="flex-1 flex overflow-x-auto no-scrollbar min-w-0">
                    {tabs.length === 0 && (
                        <div className="px-3 h-9 flex items-center text-xs text-gray-500 italic">
                            No active sessions
                        </div>
                    )}
                    {tabs.map(tab => (
                        <div 
                            key={tab.id}
                            className={`
                                group flex items-center gap-2 px-3 h-9 text-xs border-r border-white/10 cursor-pointer min-w-[150px] max-w-[250px] flex-shrink-0
                                ${activeTabId === tab.id ? 'bg-white/10 text-white border-b-0 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.1)]' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border-b border-white/10'}
                            `}
                            onClick={(e) => { e.stopPropagation(); onSwitchTab(tab.id); }}
                        >
                            {tab.type === 'terminal' ? (
                                <Terminal size={14} className={activeTabId === tab.id ? 'text-green-400' : 'text-gray-500'} />
                            ) : tab.type === 'yaml' ? (
                                <PenTool size={14} className={activeTabId === tab.id ? 'text-yellow-400' : 'text-gray-500'} />
                            ) : (
                                <FileText size={14} className={activeTabId === tab.id ? 'text-blue-400' : 'text-gray-500'} />
                            )}
                            <div className="flex flex-col truncate flex-1">
                                <span className="font-medium truncate">{tab.title}</span>
                                {tab.subtitle && <span className="text-[10px] opacity-70 truncate">{tab.subtitle}</span>}
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                                className="opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-red-400 p-0.5 rounded transition-all"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-1 pl-2">
                    {/* Container Selector (Logs only) */}
                    {!isMinimized && activeTab && activeTab.type === 'log' && activeTab.allContainers && activeTab.allContainers.length > 1 && (
                         <div className="flex items-center px-2 mr-2 border-r border-white/10 h-5">
                             <span className="text-[10px] text-gray-500 mr-2 uppercase font-bold tracking-wider">Container</span>
                             <select 
                                value={activeTab.containerName}
                                onChange={(e) => onChangeContainer(activeTab.id, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-black/50 text-blue-400 text-xs border border-white/10 rounded px-2 py-0.5 focus:outline-none focus:border-blue-500/50 hover:border-white/20 transition-colors"
                             >
                                 {activeTab.allContainers.map(c => (
                                     <option key={c} value={c}>{c}</option>
                                 ))}
                             </select>
                        </div>
                    )}

                    {!isMinimized && activeTab && activeTab.type === 'log' && (
                         <button 
                            onClick={(e) => { e.stopPropagation(); onClearLogs(activeTab.id); }}
                            className="p-1.5 hover:bg-white/10 text-gray-400 hover:text-white rounded transition-colors"
                            title="Clear Logs"
                         >
                            <Trash2 size={16} />
                         </button>
                    )}

                    <button 
                        onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}
                        className="p-1.5 hover:bg-white/10 text-gray-400 hover:text-white rounded transition-colors"
                        title={isMinimized ? "Maximize" : "Minimize"}
                    >
                        {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                    </button>
                    
                    <button 
                        onClick={(e) => { e.stopPropagation(); onCloseViewer(); }}
                        className="p-1.5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded transition-colors ml-1"
                        title="Close Panel"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-hidden bg-[#0d0d0d] font-mono text-xs relative">
                {/* 1. Always render ALL terminal tabs, hidden if inactive */}
                {tabs.filter(t => t.type === 'terminal').map(tab => (
                    <div 
                        key={tab.id} 
                        className="w-full h-full p-2"
                        style={{ display: activeTabId === tab.id ? 'block' : 'none' }}
                    >
                        <TerminalComponent id={tab.id} />
                    </div>
                ))}

                {/* 2. Render Log Content */}
                {activeTab && activeTab.type === 'log' && (
                     <div className="absolute inset-0 overflow-auto p-3 text-gray-300 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                        <div className="space-y-0.5">
                            {(!activeTab.logs || activeTab.logs.length === 0) && (
                                <div className="text-gray-600 italic p-4 text-center">Waiting for logs...</div>
                            )}
                            {activeTab.logs?.map((log, idx) => (
                                <div key={idx} className="whitespace-pre-wrap break-all px-2 py-0.5 leading-relaxed hover:bg-white/5 transition-colors border-l-2 border-transparent hover:border-blue-500/50">
                                    {log}
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                )}
                
                {/* 3. Render YAML Editor */}
                {activeTab && activeTab.type === 'yaml' && activeTab.yamlContent && activeTab.onSaveYaml && (
                    <div className="absolute inset-0 z-10 bg-[#1e1e1e]">
                        <YamlEditor 
                            initialYaml={activeTab.yamlContent}
                            onSave={activeTab.onSaveYaml} 
                        />
                    </div>
                )}

                {/* 4. Empty State */}
                {!activeTab && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
                        <Terminal size={32} className="opacity-20" />
                        <p>Select a pod to view logs or open a terminal</p>
                    </div>
                )}
            </div>
        </div>
    );
};
