/// <reference types="vite/client" />

import type { HelmCatalogSection } from './lib/helm-catalog-types';
import type {
    CrossplaneCompositesPayload, CrossplaneDefinitionsPayload, CrossplaneDetection, CrossplaneObjectRef,
    CrossplanePackagesPayload, CrossplaneScanProgress, CrossplaneTree, CrossplaneWarningEventsPayload,
    ManagedItemsPayload, ManagedKindsPayload, ManagedScanSummary,
} from './types/crossplane';

export { };

declare global {
    interface Window {
        /** Dev-only leak diagnostics helper (registered by useResourceSync under import.meta.env.DEV). */
        __lumenDiag?: () => Promise<{ main: import('./types/resource-cache').ResourceCacheDiagnostics | null; batchListeners: number; dropped: number }>;
        __APP_VERSION__?: string;
        k8s: {
            // --- Credential Management ---
            forceCredentialRefresh: () => Promise<boolean>;

            getClusters: () => Promise<import('./types/cluster-context').ClusterContextInfo[]>;
            onContextsChanged: (callback: (payload: import('./types/cluster-context').ContextsChangedPayload) => void) => () => void;
            renameCluster: (oldName: string, newName: string) => Promise<import('./types/cluster-context').RenameClusterResult>;
            getNamespaces: (contextName: string) => Promise<string[]>;
            getNamespacesDetails: (contextName: string) => Promise<any[]>;
            getDeployments: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getPods: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getPodMetrics: (contextName: string, namespaces?: string[]) => Promise<Record<string, { cpu: string; memory: string }>>;
            getNodeMetrics: (contextName: string) => Promise<Record<string, { cpu: string; memory: string }>>;
            getPod: (contextName: string, namespace: string, name: string) => Promise<any>;
            getReplicaSets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getServices: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getClusterRoleBindings: (contextName: string) => Promise<any[]>;
            getRoleBindings: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getDeployment: (contextName: string, namespace: string, name: string) => Promise<any>;
            restartDeployment: (contextName: string, namespace: string, name: string) => Promise<{ success: boolean }>;
            getService: (contextName: string, namespace: string, name: string) => Promise<any>;
            getEvents: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getNodes: (contextName: string) => Promise<any[]>;
            getNode: (contextName: string, name: string) => Promise<any>;
            getCRDs: (contextName: string) => Promise<any[]>;
            getCRD: (contextName: string, name: string) => Promise<any>;
            listCustomObjects: (contextName: string, group: string, version: string, plural: string, namespace?: string) => Promise<any[]>;
            getCustomObjects: (contextName: string, group: string, version: string, plural: string) => Promise<any[]>;
            getClusterRoleBinding: (contextName: string, name: string) => Promise<any>;
            getDaemonSets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getDaemonSet: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteDaemonSet: (contextName: string, namespace: string, name: string) => Promise<boolean>;
            getStatefulSets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getStatefulSet: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteStatefulSet: (contextName: string, namespace: string, name: string) => Promise<boolean>;
            getJobs: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getJob: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteJob: (contextName: string, namespace: string, name: string) => Promise<boolean>;
            getCronJobs: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getCronJob: (contextName: string, namespace: string, name: string) => Promise<any>;
            triggerCronJob: (contextName: string, namespace: string, name: string) => Promise<{ success: boolean; jobName: string; job: any }>;
            deleteCronJob: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            // --- Network ---
            getEndpointSlices: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getEndpointSlice: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteEndpointSlice: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            getEndpoints: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getEndpoint: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteEndpoint: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            getIngresses: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getIngress: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteIngress: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            getIngressClasses: (contextName: string) => Promise<any[]>;
            getIngressClass: (contextName: string, name: string) => Promise<any>;
            deleteIngressClass: (contextName: string, name: string) => Promise<boolean>;

            getNetworkPolicies: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getNetworkPolicy: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteNetworkPolicy: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            // --- Storage ---
            getPersistentVolumeClaims: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getPersistentVolumeClaim: (contextName: string, namespace: string, name: string) => Promise<any>;
            deletePersistentVolumeClaim: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            getPersistentVolumes: (contextName: string) => Promise<any[]>;
            getPersistentVolume: (contextName: string, name: string) => Promise<any>;
            deletePersistentVolume: (contextName: string, name: string) => Promise<boolean>;

            getStorageClasses: (contextName: string) => Promise<any[]>;
            getStorageClass: (contextName: string, name: string) => Promise<any>;
            deleteStorageClass: (contextName: string, name: string) => Promise<boolean>;

            // --- Config ---
            getConfigMaps: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getConfigMap: (contextName: string, namespace: string, name: string) => Promise<any>;

            getSecrets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getSecret: (contextName: string, namespace: string, name: string) => Promise<any>;

            getHorizontalPodAutoscalers: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getHorizontalPodAutoscaler: (contextName: string, namespace: string, name: string) => Promise<any>;

            getPodDisruptionBudgets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getPodDisruptionBudget: (contextName: string, namespace: string, name: string) => Promise<any>;
            getPdbYaml: (contextName: string, namespace: string, name: string) => Promise<string>;
            updatePdbYaml: (contextName: string, namespace: string, name: string, yamlContent: string) => Promise<any>;

            // Generic resource YAML operations
            getResourceYaml: (contextName: string, apiVersion: string, kind: string, name: string, namespace?: string) => Promise<string>;
            updateResourceYaml: (contextName: string, apiVersion: string, kind: string, name: string, yamlContent: string, namespace?: string) => Promise<any>;

            getMutatingWebhookConfigurations: (contextName: string) => Promise<any[]>;
            getMutatingWebhookConfiguration: (contextName: string, name: string) => Promise<any>;

            getValidatingWebhookConfigurations: (contextName: string) => Promise<any[]>;
            getValidatingWebhookConfiguration: (contextName: string, name: string) => Promise<any>;

            getPriorityClasses: (contextName: string) => Promise<any[]>;
            getPriorityClass: (contextName: string, name: string) => Promise<any>;

            getRuntimeClasses: (contextName: string) => Promise<any[]>;
            getRuntimeClass: (contextName: string, name: string) => Promise<any>;

            // --- Access Control ---
            getServiceAccounts: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getServiceAccount: (contextName: string, namespace: string, name: string) => Promise<any>;
            getRoles: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getRole: (contextName: string, namespace: string, name: string) => Promise<any>;
            getReplicaSet: (contextName: string, namespace: string, name: string) => Promise<any>;
            getDeploymentFullDetails: (contextName: string, namespace: string, name: string) => Promise<import('./types/deployment-details').DeploymentFullDetailsResponse>;
            scaleDeployment: (contextName: string, namespace: string, name: string, replicas: number) => Promise<void>;
            getDeploymentYaml: (contextName: string, namespace: string, name: string) => Promise<string>;
            updateDeploymentYaml: (contextName: string, namespace: string, name: string, yamlContent: string) => Promise<any>;
            startPortForward: (contextName: string, namespace: string, serviceName: string, servicePort: number, localPort: number, resourceType?: 'service' | 'pod') => Promise<{ id: string, localPort: number }>;
            stopAllPortForwards: () => Promise<void>;
            stopPortForward: (id: string) => Promise<void>;
            getActivePortForwards: () => Promise<any[]>;
            explainResource: (resource: any, model?: string) => Promise<string>;
            openExternal: (url: string) => Promise<void>;
            deletePod: (contextName: string, namespace: string, name: string) => Promise<boolean>;
            watchNodes: (contextName: string) => void;
            stopWatchNodes: () => void;
            onNodeChange: (callback: (type: string, node: any) => void) => () => void;
            onNodeBatchChange: (callback: (events: Array<{ type: string; node: any }>) => void) => () => void;
            streamPodLogs: (contextName: string, namespace: string, name: string, containerName: string) => void;
            stopStreamPodLogs: (namespace: string, name: string, containerName: string) => Promise<void>;
            onPodLogChunk: (callback: (streamId: string, chunk: string) => void) => () => void;

            // --- Settings ---
            saveApiKey: (key: string) => Promise<boolean>;

            // --- AI History & Sessions ---
            getHistory: () => Promise<any[]>;
            saveHistoryItem: (item: any) => Promise<boolean>;
            deleteHistoryItem: (id: string) => Promise<boolean>;
            clearHistory: () => Promise<boolean>;
            startSession: (context?: any, model?: string, provider?: string) => Promise<any>;
            loadSession: (id: string) => Promise<any>;
            saveCurrentSession: () => Promise<boolean>;
            getCurrentSession: () => Promise<any>;

            // --- Notifications ---
            notifications: {
                getAll: () => Promise<any[]>;
                add: (notification: any) => Promise<any[]>;
                markRead: (id: string) => Promise<any[]>;
                markAllRead: () => Promise<any[]>;
                delete: (id: string) => Promise<any[]>;
                clear: () => Promise<any[]>;
                getUnreadCount: () => Promise<number>;
            };

            // --- AI Streaming ---
            streamExplainResource: (resource: any, options: any, onChunk: (chunk: string) => void, onDone: () => void, onError: (err: any) => void) => () => void;
            streamCustomPrompt: (
                prompt: string,
                options: {
                    model: string;
                    provider: string;
                    systemPrompt?: string;
                    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
                    clusterName?: string | null;
                    namespace?: string;
                    resourceName?: string;
                    resourceType?: string;
                    saveToHistory?: boolean;
                    promptPreview?: string;
                    geminiServiceTier?: 'standard' | 'flex';
                },
                onChunk: (chunk: string) => void,
                onDone: (usage?: {
                    inputTokens?: number;
                    outputTokens?: number;
                    totalTokens?: number;
                    reasoningTokens?: number;
                    cachedInputTokens?: number;
                }) => void,
                onError: (err: any) => void
            ) => () => void;
            listModels: (provider: string) => Promise<any[]>;
            checkAwsAuth: () => Promise<any>;
            saveAwsCreds: (creds: any) => Promise<boolean>;
            getModelSync: () => string;
            getProviderSync: () => 'google' | 'bedrock' | 'local';
            saveModelSelection: (provider: string, model: string) => Promise<boolean>;
            decodeCertificate: (certData: string) => Promise<any>;
            onBedrockAccessDenied: (callback: (message: string) => void) => () => void;
            onToolApprovalRequest: (
                callback: (request: { toolCallId: string; command: string; isReadOnly: boolean }) => void
            ) => () => void;
            respondToolApproval: (toolCallId: string, approved: boolean, trust: boolean) => void;

            // --- Terminal ---
            terminal: {
                /** Spawn a local shell. `context` binds it to a kube context without changing the global kubeconfig. */
                create: (id: string, cols: number, rows: number, context?: string) => void;
                createExec: (id: string, cols: number, rows: number, context: string, namespace: string, podName: string, containerName?: string) => void;
                write: (id: string, data: string) => void;
                resize: (id: string, cols: number, rows: number) => void;
                dispose: (id: string) => void;
                /** Output of the terminal with this id only. Returns an unsubscribe function. */
                onData: (id: string, callback: (data: string) => void) => () => void;
                /** Exit of the terminal with this id only (-1 when creation failed). Returns an unsubscribe function. */
                onExit: (id: string, callback: (exitCode: number) => void) => () => void;
            };

            aws: {
                getEksCluster: (region: string, clusterName: string) => Promise<any>;
                getVpcDetails: (region: string, vpcId: string) => Promise<any>;
                getSubnets: (region: string, vpcId: string) => Promise<any[]>;
                getInstanceDetails: (region: string, instanceId: string) => Promise<any>;
                getEc2Instances: (region: string, vpcId: string, clusterName?: string) => Promise<any[]>;
                getDbInstances?: (region: string, vpcId: string) => Promise<any[]>; // Not yet implemented in preload, but preparing
                getPodIdentities: (region: string, clusterName: string) => Promise<any[]>;
                checkAuth: (region: string) => Promise<{ isAuthenticated: boolean; identity?: string; account?: string; error?: string }>;
                clearCache: () => Promise<boolean>;
            };

            app: {
                restart: () => Promise<void>;
                getVersion: () => Promise<string>;
            };

            // --- General Settings ---
            settings: {
                get: (key: string) => Promise<any>;
                set: (key: string, value: any) => Promise<void>;
                getAll: () => Promise<any>;
                getKubeconfigPath: () => Promise<string>;
                setKubeconfigPath: (p: string) => Promise<void>;
                getContextConfig: () => Promise<any>;
                setContextConfig: (config: any) => Promise<void>;
                setZoomFactor: (factor: number) => Promise<boolean>;
                // Masked credential metadata (never exposes raw secrets)
                hasApiKey: () => Promise<boolean>;
                apiKeyMasked: () => Promise<string | null>;
                hasAwsCreds: () => Promise<boolean>;
                awsAccessKeyMasked: () => Promise<string | null>;
                // Safe Mode
                getSafeMode: () => Promise<boolean>;
                setSafeMode: (enabled: boolean) => Promise<boolean>;
                // AI Data Consent
                getAiDataConsent: () => Promise<boolean>;
                setAiDataConsent: (enabled: boolean) => Promise<boolean>;
            };

            // --- Context Engine ---
            context: {
                getStatus: () => Promise<any>;
                getSummary: (resourceType: string, namespace?: string) => Promise<string>;
                getAnomalies: () => Promise<any[]>;
                clusterSwitch: () => Promise<void>;
                onAnomaly: (callback: (anomaly: any) => void) => () => void;
            };

            // --- Onboarding ---
            onboarding: {
                getLastSeenVersion: () => Promise<string | null>;
                setLastSeenVersion: (version: string) => Promise<boolean>;
            };

            // --- Auth (Supabase via main process store) ---
            auth: {
                saveSession: (session: string | object) => Promise<boolean>;
                getSession: () => Promise<string | object | null>;
                clearSession: () => Promise<boolean>;
                onOAuthCallback: (callback: (callbackUrl: string) => void) => () => void;
            };

            // --- Helm ---
            helm: {
                getReleases: (contextName: string, namespaces: string[]) => Promise<any[]>;
                getRelease: (contextName: string, namespace: string, name: string) => Promise<any>;
                getReleaseHistory: (contextName: string, namespace: string, name: string) => Promise<any[]>;
                uninstallRelease: (contextName: string, namespace: string, name: string) => Promise<any>;
                rollbackRelease: (contextName: string, namespace: string, name: string, revision: number) => Promise<any>;
                listRepos: () => Promise<Array<{ name: string; url: string }>>;
                updateRepos: () => Promise<string>;
                addRepo: (name: string, url: string) => Promise<void>;
                getCatalog: (opts?: { force?: boolean }) => Promise<HelmCatalogSection[]>;
            };

            // --- Crossplane (read-only) ---
            crossplane: {
                detect: (context: string, opts?: { force?: boolean }) => Promise<CrossplaneDetection>;
                getPackages: (context: string, opts?: { force?: boolean }) => Promise<CrossplanePackagesPayload>;
                getDefinitions: (context: string, opts?: { force?: boolean }) => Promise<CrossplaneDefinitionsPayload>;
                getComposites: (context: string, opts?: { force?: boolean }) => Promise<CrossplaneCompositesPayload>;
                getManagedKinds: (context: string, opts?: { force?: boolean }) => Promise<ManagedKindsPayload>;
                scanManaged: (context: string, opts?: { force?: boolean }) => Promise<ManagedScanSummary>;
                getManagedItems: (context: string, kindKeys: string[], opts?: { force?: boolean }) => Promise<ManagedItemsPayload>;
                getWarningEvents: (context: string, opts?: { limit?: number; force?: boolean }) => Promise<CrossplaneWarningEventsPayload>;
                getResource: (context: string, ref: CrossplaneObjectRef) => Promise<Record<string, unknown>>;
                getTree: (context: string, ref: CrossplaneObjectRef) => Promise<CrossplaneTree>;
                onScanProgress: (callback: (p: CrossplaneScanProgress) => void) => () => void;
            };

            // --- Background resource cache (core kinds) ---
            resources: {
                startSession: (args: import('./types/resource-cache').StartSessionArgs) => Promise<import('./types/resource-cache').ResourceSnapshot>;
                subscribe: () => Promise<import('./types/resource-cache').ResourceSnapshot | null>;
                stopSession: () => Promise<true>;
                setNamespaces: (namespaces: string[]) => Promise<true>;
                ensureFresh: () => Promise<import('./types/resource-cache').EnsureFreshResult>;
                getDiagnostics: () => Promise<import('./types/resource-cache').ResourceCacheDiagnostics | null>;
                onBatch: (cb: (batch: import('./types/resource-cache').ResourceBatch) => void) => () => void;
                listenerCount: () => number;
            };

            artifactHub: {
                fetch: (
                    pathAndQuery: string,
                    options?: { accept?: string }
                ) => Promise<{ ok: boolean; status: number; body: string }>;
            };

            // --- Pinned Clusters ---
            getPinnedClusters: () => Promise<string[]>;
            addPinnedCluster: (clusterName: string) => Promise<string[]>;
            removePinnedCluster: (clusterName: string) => Promise<string[]>;
        }
    }
}

interface ImportMetaEnv {
    readonly VITE_SUPABASE_OAUTH_REDIRECT?: string;
}
