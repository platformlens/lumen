import { useState, useEffect } from 'react'
import { Sidebar } from './components/features/sidebar/Sidebar'
import { SecondarySidebar } from './components/features/sidebar/SecondarySidebar'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/features/settings/Settings'
import { LogViewer, PanelTab } from './components/features/logs/LogViewer'
import { StatusBar } from './components/features/layout/StatusBar'
import { BottomPanel } from './components/features/layout/BottomPanel'
import { ToastNotification } from './components/shared/ToastNotification'
import { AnimatePresence } from 'framer-motion'

function App() {
  const [activeView, setActiveView] = useState<'clusters' | 'dashboard' | 'settings'>('clusters')
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null)
  
  // Dashboard Sub-views
  const [resourceView, setResourceView] = useState<string>('overview')

  // Log Streaming State (Hoisted from Dashboard)
  // Log & Terminal State
  const [panelTabs, setPanelTabs] = useState<PanelTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  
  // Bottom Panel State
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(300);

  // Toast State
  const [toasts, setToasts] = useState<{id: string; message: string; type?: 'success'|'error'|'info'}[]>([]);

  const showToast = (message: string, type: 'success'|'error'|'info' = 'success') => {
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

  const handleClusterSelect = (clusterName: string) => {
      setSelectedCluster(clusterName);
      setResourceView('overview');
      setActiveView('dashboard');
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
                      showToast('Deployment YAML updated successfully', 'success');
                  } catch (err: any) {
                      showToast(`Update failed: ${err.message || err}`, 'error');
                  }
              };
          } else if (type === 'poddisruptionbudget') {
              yamlContent = await window.k8s.getPdbYaml(selectedCluster, namespace, name);
              onSaveYaml = async (newContent: string) => {
                  try {
                      await window.k8s.updatePdbYaml(selectedCluster, namespace, name, newContent);
                      showToast('PDB YAML updated successfully', 'success');
                  } catch (err: any) {
                      showToast(`Update failed: ${err.message || err}`, 'error');
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

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-900 via-[#0a0a0a] to-black text-white font-sans overflow-hidden">
      {/* Custom Title Bar */}
      <div 
          className="h-10 flex-none bg-transparent flex items-center px-4 select-none z-50"
          style={{ WebkitAppRegion: 'drag' } as any}
      >
          <div className="w-16"></div> 
          <div className="text-xs text-gray-500 font-medium ml-2 flex items-center pt-0.5">Lumen</div>
      </div>

      <div className="flex-1 flex overflow-hidden p-4 gap-4 pb-0"> 
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
                    onSelectView={setResourceView}
                    selectedCluster={selectedCluster}
                    onSelectCluster={handleClusterSelect}
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
                   <div className="flex items-center justify-center h-full text-gray-500">
                     Select a cluster from the sidebar
                   </div>
                ) : (
                     selectedCluster ? (
                        <Dashboard 
                            clusterName={selectedCluster} 
                            activeView={resourceView}
                            onOpenLogs={handleOpenLogs}
                            onNavigate={setResourceView}
                            onOpenYaml={handleOpenYaml}
                        />
                     ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            No cluster selected
                        </div>
                     )
                )}
                </div>
              </main>
          </div>
      </div> 

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

      {/* Status Bar */}
      <StatusBar 
          activeCluster={selectedCluster} 
          onTogglePanel={() => {
              if (isBottomPanelOpen) {
                  // If panel is open...
                  const activeTab = panelTabs.find(t => t.id === activeTabId);
                  if (activeTab?.type === 'terminal') {
                      setIsBottomPanelOpen(false); // Close if already looking at terminal
                  } else {
                      handleOpenTerminal(); // Switch to terminal
                  }
              } else {
                  handleOpenTerminal();
              }
          }}
          isPanelOpen={isBottomPanelOpen}
          notificationCount={0}
      />
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
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
  )
}

export default App
