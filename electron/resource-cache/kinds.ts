/**
 * Pure kind layer for the background resource cache (design §3.3).
 *
 * - toWireShape: normalize typed LIST results (Date objects) to the WATCH wire shape (strings).
 * - Trimmers: strip managedFields, the last-applied annotation, and every Secret/ConfigMap value.
 * - extractStatusCode / mapStatusToMessage: numeric-only error classification with fixed strings.
 * - CORE_KIND_DESCRIPTORS: list fn per scope, page size, watch path, trimmer and id fn.
 *
 * No Electron imports, so everything here is unit-testable.
 */
import { AppsV1Api, CoreV1Api, type KubeConfig, type KubernetesObject } from '@kubernetes/client-node';
import type {
  ConfigMapItem,
  DeploymentItem,
  KindItemMap,
  ListedKind,
  SecretItem,
  ServiceItem,
  TrimmedMeta,
} from '../../src/types/resource-cache';

export type RawObject = KubernetesObject & Record<string, unknown>;

export const LAST_APPLIED_ANNOTATION = 'kubectl.kubernetes.io/last-applied-configuration';
export const HELM_SECRET_TYPE = 'helm.sh/release.v1';

// --- Errors -----------------------------------------------------------------

/** Kubeconfig could not be loaded. The original error is never attached (no path/content leaks). */
export class KubeconfigLoadError extends Error {
  constructor() {
    super('Failed to load kubeconfig');
    this.name = 'KubeconfigLoadError';
  }
}

/** The requested context is not present in the freshly loaded kubeconfig. */
export class UnknownContextError extends Error {
  constructor() {
    super('Unknown kube context');
    this.name = 'UnknownContextError';
  }
}

// --- Wire-shape normalization -------------------------------------------------

/** Recursive copy that converts every Date to an ISO string. Strings are shared by reference. */
export function toWireShape<T>(value: T): T {
  return convert(value) as T;
}

function convert(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(convert);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = convert(v);
    }
    return out;
  }
  return value;
}

export const toIso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : undefined;

// --- Narrowing helpers ----------------------------------------------------------

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNumber = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function stringMap(v: unknown): Record<string, string> | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

// --- Trimming -------------------------------------------------------------------

export function trimMeta(meta: unknown): TrimmedMeta {
  const m = asRecord(meta);
  const out: TrimmedMeta = { uid: asString(m.uid), name: asString(m.name) };
  if (typeof m.namespace === 'string') out.namespace = m.namespace;
  if (typeof m.resourceVersion === 'string') out.resourceVersion = m.resourceVersion;
  const created = toIso(m.creationTimestamp);
  if (created !== undefined) out.creationTimestamp = created;
  const deleted = toIso(m.deletionTimestamp);
  if (deleted !== undefined) out.deletionTimestamp = deleted;
  const labels = stringMap(m.labels);
  if (labels) out.labels = labels;
  const annotations = stringMap(m.annotations);
  if (annotations) {
    delete annotations[LAST_APPLIED_ANNOTATION];
    out.annotations = annotations;
  }
  if (Array.isArray(m.ownerReferences)) {
    out.ownerReferences = m.ownerReferences.map((r) => {
      const o = asRecord(r);
      const ref: NonNullable<TrimmedMeta['ownerReferences']>[number] = {
        apiVersion: asString(o.apiVersion),
        kind: asString(o.kind),
        name: asString(o.name),
        uid: asString(o.uid),
      };
      if (typeof o.controller === 'boolean') ref.controller = o.controller;
      return ref;
    });
  }
  return out;
}

/** uid, falling back to `${namespace}/${name}`. */
export function itemId(raw: unknown): string {
  const m = asRecord(asRecord(raw).metadata);
  const uid = asString(m.uid);
  if (uid) return uid;
  return `${asString(m.namespace)}/${asString(m.name)}`;
}

/** Plain-JSON deep copy for spec/status (also normalizes Dates). */
function plain(v: unknown): Record<string, unknown> {
  return asRecord(toWireShape(v));
}

