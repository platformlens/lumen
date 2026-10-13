export interface ContainerStatus {
  name: string;
  state: 'running' | 'waiting' | 'terminated';
  ready: boolean;
  restartCount: number;
}

export interface LightweightPod {
  uid: string;
  name: string;
  namespace: string;
  status: 'Running' | 'Pending' | 'Succeeded' | 'Failed' | 'Terminating' | 'Unknown';
  restarts: number;
  age: string; // ISO timestamp
  node: string;
  containers: ContainerStatus[];
  cpu?: string;
  memory?: string;
}

export interface PodDelta {
  action: 'add' | 'update' | 'delete';
  pod?: LightweightPod;
  uid?: string;
}

// ---------------------------------------------------------------------------
// Protocol v2 (background resource cache, design §3.6). Every message is
// session-tagged; the worker answers chunk requests from its current generation only.
// ---------------------------------------------------------------------------

export interface StartInformerMsg {
  type: 'start-informer';
  sessionId: string;
  context: string;
  mode: 'cluster' | 'namespaced';
  namespaces: string[];
  /** Same kubeconfig location K8sService uses (custom path); absent means loadFromDefault. */
  kubeconfigPath?: string;
}
export interface StopInformerMsg { type: 'stop-informer'; sessionId: string }
export interface RefreshMsg { type: 'refresh'; sessionId: string; maxSilenceMs: number }

export type WorkerInboundV2 =
  | StartInformerMsg
  | StopInformerMsg
  | RefreshMsg
  | { type: 'get-pods-chunk'; requestId: string; sessionId: string }
  | { type: 'get-diagnostics'; requestId: string };

export interface PodWorkerDiagnosticsReply {
  type: 'diagnostics-reply';
  requestId: string;
  informers: number;
  podCacheSize: number;
  sessionId: string | null;
  gen: number;
  retryTimers: number;
  informerStarts: number;
}

export type WorkerOutboundV2 =
  | { type: 'pod-delta-batch'; sessionId: string | null; deltas: PodDelta[] }
  | { type: 'informer-synced'; sessionId: string; count: number }
  | { type: 'informer-error'; sessionId: string; statusCode: number | null; recoverable: boolean; namespace?: string }
  | { type: 'pods-chunk-reply'; requestId: string; sessionId: string | null; synced: boolean; pods: LightweightPod[] }
  | PodWorkerDiagnosticsReply;
