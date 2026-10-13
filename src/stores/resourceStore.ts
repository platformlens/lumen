import { create } from 'zustand';
import {
  CORE_KINDS,
  type CoreKind,
  type KindDelta,
  type KindItemMap,
  type KindStatus,
  type ResourceBatch,
  type ResourceSnapshot,
} from '../types/resource-cache';

/**
 * Renderer mirror of the main-process resource cache (design §6.1).
 *
 * Normalized per-kind Maps keyed by id. Every batch is applied in ONE set(); only the kinds present
 * in the batch get a new Map, so subscribers of other kinds do not re-render. No derived arrays.
 */

export interface KindSlice<K extends CoreKind> {
  byId: ReadonlyMap<string, KindItemMap[K]>;
  status: KindStatus;
}

export type KindsState = { [K in CoreKind]: KindSlice<K> };

export type ApplyResult = 'applied' | 'dropped' | 'gap' | 'resubscribe';

export interface ResourceStoreState {
  sessionId: string | null;
  context: string | null;
  seq: number;
  droppedBatches: number;
  consecutiveMismatches: number;
  kinds: KindsState;
  /** All kinds → empty Map, phase 'loading'. Always nulls sessionId. */
  reset(context: string | null): void;
  /** Replaces everything in one set(). */
  applySnapshot(s: ResourceSnapshot): void;
  /** New status object per kind; every byId reference is kept; sessionId/seq untouched. */
  setAllStatus(status: Pick<KindStatus, 'phase' | 'error'>): void;
  applyBatch(b: ResourceBatch): ApplyResult;
}

export const MISMATCH_RESUBSCRIBE = 5;

const loading = (): KindStatus => ({ phase: 'loading', error: null, lastSyncedAt: null, mode: 'cluster' });

function emptyKinds(): KindsState {
  const out = {} as Record<CoreKind, KindSlice<CoreKind>>;
  for (const k of CORE_KINDS) out[k] = { byId: new Map(), status: loading() };
  return out as KindsState;
}

function kindsFromSnapshot(snap: ResourceSnapshot): KindsState {
  const out = {} as Record<CoreKind, KindSlice<CoreKind>>;
  for (const k of CORE_KINDS) {
    const entry = snap.kinds[k] as { items: KindItemMap[CoreKind][]; status: KindStatus };
    out[k] = { byId: new Map(entry.items.map((i) => [i.id, i])), status: entry.status };
  }
  return out as KindsState;
}

function applyDelta<K extends CoreKind>(slice: KindSlice<K>, delta: KindDelta<K>): KindSlice<K> {
  let byId: Map<string, KindItemMap[K]>;
  if (delta.reset) {
    byId = new Map(delta.upserts.map((i) => [i.id, i]));
  } else {
    byId = new Map(slice.byId);
    for (const id of delta.deletes) byId.delete(id);
    for (const item of delta.upserts) byId.set(item.id, item);
  }
  return { byId, status: delta.status ?? slice.status };
}

/** Pure reducer: new kinds object with only the batch's kinds replaced. */
export function applyKinds(kinds: KindsState, b: ResourceBatch): KindsState {
  const next = { ...kinds } as Record<CoreKind, KindSlice<CoreKind>>;
  for (const k of Object.keys(b.kinds) as CoreKind[]) {
    const delta = b.kinds[k] as KindDelta<CoreKind> | undefined;
    if (!delta) continue;
    const hasItems = delta.reset || delta.upserts.length > 0 || delta.deletes.length > 0;
    next[k] = hasItems
      ? applyDelta(kinds[k] as KindSlice<CoreKind>, delta)
      : { byId: kinds[k].byId as KindSlice<CoreKind>['byId'], status: delta.status ?? kinds[k].status };
  }
  return next as KindsState;
}

export const useResourceStore = create<ResourceStoreState>((set, get) => ({
  sessionId: null,
  context: null,
  seq: 0,
  droppedBatches: 0,
  consecutiveMismatches: 0,
  kinds: emptyKinds(),

  reset: (context) => {
    set({ context, sessionId: null, seq: 0, consecutiveMismatches: 0, kinds: emptyKinds() });
  },

  applySnapshot: (snap) => {
    set({ context: snap.context, sessionId: snap.sessionId, seq: snap.seq, consecutiveMismatches: 0, kinds: kindsFromSnapshot(snap) });
  },

  setAllStatus: ({ phase, error }) => {
    const kinds = get().kinds;
    const next = {} as Record<CoreKind, KindSlice<CoreKind>>;
    for (const k of CORE_KINDS) next[k] = { byId: kinds[k].byId as KindSlice<CoreKind>['byId'], status: { ...kinds[k].status, phase, error } };
    set({ kinds: next as KindsState });
  },

  applyBatch: (b) => {
    const s = get();
    if (s.sessionId === null) return 'dropped'; // awaiting a snapshot that covers this batch; not counted
    if (b.sessionId !== s.sessionId) {
      const n = s.consecutiveMismatches + 1;
      if (import.meta.env?.DEV) console.debug('[resourceStore] dropped batch from another session');
      set({ droppedBatches: s.droppedBatches + 1, consecutiveMismatches: n });
      return n >= MISMATCH_RESUBSCRIBE ? 'resubscribe' : 'dropped';
    }
    if (b.seq <= s.seq) return 'dropped'; // already covered by the snapshot
    const gap = b.seq > s.seq + 1;
    set({ kinds: applyKinds(s.kinds, b), seq: b.seq, consecutiveMismatches: 0 }); // ops are idempotent
    return gap ? 'gap' : 'applied';
  },
}));
