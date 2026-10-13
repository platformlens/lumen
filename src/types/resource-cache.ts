/**
 * Shared types for the background resource cache.
 *
 * Imported with `import type` by both the main process (electron/resource-cache/*)
 * and the renderer (src/stores/resourceStore.ts). All timestamps are ISO-8601 strings.
 */
import type { LightweightPod } from './pod-worker';

export type CoreKind = 'deployments' | 'pods' | 'secrets' | 'configmaps' | 'services' | 'helmreleases';

export const CORE_KINDS: readonly CoreKind[] = [
  'deployments',
  'pods',
  'secrets',
  'configmaps',
  'services',
  'helmreleases',
] as const;

export type KindPhase = 'loading' | 'ready' | 'reconnecting' | 'error' | 'forbidden';

export interface KindStatus {
  phase: KindPhase;
  /** From mapStatusToMessage only; never err.message / String(err). */
  error: string | null;
  /** Epoch ms of the last completed LIST (or pod informer sync). */
  lastSyncedAt: number | null;
  mode: 'cluster' | 'namespaced';
}

/** Metadata minus managedFields and the last-applied annotation. */
export interface TrimmedMeta {
  uid: string;
  name: string;
  namespace?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: Array<{ apiVersion: string; kind: string; name: string; uid: string; controller?: boolean }>;
}

export interface DeploymentItem {
  id: string;
  name: string;
  namespace: string;
  replicas: number;
  availableReplicas: number;
  age: string;
  status: Record<string, unknown>;
  spec: Record<string, unknown>;
  metadata: TrimmedMeta;
}

export interface ServiceItem {
  id: string;
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: string;
  age: string;
  spec: Record<string, unknown>;
  metadata: TrimmedMeta;
}

/** `data` is the key count of data + binaryData. */
export interface ConfigMapItem {
  id: string;
  name: string;
  namespace: string;
  data: number;
  age: string;
  metadata: TrimmedMeta;
}

/** `data` is the key count of data; values are NEVER included. */
export interface SecretItem {
  id: string;
  name: string;
  namespace: string;
  type: string;
  data: number;
  age: string;
  metadata: TrimmedMeta;
}

export interface HelmReleaseItem {
  id: string;
  name: string;
  namespace: string;
  revision: number;
  status: string;
  chart: string;
  chartVersion: string;
  appVersion: string;
  lastUpdated: string;
  description: string;
  secretName: string;
}

export type PodItem = LightweightPod & { id: string };

export interface KindItemMap {
  deployments: DeploymentItem;
  pods: PodItem;
  secrets: SecretItem;
  configmaps: ConfigMapItem;
  services: ServiceItem;
  helmreleases: HelmReleaseItem;
}

export interface KindDelta<K extends CoreKind> {
  /** Store replaces byId with `upserts` instead of merging. */
  reset?: true;
  upserts: KindItemMap[K][];
  /** Always [] when reset. */
  deletes: string[];
  status?: KindStatus;
}

export interface ResourceBatch {
  sessionId: string;
  seq: number;
  kinds: { [K in CoreKind]?: KindDelta<K> };
}

export interface ResourceSnapshot {
  sessionId: string;
  context: string;
  seq: number;
  kinds: { [K in CoreKind]: { items: KindItemMap[K][]; status: KindStatus } };
}

export interface StartSessionArgs {
  context: string;
  namespaces?: string[];
}

/** `resources:ensureFresh` reply: whether the calling renderer is the bound subscriber. */
export interface EnsureFreshResult {
  bound: boolean;
}

export type ResourceCacheChannel =
  | 'startSession'
  | 'subscribe'
  | 'stopSession'
  | 'setNamespaces'
  | 'ensureFresh'
  | 'getDiagnostics';

export interface StreamDiagnostics {
  kind: CoreKind;
  scope: string;
  phase: KindPhase;
  connecting: boolean;
  hasController: boolean;
  hasTimer: boolean;
  lastEventAt: number | null;
  epoch: number;
}

export type ListedKind = Exclude<CoreKind, 'pods' | 'helmreleases'>;

export interface PodWorkerDiagnostics {
  informers: number;
  podCacheSize: number;
  sessionId: string | null;
  gen: number;
  retryTimers: number;
  /** Informer constructions (each one is a pods LIST) since the last start-informer. */
  informerStarts: number;
  pendingChunkRequests: number;
  available: boolean;
}

export interface ResourceCacheDiagnostics {
  sessionId: string | null;
  context: string | null;
  seq: number;
  lastNamespaces: string[];
  streams: StreamDiagnostics[];
  counts: Record<CoreKind, number>;
  timers: { health: boolean; idle: boolean; coalescer: boolean; authRebuild: boolean };
  helmDecodeCacheSize: number;
  helmFallbackFetchesInFlight: number;
  pendingTransforms: number;
  podWorker: PodWorkerDiagnostics | null;
  /** Cumulative LIST runs/pages per kind for the current session, summed across a kind's streams. */
  listCalls: Record<ListedKind, { runs: number; pages: number }>;
  invokeCounts: Record<ResourceCacheChannel, number>;
  handlersRegistered: Record<ResourceCacheChannel, boolean>;
  subscriberBound: boolean;
  legacyMaps: { activeWatchers: number; watchGenerations: number; watchResourceVersions: number; genericWatchGenerations: number };
}
