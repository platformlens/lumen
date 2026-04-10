import { useState, useEffect, useCallback, useRef } from 'react';
import type { LightweightPod, PodDelta } from '../types/pod-worker';

export interface UsePodWorkerOptions {
  context: string;
  namespaces: string[];
  enabled: boolean;
}

export interface UsePodWorkerResult {
  pods: LightweightPod[];
  isLoading: boolean;
  isSynced: boolean;
  error: string | null;
  podCount: number;
  refresh: () => void;
}

/**
 * Applies a batch of deltas to the current pod array, returning a new immutable array.
 *
 * - add: appends if UID is new, updates in-place if UID exists (idempotent)
 * - update: replaces matching UID, appends if not found (handles out-of-order delivery)
 * - delete: removes matching UID, no-op if not found
 *
 * Uses a Map for O(n) rebuild. Order of unaffected pods is preserved.
 */
export function applyDeltas(
  current: LightweightPod[],
  deltas: PodDelta[],
): LightweightPod[] {
  const map = new Map<string, LightweightPod>();
  for (const pod of current) {
    map.set(pod.uid, pod);
  }

  for (const delta of deltas) {
    switch (delta.action) {
      case 'add':
      case 'update':
        map.set(delta.pod!.uid, delta.pod!);
        break;
      case 'delete':
        map.delete(delta.uid!);
        break;
    }
  }

  return Array.from(map.values());
}

const podWorkerApi = () => (window as any).k8s.podWorker as {
  startInformer: (context: string, namespaces: string[]) => Promise<void>;
  stopInformer: () => Promise<void>;
  getPodsChunk: (offset: number, limit: number) => Promise<LightweightPod[]>;
  onDeltaBatch: (callback: (deltas: PodDelta[]) => void) => () => void;
  onSynced: (callback: (data: { count: number }) => void) => () => void;
  onError: (callback: (data: { error: string; recoverable: boolean }) => void) => () => void;
};

export function usePodWorker(options: UsePodWorkerOptions): UsePodWorkerResult {
  const { context, namespaces, enabled } = options;

  const [pods, setPods] = useState<LightweightPod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [podCount, setPodCount] = useState(0);

  // Track current context/namespaces for the refresh callback
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const refresh = useCallback(() => {
    const { context: ctx, namespaces: ns, enabled: en } = optionsRef.current;
    if (!en || !ctx) return;

    const api = podWorkerApi();
    setPods([]);
    setIsLoading(true);
    setIsSynced(false);
    setError(null);
    setPodCount(0);

    api.stopInformer().then(() => {
      api.startInformer(ctx, ns);
    });
  }, []);

  useEffect(() => {
    if (!enabled || !context) {
      setPods([]);
      setIsLoading(false);
      setIsSynced(false);
      setError(null);
      setPodCount(0);
      return;
    }

    const api = podWorkerApi();
    setIsLoading(true);
    setIsSynced(false);
    setError(null);

    // Subscribe to events before starting the informer to avoid missing messages
    const cleanupSynced = api.onSynced(async (data) => {
      setPodCount(data.count);
      try {
        const initialPods = await api.getPodsChunk(0, 50000);
        setPods(initialPods);
        setPodCount(initialPods.length);
        setIsSynced(true);
        setIsLoading(false);
      } catch (err) {
        setError(String(err));
        setIsLoading(false);
      }
    });

    const cleanupDelta = api.onDeltaBatch((deltas) => {
      setPods((prev) => {
        const next = applyDeltas(prev, deltas);
        setPodCount(next.length);
        return next;
      });
    });

    const cleanupError = api.onError((data) => {
      setError(data.error);
      if (!data.recoverable) {
        setIsLoading(false);
      }
    });

    api.startInformer(context, namespaces);

    return () => {
      cleanupSynced();
      cleanupDelta();
      cleanupError();
      api.stopInformer();
    };
    // Serialize namespaces to avoid reference-equality re-fires
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, JSON.stringify(namespaces), enabled]);

  return { pods, isLoading, isSynced, error, podCount, refresh };
}
