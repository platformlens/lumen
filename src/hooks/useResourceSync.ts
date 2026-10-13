import { useCallback, useEffect, useRef, useState } from 'react';
import { useResourceStore } from '../stores/resourceStore';
import { createResourceSyncController, type ToastFn } from './resource-sync-controller';

/**
 * Mounted once in App.tsx (design §6.2). Keeps the renderer store in sync with the main-process
 * resource cache for the selected cluster. Dashboard remounts and tab switches never touch it.
 * Returns the callback Dashboard uses to report its namespace selection.
 */
export function useResourceSync(selectedCluster: string | null, syncEpoch: number, showToast?: ToastFn): (namespaces: string[]) => void {
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const [controller] = useState(() =>
    createResourceSyncController(window.k8s.resources, useResourceStore, { showToast: () => toastRef.current }),
  );

  useEffect(() => controller.onSync(selectedCluster, syncEpoch), [controller, selectedCluster, syncEpoch]);

  // Focus: main applies a 660 s silence floor, so alt-tab never churns healthy watches.
  useEffect(() => {
    const onFocus = () => controller.onFocus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [controller]);

  useEffect(() => {
    import.meta.hot?.dispose(() => controller.dispose());
    if (!import.meta.env.DEV) return;
    window.__lumenDiag = async () => ({
      main: await window.k8s.resources.getDiagnostics(),
      batchListeners: window.k8s.resources.listenerCount(),
      dropped: useResourceStore.getState().droppedBatches,
    });
    return () => { delete window.__lumenDiag; };
  }, [controller]);

  return useCallback((namespaces: string[]) => controller.setNamespaces(namespaces), [controller]);
}
