import { ipcRenderer, contextBridge } from 'electron'
import type { AiStreamUsagePayload } from '../src/utils/ai-meter'
import type { ContextsChangedPayload, RenameClusterResult } from '../src/types/cluster-context'
import type { CrossplaneObjectRef, CrossplaneScanProgress } from '../src/types/crossplane'
import type { EnsureFreshResult, ResourceBatch, ResourceCacheDiagnostics, ResourceSnapshot, StartSessionArgs } from '../src/types/resource-cache'

// Crossplane IPC: one object argument per call; undefined option keys are omitted.
function crossplaneArgs<T extends Record<string, unknown>>(base: T, opts?: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(opts ?? {})) if (v !== undefined) out[k] = v
  return out as T
}

// --------- Terminal event demultiplexing ---------
// One ipcRenderer listener per channel (registered lazily) routes events to the
// callbacks of the matching terminal id, so each session only sees its own IO.
type TerminalSubs<T> = Map<string, Set<(payload: T) => void>>
const terminalDataSubs: TerminalSubs<string> = new Map()
const terminalExitSubs: TerminalSubs<number> = new Map()
const registeredTerminalChannels = new Set<string>()

function subscribeTerminal<T>(subs: TerminalSubs<T>, channel: string, id: string, callback: (payload: T) => void): () => void {
  if (!registeredTerminalChannels.has(channel)) {
    registeredTerminalChannels.add(channel)
    ipcRenderer.on(channel, (_event, termId: unknown, payload: T) => {
      if (typeof termId !== 'string') return
      subs.get(termId)?.forEach(cb => cb(payload))
    })
  }
  let set = subs.get(id)
  if (!set) {
    set = new Set()
    subs.set(id, set)
  }
  set.add(callback)
  return () => {
    const current = subs.get(id)
    if (!current) return
    current.delete(callback)
    if (current.size === 0) subs.delete(id)
  }
}

