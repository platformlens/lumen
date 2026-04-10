import { KubeConfig, CoreV1Api, makeInformer, type V1Pod, type Informer } from '@kubernetes/client-node';
import type { LightweightPod, ContainerStatus, PodDelta, WorkerInbound, WorkerOutbound } from '../src/types/pod-worker';

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

  destroy(): void {
    clearInterval(this.flushTimer);
    this.flush();
  }
}


// ---------------------------------------------------------------------------
// Worker state and message handler (runs inside Electron utilityProcess)
// ---------------------------------------------------------------------------
// Guard: only initialize when running as a utilityProcess (parentPort exists).
// This allows the file to be imported in tests without side effects.

if (process.parentPort) {
  const podCache = new Map<string, LightweightPod>();
  let activeInformer: Informer<V1Pod> | null = null;

  function postMessage(msg: WorkerOutbound): void {
    process.parentPort!.postMessage(msg);
  }

  function onFlush(deltas: PodDelta[]): void {
    postMessage({ type: 'pod-delta-batch', deltas });
  }

  const deltaBatch = new DeltaBatchBuffer({ flushIntervalMs: 150, onFlush });

  process.parentPort.on('message', async (event: Electron.MessageEvent) => {
    const msg = event.data as WorkerInbound;

    switch (msg.type) {
      case 'start-informer': {
        try {
          // 1. Stop existing informer if running
          if (activeInformer) {
            await activeInformer.stop();
            podCache.clear();
            deltaBatch.flush();
            activeInformer = null;
          }

          // 2. Load kubeconfig and set context
          const kc = new KubeConfig();
          if (msg.kubeconfigPath) {
            kc.loadFromFile(msg.kubeconfigPath);
          } else {
            kc.loadFromDefault();
          }
          kc.setCurrentContext(msg.context);
          const k8sApi = kc.makeApiClient(CoreV1Api);

          // 3. Build list function and path based on namespace scope
          const isAllNamespaces = msg.namespaces.length === 0 || msg.namespaces.includes('all');
          const isSingleNamespace = !isAllNamespaces && msg.namespaces.length === 1;
          const path = isAllNamespaces || !isSingleNamespace
            ? '/api/v1/pods'
            : `/api/v1/namespaces/${msg.namespaces[0]}/pods`;

          const listFn = isAllNamespaces || !isSingleNamespace
            ? () => k8sApi.listPodForAllNamespaces()
            : () => k8sApi.listNamespacedPod({ namespace: msg.namespaces[0] });

          // 4. Create and wire informer
          const informer = makeInformer(kc, path, listFn);

          informer.on('add', (obj: V1Pod) => {
            const pod = mapLightweightPod(obj);
            podCache.set(pod.uid, pod);
            deltaBatch.push({ action: 'add', pod });
          });

          informer.on('update', (obj: V1Pod) => {
            const pod = mapLightweightPod(obj);
            podCache.set(pod.uid, pod);
            deltaBatch.push({ action: 'update', pod });
          });

          informer.on('delete', (obj: V1Pod) => {
            const uid = obj.metadata?.uid;
            if (uid) {
              podCache.delete(uid);
              deltaBatch.push({ action: 'delete', uid });
            }
          });

          informer.on('error', (err: unknown) => {
            postMessage({
              type: 'informer-error',
              error: String(err).slice(0, 500),
              recoverable: true,
            });
          });

          activeInformer = informer;

          // 5. Start and notify when initial list is synced
          await informer.start();
          postMessage({ type: 'informer-synced', count: podCache.size });
        } catch (err) {
          postMessage({
            type: 'informer-error',
            error: `Failed to start informer: ${String(err).slice(0, 450)}`,
            recoverable: false,
          });
        }
        break;
      }

      case 'stop-informer': {
        if (activeInformer) {
          await activeInformer.stop();
          activeInformer = null;
        }
        podCache.clear();
        deltaBatch.flush();
        postMessage({ type: 'informer-stopped' });
        break;
      }

      case 'get-pods-chunk': {
        const { requestId, offset, limit } = msg;
        const allPods = Array.from(podCache.values());
        const chunk = allPods.slice(offset, offset + limit);
        postMessage({ type: 'pods-chunk-reply', requestId, payload: chunk });
        break;
      }

      case 'get-pod-count': {
        postMessage({ type: 'pod-count-reply', count: podCache.size });
        break;
      }
    }
  });
}
