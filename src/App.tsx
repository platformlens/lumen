import { useState, useEffect, useRef, useTransition, useMemo, useCallback } from 'react'
import { Sparkles, Pin, PenTool } from 'lucide-react';
import { Sidebar } from './components/features/sidebar/Sidebar'
import { SecondarySidebar } from './components/features/sidebar/SecondarySidebar'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/features/settings/Settings'
import { LogViewer, PanelTab } from './components/features/logs/LogViewer'
import { YamlEditor } from './components/features/yaml-editor/YamlEditor'
import { StatusBar } from './components/features/layout/StatusBar'
import { BottomPanel } from './components/features/layout/BottomPanel'
import { ToastNotification } from './components/shared/ToastNotification'
import { NotificationsPanel } from './components/shared/NotificationsPanel'
import { ConfirmModal } from './components/shared/ConfirmModal'
import { OnboardingModal, DEFAULT_ONBOARDING_STEPS } from './components/shared/OnboardingModal'
import { SplashScreen } from './components/shared/SplashScreen'
import { WhatsNewModal } from './components/shared/WhatsNewModal'
import { shouldShowWhatsNew, handleDismiss } from './utils/whats-new-utils'
import { BedrockAccessModal } from './components/shared/BedrockAccessModal'
import { AnimatePresence } from 'framer-motion'

import { AuthView } from './components/features/auth/AuthView';
import { useAuthStore } from './stores/authStore';
import { useClusterContexts } from './hooks/useClusterContexts';
import { useResourceSync } from './hooks/useResourceSync';
import { renameMapKey, remapPanelTab } from './utils/cluster-rename-utils';
import { ConnectionErrorCard } from './components/dashboard/ConnectionErrorCard';
import { isEksCluster } from './utils/cluster-utils';
import { RESOURCE_TYPE_MAP } from './utils/resource-utils';
import { buildYamlTabId } from './utils/yaml-draft-utils';
import { createLocalTerminalTab, findReusableLocalTerminal } from './utils/terminal-tab-utils';
import { AIPanel } from './components/features/ai/AIPanel';
import { ViewTabBar, ViewTab } from './components/dashboard/ViewTabBar';
import { getViewLabel } from './utils/view-labels';
import { assistantContentForModelHistory } from './utils/ai-thinking';
import {
    addGeminiMeter,
    EMPTY_GEMINI_METER,
    type AiStreamUsagePayload,
    type GeminiSessionMeter,
} from './utils/ai-meter';