// --------- Expose typed API to the Renderer process ---------
contextBridge.exposeInMainWorld('k8s', {
  // --- Credential Management ---
  forceCredentialRefresh: () => ipcRenderer.invoke('k8s:forceCredentialRefresh'),

  getClusters: () => ipcRenderer.invoke('k8s:getClusters'),
  onContextsChanged: (callback: (payload: ContextsChangedPayload) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: ContextsChangedPayload) => callback(payload);
    ipcRenderer.on('k8s:contextsChanged', listener);
    return () => { ipcRenderer.off('k8s:contextsChanged', listener); };
  },
  renameCluster: (oldName: string, newName: string): Promise<RenameClusterResult> => ipcRenderer.invoke('k8s:renameContext', { oldName, newName }),
  getNamespaces: (contextName: string) => ipcRenderer.invoke('k8s:getNamespaces', contextName),
  getNamespacesDetails: (contextName: string) => ipcRenderer.invoke('k8s:getNamespacesDetails', contextName),
  getDeployments: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getDeployments', contextName, namespaces),
  getDeployment: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getDeployment', contextName, namespace, name),
  scaleDeployment: (contextName: string, namespace: string, name: string, replicas: number) => ipcRenderer.invoke('k8s:scaleDeployment', contextName, namespace, name, replicas),
  getDeploymentYaml: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getDeploymentYaml', contextName, namespace, name),
  updateDeploymentYaml: (contextName: string, namespace: string, name: string, yamlContent: string) => ipcRenderer.invoke('k8s:updateDeploymentYaml', contextName, namespace, name, yamlContent),
  getPods: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getPods', contextName, namespaces),
  getPodsForNode: (contextName: string, nodeName: string) => ipcRenderer.invoke('k8s:getPodsForNode', contextName, nodeName),
  getPodsLite: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getPodsLite', contextName, namespaces),
  getPodMetrics: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getPodMetrics', contextName, namespaces),
  getNodeMetrics: (contextName: string) => ipcRenderer.invoke('k8s:getNodeMetrics', contextName),
  getPod: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getPod', contextName, namespace, name),
  getReplicaSets: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getReplicaSets', contextName, namespaces),
  getDeploymentRevisions: (contextName: string, namespace: string, deploymentName: string) => ipcRenderer.invoke('k8s:getDeploymentRevisions', contextName, namespace, deploymentName),
  getDeploymentFullDetails: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getDeploymentFullDetails', contextName, namespace, name),
  restartDeployment: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:restartDeployment', contextName, namespace, name),
  getReplicaSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getReplicaSet', contextName, namespace, name),
  getServices: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getServices', contextName, namespaces),
  getService: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getService', contextName, namespace, name),
  getClusterRoleBindings: (contextName: string) => ipcRenderer.invoke('k8s:getClusterRoleBindings', contextName),
  getServiceAccounts: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getServiceAccounts', contextName, namespaces),
  getServiceAccount: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getServiceAccount', contextName, namespace, name),
  getRoles: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getRoles', contextName, namespaces),
  getRole: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getRole', contextName, namespace, name),
  getRoleBindings: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getRoleBindings', contextName, namespaces),
  getClusterRoles: (contextName: string) => ipcRenderer.invoke('k8s:getClusterRoles', contextName),
  getClusterRole: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getClusterRole', contextName, name),
  getClusterRoleBinding: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getClusterRoleBinding', contextName, name),
  getRoleBinding: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getRoleBinding', contextName, namespace, name),
  getEvents: (contextName: string, namespaces?: string[], fieldSelector?: string) => ipcRenderer.invoke('k8s:getEvents', contextName, namespaces, fieldSelector),
  getNodes: (contextName: string) => ipcRenderer.invoke('k8s:getNodes', contextName),
  getNode: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getNode', contextName, name),
  deleteNode: (contextName: string, name: string) => ipcRenderer.invoke('k8s:deleteNode', contextName, name),
  cordonNode: (contextName: string, name: string) => ipcRenderer.invoke('k8s:cordonNode', contextName, name),
  uncordonNode: (contextName: string, name: string) => ipcRenderer.invoke('k8s:uncordonNode', contextName, name),
  drainNode: (contextName: string, name: string) => ipcRenderer.invoke('k8s:drainNode', contextName, name),
  getCRDs: (contextName: string) => ipcRenderer.invoke('k8s:getCRDs', contextName),
  getCRD: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getCRD', contextName, name),
  listCustomObjects: (contextName: string, group: string, version: string, plural: string, namespace?: string) => ipcRenderer.invoke('k8s:listCustomObjects', contextName, group, version, plural, namespace),
  getCustomObjects: (contextName: string, group: string, version: string, plural: string) => ipcRenderer.invoke('k8s:getCustomObjects', contextName, group, version, plural),
  getDaemonSets: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getDaemonSets', contextName, namespaces),
  getDaemonSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getDaemonSet', contextName, namespace, name),
  restartDaemonSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:restartDaemonSet', contextName, namespace, name),
  deleteDaemonSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteDaemonSet', contextName, namespace, name),
  getStatefulSets: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getStatefulSets', contextName, namespaces),
  getStatefulSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getStatefulSet', contextName, namespace, name),
  restartStatefulSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:restartStatefulSet', contextName, namespace, name),
  deleteStatefulSet: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteStatefulSet', contextName, namespace, name),
  getJobs: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getJobs', contextName, namespaces),
  getJob: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getJob', contextName, namespace, name),
  deleteJob: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deleteJob', contextName, namespace, name),
  getCronJobs: (contextName: string, namespaces?: string[]) => ipcRenderer.invoke('k8s:getCronJobs', contextName, namespaces),
  getCronJob: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:getCronJob', contextName, namespace, name),
  triggerCronJob: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:triggerCronJob', contextName, namespace, name),
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

  // Generic resource YAML operations
  getResourceYaml: (contextName: string, apiVersion: string, kind: string, name: string, namespace?: string) => ipcRenderer.invoke('k8s:getResourceYaml', contextName, apiVersion, kind, name, namespace),
  updateResourceYaml: (contextName: string, apiVersion: string, kind: string, name: string, yamlContent: string, namespace?: string) => ipcRenderer.invoke('k8s:updateResourceYaml', contextName, apiVersion, kind, name, yamlContent, namespace),
  deleteResource: (contextName: string, apiVersion: string, kind: string, name: string, namespace?: string) => ipcRenderer.invoke('k8s:deleteResource', contextName, apiVersion, kind, name, namespace),

  getMutatingWebhookConfigurations: (contextName: string) => ipcRenderer.invoke('k8s:getMutatingWebhookConfigurations', contextName),
  getMutatingWebhookConfiguration: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getMutatingWebhookConfiguration', contextName, name),

  getValidatingWebhookConfigurations: (contextName: string) => ipcRenderer.invoke('k8s:getValidatingWebhookConfigurations', contextName),
  getValidatingWebhookConfiguration: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getValidatingWebhookConfiguration', contextName, name),

  getPriorityClasses: (contextName: string) => ipcRenderer.invoke('k8s:getPriorityClasses', contextName),
  getPriorityClass: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getPriorityClass', contextName, name),

  getRuntimeClasses: (contextName: string) => ipcRenderer.invoke('k8s:getRuntimeClasses', contextName),
  getRuntimeClass: (contextName: string, name: string) => ipcRenderer.invoke('k8s:getRuntimeClass', contextName, name),

  // --- Port Forwarding ---
  startPortForward: (contextName: string, namespace: string, serviceName: string, servicePort: number, localPort: number, resourceType?: 'service' | 'pod') => ipcRenderer.invoke('k8s:startPortForward', contextName, namespace, serviceName, servicePort, localPort, resourceType),
  stopPortForward: (id: string) => ipcRenderer.invoke('k8s:stopPortForward', id),
  stopAllPortForwards: () => ipcRenderer.invoke('k8s:stopAllPortForwards'),
  getActivePortForwards: () => ipcRenderer.invoke('k8s:getActivePortForwards'),
  streamExplainResource: (resource: any, options: any, onChunk: (chunk: string) => void, onDone: () => void, onError: (err: any) => void) => {
    ipcRenderer.send('ai:explainResourceStream', resource, options);

    const chunkListener = (_: any, chunk: string) => onChunk(chunk);
    const doneListener = () => onDone();
    const errorListener = (_: any, err: any) => onError(err);

    // Prevent duplicate listeners by removing previous ones
    ipcRenderer.removeAllListeners('ai:explainResourceStream:chunk');
    ipcRenderer.removeAllListeners('ai:explainResourceStream:done');
    ipcRenderer.removeAllListeners('ai:explainResourceStream:error');

    ipcRenderer.on('ai:explainResourceStream:chunk', chunkListener);
    ipcRenderer.on('ai:explainResourceStream:done', doneListener);
    ipcRenderer.on('ai:explainResourceStream:error', errorListener);

    return () => {
      ipcRenderer.send('ai:cancelExplainResourceStream');
      ipcRenderer.off('ai:explainResourceStream:chunk', chunkListener);
      ipcRenderer.off('ai:explainResourceStream:done', doneListener);
      ipcRenderer.off('ai:explainResourceStream:error', errorListener);
    };
  },
  streamCustomPrompt: (
    prompt: string,
    options: any,
    onChunk: (chunk: string) => void,
    onDone: (usage?: AiStreamUsagePayload) => void,
    onError: (err: any) => void
  ) => {
    // Cancel any previous stream first
    ipcRenderer.send('ai:cancelCustomPromptStream');

    // Small delay to ensure cancellation is processed
    setTimeout(() => {
      ipcRenderer.send('ai:customPromptStream', prompt, options);
    }, 10);

    const chunkListener = (_: any, chunk: string) => onChunk(chunk);
    const doneListener = (_: any, usage?: AiStreamUsagePayload) => onDone(usage);
    const errorListener = (_: any, err: any) => onError(err);

    // Prevent duplicate listeners by removing previous ones
    ipcRenderer.removeAllListeners('ai:customPromptStream:chunk');
    ipcRenderer.removeAllListeners('ai:customPromptStream:done');
    ipcRenderer.removeAllListeners('ai:customPromptStream:error');

    ipcRenderer.on('ai:customPromptStream:chunk', chunkListener);
    ipcRenderer.on('ai:customPromptStream:done', doneListener);
    ipcRenderer.on('ai:customPromptStream:error', errorListener);

    return () => {
      ipcRenderer.send('ai:cancelCustomPromptStream');
      ipcRenderer.off('ai:customPromptStream:chunk', chunkListener);
      ipcRenderer.off('ai:customPromptStream:done', doneListener);
      ipcRenderer.off('ai:customPromptStream:error', errorListener);
    };
  },
  // Tool approval IPC
  onToolApprovalRequest: (callback: (request: { toolCallId: string; command: string; isReadOnly: boolean }) => void) => {
    const listener = (_: any, request: any) => callback(request);
    ipcRenderer.on('ai:toolApprovalRequest', listener);
    return () => { ipcRenderer.off('ai:toolApprovalRequest', listener); };
  },
  respondToolApproval: (toolCallId: string, approved: boolean, trust: boolean) => {
    ipcRenderer.send('ai:toolApprovalResponse', toolCallId, approved, trust);
  },
  decodeCertificate: (certData: string) => ipcRenderer.invoke('k8s:decodeCertificate', certData),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  deletePod: (contextName: string, namespace: string, name: string) => ipcRenderer.invoke('k8s:deletePod', contextName, namespace, name),
  watchNodes: (contextName: string) => ipcRenderer.send('k8s:watchNodes', contextName),
  stopWatchNodes: () => ipcRenderer.send('k8s:stopWatchNodes'),
  watchGenericResource: (contextName: string, resourceType: string, apiPath: string) => ipcRenderer.send('k8s:watchGenericResource', contextName, resourceType, apiPath),
  stopWatchGenericResource: (resourceType: string) => ipcRenderer.send('k8s:stopWatchGenericResource', resourceType),
  onGenericResourceChange: (callback: (resourceType: string, type: string, resource: any) => void) => {
    const listener = (_: any, resourceType: string, type: string, resource: any) => callback(resourceType, type, resource);
    ipcRenderer.on('k8s:genericResourceChange', listener);
    return () => ipcRenderer.off('k8s:genericResourceChange', listener);
  },
  onGenericResourceBatchChange: (callback: (resourceType: string, events: Array<{ type: string; resource: any }>) => void) => {
    const listener = (_: any, resourceType: string, events: Array<{ type: string; resource: any }>) => callback(resourceType, events);
    ipcRenderer.on('k8s:genericResourceBatchChange', listener);
    return () => ipcRenderer.off('k8s:genericResourceBatchChange', listener);
  },
  onNodeChange: (callback: (type: string, node: any) => void) => {
    const listener = (_: any, type: string, node: any) => callback(type, node);
    ipcRenderer.on('k8s:nodeChange', listener);
    return () => ipcRenderer.off('k8s:nodeChange', listener);
  },
  onNodeBatchChange: (callback: (events: Array<{ type: string; node: any }>) => void) => {
    const listener = (_: any, events: Array<{ type: string; node: any }>) => callback(events);
    ipcRenderer.on('k8s:nodeBatchChange', listener);
    return () => ipcRenderer.off('k8s:nodeBatchChange', listener);
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
  saveAwsCreds: (creds: any) => ipcRenderer.invoke('settings:saveAwsCreds', creds),
  listModels: (provider: string) => ipcRenderer.invoke('ai:listModels', provider),
  checkAwsAuth: () => ipcRenderer.invoke('ai:checkAwsAuth'),
  getModelSync: () => ipcRenderer.sendSync('settings:getModelSync'),
  getProviderSync: () => ipcRenderer.sendSync('settings:getProviderSync'),
  saveModelSelection: (provider: string, model: string) => ipcRenderer.invoke('settings:saveModelSelection', provider, model),

  // --- General Settings ---
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    getKubeconfigPath: () => ipcRenderer.invoke('settings:getKubeconfigPath'),
    setKubeconfigPath: (p: string) => ipcRenderer.invoke('settings:setKubeconfigPath', p),
    getContextConfig: () => ipcRenderer.invoke('settings:getContextConfig'),
    setContextConfig: (config: any) => ipcRenderer.invoke('settings:setContextConfig', config),
    setZoomFactor: (factor: number) => ipcRenderer.invoke('settings:setZoomFactor', factor),
    // --- Masked credential metadata (never exposes raw secrets) ---
    hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
    apiKeyMasked: () => ipcRenderer.invoke('settings:apiKeyMasked'),
    hasAwsCreds: () => ipcRenderer.invoke('settings:hasAwsCreds'),
    awsAccessKeyMasked: () => ipcRenderer.invoke('settings:awsAccessKeyMasked'),
    // --- Safe Mode ---
    getSafeMode: () => ipcRenderer.invoke('settings:getSafeMode'),
    setSafeMode: (enabled: boolean) => ipcRenderer.invoke('settings:setSafeMode', enabled),
    // --- AI Data Consent ---
    getAiDataConsent: () => ipcRenderer.invoke('settings:getAiDataConsent'),
    setAiDataConsent: (enabled: boolean) => ipcRenderer.invoke('settings:setAiDataConsent', enabled),
  },

  // --- AI History & Sessions ---
  getHistory: () => ipcRenderer.invoke('ai:getHistory'),
  startSession: (context?: any, model?: string, provider?: string) => ipcRenderer.invoke('ai:startSession', context, model, provider),
  loadSession: (id: string) => ipcRenderer.invoke('ai:loadSession', id),
  saveCurrentSession: () => ipcRenderer.invoke('ai:saveCurrentSession'),
  getCurrentSession: () => ipcRenderer.invoke('ai:getCurrentSession'),

  // --- Context Engine ---
  context: {
    getStatus: () => ipcRenderer.invoke('context:getStatus'),
    getSummary: (resourceType: string, namespace?: string) => ipcRenderer.invoke('context:getSummary', resourceType, namespace),
    getAnomalies: () => ipcRenderer.invoke('context:getAnomalies'),
    clusterSwitch: () => ipcRenderer.invoke('context:clusterSwitch'),
    onAnomaly: (callback: (anomaly: any) => void) => {
      const listener = (_: any, anomaly: any) => callback(anomaly);
      ipcRenderer.on('context:anomaly', listener);
      return () => ipcRenderer.off('context:anomaly', listener);
    },
  },
  saveHistoryItem: (item: any) => ipcRenderer.invoke('ai:saveHistoryItem', item),
  deleteHistoryItem: (id: string) => ipcRenderer.invoke('ai:deleteHistoryItem', id),
  clearHistory: () => ipcRenderer.invoke('ai:clearHistory'),

  // --- Notifications ---
  notifications: {
    getAll: () => ipcRenderer.invoke('notifications:getAll'),
    add: (notification: any) => ipcRenderer.invoke('notifications:add', notification),
    markRead: (id: string) => ipcRenderer.invoke('notifications:markRead', id),
    markAllRead: () => ipcRenderer.invoke('notifications:markAllRead'),
    delete: (id: string) => ipcRenderer.invoke('notifications:delete', id),
    clear: () => ipcRenderer.invoke('notifications:clear'),
    getUnreadCount: () => ipcRenderer.invoke('notifications:getUnreadCount'),
  },

  // --- Pinned Clusters ---
  getPinnedClusters: () => ipcRenderer.invoke('k8s:getPinnedClusters'),
  addPinnedCluster: (clusterName: string) => ipcRenderer.invoke('k8s:addPinnedCluster', clusterName),
  removePinnedCluster: (clusterName: string) => ipcRenderer.invoke('k8s:removePinnedCluster', clusterName),


  // --- Terminal ---
  terminal: {
    create: (id: string, cols: number, rows: number, context?: string) => {
      // Only send the context when set so the optional zod rest arg stays absent
      if (context !== undefined) {
        ipcRenderer.send('terminal:create', id, cols, rows, context);
      } else {
        ipcRenderer.send('terminal:create', id, cols, rows);
      }
    },
    createExec: (id: string, cols: number, rows: number, context: string, namespace: string, podName: string, containerName?: string) => ipcRenderer.send('terminal:createExec', id, cols, rows, context, namespace, podName, containerName),
    write: (id: string, data: string) => ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
    dispose: (id: string) => ipcRenderer.send('terminal:dispose', id),
    /** Subscribe to output of ONE terminal session. Returns an unsubscribe function. */
    onData: (id: string, callback: (data: string) => void) => subscribeTerminal(terminalDataSubs, 'terminal:data', id, callback),
    /** Subscribe to the exit of ONE terminal session. Returns an unsubscribe function. */
    onExit: (id: string, callback: (exitCode: number) => void) => subscribeTerminal(terminalExitSubs, 'terminal:exit', id, callback),
  },

  // --- AWS ---
  aws: {
    getEksCluster: (region: string, clusterName: string) => ipcRenderer.invoke('aws:getEksCluster', region, clusterName),
    getVpcDetails: (region: string, vpcId: string) => ipcRenderer.invoke('aws:getVpcDetails', region, vpcId),
    getSubnets: (region: string, vpcId: string) => ipcRenderer.invoke('aws:getSubnets', region, vpcId),
    getInstanceDetails: (region: string, instanceId: string) => ipcRenderer.invoke('aws:getInstanceDetails', region, instanceId),
    getEc2Instances: (region: string, vpcId: string, clusterName?: string) => ipcRenderer.invoke('aws:getEc2Instances', region, vpcId, clusterName),
    getPodIdentities: (region: string, clusterName: string) => ipcRenderer.invoke('aws:getPodIdentities', region, clusterName),
    checkAuth: (region: string) => ipcRenderer.invoke('aws:checkAuth', region),
    clearCache: () => ipcRenderer.invoke('aws:clearCache'),
    listProfiles: () => ipcRenderer.invoke('aws:listProfiles'),
    getProfile: () => ipcRenderer.invoke('aws:getProfile'),
    setProfile: (profile: string) => ipcRenderer.invoke('aws:setProfile', profile),
    getGrantedCredentials: () => ipcRenderer.invoke('aws:getGrantedCredentials'),
    isGrantedActive: () => ipcRenderer.invoke('aws:isGrantedActive'),
    isGrantedConfigured: () => ipcRenderer.invoke('aws:isGrantedConfigured'),
    getCallerIdentity: (region?: string) => ipcRenderer.invoke('aws:getCallerIdentity', region),
    lookupCloudTrailEvents: (params: { region: string; clusterName: string; startTime: string; endTime: string; nextToken?: string; maxResults?: number }) => ipcRenderer.invoke('aws:lookupCloudTrailEvents', params),
    queryAuditLogs: (params: { region: string; clusterName: string; startTime: string; endTime: string; query: string }) => ipcRenderer.invoke('aws:queryAuditLogs', params),
    onCredentialsChanged: (callback: (data: { identity: string; account: string; profile?: string }) => void) => {
      const listener = (_: any, data: { identity: string; account: string; profile?: string }) => callback(data);
      ipcRenderer.on('aws:credentialsChanged', listener);
      return () => ipcRenderer.off('aws:credentialsChanged', listener);
    },
  },

  // --- App ---
  app: {
    restart: () => ipcRenderer.invoke('app:restart'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
    onWindowFocused: (callback: () => void) => {
      // Named listener: the disposer removes only this subscriber (D6)
      const listener = () => callback();
      ipcRenderer.on('app:windowFocused', listener);
      return () => { ipcRenderer.off('app:windowFocused', listener); };
    },
  },

  // --- Helm ---
  helm: {
    getReleases: (contextName: string, namespaces: string[]) =>
      ipcRenderer.invoke('helm:getReleases', contextName, namespaces),
    getRelease: (contextName: string, namespace: string, name: string) =>
      ipcRenderer.invoke('helm:getRelease', contextName, namespace, name),
    getReleaseHistory: (contextName: string, namespace: string, name: string) =>
      ipcRenderer.invoke('helm:getReleaseHistory', contextName, namespace, name),
    uninstallRelease: (contextName: string, namespace: string, name: string) =>
      ipcRenderer.invoke('helm:uninstallRelease', contextName, namespace, name),
    rollbackRelease: (contextName: string, namespace: string, name: string, revision: number) =>
      ipcRenderer.invoke('helm:rollbackRelease', contextName, namespace, name, revision),
    listRepos: () => ipcRenderer.invoke('helm:listRepos'),
    updateRepos: () => ipcRenderer.invoke('helm:updateRepos'),
    addRepo: (name: string, url: string) => ipcRenderer.invoke('helm:addRepo', name, url),
    getCatalog: (opts?: { force?: boolean }) => ipcRenderer.invoke('helm:getCatalog', opts),
  },

  // --- Crossplane (read-only) ---
  crossplane: {
    detect: (context: string, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('crossplane:detect', crossplaneArgs({ context }, opts)),
    getPackages: (context: string, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('crossplane:getPackages', crossplaneArgs({ context }, opts)),
    getDefinitions: (context: string, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('crossplane:getDefinitions', crossplaneArgs({ context }, opts)),
    getComposites: (context: string, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('crossplane:getComposites', crossplaneArgs({ context }, opts)),
    getManagedKinds: (context: string, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('crossplane:getManagedKinds', crossplaneArgs({ context }, opts)),
    scanManaged: (context: string, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('crossplane:scanManaged', crossplaneArgs({ context }, opts)),
    getManagedItems: (context: string, kindKeys: string[], opts?: { force?: boolean }) =>
      ipcRenderer.invoke('crossplane:getManagedItems', crossplaneArgs({ context, kindKeys }, opts)),
    getWarningEvents: (context: string, opts?: { limit?: number; force?: boolean }) =>
      ipcRenderer.invoke('crossplane:getWarningEvents', crossplaneArgs({ context }, opts)),
    getResource: (context: string, ref: CrossplaneObjectRef) =>
      ipcRenderer.invoke('crossplane:getResource', { context, ref }),
    getTree: (context: string, ref: CrossplaneObjectRef) =>
      ipcRenderer.invoke('crossplane:getTree', { context, ref }),
    onScanProgress: (callback: (p: CrossplaneScanProgress) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, p: CrossplaneScanProgress) => callback(p);
      ipcRenderer.on('crossplane:scanProgress', listener);
      return () => { ipcRenderer.removeListener('crossplane:scanProgress', listener); };
    },
  },

  artifactHub: {
    fetch: (pathAndQuery: string, options?: { accept?: string }) =>
      ipcRenderer.invoke('artifacthub:fetch', pathAndQuery, options),
  },

  // --- Background resource cache (core kinds) ---
  resources: {
    startSession: (args: StartSessionArgs): Promise<ResourceSnapshot> => ipcRenderer.invoke('resources:startSession', args),
    subscribe: (): Promise<ResourceSnapshot | null> => ipcRenderer.invoke('resources:subscribe'),
    stopSession: (): Promise<true> => ipcRenderer.invoke('resources:stopSession'),
    setNamespaces: (namespaces: string[]): Promise<true> => ipcRenderer.invoke('resources:setNamespaces', { namespaces }),
    ensureFresh: (): Promise<EnsureFreshResult> => ipcRenderer.invoke('resources:ensureFresh'),
    getDiagnostics: (): Promise<ResourceCacheDiagnostics | null> => ipcRenderer.invoke('resources:getDiagnostics'),
    onBatch: (cb: (batch: ResourceBatch) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, batch: ResourceBatch) => cb(batch);
      ipcRenderer.on('resources:batch', listener);
      return () => { ipcRenderer.off('resources:batch', listener); };
    },
    /** Diagnostics only: fixed channel. */
    listenerCount: (): number => ipcRenderer.listenerCount('resources:batch'),
  },

  // --- Onboarding ---
  onboarding: {
    getLastSeenVersion: () => ipcRenderer.invoke('onboarding:getLastSeenVersion'),
    setLastSeenVersion: (version: string) => ipcRenderer.invoke('onboarding:setLastSeenVersion', version),
  },

  // --- What's New ---
  whatsNew: {
    getLastSeenVersion: () => ipcRenderer.invoke('whatsNew:getLastSeenVersion'),
    setLastSeenVersion: (version: string) => ipcRenderer.invoke('whatsNew:setLastSeenVersion', version),
  },

  // --- File Dialog ---
  dialog: {
    openYamlFile: (): Promise<{ filePath: string; content: string } | null> =>
      ipcRenderer.invoke('dialog:openYamlFile'),
    saveYamlFile: (filePath: string | null, content: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveYamlFile', filePath, content),
  },

  // --- Auth ---
  auth: {
    saveSession: (session: string | object) => ipcRenderer.invoke('auth:saveSession', session),
    getSession: () => ipcRenderer.invoke('auth:getSession'),
    clearSession: () => ipcRenderer.invoke('auth:clearSession'),
    onOAuthCallback: (callback: (callbackUrl: string) => void) => {
      const listener = (_: unknown, callbackUrl: string) => callback(callbackUrl)
      ipcRenderer.on('auth:oauth-callback', listener)
      return () => { ipcRenderer.removeListener('auth:oauth-callback', listener) }
    },
  },

  // --- AI Events ---
  onBedrockAccessDenied: (callback: (message: string) => void) => {
    const listener = (_: any, message: string) => callback(message);
    ipcRenderer.on('ai:bedrockAccessDenied', listener);
    return () => { ipcRenderer.off('ai:bedrockAccessDenied', listener); };
  },
})
