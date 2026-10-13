/**
 * Resource sync controller (design §6.2). Plain logic behind `useResourceSync`, unit-testable
 * without a DOM. Owns the request token, the single `resources:batch` listener, single-flight
 * resubscribe and start-error mapping. It never reads `connectionStatus`.
 */
import type { EnsureFreshResult, ResourceBatch, ResourceSnapshot, StartSessionArgs } from '../types/resource-cache';
import type { ResourceStoreState } from '../stores/resourceStore';

export interface ResourceSyncApi {
  startSession(args: StartSessionArgs): Promise<ResourceSnapshot>;
  subscribe(): Promise<ResourceSnapshot | null>;
  stopSession(): Promise<unknown>;
  ensureFresh(): Promise<EnsureFreshResult>;
  onBatch(cb: (batch: ResourceBatch) => void): () => void;
}

export interface ResourceStoreLike {
  getState(): Pick<ResourceStoreState, 'context' | 'reset' | 'applySnapshot' | 'applyBatch' | 'setAllStatus'>;
}

export type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

export interface ResourceSyncController {
  /** The effect body for `[selectedCluster, syncEpoch]`. Returns the effect cleanup. */
  onSync(selectedCluster: string | null, syncEpoch: number): () => void;
  setNamespaces(namespaces: string[]): void;
  /** Window focus: ask main to refresh stale streams; rebind if main no longer has us as subscriber. */
  onFocus(): void;
  /** Full teardown (HMR backstop). */
  dispose(): void;
}

const FIXED_START_ERRORS = new Set(['Unknown kube context', 'Failed to load kubeconfig']);

export function createResourceSyncController(
  api: ResourceSyncApi,
  store: ResourceStoreLike,
  opts: { showToast?: () => ToastFn | undefined } = {},
): ResourceSyncController {
  let token = 0;
  let prevCluster: string | null = null;
  let currentCluster: string | null = null;
  let namespaces: string[] = ['all'];
  let off: (() => void) | null = null;
  let startPending = false;
  let resubscribing = false;

  function handleStartError(err: unknown): void {
    const message = (err as Error)?.message ?? '';
    if (message.includes('Session superseded')) return;
    const error = [...FIXED_START_ERRORS].find((m) => message.endsWith(m)) ?? 'Failed to start resource sync';
    store.getState().setAllStatus({ phase: 'error', error });
    opts.showToast?.()?.(error, 'error');
  }

  function startSessionFor(t: number): void {
    if (!currentCluster) return;
    startPending = true;
    api
      .startSession({ context: currentCluster, namespaces: [...namespaces] })
      .then((snap) => { if (t === token) store.getState().applySnapshot(snap); })
      .catch((err: unknown) => { if (t === token) handleStartError(err); })
      .finally(() => { if (t === token) startPending = false; });
  }

  function resubscribe(t: number): void {
    if (startPending || resubscribing || t !== token) return;
    resubscribing = true;
    api
      .subscribe()
      .then((snap) => {
        if (t !== token) return;
        if (snap) store.getState().applySnapshot(snap);
        else startSessionFor(t); // session gone: same token
      })
      .catch(() => { /* subscribe never rejects */ })
      .finally(() => { resubscribing = false; });
  }

  function cleanup(): void {
    token++;
    off?.();
    off = null;
    startPending = false;
    resubscribing = false;
  }

  return {
    onSync(selectedCluster) {
      if (off) cleanup(); // the previous effect's cleanup did not run (direct callers)
      const prev = prevCluster;
      prevCluster = selectedCluster;
      currentCluster = selectedCluster;
      const t = ++token;
      if (!selectedCluster) {
        if (prev) {
          void api.stopSession().catch(() => {});
          store.getState().reset(null);
        }
        return () => { if (t === token) cleanup(); };
      }
      if (store.getState().context !== selectedCluster) store.getState().reset(selectedCluster);
      off = api.onBatch((b) => {
        if (t !== token) return;
        const r = store.getState().applyBatch(b);
        if (r === 'gap' || r === 'resubscribe') resubscribe(t);
      });
      startSessionFor(t);
      return () => { if (t === token) cleanup(); };
    },
    setNamespaces(ns) {
      namespaces = ns.length ? [...ns] : ['all'];
    },
    onFocus() {
      const t = token;
      api
        .ensureFresh()
        .then((r) => { if (!r.bound && currentCluster && off && t === token) resubscribe(t); })
        .catch(() => {});
    },
    dispose() {
      cleanup();
    },
  };
}
