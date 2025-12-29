import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld('k8s', {
  getClusters: () => ipcRenderer.invoke('k8s:getClusters'),
  getNamespaces: (contextName: string) => ipcRenderer.invoke('k8s:getNamespaces', contextName),
  getDeployments: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getDeployments', contextName, namespaces),
  getDeployment: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getDeployment', contextName, namespace, name),
  scaleDeployment: (contextName: string, namespace: string, name: string, replicas: number) => ipcRenderer.invoke('k8s:scaleDeployment', contextName, namespace, name, replicas),
  getDeploymentYaml: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getDeploymentYaml', contextName, namespace, name),
  updateDeploymentYaml: (contextName: string, namespace: string, name: string, yamlContent: string) => ipcRenderer.invoke('k8s:updateDeploymentYaml', contextName, namespace, name, yamlContent),
  getPods: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getPods', contextName, namespaces),
  getPod: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getPod', contextName, namespace, name),
  getReplicaSets: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getReplicaSets', contextName, namespaces),
  getReplicaSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getReplicaSet', contextName, namespace, name),
  getServices: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getServices', contextName, namespaces),
  getService: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getService', contextName, namespace, name),
  getClusterRoleBindings: (contextName: string) => ipcRenderer.invoke('k8s:getClusterRoleBindings', contextName),
  getServiceAccounts: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getServiceAccounts', contextName, namespaces),
  getServiceAccount: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getServiceAccount', contextName, namespace, name),
  getRoles: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getRoles', contextName, namespaces),
  getRole: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getRole', contextName, namespace, name),
  getRoleBindings: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getRoleBindings', contextName, namespaces),
  getClusterRoleBinding: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getClusterRoleBinding', contextName, name),
  getRoleBinding: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getRoleBinding', contextName, namespace, name),
  getEvents: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getEvents', contextName, namespaces),
  getNodes: (contextName: string) => ipcRenderer.invoke('k8s:getNodes', contextName),
  getNode: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getNode', contextName, name),
  getCRDs: (contextName: string) => ipcRenderer.invoke('k8s:getCRDs', contextName),
  getCRD: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getCRD', contextName, name),
  getCustomObjects: (contextName: string, group: string, version: string, plural: string) => ipcRenderer.invoke('k8s:getCustomObjects', contextName, group, version, plural),
  getDaemonSets: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getDaemonSets', contextName, namespaces),
  getDaemonSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getDaemonSet', contextName, namespace, name),
  deleteDaemonSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteDaemonSet', contextName, namespace, name),
  getStatefulSets: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getStatefulSets', contextName, namespaces),
  getStatefulSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getStatefulSet', contextName, namespace, name),
  deleteStatefulSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteStatefulSet', contextName, namespace, name),
  getJobs: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getJobs', contextName, namespaces),
  getJob: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getJob', contextName, namespace, name),
  deleteJob: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteJob', contextName, namespace, name),
  getCronJobs: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getCronJobs', contextName, namespaces),
  getCronJob: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getCronJob', contextName, namespace, name),
  deleteCronJob: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteCronJob', contextName, namespace, name),

  // --- Network ---
  getEndpointSlices: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getEndpointSlices', contextName, namespaces),
  getEndpointSlice: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getEndpointSlice', contextName, namespace, name),
  deleteEndpointSlice: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteEndpointSlice', contextName, namespace, name),

  getEndpoints: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getEndpoints', contextName, namespaces),
  getEndpoint: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getEndpoint', contextName, namespace, name),
  deleteEndpoint: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteEndpoint', contextName, namespace, name),

  getIngresses: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getIngresses', contextName, namespaces),
  getIngress: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getIngress', contextName, namespace, name),
  deleteIngress: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteIngress', contextName, namespace, name),

  getIngressClasses: (contextName: string) => ipcRenderer.invoke('k8s:getIngressClasses', contextName),
  getIngressClass: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getIngressClass', contextName, name),
  deleteIngressClass: (contextName: string, name: string) => ipcRenderer.invoke('k8s:deleteIngressClass', contextName, name),

  getNetworkPolicies: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getNetworkPolicies', contextName, namespaces),
  getNetworkPolicy: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getNetworkPolicy', contextName, namespace, name),
  deleteNetworkPolicy: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteNetworkPolicy', contextName, namespace, name),

  // --- Storage ---
  getPersistentVolumeClaims: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getPersistentVolumeClaims', contextName, namespaces),
  getPersistentVolumeClaim: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getPersistentVolumeClaim', contextName, namespace, name),
  deletePersistentVolumeClaim: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deletePersistentVolumeClaim', contextName, namespace, name),

  getPersistentVolumes: (contextName: string) => ipcRenderer.invoke('k8s:getPersistentVolumes', contextName),
  getPersistentVolume: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getPersistentVolume', contextName, name),
  deletePersistentVolume: (contextName: string, name: string) => ipcRenderer.invoke('k8s:deletePersistentVolume', contextName, name),

  getStorageClasses: (contextName: string) => ipcRenderer.invoke('k8s:getStorageClasses', contextName),
  getStorageClass: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getStorageClass', contextName, name),
  deleteStorageClass: (contextName: string, name: string) => ipcRenderer.invoke('k8s:deleteStorageClass', contextName, name),

  // --- Config ---
  getConfigMaps: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getConfigMaps', contextName, namespaces),
  getConfigMap: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getConfigMap', contextName, namespace, name),

  getSecrets: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getSecrets', contextName, namespaces),
  getSecret: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getSecret', contextName, namespace, name),

  getHorizontalPodAutoscalers: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getHorizontalPodAutoscalers', contextName, namespaces),
  getHorizontalPodAutoscaler: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getHorizontalPodAutoscaler', contextName, namespace, name),

  getPodDisruptionBudgets: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getPodDisruptionBudgets', contextName, namespaces),
  getPodDisruptionBudget: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getPodDisruptionBudget', contextName, namespace, name),
  getPdbYaml: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getPdbYaml', contextName, namespace, name),
  updatePdbYaml: (contextName: string, namespace: string, name: string, yamlContent: string) => ipcRenderer.invoke('k8s:updatePdbYaml', contextName, namespace, name, yamlContent),

  getMutatingWebhookConfigurations: (contextName: string) => ipcRenderer.invoke('k8s:getMutatingWebhookConfigurations', contextName),
  getMutatingWebhookConfiguration: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getMutatingWebhookConfiguration', contextName, name),

  getValidatingWebhookConfigurations: (contextName: string) => ipcRenderer.invoke('k8s:getValidatingWebhookConfigurations', contextName),
  getValidatingWebhookConfiguration: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getValidatingWebhookConfiguration', contextName, name),

  getPriorityClasses: (contextName: string) => ipcRenderer.invoke('k8s:getPriorityClasses', contextName),
  getPriorityClass: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getPriorityClass', contextName, name),

  getRuntimeClasses: (contextName: string) => ipcRenderer.invoke('k8s:getRuntimeClasses', contextName),
  getRuntimeClass: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getRuntimeClass', contextName, name),

  // --- Port Forwarding ---
  startPortForward: (contextName: string, namespace: string, serviceName: string, servicePort: number, localPort: number) => ipcRenderer.invoke('k8s:startPortForward', contextName, namespace, serviceName, servicePort, localPort),
  stopPortForward: (id: string) => ipcRenderer.invoke('k8s:stopPortForward', id),
  stopAllPortForwards: () => ipcRenderer.invoke('k8s:stopAllPortForwards'),
  getActivePortForwards: () => ipcRenderer.invoke('k8s:getActivePortForwards'),
  explainResource: (resource: any, model?: string) => ipcRenderer.invoke('ai:explainResource', resource, model),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  deletePod: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deletePod', contextName, namespace, name),
  watchPods: (contextName: string, namespaces: string[]) => ipcRenderer.send('k8s:watchPods', contextName, namespaces),
  stopWatchPods: () => ipcRenderer.send('k8s:stopWatchPods'),
  onPodChange: (callback: (type: string, pod: any) => void) => {
    const listener = (_: any, type: string, pod: any) => callback(type, pod);
    ipcRenderer.on('k8s:podChange', listener);
    // Return unsubscribe function
    return () => ipcRenderer.off('k8s:podChange', listener);
  },
  streamPodLogs: (contextName: string, namespace: string, name: string, containerName: string) => ipcRenderer.send('k8s:streamPodLogs', contextName, namespace, name, containerName),
  stopStreamPodLogs: (namespace: string, name: string, containerName: string) => ipcRenderer.invoke('k8s:stopStreamPodLogs', namespace, name, containerName),
  onPodLogChunk: (callback: (streamId: string, chunk: string) => void) => {
    const listener = (_: any, id: string, chunk: string) => callback(id, chunk);
    ipcRenderer.on('k8s:podLogChunk', listener);
    return () => ipcRenderer.off('k8s:podLogChunk', listener);
  },

  // --- Settings ---
  saveApiKey: (key: string) => ipcRenderer.invoke('settings:saveApiKey', key),
  getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),

  // --- Terminal ---
  terminal: {
    create: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:create', id, cols, rows),
    write: (id: string, data: string) => ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
    dispose: (id: string) => ipcRenderer.send('terminal:dispose', id),
    onData: (callback: (id: string, data: string) => void) => {
      const listener = (_: any, id: string, data: string) => callback(id, data);
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.off('terminal:data', listener);
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const listener = (_: any, id: string, exitCode: number) => callback(id, exitCode);
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.off('terminal:exit', listener);
    }
  }
})
