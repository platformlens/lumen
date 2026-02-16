/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer
  k8s: {
    // --- Credential Management ---
    forceCredentialRefresh: () => Promise<boolean>

    getClusters: () => Promise<Array<{ name: string; cluster: any; user: any }>>
    getNamespaces: (contextName: string) => Promise<string[]>
    getNamespacesDetails: (contextName: string) => Promise<Array<{ name: string; status: string; age: string; labels: any; annotations: any }>>
    getDeployments: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; replicas: number; availableReplicas: number }>>
    getDeployment: (contextName: string, namespace: string, name: string) => Promise<any>
    scaleDeployment: (contextName: string, namespace: string, name: string, replicas: number) => Promise<any>
    restartDeployment: (contextName: string, namespace: string, name: string) => Promise<{ success: boolean }>
    restartDaemonSet: (contextName: string, namespace: string, name: string) => Promise<{ success: boolean }>
    restartStatefulSet: (contextName: string, namespace: string, name: string) => Promise<{ success: boolean }>
    getDeploymentYaml: (contextName: string, namespace: string, name: string) => Promise<string>
    updateDeploymentYaml: (contextName: string, namespace: string, name: string, yamlString: string) => Promise<any>
    getPods: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; status: string; restarts: number; age: string }>>
    getPodMetrics: (contextName: string, namespaces?: string[]) => Promise<Record<string, { cpu: string; memory: string }>>
    getPod: (contextName: string, namespace: string, name: string) => Promise<any>
    getReplicaSets: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; desired: number; current: number; ready: number }>>
    getReplicaSet: (contextName: string, namespace: string, name: string) => Promise<any>
    getDaemonSets: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getDaemonSet: (contextName: string, namespace: string, name: string) => Promise<any>
    deleteDaemonSet: (contextName: string, namespace: string, name: string) => Promise<any>
    getStatefulSets: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getStatefulSet: (contextName: string, namespace: string, name: string) => Promise<any>
    deleteStatefulSet: (contextName: string, namespace: string, name: string) => Promise<any>
    getJobs: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getJob: (contextName: string, namespace: string, name: string) => Promise<any>
    deleteJob: (contextName: string, namespace: string, name: string) => Promise<any>
    getCronJobs: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getCronJob: (contextName: string, namespace: string, name: string) => Promise<any>
    triggerCronJob: (contextName: string, namespace: string, name: string) => Promise<{ success: boolean; jobName: string; job: any }>
    deleteCronJob: (contextName: string, namespace: string, name: string) => Promise<any>
    getEndpointSlices: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getEndpointSlice: (contextName: string, namespace: string, name: string) => Promise<any>
    deleteEndpointSlice: (contextName: string, namespace: string, name: string) => Promise<any>
    getEndpoints: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getEndpoint: (contextName: string, namespace: string, name: string) => Promise<any>
    deleteEndpoint: (contextName: string, namespace: string, name: string) => Promise<any>
    getIngresses: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getIngress: (contextName: string, namespace: string, name: string) => Promise<any>
    deleteIngress: (contextName: string, namespace: string, name: string) => Promise<any>
    getIngressClasses: (contextName: string) => Promise<any[]>
    getIngressClass: (contextName: string, name: string) => Promise<any>
    deleteIngressClass: (contextName: string, name: string) => Promise<any>
    getNetworkPolicies: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getNetworkPolicy: (contextName: string, namespace: string, name: string) => Promise<any>
    deleteNetworkPolicy: (contextName: string, namespace: string, name: string) => Promise<any>
    getPersistentVolumeClaims: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getPersistentVolumeClaim: (contextName: string, namespace: string, name: string) => Promise<any>
    deletePersistentVolumeClaim: (contextName: string, namespace: string, name: string) => Promise<any>
    getPersistentVolumes: (contextName: string) => Promise<any[]>
    getPersistentVolume: (contextName: string, name: string) => Promise<any>
    deletePersistentVolume: (contextName: string, name: string) => Promise<any>
    getStorageClasses: (contextName: string) => Promise<any[]>
    getStorageClass: (contextName: string, name: string) => Promise<any>
    deleteStorageClass: (contextName: string, name: string) => Promise<any>

    // --- Config ---
    getConfigMaps: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getConfigMap: (contextName: string, namespace: string, name: string) => Promise<any>
    getSecrets: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getSecret: (contextName: string, namespace: string, name: string) => Promise<any>
    getHorizontalPodAutoscalers: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getHorizontalPodAutoscaler: (contextName: string, namespace: string, name: string) => Promise<any>
    getPodDisruptionBudgets: (contextName: string, namespaces?: string[]) => Promise<any[]>
    getPodDisruptionBudget: (contextName: string, namespace: string, name: string) => Promise<any>
    getPdbYaml: (contextName: string, namespace: string, name: string) => Promise<string>
    updatePdbYaml: (contextName: string, namespace: string, name: string, yamlContent: string) => Promise<any>

    // Generic resource YAML operations
    getResourceYaml: (contextName: string, apiVersion: string, kind: string, name: string, namespace?: string) => Promise<string>
    updateResourceYaml: (contextName: string, apiVersion: string, kind: string, name: string, yamlContent: string, namespace?: string) => Promise<any>

    getMutatingWebhookConfigurations: (contextName: string) => Promise<any[]>
    getMutatingWebhookConfiguration: (contextName: string, name: string) => Promise<any>
    getValidatingWebhookConfigurations: (contextName: string) => Promise<any[]>
    getValidatingWebhookConfiguration: (contextName: string, name: string) => Promise<any>
    getPriorityClasses: (contextName: string) => Promise<any[]>
    getPriorityClass: (contextName: string, name: string) => Promise<any>
    getRuntimeClasses: (contextName: string) => Promise<any[]>
    getRuntimeClass: (contextName: string, name: string) => Promise<any>
    getServices: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; type: string; clusterIP: string; ports: string; age: string }>>
    getService: (contextName: string, namespace: string, name: string) => Promise<any>
    getClusterRoleBindings: (contextName: string) => Promise<Array<{ name: string; age: string }>>
    getServiceAccounts: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; age: string; secrets: number }>>
    getServiceAccount: (contextName: string, namespace: string, name: string) => Promise<any>
    getRoles: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; age: string }>>
    getRole: (contextName: string, namespace: string, name: string) => Promise<any>
    getRoleBindings: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; age: string }>>
    getClusterRoles: (contextName: string) => Promise<Array<{ name: string; age: string }>>
    getClusterRole: (contextName: string, name: string) => Promise<any>
    getClusterRoleBinding: (contextName: string, name: string) => Promise<any>
    getRoleBinding: (contextName: string, namespace: string, name: string) => Promise<any>
    getEvents: (contextName: string, namespaces?: string[]) => Promise<Array<{ type: string; reason: string; message: string; count: number; lastTimestamp: string; object: string; namespace: string }>>
    getNodes: (contextName: string) => Promise<any[]>
    getNode: (contextName: string, name: string) => Promise<any>
    getCRDs: (contextName: string) => Promise<any[]>
    getCRD: (contextName: string, name: string) => Promise<any>
    listCustomObjects: (contextName: string, group: string, version: string, plural: string, namespace?: string) => Promise<any[]>
    getCustomObjects: (contextName: string, group: string, version: string, plural: string) => Promise<any[]>
    startPortForward: (contextName: string, namespace: string, serviceName: string, servicePort: number, localPort: number, resourceType?: 'service' | 'pod') => Promise<{ id: string, localPort: number }>
    stopPortForward: (id: string) => Promise<boolean>
    stopAllPortForwards: () => Promise<boolean>
    getActivePortForwards: () => Promise<Array<{ id: string, namespace: string, serviceName: string, inputPort: string | number, targetPort: number, localPort: number }>>
    deletePod: (contextName: string, namespace: string, name: string) => Promise<boolean>
    watchPods: (contextName: string, namespaces: string[]) => void
    stopWatchPods: () => void
    onPodChange: (callback: (type: string, pod: any) => void) => (() => void)
    watchDeployments: (contextName: string, namespaces: string[]) => void
    stopWatchDeployments: () => void
    watchGenericResource: (contextName: string, resourceType: string, apiPath: string) => void
    stopWatchGenericResource: (resourceType: string) => void
    onGenericResourceChange: (callback: (resourceType: string, type: string, resource: any) => void) => () => void
    onDeploymentChange: (callback: (type: string, deployment: any) => void) => (() => void)
    watchNodes: (contextName: string) => void
    stopWatchNodes: () => void
    onNodeChange: (callback: (type: string, node: any) => void) => (() => void)
    streamPodLogs: (contextName: string, namespace: string, name: string, containerName: string) => void
    stopStreamPodLogs: (namespace: string, name: string, containerName: string) => Promise<void>
    onPodLogChunk: (callback: (streamId: string, chunk: string) => void) => (() => void)
    explainResource: (resource: any, model?: string) => Promise<string>
    decodeCertificate: (certData: string) => Promise<{
      subject: string;
      issuer: string;
      validFrom: string;
      validTo: string;
      serialNumber: string;
      fingerprint: string;
      sans: string[];
    } | null>
    openExternal: (url: string) => Promise<void>
    getApiKey: () => Promise<string>
    saveApiKey: (key: string) => Promise<void>

    // AI Streaming & AWS Creds
    streamExplainResource: (
      resource: any,
      options: { model: string; provider: string },
      onChunk: (chunk: string) => void,
      onDone: () => void,
      onError: (error: any) => void
    ) => () => void
    streamCustomPrompt: (
      prompt: string,
      options: {
        model: string;
        provider: string;
        systemPrompt?: string;
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
        resourceName?: string;
        resourceType?: string;
        saveToHistory?: boolean;
        promptPreview?: string;
      },
      onChunk: (chunk: string) => void,
      onDone: () => void,
      onError: (error: any) => void
    ) => () => void
    saveAwsCreds: (creds: any) => Promise<void>
    getAwsCreds: () => Promise<any>
    listModels: (provider: string) => Promise<Array<{ id: string; name: string }>>
    checkAwsAuth: () => Promise<{ isManaged: boolean; isAuthenticated: boolean; error?: string }>

    // --- AI History ---
    getHistory: () => Promise<Array<any>>
    saveHistoryItem: (item: any) => Promise<boolean>
    deleteHistoryItem: (id: string) => Promise<boolean>
    clearHistory: () => Promise<boolean>
    startSession: (context?: any, model?: string, provider?: string) => Promise<any>
    loadSession: (id: string) => Promise<any>
    saveCurrentSession: () => Promise<boolean>
    getCurrentSession: () => Promise<any>

    // --- Notifications ---
    notifications: {
      getAll: () => Promise<any[]>
      add: (notification: any) => Promise<any[]>
      markRead: (id: string) => Promise<any[]>
      markAllRead: () => Promise<any[]>
      delete: (id: string) => Promise<any[]>
      clear: () => Promise<any[]>
      getUnreadCount: () => Promise<number>
    }

    // --- Pinned Clusters ---
    getPinnedClusters: () => Promise<string[]>
    addPinnedCluster: (clusterName: string) => Promise<string[]>
    removePinnedCluster: (clusterName: string) => Promise<string[]>
    getModelSync: () => string
    getProviderSync: () => 'google' | 'bedrock'
    saveModelSelection: (provider: string, model: string) => Promise<boolean>

    // --- General Settings ---
    settings: {
      get: (key: string) => Promise<any>
      set: (key: string, value: any) => Promise<boolean>
      getAll: () => Promise<{
        refreshInterval: number
        defaultNamespace: string
        showSystemNamespaces: boolean
        enableNotifications: boolean
        maxLogLines: number
        editorFontSize: number
        editorWordWrap: boolean
        terminalFontSize: number
      }>
      getKubeconfigPath: () => Promise<string>
      setKubeconfigPath: (path: string) => Promise<boolean>
      getContextConfig: () => Promise<{ tokenBudget: number; summariesEnabled: boolean; anomalyDetectionEnabled: boolean }>
      setContextConfig: (config: Partial<{ tokenBudget: number; summariesEnabled: boolean; anomalyDetectionEnabled: boolean }>) => Promise<boolean>
    }

    // --- Context Engine ---
    context: {
      getStatus: () => Promise<{ resourceCount: number; lastUpdate: number }>
      getSummary: (resourceType: string, namespace?: string) => Promise<{ summary: string; fromCache: boolean }>
      getAnomalies: () => Promise<any[]>
      clusterSwitch: () => Promise<boolean>
      onAnomaly: (callback: (anomaly: any) => void) => () => void
    }

    // --- AWS Integration ---
    aws: {
      getEksCluster: (region: string, clusterName: string) => Promise<any>
      getVpcDetails: (region: string, vpcId: string) => Promise<any>
      getSubnets: (region: string, vpcId: string) => Promise<any[]>
      getInstanceDetails: (region: string, instanceId: string) => Promise<any>
      getEc2Instances: (region: string, vpcId: string, clusterName?: string) => Promise<any[]>
      getDbInstances?: (region: string, vpcId: string) => Promise<any[]>
      getPodIdentities: (region: string, clusterName: string) => Promise<any[]>
      checkAuth: (region: string) => Promise<{ isAuthenticated: boolean; identity?: string; account?: string; error?: string }>
      clearCache: () => Promise<boolean>
      listProfiles: () => Promise<string[]>
      getProfile: () => Promise<string>
      setProfile: (profile: string) => Promise<{ success: boolean; identity: string | null; account: string | null }>
      getGrantedCredentials: () => Promise<any>
      isGrantedActive: () => Promise<boolean>
      isGrantedConfigured: () => Promise<{ configured: boolean; profiles: string[] }>
      getCallerIdentity: (region?: string) => Promise<any>
      onCredentialsChanged: (callback: (data: { identity: string; account: string; profile?: string }) => void) => () => void
    }

    // --- Terminal ---
    terminal: {
      create: (id: string, cols: number, rows: number) => void
      write: (id: string, data: string) => void
      resize: (id: string, cols: number, rows: number) => void
      dispose: (id: string) => void
      onData: (callback: (id: string, data: string) => void) => () => void
      onExit: (callback: (id: string, exitCode: number) => void) => () => void
    }

    // --- App ---
    app: {
      restart: () => Promise<void>
      getVersion: () => Promise<string>
    }

    // --- Onboarding ---
    onboarding: {
      getLastSeenVersion: () => Promise<string | null>
      setLastSeenVersion: (version: string) => Promise<boolean>
    }

    // --- AI Events ---
    onBedrockAccessDenied: (callback: (message: string) => void) => () => void
  }
}
