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

export type WorkerInbound =
  | { type: 'start-informer'; context: string; namespaces: string[]; kubeconfigPath?: string }
  | { type: 'stop-informer' }
  | { type: 'get-pods-chunk'; requestId: string; offset: number; limit: number }
  | { type: 'get-pod-count' };

export type WorkerOutbound =
  | { type: 'informer-synced'; count: number }
  | { type: 'informer-stopped' }
  | { type: 'informer-error'; error: string; recoverable: boolean }
  | { type: 'pods-chunk-reply'; requestId: string; payload: LightweightPod[] }
  | { type: 'pod-count-reply'; count: number }
  | { type: 'pod-delta-batch'; deltas: PodDelta[] };