function App() {
    const [activeView, setActiveView] = useState<'clusters' | 'dashboard' | 'settings' | 'editor' | 'user'>('clusters')
    const [selectedCluster, setSelectedCluster] = useState<string | null>(null)
    // Bumped on every connect attempt (success or failure) so the resource sync effect re-runs once
    const [syncEpoch, setSyncEpoch] = useState(0)
    const [isEks, setIsEks] = useState(false);
    const [theme, setTheme] = useState<'blue' | 'charcoal' | 'red'>('charcoal');
    const [hasCertManager, setHasCertManager] = useState(false);
    const [hasKarpenter, setHasKarpenter] = useState(false);
    const [hasCrossplane, setHasCrossplane] = useState(false);
    const crossplaneDetectSeq = useRef(0);

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
    const [aiProvider, setAiProvider] = useState<'google' | 'bedrock' | 'local'>(() => {
        // Use sync IPC to get persisted value on cold start
        return window.k8s.getProviderSync();
    });
    const [aiModel, setAiModel] = useState<string>(() => {
        // Use sync IPC to get persisted value on cold start
        return window.k8s.getModelSync();
    });
    const [geminiSessionMeter, setGeminiSessionMeter] = useState<GeminiSessionMeter>(() => ({
        ...EMPTY_GEMINI_METER,
    }));
    const [geminiServiceTier, setGeminiServiceTier] = useState<'standard' | 'flex'>('standard');

    // Dashboard Sub-views
    const [resourceView, setResourceView] = useState<string>('overview')
    const lastResourceViewRef = useRef<string>('overview');

    // Shared kube context list (sidebar, status bar). Stays in sync with the kubeconfig file on disk.
    const { clusters: clustersList, applyClusters } = useClusterContexts((payload) => {
        // The connected cluster's context was removed from the kubeconfig: leave it and return to the list
        // (the hook keeps the latest callback in a ref, so `selectedCluster` here is never stale)
        if (selectedCluster && payload.removed.includes(selectedCluster)) {
            showToastRef.current?.(`Context "${selectedCluster}" was removed from your kubeconfig.`, 'info');
            setSelectedCluster(null);
            setActiveView('clusters');
        }
    });

    // AWS Profile state for StatusBar indicator
    const [awsProfile, setAwsProfile] = useState<string>('default');
    const [awsProfiles, setAwsProfiles] = useState<string[]>([]);

    // Per-cluster view tabs (in-memory only — resets on app restart)
    const viewTabsByClusterRef = useRef<Map<string, ViewTab[]>>(new Map());
    const [viewTabsVersion, setViewTabsVersion] = useState(0);
    const bumpViewTabs = () => setViewTabsVersion(v => v + 1);

    // Derived: tabs for the currently selected cluster
    const viewTabs = useMemo(
        () => selectedCluster ? (viewTabsByClusterRef.current.get(selectedCluster) ?? []) : [],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedCluster, viewTabsVersion]
    );

    // Onboarding State
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [appVersion, setAppVersion] = useState('0.0.0');

    // Splash screen state
    const [showSplash, setShowSplash] = useState(true);

    useEffect(() => {
        const checkOnboarding = async () => {
            try {
                const version = await window.k8s.app.getVersion();
                setAppVersion(version);
                window.__APP_VERSION__ = version;
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

    // Restore auth session on app mount
    useEffect(() => {
        useAuthStore.getState().initialize();
    }, []);

    // Fetch AWS profiles for StatusBar indicator
    useEffect(() => {
        window.k8s.aws.listProfiles().then(setAwsProfiles).catch(console.error);
        window.k8s.aws.getProfile().then(p => setAwsProfile(p || 'default')).catch(console.error);
    }, []);

    // Listen for AWS credential changes
    useEffect(() => {
        const cleanup = window.k8s.aws.onCredentialsChanged((data: { identity?: string; profile?: string }) => {
            if (data.profile) setAwsProfile(data.profile);
        });
        return cleanup;
    }, []);

    const handleOnboardingComplete = async () => {
        setShowOnboarding(false);
        try {
            await window.k8s.onboarding.setLastSeenVersion(appVersion);
        } catch (err) {
            console.warn('Failed to save onboarding status:', err);
        }
    };

    const handleAwsProfileChange = async (profile: string) => {
        setAwsProfile(profile);
        await window.k8s.aws.setProfile(profile);
    };

    const handleToggleMute = () => {
        setIsNotificationsMuted(prev => {
            const next = !prev;
            isNotificationsMutedRef.current = next;
            window.k8s.settings.set('notificationsMuted', next).catch(() => { });
            if (next) setToasts([]);
            return next;
        });
    };

    const handleToolApproval = (approved: boolean, trust: boolean) => {
        if (pendingToolApproval) {
            window.k8s.respondToolApproval(pendingToolApproval.toolCallId, approved, trust);
            // Remove from queue and show next
            pendingToolQueueRef.current = pendingToolQueueRef.current.filter(
                r => r.toolCallId !== pendingToolApproval.toolCallId
            );
            const next = pendingToolQueueRef.current[0] || null;
            setPendingToolApproval(next);
        }
    };

    // What's New State
    const [showWhatsNew, setShowWhatsNew] = useState(false);
    const [isPackaged, setIsPackaged] = useState(true);

    useEffect(() => {
        const checkWhatsNew = async () => {
            try {
                const [version, packaged, lastSeen] = await Promise.all([
                    window.k8s.app.getVersion(),
                    window.k8s.app.isPackaged(),
                    window.k8s.whatsNew.getLastSeenVersion(),
                ]);
                setIsPackaged(packaged);
                if (shouldShowWhatsNew({ current: version, stored: lastSeen, isPackaged: packaged })) {
                    setShowWhatsNew(true);
                }
            } catch (err) {
                console.warn('Failed to check whats-new status:', err);
            }
        };
        checkWhatsNew();
    }, []);

    const handleWhatsNewDismiss = async () => {
        setShowWhatsNew(false);
        handleDismiss({
            version: appVersion,
            isPackaged,
            setLastSeenVersion: (v) => {
                window.k8s.whatsNew.setLastSeenVersion(v).catch((err: unknown) => {
                    console.warn('Failed to save whats-new status:', err);
                });
            },
        });
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

    // Listen for tool approval requests from main process
    useEffect(() => {
        const cleanup = window.k8s.onToolApprovalRequest((request) => {
            console.log('[AI Tools] Approval request received:', request);
            pendingToolQueueRef.current.push(request);
            // Show the first pending if nothing is currently shown
            setPendingToolApproval(prev => prev || request);
        });
        return cleanup;
    }, []);

    // --- Notification State ---
    const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
    const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
    const [isNotificationsMuted, setIsNotificationsMuted] = useState(false);
    const isNotificationsMutedRef = useRef(false);
    const anomalyBatchRef = useRef<any[]>([]);
    const anomalyBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seenAnomalyIdsRef = useRef<Set<string>>(new Set());

    // Load unread count on mount
    useEffect(() => {
        window.k8s.notifications.getUnreadCount().then(setUnreadNotificationCount).catch(() => { });
        window.k8s.settings.get('notificationsMuted').then((v: boolean | null) => {
            if (typeof v === 'boolean') {
                setIsNotificationsMuted(v);
                isNotificationsMutedRef.current = v;
            }
        }).catch(() => { });
    }, []);

    // Apply saved font family and size on mount
    useEffect(() => {
        window.k8s.settings.get('fontFamily').then((saved: string | null) => {
            if (saved) {
                const stacks: Record<string, string> = {
                    'Monaco': "'Monaco', 'Menlo', 'Consolas', monospace",
                    'Inter': "'Inter', system-ui, -apple-system, sans-serif",
                    'JetBrains Mono': "'JetBrains Mono', 'Fira Code', monospace",
                    'Fira Code': "'Fira Code', 'JetBrains Mono', monospace",
                    'SF Mono': "'SF Mono', 'Monaco', 'Menlo', monospace",
                    'IBM Plex Mono': "'IBM Plex Mono', 'Consolas', monospace",
                    'Source Code Pro': "'Source Code Pro', 'Menlo', monospace",
                    'System Default': "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                };
                document.documentElement.style.setProperty('--lumen-font-family', stacks[saved] ?? `'${saved}', monospace`);
            }
        }).catch(() => { });
        window.k8s.settings.get('tableFontSize').then((saved: number | null) => {
            if (saved) {
                document.documentElement.style.setProperty('--lumen-table-font-size', `${saved}px`);
            }
        }).catch(() => { });
        window.k8s.settings.get('sidebarFontSize').then((saved: number | null) => {
            if (saved) document.documentElement.style.setProperty('--lumen-sidebar-font-size', `${saved}px`);
        }).catch(() => { });
        window.k8s.settings.get('pinnedFontSize').then((saved: number | null) => {
            if (saved) document.documentElement.style.setProperty('--lumen-pinned-font-size', `${saved}px`);
        }).catch(() => { });
        window.k8s.settings.get('headingSize').then((saved: number | null) => {
            if (saved) document.documentElement.style.setProperty('--lumen-heading-size', `${saved}px`);
        }).catch(() => { });
        window.k8s.settings.get('theme').then((saved: string | null) => {
            if (saved === 'blue' || saved === 'charcoal' || saved === 'red') setTheme(saved);
        }).catch(() => { });
    }, []);

    // Listen for theme changes from Settings
    useEffect(() => {
        const handleThemeChange = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail === 'blue' || detail === 'charcoal' || detail === 'red') setTheme(detail);
        };
        window.addEventListener('themeChanged', handleThemeChange);
        return () => window.removeEventListener('themeChanged', handleThemeChange);
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
                clusterName: selectedCluster,
                ...(namespace ? { namespace } : {}),
                resourceName,
                resourceType: resourceKind,
                saveToHistory: true,
                promptPreview: `Explain anomaly: ${notif.type} on ${resourceName}`,
                geminiServiceTier,
            },
            (chunk) => {
                if (currentStreamIdRef.current === streamId) {
                    fullResponse += chunk;
                    setAiStreamingContent(prev => prev + chunk);
                }
            },
            (usage?: AiStreamUsagePayload) => {
                if (currentStreamIdRef.current === streamId) {
                    applyStreamUsageToGeminiMeter(usage);
                    conversationHistoryRef.current.push({
                        role: 'assistant',
                        content: assistantContentForModelHistory(fullResponse),
                    });
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
                if (isNotificationsMutedRef.current) return; // Muted — skip toast, anomalies are still persisted above

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

    const showToastRef = useRef<
        | ((
              message: string,
              type?: 'success' | 'error' | 'info',
              action?: { label: string; onClick: () => void }
          ) => void)
        | null
    >(null);

    const handleAiError = (err: any, streamId?: string) => {
        if (streamId && currentStreamIdRef.current !== streamId) return;
        const message = typeof err === 'string' ? err : (err?.message || String(err));
        console.error("AI Error", message);
        // Access denied errors are handled by the onBedrockAccessDenied listener above,
        // so we only append non-access errors to the streaming content.
        if (!message.includes('Model access is denied') && !message.includes('aws-marketplace')) {
            setAiStreamingContent(prev => prev + `\n\n**Error**\n\n${message}`);
        }
        const isGoogleServerError =
            /\bHTTP 5\d\d\b/i.test(message) ||
            /\b503\b/.test(message) ||
            /Service Unavailable/i.test(message) ||
            /\bUNAVAILABLE\b/i.test(message);
        if (isGoogleServerError) {
            showToastRef.current?.(
                message.length > 160 ? `${message.slice(0, 160)}…` : message,
                'error'
            );
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

        // Add tab for this view if it doesn't exist yet (per-cluster)
        if (selectedCluster && !view.startsWith('settings-')) {
            const cluster = selectedCluster;
            const existing = viewTabsByClusterRef.current.get(cluster) ?? [];
            if (!existing.find(t => t.id === view)) {
                const label = getViewLabel(view);
                viewTabsByClusterRef.current.set(cluster, [...existing, { id: view, label }]);
                bumpViewTabs();
            }
        }
    };

    const handleCloseViewTab = useCallback((tabId: string) => {
        if (!selectedCluster || tabId === 'overview') return;
        const cluster = selectedCluster;
        const existing = viewTabsByClusterRef.current.get(cluster) ?? [];
        const newTabs = existing.filter(t => t.id !== tabId);
        viewTabsByClusterRef.current.set(cluster, newTabs);
        bumpViewTabs();

        // If closing the active tab, switch to the last remaining tab or overview
        if (resourceView === tabId) {
            const next = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : 'overview';
            startViewTransition(() => setResourceView(next));
        }
    }, [selectedCluster, resourceView]);

    // AI State
    const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
    const [aiContext, setAiContext] = useState<{ name: string; type: string; namespace?: string } | undefined>(undefined);
    const [aiStreamingContent, setAiStreamingContent] = useState<string>('');
    const [isAiStreaming, setIsAiStreaming] = useState(false);
    const [pendingToolApproval, setPendingToolApproval] = useState<{ toolCallId: string; command: string; isReadOnly: boolean } | null>(null);
    const pendingToolQueueRef = useRef<Array<{ toolCallId: string; command: string; isReadOnly: boolean }>>([]);
    const aiCleanupRef = useRef<(() => void) | null>(null);
    const currentStreamIdRef = useRef<string>('');
    const explainStreamIdRef = useRef<string | null>(null);
    const conversationHistoryRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
    const aiProviderRef = useRef(aiProvider);
    aiProviderRef.current = aiProvider;

    useEffect(() => {
        window.k8s.settings.get('geminiServiceTier').then((v: unknown) => {
            if (v === 'flex' || v === 'standard') setGeminiServiceTier(v);
        }).catch(() => {});
    }, []);

    const handleGeminiTierChange = useCallback((tier: 'standard' | 'flex') => {
        setGeminiServiceTier(tier);
        window.k8s.settings.set('geminiServiceTier', tier).catch(() => {});
    }, []);

    const applyStreamUsageToGeminiMeter = useCallback((usage?: AiStreamUsagePayload) => {
        if (aiProviderRef.current !== 'google') return;
        setGeminiSessionMeter((m) => addGeminiMeter(m, usage));
    }, []);

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

    // old context name -> new name, for closures that outlive a rename (see resolveContext)
    const renamedContextsRef = useRef(new Map<string, string>());
    const resolveContext = (name: string): string => {
        let current = name;
        for (let i = 0; i < 10; i++) {
            const next = renamedContextsRef.current.get(current);
            if (!next) break;
            current = next;
        }
        return current;
    };

    // Renames a kube context. Returns null on success or the error message (so the modal stays open).
    const handleRenameCluster = async (oldName: string, newName: string): Promise<string | null> => {
        let result: Awaited<ReturnType<typeof window.k8s.renameCluster>>;
        try {
            result = await window.k8s.renameCluster(oldName, newName);
        } catch (err) {
            const message = `Failed to rename context: ${err instanceof Error ? err.message : String(err)}`;
            showToast(message, 'error');
            return message;
        }
        if (!result.ok) {
            showToast(result.error, 'error');
            return result.error;
        }

        const renamed = result.newName;
        setPinnedClusters(result.pinnedClusters);
        applyClusters(result.clusters);
        // Changing selectedCluster makes Dashboard restart its watchers under the new name
        setSelectedCluster(prev => (prev === oldName ? renamed : prev));
        setAttemptedCluster(prev => (prev === oldName ? renamed : prev));
        // Same cluster under a new name, not a cluster switch: keep the active editor tab / view
        if (prevClusterRef.current === oldName) prevClusterRef.current = renamed;
        // Long-lived closures (YAML save handlers) captured the old name; let them resolve it
        renamedContextsRef.current.delete(renamed);
        renamedContextsRef.current.set(oldName, renamed);
        if (renameMapKey(viewTabsByClusterRef.current, oldName, renamed)) bumpViewTabs();
        if (renameMapKey(editorTabsByClusterRef.current, oldName, renamed)) {
            const moved = editorTabsByClusterRef.current.get(renamed) ?? [];
            editorTabsByClusterRef.current.set(renamed, moved.map(t => remapPanelTab(t, oldName, renamed)));
            bumpEditorTabs();
        }
        setPanelTabs(prev => prev.map(t => remapPanelTab(t, oldName, renamed)));
        showToast(`Renamed ${oldName} to ${renamed}`, 'success');
        return null;
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

    // Tabs popped out into the full editor view, keyed by cluster name
    // Preserved across cluster switches for the session lifetime
    const editorTabsByClusterRef = useRef<Map<string, PanelTab[]>>(new Map());
    const [editorActiveTabId, setEditorActiveTabId] = useState<string | null>(null);

    // Force re-render when editorTabsByClusterRef mutates (since refs don't trigger renders)
    const [editorTabsVersion, setEditorTabsVersion] = useState(0);
    const bumpEditorTabs = () => setEditorTabsVersion(v => v + 1);

    // Derived: tabs for the currently selected cluster only
    // editorTabsVersion triggers re-computation when the ref mutates
    const editorTabs = useMemo(
        () => selectedCluster ? (editorTabsByClusterRef.current.get(selectedCluster) ?? []) : [],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedCluster, editorTabsVersion]
    );

    // Unsaved YAML drafts per tab id. Kept in a ref (no re-render per keystroke); the
    // dirty-id Set only changes when a tab flips between clean and dirty.
    const yamlDraftsRef = useRef(new Map<string, string>());
    const [dirtyYamlTabIds, setDirtyYamlTabIds] = useState<ReadonlySet<string>>(() => new Set());
    const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

    const handleYamlDraftChange = useCallback((tabId: string, draft: string | undefined) => {
        if (draft === undefined) {
            yamlDraftsRef.current.delete(tabId);
        } else {
            yamlDraftsRef.current.set(tabId, draft);
        }
        const isDirty = draft !== undefined;
        setDirtyYamlTabIds(prev => {
            if (prev.has(tabId) === isDirty) return prev;
            const next = new Set(prev);
            if (isDirty) next.add(tabId); else next.delete(tabId);
            return next;
        });
    }, []);

    const getYamlDraft = useCallback((id: string) => yamlDraftsRef.current.get(id), []);

    const sidebarYamlTabs = useMemo(
        () => editorTabs.map(t => ({ ...t, isDirty: dirtyYamlTabIds.has(t.id) })),
        [editorTabs, dirtyYamlTabIds]
    );

    // Local terminals: each is its own tab + PTY, bound to the context selected when opened
    const terminalCounterRef = useRef(0);
    const openTerminal = useCallback(({ forceNew = false }: { forceNew?: boolean } = {}) => {
        const existing = forceNew ? undefined : findReusableLocalTerminal(panelTabs, selectedCluster);
        let tabId: string;
        if (existing) {
            tabId = existing.id;
        } else {
            terminalCounterRef.current += 1;
            const tab = createLocalTerminalTab(terminalCounterRef.current, selectedCluster);
            tabId = tab.id;
            setPanelTabs(prev => [...prev, tab]);
        }
        setActiveTabId(tabId);
        setIsBottomPanelOpen(true);
    }, [panelTabs, selectedCluster]);

    const handleNewTerminal = useCallback(() => openTerminal({ forceNew: true }), [openTerminal]);

    // When switching clusters, reset the active editor tab to the last one for that cluster (or null)
    const prevClusterRef = useRef<string | null>(null);
    useEffect(() => {
        if (selectedCluster !== prevClusterRef.current) {
            prevClusterRef.current = selectedCluster;
            const cluster = selectedCluster ?? '__local__';
            const tabs = editorTabsByClusterRef.current.get(cluster) ?? [];
            setEditorActiveTabId(tabs.length > 0 ? tabs[tabs.length - 1].id : null);
            // If we're in editor view and there are no tabs for this cluster, navigate away
            if (tabs.length === 0 && activeView === 'editor') {
                setActiveView(selectedCluster ? 'dashboard' : 'clusters');
            }

            // Restore the last active view tab for this cluster (or default to overview)
            if (selectedCluster) {
                const vTabs = viewTabsByClusterRef.current.get(selectedCluster) ?? [];
                if (vTabs.length > 0) {
                    // Keep the current resourceView if it exists in the tabs, otherwise use the last tab
                    const hasCurrentView = vTabs.find(t => t.id === resourceView);
                    if (!hasCurrentView) {
                        setResourceView(vTabs[vTabs.length - 1].id);
                    }
                }
            }
        }
    }, [selectedCluster, activeView]);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMod = e.metaKey || e.ctrlKey;
            if (!isMod) return;

            // Cmd+K — Toggle AI Assistant
            if (e.key === 'k') {
                e.preventDefault();
                setIsAIPanelOpen(prev => !prev);
            }

            // Cmd+, — Open Settings
            if (e.key === ',') {
                e.preventDefault();
                setActiveView('settings');
            }

            // Cmd+Shift+` — Always open a new terminal
            if (e.code === 'Backquote' && e.shiftKey) {
                e.preventDefault();
                openTerminal({ forceNew: true });
                return;
            }

            // Cmd+` — Toggle Terminal
            if (e.key === '`') {
                e.preventDefault();
                // If bottom panel is open and a terminal is active, close it.
                // Otherwise focus (or create) a terminal for the selected cluster.
                const activeTab = panelTabs.find(t => t.id === activeTabId);
                if (isBottomPanelOpen && activeTab?.type === 'terminal') {
                    setIsBottomPanelOpen(false);
                } else {
                    openTerminal();
                }
            }

            // Cmd+L — Toggle Logs panel
            if (e.key === 'l') {
                e.preventDefault();
                // If bottom panel is open, close it. Otherwise open it.
                // Focus the first log tab if one exists, otherwise just toggle.
                if (isBottomPanelOpen) {
                    setIsBottomPanelOpen(false);
                } else {
                    const firstLogTab = panelTabs.find(t => t.type === 'log');
                    if (firstLogTab) {
                        setActiveTabId(firstLogTab.id);
                    }
                    setIsBottomPanelOpen(true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isBottomPanelOpen, activeTabId, panelTabs, openTerminal]);

    // Toast State
    const [toasts, setToasts] = useState<{ id: string; message: string; type?: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } }[]>([]);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success', action?: { label: string; onClick: () => void }) => {
        const id = Math.random().toString(36).substr(2, 9);
        setToasts(prev => [...prev, { id, message, type, action }]);
    };
    showToastRef.current = showToast;
    // Background resource cache for the six core kinds (lives here so Dashboard remounts keep it warm)
    const reportNamespaces = useResourceSync(selectedCluster, syncEpoch, showToast);

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
            const customEvent = e as CustomEvent<{ provider: "google" | "bedrock" | "local"; model: string }>;
            console.log("[AI Model] Event received:", customEvent.detail);
            setAiProvider(customEvent.detail.provider);
            setAiModel(customEvent.detail.model);
            setGeminiSessionMeter({ ...EMPTY_GEMINI_METER });
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

        // Crossplane detection guard: a slow detection for the previous cluster must not land after a switch
        const seq = ++crossplaneDetectSeq.current;
        setHasCrossplane(false);

        try {
            // Pre-flight check: Try to list namespaces
            // This ensures the kubeconfig is valid and we have access
            await window.k8s.getNamespaces(clusterName);

            // Success
            setSelectedCluster(clusterName);
            setConnectionStatus('connected');
            setSyncEpoch(e => e + 1);
            setResourceView('overview');
            setActiveView('dashboard');

            // Seed the overview tab for this cluster if no tabs exist yet
            if (!viewTabsByClusterRef.current.has(clusterName)) {
                viewTabsByClusterRef.current.set(clusterName, [{ id: 'overview', label: 'Overview' }]);
                bumpViewTabs();
            }

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

            // Check Karpenter status
            window.k8s.getCRD(clusterName, 'nodepools.karpenter.sh').then(crd => {
                setHasKarpenter(!!crd);
            }).catch(e => {
                console.warn("Failed to check Karpenter status", e);
                setHasKarpenter(false);
            });

            // Check Crossplane status (sequence-guarded against cluster switches)
            window.k8s.crossplane.detect(clusterName)
                .then(d => { if (seq === crossplaneDetectSeq.current) setHasCrossplane(d.installed); })
                .catch(e => {
                    if (seq !== crossplaneDetectSeq.current) return;
                    console.warn('Failed to check Crossplane status', e);
                    setHasCrossplane(false);
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
            // Re-run the resource sync for the still-selected cluster (keeps its batch listener alive)
            setSyncEpoch(e => e + 1);

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
                logs: [],
                clusterContext: selectedCluster,
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

    const handleCordonDrain = (nodeName: string) => {
        const tabId = `cordon-drain-${nodeName}`;

        // Remove existing tab if any (to get a fresh terminal)
        setPanelTabs(prev => prev.filter(t => t.id !== tabId));

        // The terminal is bound to selectedCluster via its per-terminal kubeconfig, and the
        // command also passes --context explicitly so it can never hit another cluster even if
        // the user's shell rc overrides KUBECONFIG. The global current-context is not changed.
        const contextFlag = selectedCluster ? ` --context '${selectedCluster.replace(/'/g, `'\\''`)}'` : '';
        const command = `kubectl${contextFlag} cordon ${nodeName} && kubectl${contextFlag} drain ${nodeName} --ignore-daemonsets --delete-emptydir-data`;

        setPanelTabs(prev => [...prev, {
            id: tabId,
            type: 'terminal',
            title: `Drain: ${nodeName}`,
            subtitle: selectedCluster ? `cordon & drain · ${selectedCluster}` : 'cordon & drain',
            initialCommand: command,
            clusterContext: selectedCluster ?? undefined,
        }]);

        setActiveTabId(tabId);
        setIsBottomPanelOpen(true);
    };

    const handleDeleteNode = async (nodeName: string) => {
        if (!selectedCluster) return;
        try {
            await window.k8s.deleteNode(selectedCluster, nodeName);
        } catch (err) {
            console.error('Failed to delete node:', err);
        }
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
                },
                clusterContext: selectedCluster,
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

    // Closing a tab with unsaved YAML edits asks for confirmation first
    const handleCloseLogTab = (id: string) => {
        if (dirtyYamlTabIds.has(id)) {
            setPendingCloseTabId(id);
            return;
        }
        closeTabNow(id);
    };

    const closeTabNow = (id: string) => {
        // Discard any unsaved YAML draft for this tab
        handleYamlDraftChange(id, undefined);

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
                setIsBottomPanelOpen(false);
            }
            return newTabs;
        });

        // Also handle closing from editor tabs
        if (selectedCluster) {
            const clusterTabs = editorTabsByClusterRef.current.get(selectedCluster) ?? [];
            const newClusterTabs = clusterTabs.filter(t => t.id !== id);
            editorTabsByClusterRef.current.set(selectedCluster, newClusterTabs);
            if (editorActiveTabId === id) {
                const next = newClusterTabs[newClusterTabs.length - 1] ?? null;
                setEditorActiveTabId(next?.id ?? null);
                if (newClusterTabs.length === 0 && activeView === 'editor') {
                    setActiveView(selectedCluster ? 'dashboard' : 'clusters');
                }
            }
            bumpEditorTabs();
        }
    };

    const handleSwitchTab = (id: string) => {
        setActiveTabId(id);
    };

    const handleClearLogs = (id: string) => {
        setPanelTabs(prev => prev.map(t => t.id === id ? { ...t, logs: [] } : t));
    }

    const handlePopOutTab = (tabId: string) => {
        const tab = panelTabs.find(t => t.id === tabId);
        if (!tab || !selectedCluster) return;

        // Move tab from bottom bar into the cluster-scoped editor tabs
        setPanelTabs(prev => {
            const newTabs = prev.filter(t => t.id !== tabId);
            if (activeTabId === tabId) {
                setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
            }
            if (newTabs.length === 0) setIsBottomPanelOpen(false);
            return newTabs;
        });

        const existing = editorTabsByClusterRef.current.get(selectedCluster) ?? [];
        if (!existing.find(t => t.id === tabId)) {
            editorTabsByClusterRef.current.set(selectedCluster, [...existing, { ...tab }]);
            bumpEditorTabs();
        }
        setEditorActiveTabId(tabId);
        setActiveView('editor');
    };

    const handleDockBack = () => {
        // Return to previous view (dashboard or wherever they came from)
        if (activeView === 'editor') {
            setActiveView(selectedCluster ? 'dashboard' : 'clusters');
        }
    };
    void handleDockBack; // suppress unused warning — kept for future use

    const handleNewYamlFile = () => {
        const id = `local-new-${Date.now()}`;
        const tab = {
            id,
            type: 'yaml' as const,
            title: 'untitled.yaml',
            yamlContent: '',
            filePath: undefined,
        };
        const cluster = selectedCluster ?? '__local__';
        const existing = editorTabsByClusterRef.current.get(cluster) ?? [];
        editorTabsByClusterRef.current.set(cluster, [...existing, tab]);
        bumpEditorTabs();
        setEditorActiveTabId(id);
        setActiveView('editor');
    };

    const handleOpenYamlFile = async () => {
        try {
            const result = await window.k8s.dialog.openYamlFile();
            if (!result) return;
            const { filePath, content } = result;
            const fileName = filePath.split('/').pop() ?? filePath;
            const id = `local-file-${filePath}`;
            const cluster = selectedCluster ?? '__local__';
            const existing = editorTabsByClusterRef.current.get(cluster) ?? [];
            // Don't open the same file twice
            if (!existing.find(t => t.id === id)) {
                editorTabsByClusterRef.current.set(cluster, [...existing, {
                    id,
                    type: 'yaml' as const,
                    title: fileName,
                    subtitle: filePath,
                    yamlContent: content,
                    filePath,
                }]);
                bumpEditorTabs();
            }
            setEditorActiveTabId(id);
            setActiveView('editor');
        } catch (err) {
            showToast('Failed to open file', 'error');
        }
    };



    const handleOpenYaml = async (resource: any) => {
        if (!selectedCluster) return;
        const { name, namespace } = resource.metadata || resource;
        const type = resource.type;

        try {
            let yamlContent: string;
            let onSaveYaml: (newContent: string) => Promise<void>;
            let resolvedKind: string;
            let resolvedApiVersion: string;
            // Cluster-scoped tab id: computed once and shared by the save closure and the tab
            let tabId: string;

            // Check if we have a mapping for this resource type
            const resourceInfo = RESOURCE_TYPE_MAP[type];

            if (!resourceInfo) {
                // For custom resources or unmapped types, try to get info from the resource itself
                if (resource.apiVersion && resource.kind) {
                    resolvedApiVersion = resource.apiVersion;
                    resolvedKind = resource.kind;
                    const isNamespaced = !!namespace;

                    yamlContent = await window.k8s.getResourceYaml(selectedCluster, resolvedApiVersion, resolvedKind, name, isNamespaced ? namespace : undefined);

                    tabId = buildYamlTabId(selectedCluster, resolvedKind, namespace, name);
                    onSaveYaml = async (newContent: string) => {
                        try {
                            // The context may have been renamed since this tab was opened
                            const ctx = resolveContext(selectedCluster);
                            await window.k8s.updateResourceYaml(ctx, resolvedApiVersion, resolvedKind, name, newContent, isNamespaced ? namespace : undefined);
                            const latestYaml = await window.k8s.getResourceYaml(ctx, resolvedApiVersion, resolvedKind, name, isNamespaced ? namespace : undefined);

                            const updater = (t: PanelTab) => t.id === tabId ? { ...t, yamlContent: latestYaml } : t;
                            setPanelTabs(prev => prev.map(updater));
                            // Also update if tab has been popped out to editor
                            const clusterTabs = editorTabsByClusterRef.current.get(ctx) ?? [];
                            const updated = clusterTabs.map(updater);
                            if (updated !== clusterTabs) {
                                editorTabsByClusterRef.current.set(ctx, updated);
                                bumpEditorTabs();
                            }

                            showToast(`${resolvedKind} YAML updated successfully`, 'success');
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
                resolvedApiVersion = resourceInfo.apiVersion;
                resolvedKind = resourceInfo.kind;
                const { namespaced } = resourceInfo;

                yamlContent = await window.k8s.getResourceYaml(selectedCluster, resolvedApiVersion, resolvedKind, name, namespaced ? namespace : undefined);

                tabId = buildYamlTabId(selectedCluster, resolvedKind, namespace, name);
                onSaveYaml = async (newContent: string) => {
                    try {
                        // The context may have been renamed since this tab was opened
                        const ctx = resolveContext(selectedCluster);
                        await window.k8s.updateResourceYaml(ctx, resolvedApiVersion, resolvedKind, name, newContent, namespaced ? namespace : undefined);
                        const latestYaml = await window.k8s.getResourceYaml(ctx, resolvedApiVersion, resolvedKind, name, namespaced ? namespace : undefined);

                        const updater = (t: PanelTab) => t.id === tabId ? { ...t, yamlContent: latestYaml } : t;
                        setPanelTabs(prev => prev.map(updater));
                        // Also update if tab has been popped out to editor
                        const clusterTabs = editorTabsByClusterRef.current.get(ctx) ?? [];
                        const updated = clusterTabs.map(updater);
                        if (updated !== clusterTabs) {
                            editorTabsByClusterRef.current.set(ctx, updated);
                            bumpEditorTabs();
                        }

                        showToast(`${resolvedKind} YAML updated successfully`, 'success');
                    } catch (err: any) {
                        showToast(`Update failed: ${err.message || err}`, 'error');
                        throw err;
                    }
                };
            }

            const tabSubtitle = [resolvedKind!, namespace || 'global'].join(' · ');

            // Check if tab exists
            if (!panelTabs.find(t => t.id === tabId)) {
                setPanelTabs(prev => [...prev, {
                    id: tabId,
                    type: 'yaml',
                    title: `${name}.yaml`,
                    subtitle: tabSubtitle,
                    yamlContent,
                    onSaveYaml,
                    clusterContext: selectedCluster,
                }]);
            }

            setActiveTabId(tabId);
            setIsBottomPanelOpen(true);
        } catch (err: any) {
            console.error("Failed to load YAML", err);
            showToast(`Failed to load YAML: ${err.message || err}`, 'error');
        }
    };

    const handleMainMenuChange = (view: 'clusters' | 'dashboard' | 'settings' | 'editor' | 'user') => {
        setActiveView(view);
        if (view === 'settings') {
            // Remember the current resource view before switching
            if (!resourceView.startsWith('settings-') && !resourceView.startsWith('user-')) {
                lastResourceViewRef.current = resourceView;
            }
            setResourceView('settings-general');
        } else if (view === 'user') {
            // Remember the current resource view before switching
            if (!resourceView.startsWith('settings-') && !resourceView.startsWith('user-')) {
                lastResourceViewRef.current = resourceView;
            }
            setResourceView('user-general');
        } else if (view === 'editor') {
            // Switch to editor view — active yaml tab is already tracked
        } else {
            // Restore the last resource view when leaving settings/user
            if (resourceView.startsWith('settings-') || resourceView.startsWith('user-')) {
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

        conversationHistoryRef.current = [];

        // Cancel previous stream
        if (aiCleanupRef.current) {
            aiCleanupRef.current();
        }

        const streamId = Math.random().toString(36).substring(7);
        explainStreamIdRef.current = streamId;
        let fullResponse = '';

        // Use state variables instead of localStorage
        const model = aiModel;
        const provider = aiProvider;

        console.log('[AI] Using provider:', provider, 'model:', model);

        try {
            aiCleanupRef.current = window.k8s.streamExplainResource(
                context,
                { model, provider, clusterName: selectedCluster },
                (chunk) => {
                    if (explainStreamIdRef.current !== streamId) return;
                    fullResponse += chunk;
                    setAiStreamingContent((prev) => prev + chunk);
                },
                () => {
                    if (explainStreamIdRef.current !== streamId) return;
                    const userLine = `Explain ${type} ${name}`;
                    conversationHistoryRef.current.push({ role: 'user', content: userLine });
                    conversationHistoryRef.current.push({
                        role: 'assistant',
                        content: assistantContentForModelHistory(fullResponse),
                    });
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
                    promptPreview: `Analyze logs for ${podName} (${containerName})`,
                    geminiServiceTier,
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
                (usage?: AiStreamUsagePayload) => {
                    if (currentStreamIdRef.current === streamId) {
                        applyStreamUsageToGeminiMeter(usage);
                        // Add assistant response to conversation history
                        conversationHistoryRef.current.push({
                            role: 'assistant',
                            content: assistantContentForModelHistory(fullResponse),
                        });
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

    const handleReloadConversation = (
        conversation: Array<{ role: 'user' | 'assistant'; content: string }>,
        context: { name: string; type: string; namespace?: string },
        meta?: { model?: string; provider?: string }
    ) => {
        console.log('[AI] Reloading conversation with', conversation.length, 'messages');

        // Restore conversation history (omit thinking envelopes for model round-trips)
        conversationHistoryRef.current = conversation.map((m) =>
            m.role === 'assistant'
                ? { ...m, content: assistantContentForModelHistory(m.content) }
                : m
        );

        setAiContext({
            name: context.name,
            type: context.type,
            ...(context.namespace !== undefined ? { namespace: context.namespace } : {}),
        });

        if (meta?.model?.trim()) {
            setAiModel(meta.model.trim());
        }
        if (meta?.provider === 'google' || meta?.provider === 'bedrock' || meta?.provider === 'local') {
            setAiProvider(meta.provider);
        }
        setGeminiSessionMeter({ ...EMPTY_GEMINI_METER });
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
        setGeminiSessionMeter({ ...EMPTY_GEMINI_METER });
        // Save previous session and start a fresh one
        window.k8s.saveCurrentSession().catch(() => { });
        window.k8s.startSession(undefined).catch(() => { });
    };

    const handleStopAiStreaming = useCallback(() => {
        currentStreamIdRef.current = '';
        explainStreamIdRef.current = null;
        setPendingToolApproval(null);
        if (aiCleanupRef.current) {
            aiCleanupRef.current();
            aiCleanupRef.current = null;
        }
        setIsAiStreaming(false);
    }, []);

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
        const isDev = import.meta.env && import.meta.env.DEV;
        const isK8sRelated = isDev || k8sKeywords.some(keyword => lowerPrompt.includes(keyword));

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
                    clusterName: selectedCluster,
                    ...(aiContext?.namespace !== undefined ? { namespace: aiContext.namespace } : {}),
                    resourceName: aiContext?.name || 'Chat',
                    resourceType: aiContext?.type || 'Conversation',
                    saveToHistory: true, // Save session after each response
                    geminiServiceTier,
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
                (usage?: AiStreamUsagePayload) => {
                    if (currentStreamIdRef.current === streamId) {
                        applyStreamUsageToGeminiMeter(usage);
                        // Add assistant response to conversation history
                        conversationHistoryRef.current.push({
                            role: 'assistant',
                            content: assistantContentForModelHistory(fullResponse),
                        });
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
        <div
            className={`flex h-screen min-h-0 w-full text-white font-sans overflow-hidden bg-fixed ${
                theme === 'charcoal'
                    ? 'bg-gradient-to-br from-zinc-950 via-[#0a0a0a] to-black'
                    : theme === 'red'
                      ? 'bg-gradient-to-br from-red-950/80 via-[#0a0a0a] to-black'
                      : 'bg-gradient-to-br from-slate-900 via-[#0a0a0a] to-black'
            }`}
        >
            {/* Splash Screen */}
            {showSplash && <SplashScreen onFinished={() => setShowSplash(false)} />}

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
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors border ${selectedCluster === cluster ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'}`}
                                        style={{ fontSize: 'var(--lumen-pinned-font-size)' }}
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
                        <div className="flex rounded-lg overflow-hidden border border-white/10 shadow-2xl bg-white/5 backdrop-blur-xl h-full flex-shrink-0">
                            <Sidebar
                                activeView={activeView}
                                onChangeView={handleMainMenuChange}
                                editorTabCount={editorTabs.length}
                            />

                            <SecondarySidebar
                                mode={activeView === 'settings' ? 'settings' : activeView === 'user' ? 'user' : activeView === 'clusters' ? 'clusters' : activeView === 'editor' ? 'editor' : 'resources'}
                                activeView={resourceView.startsWith('deployment-detail/') ? 'deployments' : resourceView}
                                onSelectView={handleViewChange}
                                selectedCluster={selectedCluster}
                                onSelectCluster={handleClusterSelect}
                                connectionStatus={connectionStatus}
                                attemptedCluster={attemptedCluster}
                                clusters={clustersList}
                                pinnedClusters={pinnedClusters}
                                onTogglePin={handleTogglePin}
                                onRenameCluster={handleRenameCluster}
                                isEks={isEks}
                                hasCertManager={hasCertManager}
                                hasKarpenter={hasKarpenter}
                                hasCrossplane={hasCrossplane}
                                onBack={() => {
                                    setActiveView('clusters');
                                    setSelectedCluster(null);
                                    crossplaneDetectSeq.current++;
                                    setHasCrossplane(false);
                                }}
                                yamlTabs={sidebarYamlTabs}
                                activeYamlTabId={editorActiveTabId}
                                onSelectYamlTab={(tabId) => setEditorActiveTabId(tabId)}
                                onCloseYamlTab={handleCloseLogTab}
                                onNewYamlFile={handleNewYamlFile}
                                onOpenYamlFile={handleOpenYamlFile}
                            />
                        </div>

                        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                            {activeView === 'dashboard' && selectedCluster && viewTabs.length > 1 && (
                                <ViewTabBar
                                    tabs={viewTabs}
                                    activeTabId={resourceView}
                                    onSelectTab={handleViewChange}
                                    onCloseTab={handleCloseViewTab}
                                />
                            )}
                            <div className="flex-1 min-h-0 w-full min-w-0 relative overflow-hidden flex flex-col">
                                {activeView === 'settings' ? (
                                    <Settings activeSection={resourceView} />
                                ) : activeView === 'user' ? (
                                    <AuthView
                                        activeSection={resourceView}
                                        onUserViewChange={setResourceView}
                                    />
                                ) : activeView === 'editor' ? (
                                    (() => {
                                        // Read directly from the ref (not the memoized snapshot) so we always
                                        // get the latest saved yamlContent. Unsaved edits live in yamlDraftsRef.
                                        const cluster = selectedCluster ?? '__local__';
                                        const liveTabs = editorTabsByClusterRef.current.get(cluster) ?? [];
                                        const tab = editorActiveTabId ? liveTabs.find(t => t.id === editorActiveTabId) : null;
                                        if (tab && tab.type === 'yaml') {
                                            // Build save handler: k8s resources use onSaveYaml, local files use dialog
                                            const saveHandler = tab.onSaveYaml ?? (async (content: string) => {
                                                const savedPath = await window.k8s.dialog.saveYamlFile(tab.filePath ?? null, content);
                                                if (!savedPath) throw new Error('Save cancelled');
                                                // The saved content becomes the new base; also update filePath
                                                // and title if this was an untitled file
                                                const fileName = savedPath.split('/').pop() ?? savedPath;
                                                const clusterTabs = editorTabsByClusterRef.current.get(cluster) ?? [];
                                                editorTabsByClusterRef.current.set(cluster, clusterTabs.map(t => {
                                                    if (t.id !== tab.id) return t;
                                                    return tab.filePath
                                                        ? { ...t, yamlContent: content }
                                                        : { ...t, yamlContent: content, filePath: savedPath, title: fileName, subtitle: savedPath };
                                                }));
                                                bumpEditorTabs();
                                            });
                                            return (
                                                <div className="h-full w-full rounded-xl overflow-hidden border border-white/10">
                                                    <YamlEditor
                                                        key={tab.id}
                                                        initialYaml={tab.yamlContent ?? ''}
                                                        initialDraft={getYamlDraft(tab.id)}
                                                        onSave={saveHandler}
                                                        onDraftChange={(draft) => handleYamlDraftChange(tab.id, draft)}
                                                        contextLabel={tab.clusterContext}
                                                    />
                                                </div>
                                            );
                                        }
                                        return (
                                            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
                                                <PenTool size={32} className="opacity-20" />
                                                <p className="text-sm">No file selected</p>
                                                <p className="text-xs text-gray-600">Create a new file or open one from the sidebar</p>
                                            </div>
                                        );
                                    })()
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
                                            onCordonDrain={handleCordonDrain}
                                            onDeleteNode={handleDeleteNode}
                                            showToast={showToast}
                                            onNamespacesChange={reportNamespaces}
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
                                onPopOutTab={handlePopOutTab}
                                getYamlDraft={getYamlDraft}
                                onYamlDraftChange={handleYamlDraftChange}
                                dirtyTabIds={dirtyYamlTabIds}
                                onNewTerminal={handleNewTerminal}
                                currentCluster={selectedCluster}
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
                                            openTerminal();
                                        }
                                    } else {
                                        openTerminal();
                                    }
                                }}
                                isPanelOpen={isBottomPanelOpen}
                                notificationCount={unreadNotificationCount}
                                onToggleNotifications={() => {
                                    setIsNotificationsPanelOpen(prev => !prev);
                                }}
                                isNotificationsPanelOpen={isNotificationsPanelOpen}
                                isNotificationsMuted={isNotificationsMuted}
                                onToggleMute={handleToggleMute}
                                aiProvider={aiProvider}
                                aiModel={aiModel}
                                clusters={clustersList}
                                onClusterSelect={handleClusterSelect}
                                awsProfile={awsProfile}
                                awsProfiles={awsProfiles}
                                onAwsProfileChange={handleAwsProfileChange}
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
                    <div className="fixed top-4 right-4 z-[300] flex flex-col gap-2 ">
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
                        aiModel={aiModel}
                        aiProvider={aiProvider}
                        theme={theme}
                        pendingToolApproval={pendingToolApproval}
                        onToolApproval={handleToolApproval}
                        onStopStreaming={handleStopAiStreaming}
                        geminiSessionMeter={geminiSessionMeter}
                        geminiServiceTier={geminiServiceTier}
                        onGeminiServiceTierChange={handleGeminiTierChange}
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

            {/* Discard unsaved YAML changes confirmation */}
            <ConfirmModal
                isOpen={pendingCloseTabId !== null}
                onClose={() => setPendingCloseTabId(null)}
                onConfirm={() => {
                    if (pendingCloseTabId) closeTabNow(pendingCloseTabId);
                }}
                title="Discard unsaved changes?"
                message={`"${(panelTabs.find(t => t.id === pendingCloseTabId) ?? editorTabs.find(t => t.id === pendingCloseTabId))?.title ?? 'This tab'}" has unsaved changes. Closing it will discard them.`}
                confirmText="Discard"
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

            {/* What's New Modal */}
            <WhatsNewModal
                isOpen={showWhatsNew}
                onDismiss={handleWhatsNewDismiss}
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
