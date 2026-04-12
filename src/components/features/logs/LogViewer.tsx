import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, Terminal, Trash2, FileText, Maximize2, Minimize2, PenTool, Sparkles, ExternalLink, Search, Download, ArrowDown, ChevronUp, ChevronDown } from 'lucide-react';
import { TerminalComponent } from '../terminal/TerminalComponent';
import { YamlEditor } from '../yaml-editor/YamlEditor';

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

    // Terminal Exec Specific
    execContext?: {
        context: string;
        namespace: string;
        podName: string;
        containerName?: string;
    };

    // Terminal Command
    initialCommand?: string;

    // YAML Specific
    yamlContent?: string;
    onSaveYaml?: (content: string) => Promise<void>;
    filePath?: string; // set for local files opened from disk
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
    onAnalyzeWithAI?: (logs: string[], podName: string, containerName: string) => void;
    onPopOutTab?: (tabId: string) => void;
}

export const LogViewer: React.FC<LogViewerProps> = React.memo(({
    tabs,
    activeTabId,
    onCloseTab,
    onSwitchTab,
    onClearLogs,
    onCloseViewer,
    onChangeContainer,
    isMinimized,
    onToggleMinimize,
    onAnalyzeWithAI,
    onPopOutTab,
}) => {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const activeTab = tabs.find(t => t.id === activeTabId);

    // Track whether the user is pinned to the bottom (auto-follow mode)
    const [isAtBottom, setIsAtBottom] = useState(true);

    // Search state
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [matchIndex, setMatchIndex] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const matchRefs = useRef<Map<number, HTMLDivElement>>(new Map());

    // Detect scroll position to determine if user is at the bottom
    const handleScroll = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const threshold = 40; // px from bottom to consider "at bottom"
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
        setIsAtBottom(atBottom);
    }, []);

    // Auto-scroll only when pinned to bottom
    useEffect(() => {
        if (activeTab?.type === 'log' && isAtBottom && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
    }, [activeTab?.logs?.length, activeTab?.id, isAtBottom]);

    // Reset to bottom when switching tabs
    useEffect(() => {
        setIsAtBottom(true);
        setSearchOpen(false);
        setSearchQuery('');
        setMatchIndex(0);
    }, [activeTabId]);

    const scrollToBottom = useCallback(() => {
        setIsAtBottom(true);
        logsEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, []);

    // Compute search matches
    const searchMatches = useMemo(() => {
        if (!searchQuery || !activeTab?.logs) return [];
        const query = searchQuery.toLowerCase();
        const matches: number[] = [];
        activeTab.logs.forEach((line, idx) => {
            if (line.toLowerCase().includes(query)) {
                matches.push(idx);
            }
        });
        return matches;
    }, [searchQuery, activeTab?.logs]);

    // Clamp matchIndex when matches change
    useEffect(() => {
        if (searchMatches.length === 0) {
            setMatchIndex(0);
        } else if (matchIndex >= searchMatches.length) {
            setMatchIndex(searchMatches.length - 1);
        }
    }, [searchMatches.length, matchIndex]);

    // Scroll to current match
    useEffect(() => {
        if (searchMatches.length > 0 && matchRefs.current.has(searchMatches[matchIndex])) {
            const el = matchRefs.current.get(searchMatches[matchIndex]);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setIsAtBottom(false);
        }
    }, [matchIndex, searchMatches]);

    // Focus search input when opened
    useEffect(() => {
        if (searchOpen) {
            searchInputRef.current?.focus();
        }
    }, [searchOpen]);

    // Keyboard shortcut: Cmd/Ctrl+F to open search
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f' && activeTab?.type === 'log') {
                e.preventDefault();
                setSearchOpen(true);
            }
            if (e.key === 'Escape' && searchOpen) {
                setSearchOpen(false);
                setSearchQuery('');
                setMatchIndex(0);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTab?.type, searchOpen]);

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (searchMatches.length > 0) {
                if (e.shiftKey) {
                    setMatchIndex(prev => (prev - 1 + searchMatches.length) % searchMatches.length);
                } else {
                    setMatchIndex(prev => (prev + 1) % searchMatches.length);
                }
            }
        }
    };

    const handleExportLogs = useCallback(() => {
        if (!activeTab?.logs || activeTab.logs.length === 0) return;
        const content = activeTab.logs.join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const podName = activeTab.podName || 'logs';
        const container = activeTab.containerName ? `-${activeTab.containerName}` : '';
        a.download = `${podName}${container}-${timestamp}.log`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [activeTab?.logs, activeTab?.podName, activeTab?.containerName]);

    // Build a set of matching line indices for O(1) lookup during render
    const matchSet = useMemo(() => new Set(searchMatches), [searchMatches]);
    const currentMatchLine = searchMatches.length > 0 ? searchMatches[matchIndex] : -1;

    // Highlight matching text within a line
    const highlightLine = useCallback((line: string, isCurrentMatch: boolean) => {
        if (!searchQuery) return line;
        const query = searchQuery.toLowerCase();
        const parts: React.ReactNode[] = [];
        let remaining = line;
        let key = 0;
        while (remaining.length > 0) {
            const idx = remaining.toLowerCase().indexOf(query);
            if (idx === -1) {
                parts.push(remaining);
                break;
            }
            if (idx > 0) {
                parts.push(remaining.slice(0, idx));
            }
            parts.push(
                <mark
                    key={key++}
                    className={isCurrentMatch ? 'bg-yellow-400/80 text-black rounded-sm px-0.5' : 'bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5'}
                >
                    {remaining.slice(idx, idx + query.length)}
                </mark>
            );
            remaining = remaining.slice(idx + query.length);
        }
        return parts;
    }, [searchQuery]);

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
                                <PenTool size={14} className={activeTabId === tab.id ? 'text-blue-400' : 'text-gray-500'} />
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

                    {/* Search toggle */}
                    {!isMinimized && activeTab && activeTab.type === 'log' && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setSearchOpen(prev => {
                                    if (prev) {
                                        setSearchQuery('');
                                        setMatchIndex(0);
                                    }
                                    return !prev;
                                });
                            }}
                            className={`p-1.5 rounded transition-colors ${searchOpen ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/10 text-gray-400 hover:text-white'}`}
                            title="Search Logs (⌘F)"
                        >
                            <Search size={16} />
                        </button>
                    )}

                    {/* Export logs */}
                    {!isMinimized && activeTab && activeTab.type === 'log' && activeTab.logs && activeTab.logs.length > 0 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleExportLogs(); }}
                            className="p-1.5 hover:bg-white/10 text-gray-400 hover:text-white rounded transition-colors"
                            title="Export Logs"
                        >
                            <Download size={16} />
                        </button>
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

                    {activeTab && activeTab.type === 'yaml' && onPopOutTab && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onPopOutTab(activeTab.id); }}
                            className="p-1.5 hover:bg-blue-500/20 text-gray-400 hover:text-blue-400 rounded transition-colors"
                            title="Open in window"
                        >
                            <ExternalLink size={16} />
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

            {/* Search Bar */}
            {searchOpen && activeTab?.type === 'log' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border-b border-white/10 flex-none">
                    <Search size={14} className="text-gray-500 flex-shrink-0" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setMatchIndex(0); }}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search logs..."
                        className="flex-1 bg-transparent border-none outline-none text-sm text-gray-200 placeholder-gray-500"
                    />
                    {searchQuery && (
                        <span className="text-xs text-gray-500 flex-shrink-0 tabular-nums">
                            {searchMatches.length > 0 ? `${matchIndex + 1} of ${searchMatches.length}` : 'No results'}
                        </span>
                    )}
                    {searchQuery && searchMatches.length > 0 && (
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button
                                onClick={() => setMatchIndex(prev => (prev - 1 + searchMatches.length) % searchMatches.length)}
                                className="p-0.5 hover:bg-white/10 text-gray-400 hover:text-white rounded transition-colors"
                                title="Previous match (Shift+Enter)"
                            >
                                <ChevronUp size={14} />
                            </button>
                            <button
                                onClick={() => setMatchIndex(prev => (prev + 1) % searchMatches.length)}
                                className="p-0.5 hover:bg-white/10 text-gray-400 hover:text-white rounded transition-colors"
                                title="Next match (Enter)"
                            >
                                <ChevronDown size={14} />
                            </button>
                        </div>
                    )}
                    <button
                        onClick={() => { setSearchOpen(false); setSearchQuery(''); setMatchIndex(0); }}
                        className="p-0.5 hover:bg-white/10 text-gray-400 hover:text-white rounded transition-colors flex-shrink-0"
                        title="Close search (Esc)"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Content Body */}
            <div className="flex-1 overflow-hidden bg-[#0d0d0d] font-mono text-xs relative">
                {/* 1. Always render ALL terminal tabs, hidden if inactive */}
                {tabs.filter(t => t.type === 'terminal').map(tab => (
                    <div
                        key={tab.id}
                        className="w-full h-full p-2"
                        style={{ display: activeTabId === tab.id ? 'block' : 'none' }}
                    >
                        <TerminalComponent id={tab.id} execContext={tab.execContext} initialCommand={tab.initialCommand} />
                    </div>
                ))}

                {/* 2. Render Log Content */}
                {activeTab && activeTab.type === 'log' && (
                    <>
                        <div
                            ref={scrollContainerRef}
                            onScroll={handleScroll}
                            className="absolute inset-0 overflow-auto p-3 text-gray-300 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
                        >
                            <div className="space-y-0.5">
                                {(!activeTab.logs || activeTab.logs.length === 0) && (
                                    <div className="text-gray-600 italic p-4 text-center">Waiting for logs...</div>
                                )}
                                {activeTab.logs?.map((log, idx) => {
                                    const isMatch = matchSet.has(idx);
                                    const isCurrent = idx === currentMatchLine;
                                    return (
                                        <div
                                            key={idx}
                                            ref={(el) => {
                                                if (el && isMatch) {
                                                    matchRefs.current.set(idx, el);
                                                } else {
                                                    matchRefs.current.delete(idx);
                                                }
                                            }}
                                            className={`whitespace-pre-wrap break-all px-2 py-0.5 leading-relaxed transition-colors border-l-2 ${
                                                isCurrent
                                                    ? 'bg-yellow-500/15 border-yellow-500/70'
                                                    : isMatch
                                                        ? 'bg-yellow-500/5 border-yellow-500/30'
                                                        : 'border-transparent hover:bg-white/5 hover:border-blue-500/50'
                                            }`}
                                        >
                                            {isMatch ? highlightLine(log, isCurrent) : log}
                                        </div>
                                    );
                                })}
                                <div ref={logsEndRef} />
                            </div>
                        </div>

                        {/* Scroll-to-bottom button — shown when user has scrolled up */}
                        {!isAtBottom && (
                            <button
                                onClick={scrollToBottom}
                                className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/15 backdrop-blur-sm text-gray-300 hover:text-white rounded-full border border-white/10 shadow-lg transition-all text-xs z-40"
                                title="Scroll to latest"
                            >
                                <ArrowDown size={14} />
                                <span>Follow logs</span>
                            </button>
                        )}

                        {/* Floating AI Analyze Button - positioned relative to log viewer */}
                        {onAnalyzeWithAI && activeTab.logs && activeTab.logs.length > 0 && (
                            <button
                                onClick={() => onAnalyzeWithAI(
                                    activeTab.logs || [],
                                    activeTab.podName || '',
                                    activeTab.containerName || ''
                                )}
                                className="absolute bottom-6 right-6 flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-full shadow-lg shadow-purple-900/50 transition-all hover:shadow-xl hover:shadow-purple-900/70 hover:scale-105 font-medium text-sm z-50 group"
                                title="Analyze logs with AI"
                            >
                                <Sparkles size={18} className="group-hover:animate-pulse" />
                                <span>Analyze with AI</span>
                            </button>
                        )}
                    </>
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
});
