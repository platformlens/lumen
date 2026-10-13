/**
 * Transform worker client (design §3.5.1, fixes D9).
 *
 * Pending requests are tracked per worker instance, so a dying worker can only fail
 * its own requests and never nulls a newer worker. Every request settles: on a message,
 * on worker error/exit, or after a 15 s timeout.
 */
import type { TransformRequest, TransformResponse } from './resource-transform-worker';

export interface TransformWorkerLike {
  on(event: 'message', cb: (r: TransformResponse) => void): unknown;
  on(event: 'error', cb: (err: unknown) => void): unknown;
  on(event: 'exit', cb: (code: number) => void): unknown;
  postMessage(req: TransformRequest): void;
  terminate(): Promise<number> | void;
}

export interface TransformWorkerClientDeps {
  createWorker(): TransformWorkerLike;
  timeoutMs?: number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
}

export interface TransformWorkerClient {
  sendToWorker(req: TransformRequest): Promise<TransformResponse>;
  pendingTransformCount(): number;
  /** For tests/diagnostics: the current worker, or null. */
  currentWorker(): TransformWorkerLike | null;
}

export const TRANSFORM_TIMEOUT_MS = 15_000;

export function createTransformWorkerClient(deps: TransformWorkerClientDeps): TransformWorkerClient {
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((t) => clearTimeout(t));
  const timeoutMs = deps.timeoutMs ?? TRANSFORM_TIMEOUT_MS;

  const pending = new Map<string, { resolve: (r: TransformResponse) => void; worker: TransformWorkerLike; timer: ReturnType<typeof setTimeout> }>();
  const workerPending = new WeakMap<TransformWorkerLike, Set<string>>();
  let transformWorker: TransformWorkerLike | null = null;

  function getOrCreateWorker(): TransformWorkerLike {
    if (transformWorker) return transformWorker;
    const w = deps.createWorker();
    const mine = new Set<string>();
    workerPending.set(w, mine);
    const settle = (id: string, r: TransformResponse) => {
      const p = pending.get(id);
      if (!p || p.worker !== w) return;
      clearT(p.timer);
      pending.delete(id);
      mine.delete(id);
      p.resolve(r);
    };
    const failAll = (reason: string) => {
      for (const id of [...mine]) {
        const resourceType = 'unknown';
        settle(id, { id, resourceType, events: [], error: reason });
      }
      if (transformWorker === w) transformWorker = null; // never null a newer worker
    };
    w.on('message', (r: TransformResponse) => settle(r.id, r));
    w.on('error', (err: unknown) => {
      console.error('[Worker] Transform worker error:', (err as Error)?.name ?? 'Error');
      failAll('worker error');
      void w.terminate();
    });
    w.on('exit', (code: number) => {
      if (code !== 0) console.error('[Worker] Transform worker exited with code', code);
      failAll('worker exited');
    });
    transformWorker = w;
    return w;
  }

  return {
    sendToWorker(req) {
      return new Promise((resolve) => {
        const w = getOrCreateWorker();
        const timer = setT(() => {
          const p = pending.get(req.id);
          if (!p) return;
          pending.delete(req.id);
          workerPending.get(p.worker)?.delete(req.id);
          console.warn('[Worker] transform timeout', req.resourceType);
          resolve({ id: req.id, resourceType: req.resourceType, events: [], error: 'timeout' });
        }, timeoutMs);
        pending.set(req.id, { resolve, worker: w, timer });
        workerPending.get(w)!.add(req.id);
        w.postMessage(req);
      });
    },
    pendingTransformCount: () => pending.size,
    currentWorker: () => transformWorker,
  };
}
