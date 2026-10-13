import { KubeConfig, CoreV1Api, makeInformer, type V1Pod } from '@kubernetes/client-node';
import type { LightweightPod, ContainerStatus, PodDelta, WorkerInboundV2, WorkerOutboundV2 } from '../src/types/pod-worker';
import { createPodWorkerCore } from './pod-worker-core';

/**
 * Transforms a raw Kubernetes V1Pod into a LightweightPod for IPC transfer.
 * Retains no reference to the original V1Pod object.
 */
export function mapLightweightPod(raw: V1Pod): LightweightPod {
  const initContainerStatuses = raw.status?.initContainerStatuses ?? [];
  const containerStatuses = raw.status?.containerStatuses ?? [];

  const containers: ContainerStatus[] = [...initContainerStatuses, ...containerStatuses].map(c => ({
    name: c.name,
    state: c.state?.running ? 'running' : c.state?.waiting ? 'waiting' : 'terminated',
    ready: c.ready ?? false,
    restartCount: c.restartCount ?? 0,
  }));

  const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);

  let status: LightweightPod['status'];
  if (raw.metadata?.deletionTimestamp) {
    status = 'Terminating';
  } else {
    const phase = raw.status?.phase;
    switch (phase) {
      case 'Running':
      case 'Pending':
      case 'Succeeded':
      case 'Failed':
        status = phase;
        break;
      default:
        status = 'Unknown';
    }
  }

  return {
    uid: raw.metadata!.uid!,
    name: raw.metadata!.name!,
    namespace: raw.metadata!.namespace!,
    status,
    restarts,
    age: (() => {
      if (raw.metadata!.creationTimestamp) {
        const d = new Date(raw.metadata!.creationTimestamp);
        if (!isNaN(d.getTime())) return d.toISOString();
      }
      return new Date().toISOString();
    })(),
    node: raw.spec?.nodeName ?? '',
    containers,
  };
}

export interface DeltaBatchBufferOptions {
  flushIntervalMs?: number;
  onFlush: (deltas: PodDelta[]) => void;
}

/**
 * Coalescing buffer that accumulates PodDelta events and flushes them
 * at a fixed interval. Deduplicates by UID using last-write-wins semantics.
 *
 * Coalescing rules:
 * - Multiple updates to the same UID: last write wins
 * - Delete after add/update: only the delete is emitted
 * - Add after delete: only the add is emitted
 */
export class DeltaBatchBuffer {
  private buffer: Map<string, PodDelta>;
  private flushTimer: ReturnType<typeof setInterval>;
  private onFlush: (deltas: PodDelta[]) => void;

  constructor(options: DeltaBatchBufferOptions) {
    this.buffer = new Map();
    this.onFlush = options.onFlush;
    this.flushTimer = setInterval(() => this.flush(), options.flushIntervalMs ?? 150);
  }

  push(delta: PodDelta): void {
    const uid = delta.action === 'delete' ? delta.uid! : delta.pod!.uid;
    const existing = this.buffer.get(uid);

    if (existing) {
      if (delta.action === 'delete') {
        // Delete supersedes any prior add/update
        this.buffer.set(uid, delta);
      } else if (existing.action === 'delete') {
        // Add/update after a delete: emit only the add
        this.buffer.set(uid, { action: 'add', pod: delta.pod });
      } else {
        // Update after add/update: last write wins, preserve original action if it was 'add'
        this.buffer.set(uid, { action: existing.action === 'add' ? 'add' : delta.action, pod: delta.pod });
      }
    } else {
      this.buffer.set(uid, delta);
    }
  }

  flush(): void {
    if (this.buffer.size === 0) return;
    const deltas = Array.from(this.buffer.values());
    this.buffer.clear();
    this.onFlush(deltas);
  }

  /**
   * Drop pending deltas without posting (generation change, design §3.6 / D5).
   * The module-lifetime flush interval keeps running; with an empty map it is a no-op.
   */
  clear(): void {
    this.buffer.clear();
  }

  destroy(): void {
    clearInterval(this.flushTimer);
    this.flush();
  }
}


// ---------------------------------------------------------------------------
// Worker entry (runs inside Electron utilityProcess). The lifecycle logic lives in
// pod-worker-core.ts (protocol v2, design §3.6); this file only wires parentPort.
// ---------------------------------------------------------------------------
// Guard: only initialize when running as a utilityProcess (parentPort exists).
// This allows the file to be imported in tests without side effects.

if (process.parentPort) {
  const port = process.parentPort;
  const core = createPodWorkerCore<KubeConfig, V1Pod>({
    makeInformer: (kc, path, namespace) => {
      const api = kc.makeApiClient(CoreV1Api);
      const listFn = namespace === null ? () => api.listPodForAllNamespaces() : () => api.listNamespacedPod({ namespace });
      return makeInformer(kc, path, listFn);
    },
    buildKc: (context, kubeconfigPath) => {
      const kc = new KubeConfig();
      if (kubeconfigPath) kc.loadFromFile(kubeconfigPath);
      else kc.loadFromDefault();
      if (!kc.getContextObject(context)) throw new Error('Unknown kube context');
      kc.setCurrentContext(context);
      return kc;
    },
    post: (msg: WorkerOutboundV2) => port.postMessage(msg),
    mapPod: mapLightweightPod,
    uidOf: (raw) => raw.metadata?.uid,
    createDeltaBuffer: (onFlush) => new DeltaBatchBuffer({ flushIntervalMs: 150, onFlush }),
  });

  port.on('message', (event: Electron.MessageEvent) => {
    core.handle(event.data as WorkerInboundV2);
  });
}