export function trimDeployment(raw: unknown): DeploymentItem {
  const r = asRecord(raw);
  const metadata = trimMeta(r.metadata);
  const spec = plain(r.spec);
  const status = plain(r.status);
  return {
    id: itemId(raw),
    name: metadata.name,
    namespace: metadata.namespace ?? '',
    replicas: asNumber(spec.replicas),
    availableReplicas: asNumber(status.availableReplicas),
    age: metadata.creationTimestamp ?? '',
    status,
    spec,
    metadata,
  };
}

export function trimService(raw: unknown): ServiceItem {
  const r = asRecord(raw);
  const metadata = trimMeta(r.metadata);
  const spec = plain(r.spec);
  const ports = Array.isArray(spec.ports)
    ? spec.ports
        .map((p) => {
          const o = asRecord(p);
          return `${String(o.port ?? '')}:${String(o.targetPort ?? '')}/${String(o.protocol ?? '')}`;
        })
        .join(', ')
    : '';
  return {
    id: itemId(raw),
    name: metadata.name,
    namespace: metadata.namespace ?? '',
    type: asString(spec.type),
    clusterIP: asString(spec.clusterIP),
    ports,
    age: metadata.creationTimestamp ?? '',
    spec,
    metadata,
  };
}

export function trimConfigMap(raw: unknown): ConfigMapItem {
  const r = asRecord(raw);
  const metadata = trimMeta(r.metadata);
  return {
    id: itemId(raw),
    name: metadata.name,
    namespace: metadata.namespace ?? '',
    data: Object.keys(asRecord(r.data)).length + Object.keys(asRecord(r.binaryData)).length,
    age: metadata.creationTimestamp ?? '',
    metadata,
  };
}

export function trimSecret(raw: unknown): SecretItem {
  const r = asRecord(raw);
  const metadata = trimMeta(r.metadata);
  return {
    id: itemId(raw),
    name: metadata.name,
    namespace: metadata.namespace ?? '',
    type: asString(r.type),
    data: Object.keys(asRecord(r.data)).length,
    age: metadata.creationTimestamp ?? '',
    metadata,
  };
}

// --- Error classification ------------------------------------------------------------

/** Numeric HTTP-ish status code from a client-node / fetch error, or undefined. */
export function extractStatusCode(err: unknown): number | undefined {
  const e = err as { statusCode?: unknown; code?: unknown; body?: { code?: unknown } } | null | undefined;
  return [e?.statusCode, e?.code, e?.body?.code].find((c): c is number => typeof c === 'number');
}

export function isNetworkError(err: unknown): boolean {
  const e = err as { code?: unknown; name?: unknown } | null | undefined;
  return extractStatusCode(err) === undefined && (typeof e?.code === 'string' || e?.name === 'FetchError');
}

const KIND_LABEL: Record<string, string> = {
  deployments: 'Deployments',
  pods: 'Pods',
  secrets: 'Secrets',
  configmaps: 'ConfigMaps',
  services: 'Services',
  helmreleases: 'Helm releases',
};

export const kindLabel = (kind: string): string => KIND_LABEL[kind] ?? 'resources';

/** Fixed user-facing strings only. Never echoes err.message or the response body. */
export function mapStatusToMessage(err: unknown, kind: string): string {
  const code = extractStatusCode(err);
  if (code === 401) return 'Authentication failed: refresh credentials';
  if (code === 403) return `No permission to list ${kindLabel(kind)}`;
  if (code === 404) return 'Resource type not served by cluster';
  if (code === 410) return 'Resync required';
  if (code !== undefined && code >= 500 && code < 600) return `Cluster API error (${code})`;
  if (isNetworkError(err)) return 'Cannot reach cluster API';
  return 'Unexpected error';
}

export const AUTH_FAILED_MESSAGE = 'Authentication failed: refresh credentials';
export const clusterForbiddenMessage = (kind: string): string =>
  `No permission to list ${kindLabel(kind)} cluster-wide. Select specific namespaces.`;

// --- Descriptors ----------------------------------------------------------------------

export interface ListPageResult {
  items: RawObject[];
  continueToken?: string;
  resourceVersion?: string;
}

