import { useCallback, useMemo } from 'react';
import { useResourceStore, type ResourceStoreState } from '../stores/resourceStore';
import { countInNamespaces, filterByNamespaces } from '../utils/resource-utils';
import type { CoreKind, KindItemMap, KindStatus } from '../types/resource-cache';

/**
 * Selector hooks for the resource cache (design §6.3). Every selector returns a stored reference
 * or a primitive, never a fresh object, so no useShallow is needed.
 */

export function useResourceMap<K extends CoreKind>(kind: K): ReadonlyMap<string, KindItemMap[K]> {
  return useResourceStore((s) => s.kinds[kind].byId as ReadonlyMap<string, KindItemMap[K]>);
}

export function useResourceList<K extends CoreKind>(kind: K, selectedNamespaces: string[]): KindItemMap[K][] {
  const byId = useResourceMap(kind);
  const nsKey = selectedNamespaces.join(',');
  return useMemo(() => filterByNamespaces(Array.from(byId.values()), nsKey.split(',')), [byId, nsKey]);
}

export function useResourceStatus(kind: CoreKind): KindStatus {
  return useResourceStore((s) => s.kinds[kind].status);
}

/** -1 for non-core views. Re-renders the caller only when the visible count changes. */
export function useResourceCount(kind: CoreKind | null, selectedNamespaces: string[]): number {
  const nsKey = selectedNamespaces.join(',');
  return useResourceStore(
    useCallback((s: ResourceStoreState) => (kind ? countInNamespaces(s.kinds[kind].byId, nsKey) : -1), [kind, nsKey]),
  );
}
