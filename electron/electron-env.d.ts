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
    getClusters: () => Promise<Array<{ name: string; cluster: any; user: any }>>
    getNamespaces: (contextName: string) => Promise<string[]>
    getDeployments: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; replicas: number; availableReplicas: number }>>
    getDeployment: (contextName: string, namespace: string, name: string) => Promise<any>
    scaleDeployment: (contextName: string, namespace: string, name: string, replicas: number) => Promise<any>
    getDeploymentYaml: (contextName: string, namespace: string, name: string) => Promise<string>
    updateDeploymentYaml: (contextName: string, namespace: string, name: string, yamlString: string) => Promise<any>
    getPods: (contextName: string, namespaces?: string[]) => Promise<Array<{ name: string; namespace: string; status: string; restarts: number; age: string }>>
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
    getClusterRoleBinding: (contextName: string, name: string) => Promise<any>
    getRoleBinding: (contextName: string, namespace: string, name: string) => Promise<any>
    getEvents: (contextName: string, namespaces?: string[]) => Promise<Array<{ type: string; reason: string; message: string; count: number; lastTimestamp: string; object: string; namespace: string }>>
    getNodes: (contextName: string) => Promise<any[]>
    getNode: (contextName: string, name: string) => Promise<any>
    getCRDs: (contextName: string) => Promise<any[]>
    getCRD: (contextName: string, name: string) => Promise<any>
    getCustomObjects: (contextName: string, group: string, version: string, plural: string) => Promise<any[]>
    startPortForward: (contextName: string, namespace: string, serviceName: string, servicePort: number, localPort: number) => Promise<{ id: string, localPort: number }>
    stopPortForward: (id: string) => Promise<boolean>
    stopAllPortForwards: () => Promise<boolean>
    getActivePortForwards: () => Promise<Array<{ id: string, namespace: string, serviceName: string, inputPort: string | number, targetPort: number, localPort: number }>>
    deletePod: (contextName: string, namespace: string, name: string) => Promise<boolean>
    watchPods: (contextName: string, namespaces: string[]) => void
    stopWatchPods: () => void
    onPodChange: (callback: (type: string, pod: any) => void) => (() => void)
    streamPodLogs: (contextName: string, namespace: string, name: string, containerName: string) => void
    stopStreamPodLogs: (namespace: string, name: string, containerName: string) => Promise<void>
    onPodLogChunk: (callback: (streamId: string, chunk: string) => void) => (() => void)
    explainResource: (resource: any, model?: string) => Promise<string>
    openExternal: (url: string) => Promise<void>
    getApiKey: () => Promise<string>
    saveApiKey: (key: string) => Promise<void>
  }
}