export interface ListPageOptions {
  limit: number;
  continueToken?: string;
}

export interface ListHooks {
  /** Called once per LIST page with the toWireShape'd raw items. Must not retain them. */
  onListPage?(rawItems: RawObject[], ctx: { first: boolean }): void;
  /** Called once after the last page with ids owned before this LIST and absent from it. */
  onListComplete?(deletedIds: string[], deletedMeta: Map<string, { name: string; namespace?: string }>, ctx: { first: boolean }): void;
  /** Called for every WATCH event with the raw object (before trimming). */
  onWatchEvent?(type: 'ADDED' | 'MODIFIED' | 'DELETED', raw: RawObject): void;
}

export interface CoreKindDescriptor<K extends ListedKind> {
  kind: K;
  pageSize: number;
  listPage(kc: KubeConfig, scope: string, opts: ListPageOptions): Promise<ListPageResult>;
  watchPath(scope: string): string;
  trim(raw: unknown): KindItemMap[K];
  id(raw: unknown): string;
  /** Context-engine kind name for kinds that feed it. */
  contextKind?: 'Deployment';
}

interface TypedList {
  items: unknown[];
  metadata?: { _continue?: string; resourceVersion?: string };
}

function toPage(list: TypedList): ListPageResult {
  return {
    items: list.items as RawObject[],
    continueToken: list.metadata?._continue || undefined,
    resourceVersion: list.metadata?.resourceVersion,
  };
}

const params = (opts: ListPageOptions) => ({ limit: opts.limit, _continue: opts.continueToken });

const nsPath = (group: string, plural: string, scope: string) =>
  scope === '*' ? `${group}/${plural}` : `${group}/namespaces/${encodeURIComponent(scope)}/${plural}`;

export const CORE_KIND_DESCRIPTORS: { [K in ListedKind]: CoreKindDescriptor<K> } = {
  deployments: {
    kind: 'deployments',
    pageSize: 500,
    contextKind: 'Deployment',
    async listPage(kc, scope, opts) {
      const api = kc.makeApiClient(AppsV1Api);
      return toPage(
        scope === '*'
          ? await api.listDeploymentForAllNamespaces(params(opts))
          : await api.listNamespacedDeployment({ namespace: scope, ...params(opts) }),
      );
    },
    watchPath: (scope) => nsPath('/apis/apps/v1', 'deployments', scope),
    trim: trimDeployment,
    id: itemId,
  },
  services: {
    kind: 'services',
    pageSize: 500,
    async listPage(kc, scope, opts) {
      const api = kc.makeApiClient(CoreV1Api);
      return toPage(
        scope === '*'
          ? await api.listServiceForAllNamespaces(params(opts))
          : await api.listNamespacedService({ namespace: scope, ...params(opts) }),
      );
    },
    watchPath: (scope) => nsPath('/api/v1', 'services', scope),
    trim: trimService,
    id: itemId,
  },
  configmaps: {
    kind: 'configmaps',
    pageSize: 500,
    async listPage(kc, scope, opts) {
      const api = kc.makeApiClient(CoreV1Api);
      return toPage(
        scope === '*'
          ? await api.listConfigMapForAllNamespaces(params(opts))
          : await api.listNamespacedConfigMap({ namespace: scope, ...params(opts) }),
      );
    },
    watchPath: (scope) => nsPath('/api/v1', 'configmaps', scope),
    trim: trimConfigMap,
    id: itemId,
  },
  secrets: {
    kind: 'secrets',
    // A page can hold Helm release blobs of 100 KB–1 MB each.
    pageSize: 100,
    async listPage(kc, scope, opts) {
      const api = kc.makeApiClient(CoreV1Api);
      return toPage(
        scope === '*'
          ? await api.listSecretForAllNamespaces(params(opts))
          : await api.listNamespacedSecret({ namespace: scope, ...params(opts) }),
      );
    },
    watchPath: (scope) => nsPath('/api/v1', 'secrets', scope),
    trim: trimSecret,
    id: itemId,
  },
};

export const LISTED_KINDS: readonly ListedKind[] = ['deployments', 'services', 'configmaps', 'secrets'];
