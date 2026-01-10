import { useState, useEffect, useRef, useTransition } from 'react'
import { Sparkles, Pin, Server, ChevronLeft, ChevronRight } from 'lucide-react';
import { Sidebar } from './components/features/sidebar/Sidebar'
import { SecondarySidebar } from './components/features/sidebar/SecondarySidebar'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/features/settings/Settings'
import { LogViewer, PanelTab } from './components/features/logs/LogViewer'
import { StatusBar } from './components/features/layout/StatusBar'
import { BottomPanel } from './components/features/layout/BottomPanel'
import { ToastNotification } from './components/shared/ToastNotification'
import { ConfirmModal } from './components/shared/ConfirmModal'
import { AnimatePresence } from 'framer-motion'

import { ConnectionErrorCard } from './components/dashboard/ConnectionErrorCard';
import { isEksCluster } from './utils/cluster-utils';
import { AIPanel } from './components/features/ai/AIPanel';

function App() {
    const [activeView, setActiveView] = useState<'clusters' | 'dashboard' | 'settings'>('clusters')
    const [selectedCluster, setSelectedCluster] = useState<string | null>(null)
    const [isEks, setIsEks] = useState(false);
    const [hasCertManager, setHasCertManager] = useState(false);

    // Connection State
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
    const [connectionError, setConnectionError] = useState<{ message: string; timestamp: number } | null>(null);
    const [attemptedCluster, setAttemptedCluster] = useState<string | null>(null);
    const [pinnedClusters, setPinnedClusters] = useState<string[]>([]);
    const [unpinModalOpen, setUnpinModalOpen] = useState(false);
    const [showOverflowDropdown, setShowOverflowDropdown] = useState(false);
    const [clusterToUnpin, setClusterToUnpin] = useState<string | null>(null);

    // AI Model State
    // AI Model State
    // AI Model State
    // AI Model State
    const [aiProvider, setAiProvider] = useState<'google' | 'bedrock'>(() => {
        // Use sync IPC to get persisted value on cold start
        return window.k8s.getProviderSync();
    });
    const [aiModel, setAiModel] = useState<string>(() => {
        // Use sync IPC to get persisted value on cold start
        return window.k8s.getModelSync();
    });

    // Dashboard Sub-views
    const [resourceView, setResourceView] = useState<string>('overview')

    // Performance: Use transition to make view changes non-blocking
    const [isPendingViewChange, startViewTransition] = useTransition();

    const handleViewChange = (view: string) => {
        // Make view change non-blocking - UI stays responsive
        startViewTransition(() => {
            setResourceView(view);
        });
    };

    // AI State
    const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
    const [aiContext, setAiContext] = useState<{ name: string; type: string; namespace?: string } | undefined>(undefined);
    const [aiStreamingContent, setAiStreamingContent] = useState<string>('');
    const [isAiStreaming, setIsAiStreaming] = useState(false);
    const aiCleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        window.k8s.getPinnedClusters().then(setPinnedClusters).catch(console.error);
    }, []);

    const handleTogglePin = async (clusterName: string) => {
        if (pinnedClusters.includes(clusterName)) {
            const updated = await window.k8s.removePinnedCluster(clusterName);
            setPinnedClusters(updated);
            showToast(`Unpinned ${clusterName}`, 'info');
        } else {
            const updated = await window.k8s.addPinnedCluster(clusterName);
            setPinnedClusters(updated);
            showToast(`Pinned ${clusterName}`, 'success');
        }
    };

    const handlePinClick = (e: React.MouseEvent, cluster: string) => {
        e.stopPropagation(); // Prevent cluster selection
        setClusterToUnpin(cluster);
        setUnpinModalOpen(true);
    };

    const handleConfirmUnpin = async () => {
        if (clusterToUnpin) {
            const updated = await window.k8s.removePinnedCluster(clusterToUnpin);
            setPinnedClusters(updated);
            showToast(`Unpinned ${clusterToUnpin}`, 'info');
            setClusterToUnpin(null);
        }
    };

    // Log Streaming State (Hoisted from Dashboard)
    // Log & Terminal State
    const [panelTabs, setPanelTabs] = useState<PanelTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);

    // Bottom Panel State
    const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
    const [bottomPanelHeight, setBottomPanelHeight] = useState(300);

    // Toast State
    const [toasts, setToasts] = useState<{ id: string; message: string; type?: 'success' | 'error' | 'info' }[]>([]);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        const id = Math.random().toString(36).substr(2, 9);
        setToasts(prev => [...prev, { id, message, type }]);
    };

    const removeToast = (id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    useEffect(() => {
        const cleanup = window.k8s.onPodLogChunk((streamId, chunk) => {
            setPanelTabs(prev => prev.map(tab => {
                if (tab.type !== 'log') return tab;
                const currentStreamKey = `${tab.namespace}-${tab.podName}-${tab.containerName}`;
                if (streamId === currentStreamKey) {
                    const lines = chunk.split('\n');
                    return { ...tab, logs: [...(tab.logs || []), ...lines].slice(-1000) };
                }
                return tab;
            }));
        });
        return cleanup;
    }, []);

    // Load AI model settings and pinned clusters
    useEffect(() => {
        const loadPinnedClusters = async () => {
            const pinned = await window.k8s.getPinnedClusters();
            setPinnedClusters(pinned);
        };
        loadPinnedClusters();

        // Listen for AI model changes from Settings
        const handleAIModelChange = (e: Event) => {
            const customEvent = e as CustomEvent<{ provider: "google" | "bedrock"; model: string }>;
            console.log("[AI Model] Event received:", customEvent.detail);
            setAiProvider(customEvent.detail.provider);
            setAiModel(customEvent.detail.model);
        };
        window.addEventListener("aiModelChanged", handleAIModelChange);
        return () => window.removeEventListener("aiModelChanged", handleAIModelChange);
    }, []);

    const handleClusterSelect = async (clusterName: string) => {
        // Clear previous error and set connecting state
        setConnectionStatus('connecting');
        setConnectionError(null);
        setAttemptedCluster(clusterName);

        try {
            // Pre-flight check: Try to list namespaces
            // This ensures the kubeconfig is valid and we have access
            await window.k8s.getNamespaces(clusterName);

            // Success
            setSelectedCluster(clusterName);
            setConnectionStatus('connected');
            setResourceView('overview');
            setActiveView('dashboard');

            // Check EKS status
            window.k8s.getNodes(clusterName).then(nodes => {
                setIsEks(isEksCluster(nodes));
            }).catch(e => {
                console.warn("Failed to check EKS status", e);
                setIsEks(false);
            });

            // Check Cert Manager status
            window.k8s.getCRD(clusterName, 'certificates.cert-manager.io').then(crd => {
                setHasCertManager(!!crd);
            }).catch(e => {
                console.warn("Failed to check Cert Manager status", e);
                setHasCertManager(false);
            });
        } catch (err: any) {
            console.error("Connection failed", err);
            // Failure
            const errorMessage = err.message || "Failed to connect to cluster. Please check your credentials and network connection.";
            setConnectionError({
                message: errorMessage,
                timestamp: Date.now()
            });
            setConnectionStatus('error');

            // Show toast notification with error details
            showToast(`Authentication Failed: ${errorMessage}`, 'error');
        }
    };

    const handleRetryConnection = () => {
        if (attemptedCluster) {
            handleClusterSelect(attemptedCluster);
        }
    };

    const handleOpenLogs = (pod: any, containerName: string) => {
        const name = pod.metadata?.name || pod.name;
        const namespace = pod.metadata?.namespace || pod.namespace;

        if (!name || !namespace || !selectedCluster) return;

        const tabId = `${namespace}-${name}`;
        const containers = pod.spec?.containers?.map((c: any) => c.name) || [containerName];
        const initContainers = pod.spec?.initContainers?.map((c: any) => c.name) || [];
        const allContainers = [...containers, ...initContainers];

        if (!panelTabs.find(t => t.id === tabId)) {
            const newTab: PanelTab = {
                id: tabId,
                type: 'log',
                title: name,
                subtitle: containerName,
                namespace: namespace,
                podName: name,
                containerName,
                allContainers,
                logs: []
            };
            setPanelTabs(prev => [...prev, newTab]);
            window.k8s.streamPodLogs(selectedCluster, namespace, name, containerName);
        } else {
            const existing = panelTabs.find(t => t.id === tabId);
            if (existing && existing.containerName !== containerName) {
                handleChangeContainer(tabId, containerName);
            }
        }

        setActiveTabId(tabId);
        setIsBottomPanelOpen(true); // Open the panel
    };

    const handleOpenTerminal = () => {
        // Check if we already have a terminal tab or create a new one?
        // Let's create one if none exists, or focus existing one if active.
        // User asked for "a terminal tab", implying one.
        const terminalTabId = 'local-terminal';
        const existing = panelTabs.find(t => t.id === terminalTabId);

        if (!existing) {
            setPanelTabs(prev => [...prev, {
                id: terminalTabId,
                type: 'terminal',
                title: 'Terminal'
            }]);
        }

        setActiveTabId(terminalTabId);
        setIsBottomPanelOpen(true);
    };

    const handleChangeContainer = (tabId: string, newContainer: string) => {
        const tab = panelTabs.find(t => t.id === tabId);
        if (!tab || !selectedCluster || tab.type !== 'log') return;

        if (tab.namespace && tab.podName && tab.containerName) {
            window.k8s.stopStreamPodLogs(tab.namespace, tab.podName, tab.containerName);
        }

        setPanelTabs(prev => prev.map(t => {
            if (t.id === tabId) {
                return { ...t, containerName: newContainer, subtitle: newContainer, logs: [] };
            }
            return t;
        }));

        if (tab.namespace && tab.podName) {
            window.k8s.streamPodLogs(selectedCluster, tab.namespace, tab.podName, newContainer);
        }
    };

    const handleCloseLogTab = (id: string) => {
        const tab = panelTabs.find(t => t.id === id);
        if (tab && tab.type === 'log' && tab.namespace && tab.podName && tab.containerName) {
            window.k8s.stopStreamPodLogs(tab.namespace, tab.podName, tab.containerName);
        }

        setPanelTabs(prev => {
            const newTabs = prev.filter(t => t.id !== id);
            if (activeTabId === id) {
                setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
            }
            if (newTabs.length === 0) {
                setIsBottomPanelOpen(false); // Close panel if no tabs
            }
            return newTabs;
        });
    };

    const handleSwitchTab = (id: string) => {
        setActiveTabId(id);
    };

    const handleClearLogs = (id: string) => {
        setPanelTabs(prev => prev.map(t => t.id === id ? { ...t, logs: [] } : t));
    }



    const handleOpenYaml = async (resource: any) => {
        if (!selectedCluster) return;
        const { name, namespace } = resource.metadata || resource;
        const type = resource.type;

        try {
            let yamlContent: string;
            let onSaveYaml: (newContent: string) => Promise<void>;

            if (type === 'deployment') {
                yamlContent = await window.k8s.getDeploymentYaml(selectedCluster, namespace, name);
                onSaveYaml = async (newContent: string) => {
                    try {
                        await window.k8s.updateDeploymentYaml(selectedCluster, namespace, name, newContent);
                        // Fetch latest YAML to update editor and prevent version conflicts
                        const latestYaml = await window.k8s.getDeploymentYaml(selectedCluster, namespace, name);

                        setPanelTabs(prev => prev.map(t => {
                            if (t.id === `yaml-${type}-${namespace || 'global'}-${name}`) {
                                return { ...t, yamlContent: latestYaml };
                            }
                            return t;
                        }));

                        showToast('Deployment YAML updated successfully', 'success');
                    } catch (err: any) {
                        showToast(`Update failed: ${err.message || err}`, 'error');
                        throw err;
                    }
                };
            } else if (type === 'poddisruptionbudget') {
                yamlContent = await window.k8s.getPdbYaml(selectedCluster, namespace, name);
                onSaveYaml = async (newContent: string) => {
                    try {
                        await window.k8s.updatePdbYaml(selectedCluster, namespace, name, newContent);
                        // Fetch latest YAML
                        const latestYaml = await window.k8s.getPdbYaml(selectedCluster, namespace, name);

                        setPanelTabs(prev => prev.map(t => {
                            if (t.id === `yaml-${type}-${namespace || 'global'}-${name}`) {
                                return { ...t, yamlContent: latestYaml };
                            }
                            return t;
                        }));

                        showToast('PDB YAML updated successfully', 'success');
                    } catch (err: any) {
                        showToast(`Update failed: ${err.message || err}`, 'error');
                        throw err;
                    }
                };
            } else {
                showToast(`YAML editing not yet supported for ${type}`, 'info');
                return;
            }

            const tabId = `yaml-${type}-${namespace || 'global'}-${name}`;

            // Check if tab exists
            if (!panelTabs.find(t => t.id === tabId)) {
                setPanelTabs(prev => [...prev, {
                    id: tabId,
                    type: 'yaml',
                    title: `${name}.yaml`,
                    subtitle: namespace || 'Global',
                    yamlContent,
                    onSaveYaml
                }]);
            }

            setActiveTabId(tabId);
            setIsBottomPanelOpen(true);
        } catch (err) {
            console.error("Failed to load YAML", err);
            showToast('Failed to load YAML', 'error');
        }
    };

    const handleMainMenuChange = (view: 'clusters' | 'dashboard' | 'settings') => {
        setActiveView(view);
    }

    const handleOpenAI = (context: any) => {
        // Prepare context for the panel
        // context is the K8s resource object
        const name = context.metadata?.name || context.name;
        const namespace = context.metadata?.namespace || context.namespace;
        const type = context.type || context.kind || 'Resource';

        setAiContext({ name, namespace, type });
        setIsAIPanelOpen(true);
        setAiStreamingContent('');
        setIsAiStreaming(true);

        // Cancel previous stream
        if (aiCleanupRef.current) {
            aiCleanupRef.current();
        }

        const model = localStorage.getItem('k8ptain_model') || 'gemini-1.5-flash';
        const provider = localStorage.getItem('k8ptain_provider') || 'google';

        try {
            aiCleanupRef.current = window.k8s.streamExplainResource(
                context,
                { model, provider },
                (chunk) => {
                    setAiStreamingContent(prev => prev + chunk);
                },
                () => {
                    setIsAiStreaming(false);
                    aiCleanupRef.current = null;
                },
                (err) => {
                    console.error("AI Error", err);
                    setAiStreamingContent(prev => prev + `\n\nError: ${err}`);
                    setIsAiStreaming(false);
                    aiCleanupRef.current = null;
                }
            );
        } catch (e) {
            console.error(e);
            setIsAiStreaming(false);
        }
    };

    return (
        <div className="flex h-screen bg-gradient-to-br from-slate-900 via-[#0a0a0a] to-black text-white font-sans overflow-hidden">
            {/* Left Content Area (Title Bar + Main Content + Bottom Panel) */}
            <div className="flex-1 flex flex-col min-w-0 relative">
                {/* Custom Title Bar */}
                <div
                    className="h-10 flex-none bg-transparent flex items-center justify-between px-4 select-none z-50"
                    style={{ WebkitAppRegion: 'drag' } as any}
                >
                    <div className="flex items-center">
                        <div className="w-16"></div>
                        <div className="text-xs text-gray-500 font-medium ml-2 flex items-center pt-0.5">Lumen</div>
                    </div>

                    {/* Pinned Clusters & Window Controls */}
                    <div className="flex items-center gap-4" style={{ WebkitAppRegion: 'no-drag' } as any}>
                        {/* Pinned Clusters View */}
                        {pinnedClusters.length > 0 && (
                            <div className="flex items-center gap-1.5 mr-2">
                                {pinnedClusters.slice(0, 6).map(cluster => (
                                    <div
                                        key={cluster}
                                        onClick={() => handleClusterSelect(cluster)}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors border ${selectedCluster === cluster ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'}`}
                                        title={cluster}
                                    >
                                        <Pin
                                            size={10}
                                            className="fill-current opacity-50 hover:opacity-100 transition-opacity"
                                            onClick={(e) => handlePinClick(e, cluster)}
                                        />
                                        <span className="max-w-[150px] truncate">{cluster}</span>
                                    </div>
                                ))}
                                {pinnedClusters.length > 6 && (
                                    <div className="relative">
                                        <button
                                            onClick={() => setShowOverflowDropdown(!showOverflowDropdown)}
                                            className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                                        >
                                            +{pinnedClusters.length - 6} more
                                        </button>

                                        {showOverflowDropdown && (
                                            <>
                                                {/* Backdrop to close dropdown */}
                                                <div
                                                    className="fixed inset-0 z-[100]"
                                                    onClick={() => setShowOverflowDropdown(false)}
                                                />

                                                {/* Dropdown menu */}
                                                <div className="absolute top-full right-0 mt-1 bg-[#1e1e1e] border border-white/10 rounded-md shadow-xl py-1 min-w-[180px] z-[101]">
                                                    {pinnedClusters.slice(6).map(cluster => (
                                                        <div
                                                            key={cluster}
                                                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 cursor-pointer transition-colors"
                                                        >
                                                            <Pin
                                                                size={12}
                                                                className="fill-current opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handlePinClick(e, cluster);
                                                                    setShowOverflowDropdown(false);
                                                                }}
                                                            />
                                                            <span
                                                                className="flex-1 truncate"
                                                                onClick={() => {
                                                                    handleClusterSelect(cluster);
                                                                    setShowOverflowDropdown(false);
                                                                }}
                                                            >
                                                                {cluster}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
                            onMouseDown={(e) => e.stopPropagation()}
                            className={`p-1.5 rounded-md transition-all ${isAIPanelOpen ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/10 text-gray-400'}`}
                            title="Toggle AI Assistant"
                        >
                            <Sparkles size={14} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex overflow-hidden p-4 gap-4 ">
                    {/* Main Sidebar & Content Container */}
                    <div
                        className="flex flex-1 overflow-hidden gap-4 pb-4 transition-[padding] duration-100 ease-out"
                        style={{ paddingBottom: isBottomPanelOpen ? (bottomPanelHeight + 6) : 16 }} // Add extra buffer when panel is open
                    >
                        {/* Floating Glass Sidebar Container */}
                        <div className="flex rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-white/5 backdrop-blur-xl h-full flex-shrink-0">
                            <Sidebar activeView={activeView} onChangeView={handleMainMenuChange} />

                            <SecondarySidebar
                                mode={activeView === 'settings' ? 'settings' : activeView === 'clusters' ? 'clusters' : 'resources'}
                                activeView={resourceView}
                                onSelectView={handleViewChange}
                                selectedCluster={selectedCluster}
                                onSelectCluster={handleClusterSelect}
                                connectionStatus={connectionStatus}
                                attemptedCluster={attemptedCluster}
                                pinnedClusters={pinnedClusters}
                                onTogglePin={handleTogglePin}
                                isEks={isEks}
                                hasCertManager={hasCertManager}
                                onBack={() => {
                                    setActiveView('clusters');
                                    setSelectedCluster(null); // Optional: clear selection or keep it?
                                    // User request implies "back appended before text that takes the user to the cluster"
                                    // This usually means going back to the cluster LIST.
                                    // If we clear selectedCluster, the right pane shows "Select a cluster".
                                    // If we don't, it might still show the dashboard.
                                    // Let's clear it to be consistent with 'clusters' mode.
                                    // Actually, if we keep it, we can re-select it easily.
                                    // But the prompt says "takes the user to the cluster" - well, if we are IN the cluster view, back takes us OUT.
                                }}
                            />
                        </div>

                        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                            <div className="flex-1 min-h-0 w-full relative rounded-2xl overflow-hidden border border-white/5">
                                {activeView === 'settings' ? (
                                    <Settings />
                                ) : activeView === 'clusters' && !selectedCluster ? (
                                    connectionStatus === 'error' && attemptedCluster ? (
                                        <ConnectionErrorCard
                                            clusterName={attemptedCluster}
                                            error={connectionError}
                                            onRetry={handleRetryConnection}
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-gray-500">
                                            {connectionStatus === 'connecting' ? 'Connecting to cluster...' : 'Select a cluster from the sidebar'}
                                        </div>
                                    )
                                ) : (
                                    selectedCluster ? (
                                        <Dashboard
                                            clusterName={selectedCluster}
                                            activeView={resourceView}
                                            onOpenLogs={handleOpenLogs}
                                            onNavigate={handleViewChange}
                                            onOpenYaml={handleOpenYaml}
                                            onExplain={handleOpenAI}
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-gray-500">
                                            No cluster selected
                                        </div>
                                    )
                                )}
                            </div>
                        </main>




                        {/* Bottom Panel */}
                        <BottomPanel
                            isVisible={isBottomPanelOpen}
                            onClose={() => setIsBottomPanelOpen(false)}
                            height={bottomPanelHeight}
                            onHeightChange={setBottomPanelHeight}
                        >
                            <LogViewer
                                tabs={panelTabs}
                                activeTabId={activeTabId}
                                onCloseTab={handleCloseLogTab}
                                onSwitchTab={handleSwitchTab}
                                onClearLogs={handleClearLogs}
                                onCloseViewer={() => setIsBottomPanelOpen(false)}
                                isMinimized={false}
                                onToggleMinimize={() => setIsBottomPanelOpen(false)}
                                onChangeContainer={handleChangeContainer}
                            />
                        </BottomPanel>
                    </div>



                    {/* Status Bar - Absolute at bottom of Left Content Area, need to adjust wrapper z-index or placement */}
                    {/* Actually Status Bar is typically overlay or fixed. In previous layout it was sibling to flex-col.
                If we keep it outside, it might overlay AIPanel or be covered.
                Ideally Status Bar is part of the Left Content Area at the bottom.
                But BottomPanel is also there.
                Status Bar is usually fixed bottom.
            */}
                    <div className="absolute bottom-0 left-0 w-full z-[100] ">
                        <StatusBar
                            activeCluster={selectedCluster}
                            onTogglePanel={() => {
                                if (isBottomPanelOpen) {
                                    const activeTab = panelTabs.find(t => t.id === activeTabId);
                                    if (activeTab?.type === 'terminal') {
                                        setIsBottomPanelOpen(false);
                                    } else {
                                        handleOpenTerminal();
                                    }
                                } else {
                                    handleOpenTerminal();
                                }
                            }}
                            isPanelOpen={isBottomPanelOpen}
                            notificationCount={0}
                            aiProvider={aiProvider}
                            aiModel={aiModel}
                        />
                    </div>

                    {/* Toast Notifications */}
                    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 ">
                        <AnimatePresence>
                            {toasts.map(toast => (
                                <ToastNotification
                                    key={toast.id}
                                    {...toast}
                                    onClose={removeToast}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Right Side AI Panel */}
            <AnimatePresence>
                {isAIPanelOpen && (
                    <AIPanel
                        isOpen={isAIPanelOpen}
                        onClose={() => setIsAIPanelOpen(false)}
                        currentExplanation={aiStreamingContent}
                        isStreaming={isAiStreaming}
                        resourceContext={aiContext}
                        mode="sidebar"
                    />
                )}
            </AnimatePresence>

            {/* Unpin Confirmation Modal */}
            <ConfirmModal
                isOpen={unpinModalOpen}
                onClose={() => {
                    setUnpinModalOpen(false);
                    setClusterToUnpin(null);
                }}
                onConfirm={handleConfirmUnpin}
                title="Unpin Cluster"
                message={`Are you sure you want to unpin "${clusterToUnpin}" from the top bar?`}
                confirmText="Unpin"
                cancelText="Cancel"
                variant="warning"
            />
        </div>
    )
}

export default App;
