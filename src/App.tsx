import { useState, useEffect, useRef, useTransition } from 'react'
import { Sparkles, Pin } from 'lucide-react';
import { Sidebar } from './components/features/sidebar/Sidebar'
import { SecondarySidebar } from './components/features/sidebar/SecondarySidebar'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/features/settings/Settings'
import { LogViewer, PanelTab } from './components/features/logs/LogViewer'
import { StatusBar } from './components/features/layout/StatusBar'
import { BottomPanel } from './components/features/layout/BottomPanel'
import { ToastNotification } from './components/shared/ToastNotification'
import { NotificationsPanel } from './components/shared/NotificationsPanel'
import { ConfirmModal } from './components/shared/ConfirmModal'
import { OnboardingModal, DEFAULT_ONBOARDING_STEPS } from './components/shared/OnboardingModal'
import { BedrockAccessModal } from './components/shared/BedrockAccessModal'
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
    const lastResourceViewRef = useRef<string>('overview');

    // Onboarding State
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [appVersion, setAppVersion] = useState('0.0.0');

    useEffect(() => {
        const checkOnboarding = async () => {
            try {
                const version = await window.k8s.app.getVersion();
                setAppVersion(version);
                const lastSeen = await window.k8s.onboarding.getLastSeenVersion();
                if (!lastSeen || lastSeen !== version) {
                    setShowOnboarding(true);
                }
            } catch (err) {
                console.warn('Failed to check onboarding status:', err);
            }
        };
        checkOnboarding();
    }, []);

    const handleOnboardingComplete = async () => {
        setShowOnboarding(false);
        try {
            await window.k8s.onboarding.setLastSeenVersion(appVersion);
        } catch (err) {
            console.warn('Failed to save onboarding status:', err);
        }
    };

    // Bedrock Access Error State
    const [bedrockAccessError, setBedrockAccessError] = useState<{ model: string; message: string } | null>(null);

    // Listen for Bedrock access denied events from main process
    useEffect(() => {
        const cleanup = window.k8s.onBedrockAccessDenied((message) => {
            setBedrockAccessError({
                model: aiModel,
                message,
            });
        });
        return cleanup;
    }, [aiModel]);

    // --- Notification State ---
    const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
    const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
    const anomalyBatchRef = useRef<any[]>([]);
    const anomalyBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seenAnomalyIdsRef = useRef<Set<string>>(new Set());

    // Load unread count on mount
    useEffect(() => {
        window.k8s.notifications.getUnreadCount().then(setUnreadNotificationCount).catch(() => { });
    }, []);

    const refreshUnreadCount = () => {
        window.k8s.notifications.getUnreadCount().then(setUnreadNotificationCount).catch(() => { });
    };

    const handleExplainAnomaly = (notif: any) => {
        setIsNotificationsPanelOpen(false);
        const resourceName = notif.resourceName || 'Unknown';
        const resourceKind = notif.resourceKind || 'Resource';
        const namespace = notif.resourceNamespace;

        setAiContext({ name: resourceName, type: resourceKind, namespace: namespace || undefined });
        setIsAIPanelOpen(true);
        setAiStreamingContent('');
        setIsAiStreaming(true);

        const prompt = `Explain this anomaly and suggest remediation: ${notif.type} detected on ${resourceKind} "${resourceName}"${namespace ? ` in namespace "${namespace}"` : ''}. ${notif.message || ''}`;

        conversationHistoryRef.current = [];
        conversationHistoryRef.current.push({ role: 'user', content: prompt });

        const streamId = Math.random().toString(36).substring(7);
        currentStreamIdRef.current = streamId;

        let fullResponse = '';
        aiCleanupRef.current = window.k8s.streamCustomPrompt(
            prompt,
            {
                model: aiModel,
                provider: aiProvider,
                resourceName,
                resourceType: resourceKind,
                saveToHistory: true,
                promptPreview: `Explain anomaly: ${notif.type} on ${resourceName}`,
            },
            (chunk) => {
                if (currentStreamIdRef.current === streamId) {
                    fullResponse += chunk;
                    setAiStreamingContent(prev => prev + chunk);
                }
            },
            () => {
                if (currentStreamIdRef.current === streamId) {
                    conversationHistoryRef.current.push({ role: 'assistant', content: fullResponse });
                    setIsAiStreaming(false);
                    aiCleanupRef.current = null;
                }
            },
            (err) => {
                if (currentStreamIdRef.current === streamId) {
                    handleAiError(err, streamId);
                }
            }
        );
    };

    // Listen for anomaly events — batch and deduplicate
    useEffect(() => {
        const cleanup = window.k8s.context.onAnomaly((anomaly: any) => {
            const anomalyId = anomaly.id || `${anomaly.resource?.kind}/${anomaly.resource?.namespace}/${anomaly.resource?.name}/${anomaly.type}`;

            // Skip if already seen in this session
            if (seenAnomalyIdsRef.current.has(anomalyId)) return;
            seenAnomalyIdsRef.current.add(anomalyId);

            const resourceName = anomaly.resource?.name || 'Unknown';
            const resourceKind = anomaly.resource?.kind || 'Resource';

            // Persist to notification store
            window.k8s.notifications.add({
                anomalyId,
                type: anomaly.type || 'Anomaly',
                severity: anomaly.severity || 'warning',
                message: anomaly.message || 'Issue detected',
                resourceName,
                resourceKind,
                resourceNamespace: anomaly.resource?.namespace || undefined,
            }).then(() => refreshUnreadCount()).catch(() => { });

            // Batch for toast display
            anomalyBatchRef.current.push(anomaly);

            // Debounce: show a single batched toast after 2s of quiet
            if (anomalyBatchTimerRef.current) clearTimeout(anomalyBatchTimerRef.current);
            anomalyBatchTimerRef.current = setTimeout(() => {
                const batch = anomalyBatchRef.current;
                anomalyBatchRef.current = [];

                if (batch.length === 0) return;

                const first = batch[0];
                const firstName = first.resource?.name || 'Unknown';
                const firstType = first.type || 'Anomaly';
                const severity = batch.some((a: any) => a.severity === 'critical') ? 'critical' : 'warning';
                const toastType = severity === 'critical' ? 'error' as const : 'info' as const;

                const message = batch.length === 1
                    ? `${firstType}: ${firstName}`
                    : `${firstType}: ${firstName} + ${batch.length - 1} other${batch.length > 2 ? 's' : ''}`;

                showToast(message, toastType, {
                    label: 'View',
                    onClick: () => setIsNotificationsPanelOpen(true),
                });
            }, 2000);
        });

        return () => {
            cleanup();
            if (anomalyBatchTimerRef.current) clearTimeout(anomalyBatchTimerRef.current);
        };
    }, [aiModel, aiProvider]);

    const handleAiError = (err: any, streamId?: string) => {
        if (streamId && currentStreamIdRef.current !== streamId) return;
        const message = typeof err === 'string' ? err : (err?.message || String(err));
        console.error("AI Error", message);
        // Access denied errors are handled by the onBedrockAccessDenied listener above,
        // so we only append non-access errors to the streaming content.
        if (!message.includes('Model access is denied') && !message.includes('aws-marketplace')) {
            setAiStreamingContent(prev => prev + `\n\nError: ${message}`);
        }
        setIsAiStreaming(false);
        aiCleanupRef.current = null;
    };

    // Performance: Use transition to make view changes non-blocking
    const [, startViewTransition] = useTransition();

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
    const currentStreamIdRef = useRef<string>('');
    const conversationHistoryRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

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
    const [toasts, setToasts] = useState<{ id: string; message: string; type?: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } }[]>([]);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success', action?: { label: string; onClick: () => void }) => {
        const id = Math.random().toString(36).substr(2, 9);
        setToasts(prev => [...prev, { id, message, type, action }]);
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

        // Clear seen anomaly IDs on cluster switch to avoid stale dedup
        seenAnomalyIdsRef.current.clear();

        // Clear ContextEngine store so old cluster data doesn't accumulate
        window.k8s.context.clusterSwitch().catch(() => { });

        // Clear persisted notifications from previous cluster
        window.k8s.notifications.clear().then(() => {
            setUnreadNotificationCount(0);
            setIsNotificationsPanelOpen(false);
        }).catch(() => { });

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

    const handleExec = (pod: any, containerName: string) => {
        const name = pod.metadata?.name || pod.name;
        const namespace = pod.metadata?.namespace || pod.namespace;

        if (!name || !namespace || !selectedCluster) return;

        const tabId = `exec-${namespace}-${name}-${containerName}`;

        // Check if tab already exists
        if (!panelTabs.find(t => t.id === tabId)) {
            const newTab: PanelTab = {
                id: tabId,
                type: 'terminal',
                title: `${name}`,
                subtitle: `exec: ${containerName}`,
                execContext: {
                    context: selectedCluster,
                    namespace,
                    podName: name,
                    containerName
                }
            };
            setPanelTabs(prev => [...prev, newTab]);
        }

        setActiveTabId(tabId);
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

            // Map resource types to their API details
            const resourceTypeMap: Record<string, { apiVersion: string; kind: string; namespaced: boolean }> = {
                'deployment': { apiVersion: 'apps/v1', kind: 'Deployment', namespaced: true },
                'daemonset': { apiVersion: 'apps/v1', kind: 'DaemonSet', namespaced: true },
                'statefulset': { apiVersion: 'apps/v1', kind: 'StatefulSet', namespaced: true },
                'replicaset': { apiVersion: 'apps/v1', kind: 'ReplicaSet', namespaced: true },
                'pod': { apiVersion: 'v1', kind: 'Pod', namespaced: true },
                'service': { apiVersion: 'v1', kind: 'Service', namespaced: true },
                'configmap': { apiVersion: 'v1', kind: 'ConfigMap', namespaced: true },
                'secret': { apiVersion: 'v1', kind: 'Secret', namespaced: true },
                'namespace': { apiVersion: 'v1', kind: 'Namespace', namespaced: false },
                'node': { apiVersion: 'v1', kind: 'Node', namespaced: false },
                'persistentvolumeclaim': { apiVersion: 'v1', kind: 'PersistentVolumeClaim', namespaced: true },
                'persistentvolume': { apiVersion: 'v1', kind: 'PersistentVolume', namespaced: false },
                'serviceaccount': { apiVersion: 'v1', kind: 'ServiceAccount', namespaced: true },
                'job': { apiVersion: 'batch/v1', kind: 'Job', namespaced: true },
                'cronjob': { apiVersion: 'batch/v1', kind: 'CronJob', namespaced: true },
                'ingress': { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', namespaced: true },
                'ingressclass': { apiVersion: 'networking.k8s.io/v1', kind: 'IngressClass', namespaced: false },
                'networkpolicy': { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', namespaced: true },
                'storageclass': { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', namespaced: false },
                'role': { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', namespaced: true },
                'rolebinding': { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', namespaced: true },
                'clusterrole': { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole', namespaced: false },
                'clusterrolebinding': { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRoleBinding', namespaced: false },
                'horizontalpodautoscaler': { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', namespaced: true },
                'poddisruptionbudget': { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', namespaced: true },
                'priorityclass': { apiVersion: 'scheduling.k8s.io/v1', kind: 'PriorityClass', namespaced: false },
                'runtimeclass': { apiVersion: 'node.k8s.io/v1', kind: 'RuntimeClass', namespaced: false },
                'mutatingwebhookconfiguration': { apiVersion: 'admissionregistration.k8s.io/v1', kind: 'MutatingWebhookConfiguration', namespaced: false },
                'validatingwebhookconfiguration': { apiVersion: 'admissionregistration.k8s.io/v1', kind: 'ValidatingWebhookConfiguration', namespaced: false },
                'endpointslice': { apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', namespaced: true },
                'endpoint': { apiVersion: 'v1', kind: 'Endpoints', namespaced: true },
            };

            // Check if we have a mapping for this resource type
            const resourceInfo = resourceTypeMap[type];

            if (!resourceInfo) {
                // For custom resources or unmapped types, try to get info from the resource itself
                if (resource.apiVersion && resource.kind) {
                    const apiVersion = resource.apiVersion;
                    const kind = resource.kind;
                    const isNamespaced = !!namespace;

                    yamlContent = await window.k8s.getResourceYaml(selectedCluster, apiVersion, kind, name, isNamespaced ? namespace : undefined);

                    onSaveYaml = async (newContent: string) => {
                        try {
                            await window.k8s.updateResourceYaml(selectedCluster, apiVersion, kind, name, newContent, isNamespaced ? namespace : undefined);
                            const latestYaml = await window.k8s.getResourceYaml(selectedCluster, apiVersion, kind, name, isNamespaced ? namespace : undefined);

                            setPanelTabs(prev => prev.map(t => {
                                if (t.id === `yaml-${type}-${namespace || 'global'}-${name}`) {
                                    return { ...t, yamlContent: latestYaml };
                                }
                                return t;
                            }));

                            showToast(`${kind} YAML updated successfully`, 'success');
                        } catch (err: any) {
                            showToast(`Update failed: ${err.message || err}`, 'error');
                            throw err;
                        }
                    };
                } else {
                    showToast(`YAML editing not supported for ${type}`, 'info');
                    return;
                }
            } else {
                // Use the mapped resource info
                const { apiVersion, kind, namespaced } = resourceInfo;

                yamlContent = await window.k8s.getResourceYaml(selectedCluster, apiVersion, kind, name, namespaced ? namespace : undefined);

                onSaveYaml = async (newContent: string) => {
                    try {
                        await window.k8s.updateResourceYaml(selectedCluster, apiVersion, kind, name, newContent, namespaced ? namespace : undefined);
                        const latestYaml = await window.k8s.getResourceYaml(selectedCluster, apiVersion, kind, name, namespaced ? namespace : undefined);

                        setPanelTabs(prev => prev.map(t => {
                            if (t.id === `yaml-${type}-${namespace || 'global'}-${name}`) {
                                return { ...t, yamlContent: latestYaml };
                            }
                            return t;
                        }));

                        showToast(`${kind} YAML updated successfully`, 'success');
                    } catch (err: any) {
                        showToast(`Update failed: ${err.message || err}`, 'error');
                        throw err;
                    }
                };
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
        } catch (err: any) {
            console.error("Failed to load YAML", err);
            showToast(`Failed to load YAML: ${err.message || err}`, 'error');
        }
    };

    const handleMainMenuChange = (view: 'clusters' | 'dashboard' | 'settings') => {
        setActiveView(view);
        if (view === 'settings') {
            // Remember the current resource view before switching
            if (!resourceView.startsWith('settings-')) {
                lastResourceViewRef.current = resourceView;
            }
            setResourceView('settings-general');
        } else {
            // Restore the last resource view when leaving settings
            if (resourceView.startsWith('settings-')) {
                setResourceView(lastResourceViewRef.current);
            }
        }
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

        // Use state variables instead of localStorage
        const model = aiModel;
        const provider = aiProvider;

        console.log('[AI] Using provider:', provider, 'model:', model);

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
                    handleAiError(err);
                }
            );
        } catch (e) {
            console.error(e);
            setIsAiStreaming(false);
        }
    };

    const handleAnalyzeLogsWithAI = async (logs: string[], podName: string, containerName: string) => {
        // Cancel previous stream FIRST to prevent mismatch
        if (aiCleanupRef.current) {
            console.log('[AI] Canceling previous stream before starting new analysis');
            aiCleanupRef.current();
            aiCleanupRef.current = null;
        }

        // Generate unique stream ID
        const streamId = Math.random().toString(36).substring(7);
        currentStreamIdRef.current = streamId;
        console.log('[AI] Starting new stream with ID:', streamId);

        // Reset conversation history for new analysis
        conversationHistoryRef.current = [];

        // Prepare context for AI analysis
        setAiContext({ name: podName, type: 'Pod Logs', namespace: containerName });
        setIsAIPanelOpen(true);
        setAiStreamingContent('');
        setIsAiStreaming(true);

        const model = aiModel;
        const provider = aiProvider;

        console.log('[AI] Analyzing logs with provider:', provider, 'model:', model);

        // Limit logs to last 100 lines to avoid excessive billing
        const recentLogs = logs.slice(-100);
        const totalLogLines = recentLogs.length;
        const logsText = recentLogs.join('\n');

        // Import and use the log analysis prompt from prompts.ts
        const { LOG_ANALYSIS_PROMPT } = await import('../electron/prompts');
        const prompt = LOG_ANALYSIS_PROMPT(podName, containerName, logsText, totalLogLines);

        // Add to conversation history
        conversationHistoryRef.current.push({ role: 'user', content: prompt });

        try {
            let fullResponse = '';
            aiCleanupRef.current = window.k8s.streamCustomPrompt(
                prompt,
                {
                    model,
                    provider,
                    resourceName: podName,
                    resourceType: 'Pod Logs',
                    saveToHistory: true,
                    promptPreview: `Analyze logs for ${podName} (${containerName})`
                },
                (chunk) => {
                    // Only process chunks for the current stream
                    if (currentStreamIdRef.current === streamId) {
                        fullResponse += chunk;
                        setAiStreamingContent(prev => prev + chunk);
                    } else {
                        console.log('[AI] Ignoring chunk from old stream');
                    }
                },
                () => {
                    if (currentStreamIdRef.current === streamId) {
                        // Add assistant response to conversation history
                        conversationHistoryRef.current.push({ role: 'assistant', content: fullResponse });
                        setIsAiStreaming(false);
                        aiCleanupRef.current = null;
                    }
                },
                (err) => {
                    if (currentStreamIdRef.current === streamId) {
                        handleAiError(err, streamId);
                    }
                }
            );
        } catch (e) {
            console.error(e);
            if (currentStreamIdRef.current === streamId) {
                setIsAiStreaming(false);
            }
        }
    };

    const handleReloadConversation = (conversation: Array<{ role: 'user' | 'assistant'; content: string }>, context: { name: string; type: string }) => {
        console.log('[AI] Reloading conversation with', conversation.length, 'messages');

        // Restore conversation history
        conversationHistoryRef.current = conversation;

        // Set context
        setAiContext({ name: context.name, type: context.type });

        // The AIPanel will display the conversation, no need to set streaming content
    };

    const handleNewChat = () => {
        // Cancel any active stream
        if (aiCleanupRef.current) {
            aiCleanupRef.current();
            aiCleanupRef.current = null;
        }
        // Reset all AI state
        conversationHistoryRef.current = [];
        setAiStreamingContent('');
        setIsAiStreaming(false);
        setAiContext(undefined);
        // Save previous session and start a fresh one
        window.k8s.saveCurrentSession().catch(() => { });
        window.k8s.startSession(undefined).catch(() => { });
    };

    const handleSendPrompt = async (userPrompt: string) => {
        // Add guardrails - check if the prompt is Kubernetes-related
        const k8sKeywords = [
            'kubernetes', 'k8s', 'pod', 'deployment', 'service', 'namespace', 'container',
            'node', 'cluster', 'helm', 'kubectl', 'ingress', 'configmap', 'secret',
            'volume', 'pvc', 'statefulset', 'daemonset', 'job', 'cronjob', 'replica',
            'hpa', 'autoscal', 'resource', 'yaml', 'manifest', 'api', 'etcd',
            'kube-', 'docker', 'image', 'registry', 'label', 'selector', 'annotation',
            'taint', 'toleration', 'affinity', 'network', 'policy', 'rbac', 'role',
            'serviceaccount', 'endpoint', 'port', 'probe', 'liveness', 'readiness',
            'restart', 'crash', 'oom', 'cpu', 'memory', 'storage', 'persistent',
            'log', 'event', 'status', 'describe', 'get', 'apply', 'delete', 'scale',
            'rollout', 'update', 'upgrade', 'version', 'cert-manager', 'istio',
            'prometheus', 'grafana', 'monitoring', 'observability', 'eks', 'gke', 'aks',
            'karpenter', 'argo', 'flux', 'operator', 'crd', 'custom resource'
        ];

        const lowerPrompt = userPrompt.toLowerCase();
        const isK8sRelated = k8sKeywords.some(keyword => lowerPrompt.includes(keyword));

        if (!isK8sRelated) {
            // Reject non-Kubernetes queries - append to existing content
            const rejectionMessage = `\n\n---\n\n**User:** ${userPrompt}\n\n**Assistant:** I'm a Kubernetes assistant designed to help with cluster management, troubleshooting, and Kubernetes-related questions only. I cannot assist with topics outside of Kubernetes, container orchestration, and related cloud-native technologies.\n\nPlease ask me about:\n- Kubernetes resources and configurations\n- Pod, deployment, and service issues\n- Cluster troubleshooting\n- Helm charts and package management\n- Container and image management\n- Kubernetes best practices\n- Cloud provider integrations (EKS, GKE, AKS)\n- Monitoring and observability tools\n`;
            setAiStreamingContent(prev => prev + rejectionMessage);
            return;
        }

        // Cancel previous stream FIRST to prevent mismatch
        if (aiCleanupRef.current) {
            console.log('[AI] Canceling previous stream before starting new chat');
            aiCleanupRef.current();
            aiCleanupRef.current = null;
        }

        // Generate unique stream ID
        const streamId = Math.random().toString(36).substring(7);
        currentStreamIdRef.current = streamId;
        console.log('[AI] Starting new chat stream with ID:', streamId);

        // Clear previous content and start streaming for valid Kubernetes queries
        setAiStreamingContent('');
        setIsAiStreaming(true);

        const model = aiModel;
        const provider = aiProvider;

        console.log('[AI] Sending custom prompt with provider:', provider, 'model:', model);

        // Import and use the chat system prompt from prompts.ts
        const { getChatSystemPrompt } = await import('../electron/prompts');
        const systemPrompt = getChatSystemPrompt(aiContext);

        // Add user message to conversation history
        conversationHistoryRef.current.push({ role: 'user', content: userPrompt });

        try {
            let fullResponse = '';
            aiCleanupRef.current = window.k8s.streamCustomPrompt(
                userPrompt,
                {
                    model,
                    provider,
                    systemPrompt,
                    messages: conversationHistoryRef.current, // Pass conversation history
                    resourceName: aiContext?.name || 'Chat',
                    resourceType: aiContext?.type || 'Conversation',
                    saveToHistory: true // Save session after each response
                },
                (chunk) => {
                    // Only process chunks for the current stream
                    if (currentStreamIdRef.current === streamId) {
                        fullResponse += chunk;
                        setAiStreamingContent(prev => prev + chunk);
                    } else {
                        console.log('[AI] Ignoring chunk from old stream');
                    }
                },
                () => {
                    if (currentStreamIdRef.current === streamId) {
                        // Add assistant response to conversation history
                        conversationHistoryRef.current.push({ role: 'assistant', content: fullResponse });
                        console.log('[AI] Conversation history length:', conversationHistoryRef.current.length);
                        setIsAiStreaming(false);
                        aiCleanupRef.current = null;
                        // Always save the session after a completed response
                        window.k8s.saveCurrentSession().catch(() => { });
                    }
                },
                (err) => {
                    if (currentStreamIdRef.current === streamId) {
                        handleAiError(err, streamId);
                    }
                }
            );
        } catch (e) {
            console.error(e);
            if (currentStreamIdRef.current === streamId) {
                setIsAiStreaming(false);
            }
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
                                    <Settings activeSection={resourceView} />
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
                                            onExec={handleExec}
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
                                onAnalyzeWithAI={handleAnalyzeLogsWithAI}
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
                    <div className="absolute bottom-0 left-0 w-full z-[100]">
                        <div className="relative">
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
                                notificationCount={unreadNotificationCount}
                                onToggleNotifications={() => {
                                    setIsNotificationsPanelOpen(prev => !prev);
                                }}
                                isNotificationsPanelOpen={isNotificationsPanelOpen}
                                aiProvider={aiProvider}
                                aiModel={aiModel}
                            />
                            <AnimatePresence>
                                {isNotificationsPanelOpen && (
                                    <>
                                        <div className="fixed inset-0 z-[109]" onClick={() => { setIsNotificationsPanelOpen(false); refreshUnreadCount(); }} />
                                        <NotificationsPanel
                                            isOpen={isNotificationsPanelOpen}
                                            onClose={() => { setIsNotificationsPanelOpen(false); refreshUnreadCount(); }}
                                            onExplainAnomaly={handleExplainAnomaly}
                                            onClear={() => { seenAnomalyIdsRef.current.clear(); refreshUnreadCount(); }}
                                        />
                                    </>
                                )}
                            </AnimatePresence>
                        </div>
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
                        clusterContext={selectedCluster || undefined}
                        onSendPrompt={handleSendPrompt}
                        onReloadConversation={handleReloadConversation}
                        onNewChat={handleNewChat}
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

            {/* Onboarding Modal */}
            <OnboardingModal
                isOpen={showOnboarding}
                onComplete={handleOnboardingComplete}
                steps={DEFAULT_ONBOARDING_STEPS}
                appVersion={appVersion}
            />

            {/* Bedrock Access Error Modal */}
            <BedrockAccessModal
                isOpen={!!bedrockAccessError}
                onClose={() => setBedrockAccessError(null)}
                modelId={bedrockAccessError?.model || ''}
            />
        </div>
    )
}

export default App;
