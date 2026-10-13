# Design: Deployment Full View (revision 4)

## 1. Overview

Clicking a deployment keeps opening the side drawer exactly as it does today. The drawer header and each row in the Deployments list get a "Full View" action. That action opens a dedicated full-page Deployment view as a new view tab in the main dashboard area. It uses the same per-cluster `ViewTabBar` and view-id routing that `helm-release-detail/…` and `helm-chart-detail/…` already use.

The page is lazy-loaded. It pulls everything through one aggregated, RBAC-tolerant IPC call, `k8s:getDeploymentFullDetails`, and renders these sections:

- Header and quick actions
- Overview/spec
- Interactive revision timeline with change summaries and an embedded Monaco diff
- Rollout and replicas (HPA, PDB)
- Pod distribution per node and zone, with risk flags and scheduling constraints
- Pods table
- Containers (init, sidecar and main)
- Security posture, with an approximate Pod Security Standards (PSS) level
- Networking (Services, Ingresses, NetworkPolicies, port mapping)
- Config and storage (ConfigMap/Secret references by name only, PVCs)
- Events
- Topology (lazy)

All derivation logic lives in pure, unit-tested utilities in `src/utils/`. The UI is split into small presentational components under `src/components/dashboard/views/deployment-details/`.

**Locked technology stack.** Everything is already in the project; no new dependencies.

- React 18 + TypeScript strict
- Tailwind (glass theme)
- Framer Motion
- Lucide icons
- `@monaco-editor/react` `DiffEditor`
- `js-yaml`
- `react-virtualized` through the existing `VirtualizedTable`
- `@kubernetes/client-node` 1.x (main process only; the renderer uses `import type` only)
- `zod` for IPC validation through `safeHandle`
- vitest + fast-check for tests

## 2. Navigation decision: what "full tab" means

**Options considered**

- **(a) Full-page view replacing the list, with a back button.**
- **(b) A new tab type in `BottomPanel`.** Rejected. The bottom panel is a short, resizable strip built for streaming tools (logs, terminal, YAML). A dense multi-section page would be cramped there. It would also compete with the logs opened from that page, and it doesn't match "opens up a full tab".
- **(c) Multi-tab strip in the main area.**

**Finding.** The app already has (c), and it renders as (a):

- `App.tsx` keeps per-cluster `viewTabsByClusterRef` and renders `ViewTabBar` above the main area.
- `handleViewChange(viewId)` switches `resourceView` and appends a tab when the id is new, so it dedupes by id.
- `DashboardContent` routes on `activeView` string prefixes. For example, `helm-release-detail/<ns>/<name>` renders `HelmReleaseDetail` with `onBack`.
- `getViewLabel`, `getViewIcon` and `DashboardHeader.getViewTitle` all understand prefixed ids.

**Decision: reuse that pattern.** The Full View is the view id `deployment-detail/<ns>/<name>`, with each segment `encodeURIComponent`-encoded. Opening it calls the existing `onNavigate(viewId)` (which is `App.handleViewChange`). This gives the following for free:

- A real, closable tab labelled `Deploy: <name>`, with several deployments open at once.
- Full-page rendering inside the dashboard scroll area.
- Per-cluster isolation.
- The existing drawer, rendered by `Dashboard.tsx` above the content, keeps working on top of the full view. Clicking a pod, node or service inside the page opens the normal drawer.

A `GlassButton variant="secondary"` "Back to Deployments" calls `onNavigate('deployments')`. The tab stays open, matching the Helm detail behaviour. No new state containers or routing mechanisms are introduced.

### 2.1 View-id helpers (new, in `src/utils/view-labels.ts`)

```ts
export const DEPLOYMENT_DETAIL_PREFIX = 'deployment-detail/';
export function buildDeploymentDetailViewId(namespace: string, name: string): string;
// -> `deployment-detail/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
export function parseDeploymentDetailViewId(viewId: string): { namespace: string; name: string } | null;
// returns null when: the prefix is missing, there aren't exactly 3 '/'-segments,
// any segment is empty, or decodeURIComponent throws
```

`getViewLabel` returns `Deploy: <name>` for this prefix. If parsing fails it falls back to `'Deployment'`.

### 2.2 Integration edits

| File | Change |
|---|---|
| `src/utils/view-labels.ts` | Add the helpers above and the label branch. |
| `src/components/dashboard/ViewTabBar.tsx` | In `getViewIcon`, `deployment-detail/` maps to `<Layers size={13} />`. |
| `src/components/dashboard/DashboardHeader.tsx` | `getViewTitle` returns `Deployment: <name>`. When `parseDeploymentDetailViewId(activeView)` is non-null, hide the search input, the namespace selector and the "N resources" count. The page is scoped to one object, and changing the namespace filter would re-key the deployment watcher that drives live refresh. |
| `src/components/Dashboard.tsx` | (1) In the Drawer `headerActions`, when `selectedResource?.type === 'deployment'`, add a labelled **Full View** button: Lucide `Maximize2`, the same classes as the existing Scale button (`bg-blue-600/20 text-blue-400 border border-blue-600/30`), and `title="Open full deployment view"`. On click it calls `onNavigate?.(buildDeploymentDetailViewId(ns, name))` and then `setIsDrawerOpen(false)`. `ns` resolves as `selectedResource.metadata?.namespace ?? selectedResource.namespace`, and `name` the same way. (2) Pass `onOpenYaml={onOpenYaml}` to `DashboardContent`. (3) `getResourceCount` returns 0 for the prefix; the value isn't displayed because the header hides the count. |
| `src/components/dashboard/DashboardContent.tsx` | See the hook-placement rules below. |
| `src/components/dashboard/views/DeploymentsView.tsx` | Add the optional prop `onOpenFullView?: (namespace: string, name: string) => void`. Add a trailing column `{ label: '', dataKey: 'actions', sortable: false, width: 44, flexGrow: 0, compact: true, cellRenderer }` (`GenericResourceView` keys `<th>`/`<td>` by `dataKey`, so the key must be unique; no existing column uses `actions`). The `cellRenderer` renders an icon button: `Maximize2`, `aria-label="Open full view for <name>"`, `title="Full view"`, and an `onClick` that calls `e.stopPropagation()` then `onOpenFullView`. The column is appended only when the handler exists: `[...baseColumns, ...(onOpenFullView ? [actionsCol] : [])]` inside the memo, so other `DeploymentsView` usages render no empty column. The row click still opens the drawer. The columns `useMemo` keeps `onOpenFullView` in its deps; that prop is now genuinely stable (see below). |
| `src/App.tsx` | `SecondarySidebar activeView` gets a normalized value, `resourceView.startsWith('deployment-detail/') ? 'deployments' : resourceView`, so "Deployments" stays highlighted. No other App changes. |

**`DashboardContent` hook placement.** Every existing route in `DashboardContent` is a sequential `if (activeView === …) return`, placed after the top-level hooks. A hook inside a route branch would be conditional, so these three are declared at the top level, immediately after the `podStatusStats` `useMemo` (line ~184) and before `if (activeView === 'overview')`:

```ts
// latest-ref so the callback is stable even though App.handleViewChange is re-created every render
const onNavigateRef = React.useRef(onNavigate);
onNavigateRef.current = onNavigate;

const deploymentDetail = React.useMemo(() => parseDeploymentDetailViewId(activeView), [activeView]);
const liveDeployment = React.useMemo(
  () => deploymentDetail
    ? deployments.find(d => d.namespace === deploymentDetail.namespace && d.name === deploymentDetail.name)
    : undefined,
  [deploymentDetail, deployments]);
const handleOpenDeploymentFullView = React.useCallback(
  (ns: string, n: string) => onNavigateRef.current?.(buildDeploymentDetailViewId(ns, n)), []);
const handleBackToDeployments = React.useCallback(() => onNavigateRef.current?.('deployments'), []);
```

The route branch uses only those values:

```tsx
if (deploymentDetail) {
  return <DeploymentFullView key={`${clusterName}|${activeView}`} clusterName={clusterName}
    namespace={deploymentDetail.namespace} name={deploymentDetail.name}
    liveDeployment={liveDeployment} onBack={handleBackToDeployments}
    onResourceClick={onResourceClick} onOpenLogs={onOpenLogs} onOpenYaml={onOpenYaml} showToast={showToast} />;
}
```

The key includes the cluster. `Dashboard` isn't keyed by cluster, and per-cluster tab restore (App.tsx ~645–650) can land on the same `deployment-detail/<ns>/<name>` id in a different cluster. With `key={`${clusterName}|${activeView}`}`, a cluster switch always unmounts the old instance (its in-flight response is dropped by `mountedRef`) and mounts a fresh one. Switching between two deployment tabs also remounts. Local UI state (selected revision, expanded cards, open diff) and hook state therefore never carry across deployments or clusters. The view-id format itself is unchanged: tabs are already stored per cluster, so the tab id doesn't need the cluster. `DeploymentsView` receives `onOpenFullView={handleOpenDeploymentFullView}`. `DashboardContent` gains the prop `onOpenYaml?: (resource: unknown) => void`.

**Edge cases**

- Opening the same deployment twice focuses the existing tab, because `handleViewChange` dedupes by id.
- If the deployment is deleted while its tab is open, the page shows a "not found" state with Back.
- Tabs are in memory only.
- Tabs are per cluster. Data never leaks across clusters for two independent reasons: the component key includes the cluster (above), and the hook's request identity and cache key include the cluster (§4 "Race safety").

## 3. Data fetching (main process)

### 3.1 Shared types: `src/types/deployment-details.ts` (new)

This follows the precedent of `src/types/pod-worker.ts`, which holds cross-process types imported by both `electron/` and `src/`. It uses `import type` only.

```ts
import type { V1Deployment, V1ReplicaSet, V1Service, V1Ingress, V1NetworkPolicy,
  V2HorizontalPodAutoscaler, V1PodDisruptionBudget, V1PodTemplateSpec, V1LabelSelector } from '@kubernetes/client-node';

/** client-node deserializes timestamps to Date; main JSON-normalizes so the renderer only sees ISO strings. */
export type Jsonified<T> = T extends Date ? string
  : T extends Array<infer U> ? Jsonified<U>[]
  : T extends object ? { [K in keyof T]: Jsonified<T[K]> } : T;

export type DeploymentObj = Jsonified<V1Deployment>;
export type ReplicaSetObj = Jsonified<V1ReplicaSet>;
export type PodTemplate = Jsonified<V1PodTemplateSpec>;
export type LabelSelector = Jsonified<V1LabelSelector>;

export type SectionResult<T> =
  | { status: 'ok'; data: T; note?: string }   // note: non-fatal caveat rendered as an info line
  | { status: 'forbidden'; message: string }   // 403
  | { status: 'error'; message: string };      // API group 404, timeout, 5xx, network

export interface DeploymentPodContainerStatus {
  name: string; kind: 'init' | 'sidecar' | 'main';
  ready: boolean; started: boolean | null; restartCount: number;
  state: 'running' | 'waiting' | 'terminated' | 'unknown';
  reason: string | null;                  // CrashLoopBackOff, OOMKilled, Completed…
  lastTerminationReason: string | null;
  image: string; imageID: string;         // imageID carries the running digest
}
export interface DeploymentPodSummary {
  name: string; uid: string; namespace: string;
  phase: string;                          // raw status.phase
  displayStatus: string;                  // Terminating | <waiting reason> | <terminated reason> | phase
  readyContainers: number; totalContainers: number;   // main + sidecar only
  restarts: number;                       // sum over all containers
  nodeName: string | null; podIP: string | null; hostIP: string | null;
  createdAt: string; startTime: string | null; deletionTimestamp: string | null;
  qosClass: string | null; podTemplateHash: string | null; ownerReplicaSet: string | null;
  unschedulableMessage: string | null;    // PodScheduled=False message
  containers: DeploymentPodContainerStatus[];
}
export interface NodeSummary {
  name: string; ready: boolean; unschedulable: boolean;
  hostname: string | null;      // label kubernetes.io/hostname (may differ from name)
  zone: string | null;          // topology.kubernetes.io/zone ?? failure-domain.beta.kubernetes.io/zone
  region: string | null;        // topology.kubernetes.io/region
  instanceType: string | null;  // node.kubernetes.io/instance-type ?? beta.kubernetes.io/instance-type
  capacityType: string | null;  // karpenter.sh/capacity-type ?? eks.amazonaws.com/capacityType
  nodePool: string | null;      // karpenter.sh/nodepool ?? eks.amazonaws.com/nodegroup
  arch: string | null; os: string | null; kubeletVersion: string | null;
  taints: { key: string; value: string | null; effect: string }[];
  allocatable: { cpu: string | null; memory: string | null; pods: string | null };
}
export interface DeploymentEvent {
  type: string;                   // 'Normal' | 'Warning' in practice; kept open because the API doesn't constrain it
  reason: string; message: string;
  count: number;                  // always >= 1 (see mapping in §3.3)
  firstTimestamp: string | null;
  lastTimestamp: string;          // always set (see mapping in §3.3)
  involvedKind: string; involvedName: string; involvedUid: string; source: string | null;
}
export interface ServiceAccountSummary {
  name: string; exists: boolean;
  automountServiceAccountToken: boolean | null;
  imagePullSecretNames: string[];
  irsaRoleArn: string | null;     // annotation eks.amazonaws.com/role-arn
}
export interface NamespaceSummary {
  name: string;
  podSecurity: { enforce: string | null; enforceVersion: string | null; audit: string | null; warn: string | null };
}
export interface PvcSummary {
  claimName: string; found: boolean; phase: string | null; storageClass: string | null;
  capacity: string | null; accessModes: string[]; volumeName: string | null;
}
export interface DeploymentFullDetails {
  context: string; fetchedAt: string;
  deployment: DeploymentObj;                         // managedFields and last-applied-configuration stripped; kind/apiVersion guaranteed
  lastAppliedBytes: number | null;                   // UTF-8 byte length of the stripped last-applied annotation, null if absent
  replicaSets: SectionResult<ReplicaSetObj[]>;       // owned by this deployment (by uid)
  pods: SectionResult<DeploymentPodSummary[]>;
  nodes: SectionResult<NodeSummary[]>;               // only nodes hosting this deployment's pods
  events: SectionResult<DeploymentEvent[]>;          // newest first, max 300
  services: SectionResult<Jsonified<V1Service>[]>;
  ingresses: SectionResult<Jsonified<V1Ingress>[]>;
  networkPolicies: SectionResult<Jsonified<V1NetworkPolicy>[]>;
  hpas: SectionResult<Jsonified<V2HorizontalPodAutoscaler>[]>;
  pdbs: SectionResult<Jsonified<V1PodDisruptionBudget>[]>;
  serviceAccount: SectionResult<ServiceAccountSummary>;
  namespace: SectionResult<NamespaceSummary>;
  pvcs: SectionResult<PvcSummary[]>;
  /** keyed by pod NAME (not ns/name); only pods of this deployment */
  podMetrics: SectionResult<Record<string, { cpu: string; memory: string }>>;
}
export type DeploymentFullDetailsResponse =
  | { found: true; details: DeploymentFullDetails }
  | { found: false; reason: 'not-found' | 'forbidden'; message: string };
```

### 3.2 Label selector utilities: `src/utils/label-selector-utils.ts` (new, pure, shared)

The main process imports this module; `electron/main.ts` already imports `../src/utils/ai-thinking`, so there is precedent.

```ts
export function selectorToQueryString(sel: LabelSelector | null | undefined): string | null;
// matchLabels -> "k=v"; In -> "k in (a,b)"; NotIn -> "k notin (a,b)"; Exists -> "k"; DoesNotExist -> "!k"
// returns null for a nil or empty selector (caller must not list unfiltered)

export function matchesLabelSelector(sel: LabelSelector | null | undefined,
  labels: Record<string, string> | undefined, opts: { emptyMatchesAll: boolean }): boolean;
// nil -> false; {} -> opts.emptyMatchesAll; otherwise all matchLabels AND all matchExpressions must hold

export function matchesServiceSelector(sel: Record<string, string> | null | undefined,
  labels: Record<string, string> | undefined): boolean;
// a selectorless service (nil or {}) -> false; otherwise every k=v must be present in labels
```

### 3.3 Aggregator: `electron/deployment-full-details.ts` (new, ~380 lines)

API orchestration takes injected API clients so it can be unit tested with mocks. `K8sService` keeps ownership of kubeconfig/context and is the only caller.

```ts
export interface DeploymentDetailsClients {
  apps: AppsV1Api; core: CoreV1Api; networking: NetworkingV1Api;
  autoscaling: AutoscalingV2Api; policy: PolicyV1Api;
  /** existing K8sService.getPodMetrics(context, [namespace]); Map keyed `${namespace}/${podName}` */
  getPodMetrics: () => Promise<Map<string, { cpu: string; memory: string }>>;
}
export async function fetchDeploymentFullDetails(
  clients: DeploymentDetailsClients, context: string, namespace: string, name: string
): Promise<DeploymentFullDetailsResponse>;

// pure helpers, exported for tests
export function classifyK8sError(err: unknown): 'unauthorized' | 'forbidden' | 'not-found' | 'timeout' | 'other';
// status = err.code ?? err.statusCode ?? err.response?.statusCode
// 'unauthorized' when status === 401 OR /\b401\b|Unauthorized/.test(message)   (mirrors K8sService.is401Error, k8s.ts 252–257,
//                 so message-only 401s from exec-plugin failures still reach withAuthRetry)
// 'forbidden' 403, 'not-found' 404; a message containing "timed out" -> 'timeout'; else 'other'

export interface SettleOptions<T> {
  timeoutMs?: number;                         // default 15000
  onNotFound?: () => SectionResult<T>;        // called when classifyK8sError(err) === 'not-found'
}
export async function settle<T>(p: Promise<T>, label: string, opts?: SettleOptions<T>): Promise<SectionResult<T>>;
// wraps withTimeout(p, opts?.timeoutMs ?? 15000, label) from src/lib/with-timeout. The timeout covers only the promise
// passed in (one API call plus its synchronous .then mapping), never a chain: each chained section calls settle on its own
// request after its prerequisites resolve. Classifies errors via classifyK8sError:
//   'unauthorized' -> rethrown (so withAuthRetry can refresh credentials)
//   'forbidden'    -> { status:'forbidden', message: `${label}: forbidden` }
//   'not-found'    -> opts.onNotFound() if given, else { status:'error', message: `${label}: not found (API not available?)` }
//   'timeout'      -> { status:'error', message: `${label}: timed out` }
//   'other'        -> { status:'error', message: `${label}: ${err.message}` }
// every non-ok outcome logs console.warn once with label + classification (never object contents)

export function toPlain<T>(obj: T): Jsonified<T>;   // JSON round-trip + delete metadata.managedFields (recursive on items)
export function summarizePod(pod: V1Pod): DeploymentPodSummary;
// containers: one entry per pod.spec.initContainers[] then pod.spec.containers[] (spec order), merged with the matching
// status by name; a container with no status yet (e.g. Pending) gets state 'unknown', ready false, restartCount 0.
// kind: 'sidecar' for an init container with restartPolicy 'Always', else 'init'; 'main' for spec.containers.
export function summarizeNode(node: V1Node): NodeSummary;   // hostname = labels['kubernetes.io/hostname'] ?? null
export function toSaSummary(sa: V1ServiceAccount): ServiceAccountSummary;   // exists: true; never copies `secrets`
export function toPvcSummary(pvc: V1PersistentVolumeClaim): PvcSummary;     // found: true
export function filterHpa(list: V2HorizontalPodAutoscalerList, deploymentName: string): Jsonified<V2HorizontalPodAutoscaler>[];
export function toDeploymentEvent(e: CoreV1Event): DeploymentEvent;
export function filterOwned<T extends { metadata?: { ownerReferences?: V1OwnerReference[] } }>(items: T[], ownerUids: Set<string>): T[];
export function pickPodMetrics(map: Map<string, { cpu: string; memory: string }>, namespace: string,
  podNames: string[]): Record<string, { cpu: string; memory: string }>;
export async function mapWithConcurrency<I, O>(items: I[], limit: number,
  fn: (i: I) => Promise<O>, shouldStop?: () => boolean): Promise<(O | undefined)[]>;
// once shouldStop() returns true, no new items are started; unstarted slots stay undefined
```

**Fetch plan.** Every list is namespaced to the deployment's namespace. Nothing is cluster-wide except reads of individual nodes and the namespace object.

**Phase 1 (fatal on failure).** `apps.readNamespacedDeployment({ name, namespace })` with a 20 s timeout.

- 404 returns `{ found: false, reason: 'not-found' }`.
- 403 returns `{ found: false, reason: 'forbidden' }`.
- 401 is rethrown for `withAuthRetry`.
- Anything else is rethrown, so the IPC call rejects.

After `toPlain`, set `deployment.kind ??= 'Deployment'` and `deployment.apiVersion ??= 'apps/v1'`. `topologyBuilder` checks `kind === 'Deployment'`, and this makes that check hold even if a GET response omits the field.

Then strip the last-applied annotation and record its size:

```ts
import { LAST_APPLIED } from '../src/utils/sensitive-value-utils';   // pure module, safe to import in main
const raw = deployment.metadata?.annotations?.[LAST_APPLIED];
const lastAppliedBytes = raw != null ? Buffer.byteLength(raw, 'utf8') : null;
if (raw != null) delete deployment.metadata!.annotations![LAST_APPLIED];
```

No consumer of `details.deployment` needs it. Edit YAML goes through `App.handleOpenYaml`, which reads only `name`/`namespace`/`type` and re-fetches the live object with `window.k8s.getResourceYaml`, and `ResourceTopology` doesn't read annotations. Stripping it removes a second full copy of the spec, including unmasked literal env values, from the payload. The same strip is applied to each owned ReplicaSet's annotations (kubectl doesn't normally set it there, but this is cheap defence).

Let `templateLabels = deployment.spec.template.metadata.labels`. Let `labelSelector = selectorToQueryString(deployment.spec.selector)`. If `labelSelector` is null (apps/v1 forbids an empty selector, but the code is defensive), the RS, pods, PDB and NetPol sections become `status:'error'` with "Deployment has no selector".

**Phase 2 (parallel).** All calls go through `Promise.all` of `settle(...)`. Each is independent, and a failure only marks its own section. Dependent filters run as promise chains inside phase 2.

- **ReplicaSets.** `apps.listNamespacedReplicaSet({ namespace, labelSelector })`, then `filterOwned(items, {deployment.uid})`. Ownership is by uid, not by name as in the existing `getDeploymentRevisions`, so a recreated deployment with the same name never picks up orphans.
- **Pods.** `core.listNamespacedPod({ namespace, labelSelector })`, chained after RS.
  - If RS is `ok`, keep pods whose owner RS uid is in the owned set.
  - If RS is not ok, keep all pods matching the selector and return `{ status:'ok', data, note:'Ownership approximate: ReplicaSets unavailable, matched by selector only' }`.
  - Then `summarizePod`.
- **Events.** `core.listNamespacedEvent({ namespace })`, chained after RS and pods. Build the allowed uid set from what's available:
  - the deployment uid (always)
  - owned RS uids (if RS is `ok`)
  - pod uids (if pods are `ok`)

  If RS or pods is not `ok`, set `note: 'Some related events may be missing'`.

  Map each event with `toDeploymentEvent`:
  - `lastTimestamp = e.lastTimestamp ?? e.series?.lastObservedTime ?? e.eventTime ?? e.metadata.creationTimestamp`. If all are missing, use `fetchedAt`.
  - `firstTimestamp = e.firstTimestamp ?? e.eventTime ?? null`
  - `count = e.count ?? e.series?.count ?? 1`
  - `source = e.source?.component ?? e.reportingComponent ?? e.reportingController ?? null`
  - `involvedKind`, `involvedName` and `involvedUid` come from `involvedObject`, with `''` for missing values.

  All timestamps are ISO strings, already normalized by `toPlain`. Sort by mapped `lastTimestamp` descending and cap at 300.
- **Services.** `core.listNamespacedService`, filtered with `matchesServiceSelector(svc.spec.selector, templateLabels)`.
- **Ingresses.** `networking.listNamespacedIngress`, chained after services. Keep ingresses where `defaultBackend.service.name` or any `rules[].http.paths[].backend.service.name` is in the matched service names. If services is not ok, this section is `error` with "Requires Services".
- **NetworkPolicies.** `networking.listNamespacedNetworkPolicy`, filtered with `matchesLabelSelector(np.spec.podSelector, templateLabels, { emptyMatchesAll: true })`.
- **HPAs.** `autoscaling.listNamespacedHorizontalPodAutoscaler`, filtered to `spec.scaleTargetRef.kind === 'Deployment' && spec.scaleTargetRef.name === name`. A 404 of the API group gives `error` with "autoscaling/v2 API not available":

  ```ts
  settle(autoscaling.listNamespacedHorizontalPodAutoscaler({ namespace }).then(list => filterHpa(list, name)), 'hpas',
    { onNotFound: () => ({ status: 'error', message: 'autoscaling/v2 API not available' }) });
  ```
- **PDBs.** `policy.listNamespacedPodDisruptionBudget`, filtered with `matchesLabelSelector(pdb.spec.selector, templateLabels, { emptyMatchesAll: true })`. In policy/v1, an empty selector matches every pod in the namespace.
- **ServiceAccount.** `core.readNamespacedServiceAccount({ name: spec.serviceAccountName ?? 'default', namespace })`.
  - 404 gives `ok` with `exists:false`:

    ```ts
    settle(core.readNamespacedServiceAccount({ name: saName, namespace }).then(toSaSummary), 'serviceaccount',
      { onNotFound: () => ({ status: 'ok', data: { name: saName, exists: false,
          automountServiceAccountToken: null, imagePullSecretNames: [], irsaRoleArn: null } }) });
    ```
  - Only `automountServiceAccountToken`, `imagePullSecrets[].name` and the IRSA annotation are copied. The `secrets` field is never copied.
- **Namespace.** `core.readNamespace({ name: namespace })`, reading the PSA labels `pod-security.kubernetes.io/{enforce,enforce-version,audit,warn}`. A 403 is common and maps to `forbidden`.
- **PVCs** (moved here from phase 3, since they depend only on the template). Take the unique `template.spec.volumes[].persistentVolumeClaim.claimName` values (cap 50) and run:

  ```ts
  mapWithConcurrency(claims, 8, c =>
    settle(core.readNamespacedPersistentVolumeClaim({ name: c, namespace }).then(toPvcSummary), 'pvc',
      { onNotFound: () => ({ status: 'ok', data: { claimName: c, found: false, phase: null, storageClass: null,
          capacity: null, accessModes: [], volumeName: null } }) }));
  ```
  - Per claim, 404 gives `ok` with `found:false` (via `onNotFound`), so it counts as a success when aggregating.
  - If every read is `forbidden`, the section is `forbidden`.
  - Other partial failures give `ok` with `note: 'N of M PVC reads failed'`, and those claims are omitted.
- **Pod metrics.** `clients.getPodMetrics()`, chained after pods. Run `pickPodMetrics(map, namespace, pods.map(p => p.name))`, which does `for (const n of podNames) { const m = map.get(`${namespace}/${n}`); if (m) out[n] = m; }`. The result is a `Record<podName, …>`.
  - If pods is not ok, the section is `error` with "Requires Pods".
  - The existing method (k8s.ts 870–959) catches every error, including 403, and returns an empty Map. The result is therefore `ok` with `{}` and the UI shows "Metrics unavailable (metrics-server missing or no permission)". This section can never report `forbidden`; `getPodMetrics` is not changed.

**Phase 3 (nodes, after pods).** The whole phase is wrapped in `withTimeout(…, 20000, 'nodes')`. On overall timeout, the section is `error` with "Timed out reading nodes". Because `withTimeout` doesn't cancel, a flag also stops new reads from starting after the deadline:

```ts
let sawForbidden = false;
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; }, 20000);
try {
  // withTimeout(mapWithConcurrency(..., () => sawForbidden || timedOut), 20000, 'nodes')
} finally { clearTimeout(timer); }
```

1. Take the unique non-null `pod.nodeName` values (cap 100).
2. Run `mapWithConcurrency(nodeNames, 8, n => settle(core.readNode({ name: n }), 'node', { timeoutMs: 10000 }), () => sawForbidden || timedOut)`. Reads already in flight at the deadline finish in the background and their results are discarded.
3. The first `forbidden` result sets `sawForbidden = true`, so no further reads start, and the section becomes `forbidden` with "No permission to read nodes".
4. Otherwise:
   - If every read failed, the section is `error`.
   - If some failed, it's `ok` with the successful summaries plus `note: 'N of M node reads failed'`. The UI treats a missing node as zone/instance unknown.
5. If pods is not ok, the section is `error` with "Requires Pods".

`listNode` is never used, so large clusters stay cheap.

**Invariant: no secret material.** The aggregator owns this invariant because it is the only code that talks to the API for this page.

- It never calls any Secret read or list API.
- Secret names appear only as references already present in the pod template: `secretKeyRef`, `envFrom.secretRef`, `volumes[].secret`, `projected.sources[].secret` and `imagePullSecrets`.
- The ServiceAccount summary deliberately omits `secrets`.
- A unit test asserts that the mocked `CoreV1Api` secret methods are never called.

Masking of sensitive literal env values (§5.5) is a display concern owned by the renderer utils. The `last-applied-configuration` annotation is stripped in main (above) and rendered as a byte count by `displayAnnotations`; `HIDDEN_ANNOTATIONS` stays in the renderer as defence-in-depth.

**Payload control.**

- `toPlain` strips `managedFields`; the aggregator strips `last-applied-configuration`.
- Pods are sent as `DeploymentPodSummary`; the template already carries the spec.
- Caps: 300 events, 100 nodes, 50 PVCs.

### 3.4 `K8sService.getDeploymentFullDetails` (edit `electron/k8s.ts`, ~25 lines)

```ts
async getDeploymentFullDetails(contextName: string, namespace: string, name: string): Promise<DeploymentFullDetailsResponse> {
  await this.setContextWithSmartReload(contextName);
  return this.withAuthRetry(contextName, () => fetchDeploymentFullDetails({
    apps: this.kc.makeApiClient(AppsV1Api), core: this.kc.makeApiClient(CoreV1Api),
    networking: this.kc.makeApiClient(NetworkingV1Api), autoscaling: this.kc.makeApiClient(AutoscalingV2Api),
    policy: this.kc.makeApiClient(PolicyV1Api),
    getPodMetrics: () => this.getPodMetrics(contextName, [namespace]),
  }, contextName, namespace, name));
}
```

Clients are created inside the retry closure, after the context switch, so a retry rebuilds them with refreshed credentials. Context handling is the same as in existing `K8sService` methods: the service shares one `KubeConfig` that `setCurrentContext` switches. As for every other method, a concurrent call for another context can interleave. This design doesn't introduce or fix that.

**Logging**

- `console.log` once at entry, with ns/name.
- `console.warn('[k8s] deploymentFullDetails <section>: <classified> <message>')` per failed section.
- `console.error` for unexpected phase-1 errors.
- Object contents are never logged.

### 3.5 IPC (edit `electron/main.ts`, `electron/preload.ts`, `electron/electron-env.d.ts`, `src/vite-env.d.ts`)

```ts
// main.ts, inside registerIpcHandlers()
safeHandle('k8s:getDeploymentFullDetails', z.tuple([
  z.string().min(1).max(253),                                                   // context
  z.string().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/).max(63),                  // namespace (DNS-1123 label)
  z.string().regex(/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/).max(253),                // name (DNS-1123 subdomain)
]), async (_e, [context, namespace, name]) => k8sService.getDeploymentFullDetails(context, namespace, name));

// preload.ts (top-level window.k8s object, next to getDeploymentRevisions)
getDeploymentFullDetails: (contextName: string, namespace: string, name: string) =>
  ipcRenderer.invoke('k8s:getDeploymentFullDetails', contextName, namespace, name),
```

- Both type declaration files declare the return as `Promise<DeploymentFullDetailsResponse>`, imported as a type from `src/types/deployment-details`.
- `mutation-policy.ts` classifies the channel as `READ`, so Safe Mode doesn't affect it.
- Validation failure rejects with `IPC validation failed: …` and is audit-logged by `safeHandle`. The renderer shows it in the error card.

**Errors seen by the renderer**

| Condition | Recoverable? | Renderer receives | Logged |
|---|---|---|---|
| Deployment 404 | yes (Back) | `{found:false, reason:'not-found'}` | `console.log` |
| Deployment 403 | no | `{found:false, reason:'forbidden'}` | `console.warn` |
| 401 after one retry, or timeout/network failure in phase 1 | yes (Retry) | rejected promise (Error message) | `console.error` |
| Section 403 | n/a | `forbidden`, shown as "Not available: missing permission to list X in ns" | `console.warn` |
| Section API 404, timeout or 5xx | yes (page Refresh) | `error` with message | `console.warn` |
| Section partial or approximate | n/a | `ok` with `note`, shown as an info line | `console.warn` (once per section) |

## 4. Renderer data hook: `src/hooks/useDeploymentFullDetails.ts` (new, ~170 lines)

```ts
export interface UseDeploymentFullDetailsResult {
  state: 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';
  details: DeploymentFullDetails | null;
  error: string | null;          // fatal error (state 'error') or last refresh error (state 'ready')
  isRefreshing: boolean;
  lastFetchedAt: number | null;
  liveUpdates: boolean;          // false when liveResourceVersion is undefined (namespace not watched)
  refresh: () => void;
  dismissError: () => void;
}
export function useDeploymentFullDetails(args: {
  clusterName: string; namespace: string; name: string; liveResourceVersion: string | undefined;
}): UseDeploymentFullDetailsResult;
```

**Lazy loading.** The hook fetches only when the full view mounts. The drawer and the list never fetch.

**Stale-while-revalidate cache.** A module-level `Map<string, DeploymentFullDetails>` (LRU, max 5 entries) is keyed by `${cluster}|${ns}|${name}`. On re-entering a tab, cached details render immediately (`state:'ready'`, `isRefreshing:true`) while a refetch runs.

Eviction rules, so a re-entered tab never flashes stale "ready" content for an object that's gone:

- `found:false` (not-found or forbidden): `cache.delete(key)`, then set `state` to `'not-found'` / `'forbidden'` and `details` to `null`.
- Fatal error (rejected promise) while `details` is still `null` (first load, no cache hit): `cache.delete(key)` (a no-op unless an older entry exists) and `state:'error'`.
- Rejected refresh while `details` is non-null: the entry is kept, matching the "keep existing details" refresh rule below.
- Successful fetch: `cache.delete(key); cache.set(key, details)` (re-insert for LRU order), then drop the oldest key when `size > 5`.

**Race safety.** The request identity is `(requestId, reqKey)`, where `reqKey = `${clusterName}|${namespace}|${name}``. IPC can't be cancelled, so late results are dropped rather than aborted.

- `currentKeyRef.current` is assigned `reqKey` for the current props on every render (latest-ref).
- Each fetch captures `const id = ++requestIdRef.current; const reqKey = currentKeyRef.current;` before invoking IPC, and passes the cluster/ns/name parsed from that same snapshot (never re-reading props after the `await`).
- On resolve, the cache write uses the captured `reqKey`, never the current key, so a late response can only refresh its own cluster's entry. The eviction rules above apply to that `reqKey`.
- State is updated only when `id === requestIdRef.current && reqKey === currentKeyRef.current && mountedRef.current`. Otherwise the response is cached (if successful) and ignored.
- Coalescing: if a fetch is requested while one is in flight **for the same `reqKey`**, `pendingRef = true` is set and exactly one follow-up fetch runs after it settles. A follow-up is only issued if `currentKeyRef.current` still equals the key that set `pendingRef`.
- Key-change reset effect (declared first, deps `[clusterName, namespace, name]`, skipped on the initial mount): increments `requestIdRef` (invalidating anything in flight), clears `pendingRef` and the debounce timer, resets state to the cache hit for the new key (`ready` + `isRefreshing`) or `loading`, then fetches. With the cluster-inclusive component key (§2.2) this path shouldn't run in practice; it exists as defence in depth, and in development it also logs `console.error('[DeploymentFullView] identity props changed on a mounted instance')` because a change means a caller dropped the key.

**Live refresh: no new watchers, no polling.** The `useDashboardWatchers` deployment watcher in `Dashboard.tsx` already runs for the session, and its items carry `metadata.resourceVersion`. The trigger is a *change* in the live value, not a mismatch with the fetched value. A lagging or stalled watcher therefore can't cause a refetch loop.

The effect body delegates entirely to the pure `decideLiveRefresh` (§9):

```ts
const stateRef = useRef<{ lastLiveRv?: string; hadLive: boolean }>({ hadLive: false });
// reset (in the key-change effect above): stateRef.current = { hadLive: false };
useEffect(() => {
  const { action, next } = decideLiveRefresh(stateRef.current, liveResourceVersion,
    detailsRef.current?.deployment.metadata?.resourceVersion);
  stateRef.current = next;
  if (action === 'debounce') scheduleDebouncedRefetch(1500);
}, [liveResourceVersion]);
```

Commentary only (the logic `decideLiveRefresh` implements; not to be inlined):

```ts
useEffect(() => {
  if (liveResourceVersion === undefined) {
    // present -> absent: possibly deleted, possibly a watcher re-seed (useDashboardWatchers clears depMapRef
    // on epoch bump). Debounce rather than fetch immediately; a genuine delete still resolves 1.5 s later.
    if (hadLiveRef.current) { hadLiveRef.current = false; lastLiveRvRef.current = undefined; scheduleDebouncedRefetch(1500); }
    return;
  }
  hadLiveRef.current = true;
  if (lastLiveRvRef.current === undefined) { lastLiveRvRef.current = liveResourceVersion; return; } // first observation
  if (liveResourceVersion === lastLiveRvRef.current) return;
  lastLiveRvRef.current = liveResourceVersion;
  if (liveResourceVersion === detailsRef.current?.deployment.metadata?.resourceVersion) return;    // already have it
  scheduleDebouncedRefetch(1500);
}, [liveResourceVersion]);
```

- The reset effect is declared before the trigger effect, so on a key change it runs first.
- On a watcher re-seed the sequence is present → absent (debounce scheduled) → present again with some rv. When the rv reappears, the trigger treats it as a first observation (`lastLiveRvRef` was cleared) and doesn't schedule anything new, but the already-scheduled debounce still fires once. That's at most one debounced refetch per re-seed, never an immediate one or a burst. Watcher epochs only bump on reconnects, so this cost is acceptable and keeps `decideLiveRefresh` to two actions (`none`, `debounce`).
- The 1500 ms debounce (a `setTimeout` in a ref, reset on each schedule) collapses the many status updates a rollout emits into one fetch.
- `detailsRef` mirrors `details`, so the effect deps stay `[liveResourceVersion]`.
- At most one fetch happens per distinct watcher rv. The worst case is bounded by watcher event frequency, not by elapsed time.

**Manual refresh.** The header Refresh button calls `refresh()`. It also runs after a successful scale or restart.

**Errors**

- First-load failure: `state:'error'` with the message. The page shows an error card with Retry.
- Refresh failure: the existing `details` are kept, `error` is set, and the header shows a dismissible yellow line "Refresh failed: …".
- `found:false`: `state` becomes `'not-found'` or `'forbidden'`.

**Cleanup.** On unmount the hook clears the debounce timer, sets `mountedRef=false` and clears `pendingRef`. Because the component key is `${clusterName}|${activeView}` (§2.2), the hook's `clusterName/namespace/name` never change for a mounted instance; a change is treated as a programming error (dev `console.error`) and handled by the key-change reset above.

The response-apply guard is extracted as a pure function so the stale-response rule is unit tested:

```ts
// src/hooks/live-refresh-decision.ts (same module as decideLiveRefresh)
export function shouldApplyResponse(req: { id: number; key: string },
  current: { id: number; key: string; mounted: boolean }): boolean;
// true only when req.id === current.id && req.key === current.key && current.mounted
```

**Known limitation** (documented in the live-indicator tooltip). Pod restarts that don't change deployment status won't trigger a refresh; the Refresh button covers this. The pod-worker stream (`LightweightPod`) has no labels or owner. Scoping it to a deployment would require changing the worker, which is out of scope.

## 5. Pure utilities (all new in `src/utils/`, each under 500 lines, each with a `*.test.ts`)

### 5.1 `deployment-history-utils.ts` (~250 lines)

```ts
export interface RevisionEntry {
  revision: number | null; revisionLabel: string;          // "7" or "?"
  previousRevisions: number[];                              // deployment.kubernetes.io/revision-history (rollbacks)
  replicaSetName: string; replicaSetUid: string; podTemplateHash: string | null;
  createdAt: string; changeCause: string | null;            // kubernetes.io/change-cause
  images: { container: string; image: string; kind: 'init' | 'sidecar' | 'main' }[];
  desiredReplicas: number; currentReplicas: number; readyReplicas: number; availableReplicas: number;
  isCurrent: boolean; isActive: boolean;                    // isActive: currentReplicas > 0
  selector: LabelSelector | null;                           // rs.spec.selector
  template: PodTemplate;                                    // pod-template-hash label removed
}

export function buildRevisionTimeline(deployment: DeploymentObj, replicaSets: ReplicaSetObj[],
  pods?: DeploymentPodSummary[] | null): RevisionEntry[];
export function getCurrentRevision(entries: RevisionEntry[]): RevisionEntry | null;
export function getPreviousRevision(entries: RevisionEntry[], entry: RevisionEntry): RevisionEntry | null;
export function buildRevisionByHash(entries: RevisionEntry[]): Map<string, RevisionEntry>;
export function eventsForRevision(events: DeploymentEvent[], entry: RevisionEntry): DeploymentEvent[];
export interface RevisionYamlInput { revision: string; name: string; createdAt: string | Date;
  replicas?: number; selector?: unknown; template: PodTemplate | undefined }
export function revisionToYaml(input: RevisionYamlInput): string;
export function revisionEntryToYamlInput(e: RevisionEntry): RevisionYamlInput;
// { revision: e.revisionLabel, name: e.replicaSetName, createdAt: e.createdAt,
//   replicas: e.desiredReplicas, selector: e.selector ?? undefined, template: e.template }
```

**Ordering.** Entries are sorted ascending by `revision`. Entries with a null revision (missing or non-integer annotation) go last, ordered by `createdAt`.

**Current revision.** Exactly one entry is current when the list is non-empty. Resolve it in this order:

1. The RS whose revision equals `deployment.metadata.annotations['deployment.kubernetes.io/revision']`.
2. If that annotation is absent, the RS whose `pod-template-hash` equals the most common hash among `pods`.
3. Otherwise, the highest revision.

**YAML.** `revisionToYaml` produces exactly the key order of the current modal helper: `revision, name, createdAt, replicas, template{labels, annotations, spec}, selector`, with undefined values removed. It uses the `js-yaml` `dump` options the current `RevisionDiffModal` uses. Before dumping, it deep-clones and applies `maskTemplateEnv` (§5.5).

**Per-revision events.** `eventsForRevision` returns, deduplicated and newest first, the union of:

- events whose `involvedUid === entry.replicaSetUid`
- Deployment events whose message mentions `entry.replicaSetName` as a whole token, for example `ScalingReplicaSet: Scaled up replica set web-6d4f to 3`. Matching uses a token-boundary regex, not `includes`, so `web-6d4f` doesn't match a message about `web-6d4f9`:

  ```ts
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[\\s"'(])${escapeRegExp(entry.replicaSetName)}($|[\\s"',.:)])`);
  ```

  The regex is built once per call, not per event.

### 5.2 `pod-template-diff-utils.ts` (~300 lines, split from history utils)

```ts
export type ChangeKind = 'added' | 'removed' | 'changed';
export interface TemplateChange {
  kind: ChangeKind; scope: 'pod' | 'container';
  container: string | null; containerKind: 'init' | 'sidecar' | 'main' | null;
  field: string;          // "image", "env.FOO", "resources.limits.memory", "volumes.cache"
  label: string;          // "image app: v1 → v2", "env FOO added", "resources.limits.memory 256Mi → 512Mi"
  before: string | null; after: string | null;   // display strings; sensitive env literals already masked
}
export function diffPodTemplates(before: PodTemplate | null, after: PodTemplate): TemplateChange[];
export function summarizeChanges(changes: TemplateChange[], max?: number): { lines: string[]; more: number }; // max default 3
```

**Container matching.** Containers are matched by name within each of `initContainers` and `containers`. A container that moves between the two lists counts as removed plus added.

**Container fields compared**

- `image`, `imagePullPolicy`, `command`, `args`, `workingDir`
- env, by name: the literal value, or the ref target for `valueFrom`. **Comparison uses raw values; display uses masked ones.** If either side's literal is sensitive (`isSensitiveEnv(name, value)` on before or after), a changed value yields `{ kind:'changed', field:'env.DB_PASSWORD', label:'env DB_PASSWORD changed (value hidden)', before: MASK, after: MASK }`. Added/removed sensitive vars show `MASK` for the present side. Raw values never leave this function.
- `envFrom`, by ref name
- `ports`, by `containerPort/protocol`
- `resources.requests` and `resources.limits`, per key
- `livenessProbe`, `readinessProbe`, `startupProbe` (added, removed, or changed by JSON)
- `volumeMounts`, by `mountPath`
- `securityContext` (JSON)
- `lifecycle` (JSON)
- `restartPolicy` (sidecar)

**Pod fields compared**

- `volumes`, by name
- `serviceAccountName`, `nodeSelector`, `affinity`, `tolerations`, `topologySpreadConstraints`, `priorityClassName`
- `securityContext`
- `hostNetwork`, `hostPID`, `hostIPC`
- `imagePullSecrets`
- `terminationGracePeriodSeconds`
- template labels and annotations, by key

**Special cases**

- `pod-template-hash` is ignored.
- A `kubectl.kubernetes.io/restartedAt` change yields one label: "Rollout restart triggered".
- `before === null` yields one change: `{ kind:'added', field:'template', label:'Initial revision' }`.

### 5.3 `security-posture-utils.ts` (~380 lines)

```ts
export type CheckLevel = 'pass' | 'warn' | 'fail' | 'info';
export type ValueSource = 'container' | 'pod' | 'unset';
export type PssProfile = 'baseline' | 'restricted';
export interface EffectiveContainerSecurity {
  container: string; kind: 'init' | 'sidecar' | 'main';
  runAsUser: { value: number | null; source: ValueSource };
  runAsGroup: { value: number | null; source: ValueSource };
  runAsNonRoot: { value: boolean | null; source: ValueSource };
  seccompProfile: { value: string | null; source: ValueSource };     // RuntimeDefault | Localhost | Unconfined
  appArmorProfile: { value: string | null; source: ValueSource | 'annotation' };  // RuntimeDefault | Localhost | Unconfined
  seLinuxOptions: { value: { type?: string; user?: string; role?: string; level?: string } | null; source: ValueSource };
  privileged: boolean; allowPrivilegeEscalation: boolean | null; readOnlyRootFilesystem: boolean;
  capabilitiesAdd: string[]; capabilitiesDrop: string[]; procMount: string | null; hostPorts: number[];
}
export interface SecurityCheck {
  id: string; level: CheckLevel; scope: 'pod' | 'container'; container: string | null;
  title: string; detail: string;
  pss: PssProfile | null;   // the PSS profile whose control this check maps to (null = not a PSS control)
  pssViolation: boolean;    // true when the evaluated value violates that profile; sole input to pssLevel
}
export interface SecurityPostureReport {
  containers: EffectiveContainerSecurity[]; checks: SecurityCheck[];
  pssLevel: 'restricted' | 'baseline' | 'privileged';   // highest profile the template satisfies (approximation)
  counts: Record<CheckLevel, number>;
}
export const BASELINE_ALLOWED_CAPS: readonly string[] = ['AUDIT_WRITE','CHOWN','DAC_OVERRIDE','FOWNER','FSETID',
  'KILL','MKNOD','NET_BIND_SERVICE','SETFCAP','SETGID','SETPCAP','SETUID','SYS_CHROOT'];
export const DANGEROUS_CAPS: readonly string[] = ['ALL','SYS_ADMIN','NET_ADMIN','SYS_PTRACE','SYS_MODULE',
  'SYS_RAWIO','BPF','PERFMON','DAC_READ_SEARCH'];
export const BASELINE_SELINUX_TYPES: readonly string[] = ['container_t','container_init_t','container_kvm_t','container_engine_t'];
export const BASELINE_SAFE_SYSCTLS: readonly string[] = ['kernel.shm_rmid_forced','net.ipv4.ip_local_port_range',
  'net.ipv4.ip_unprivileged_port_start','net.ipv4.tcp_syncookies','net.ipv4.ping_group_range',
  'net.ipv4.ip_local_reserved_ports','net.ipv4.tcp_keepalive_time','net.ipv4.tcp_fin_timeout',
  'net.ipv4.tcp_keepalive_intvl','net.ipv4.tcp_keepalive_probes'];
export const RESTRICTED_VOLUME_TYPES: readonly string[] = ['configMap','csi','downwardAPI','emptyDir',
  'ephemeral','persistentVolumeClaim','projected','secret'];

export function resolveEffectiveSecurityContext(template: PodTemplate, container: Jsonified<V1Container>,
  kind: 'init' | 'sidecar' | 'main'): EffectiveContainerSecurity;
export function evaluateRunAsRoot(eff: EffectiveContainerSecurity): SecurityCheck;   // exported for the truth-table test
export function evaluateAddedCapability(container: string, cap: string): SecurityCheck;
export function computePssLevel(checks: SecurityCheck[]): SecurityPostureReport['pssLevel'];
export function evaluateSecurityPosture(template: PodTemplate,
  opts?: { serviceAccount?: ServiceAccountSummary | null }): SecurityPostureReport;
```

**Merge rules.** These follow Kubernetes semantics.

- Container `securityContext` overrides pod `securityContext` for `runAsUser`, `runAsGroup`, `runAsNonRoot`, `seccompProfile`, `seLinuxOptions` and `appArmorProfile`. The `source` field records which level won.
- AppArmor falls back to the annotation `container.apparmor.security.beta.kubernetes.io/<name>`. `runtime/default` maps to `RuntimeDefault`, `localhost/x` to `Localhost` and `unconfined` to `Unconfined`. The source is then `'annotation'`.
- `privileged`, `allowPrivilegeEscalation`, `readOnlyRootFilesystem`, `capabilities` and `procMount` are container-only.
- Capability names are normalized to upper case, with any `CAP_` prefix stripped.
- A sidecar is an init container with `restartPolicy: 'Always'`.

**PSS level rule (single approach).** `pssLevel` is computed only from `pssViolation`; `level` is not consulted.

- `'privileged'` if any check has `pssViolation && pss === 'baseline'`.
- Otherwise `'baseline'` if any check has `pssViolation && pss === 'restricted'`.
- Otherwise `'restricted'`.

This lets a `pass` row still record a Restricted gap. The UI labels the result "approx.". The Windows `hostProcess` and the `restricted` seccomp allowance per Kubernetes version are not modelled.

**Runs as root.** This is per container and exhaustive. It is evaluated top to bottom on the effective values, and the first match wins.

| effective runAsUser | effective runAsNonRoot | level | pss | pssViolation | title / detail |
|---|---|---|---|---|---|
| 0 | true | fail | restricted | true | "Pod will fail to start: runAsNonRoot=true with runAsUser=0" |
| 0 | false or unset | fail | restricted | true | "Runs as root (runAsUser=0)" |
| > 0 | true | pass | restricted | false | "Runs as non-root uid N" |
| > 0 | false or unset | pass | restricted | true | "Runs as uid N; runAsNonRoot not set (Restricted requires it)" |
| unset | true | pass | restricted | false | "Non-root enforced by kubelet (image USER must be numeric, non-zero)" |
| unset | false or unset | warn | restricted | true | "May run as root (depends on image USER)" |

An explicit `runAsNonRoot:false` is treated the same as unset. The detail notes "explicitly false" when the source is not `unset`.

**Other checks.** These are per container unless marked "pod".

| Check | Outcome → level / pss / pssViolation |
|---|---|
| runAsGroup | gid > 0 → pass/null; unset → warn/null ("primary group may be root"); 0 → warn/null |
| privileged | false → pass/baseline/false; true → fail/baseline/true |
| allowPrivilegeEscalation | false → pass/restricted/false; unset → warn/restricted/true ("defaults to true"); true, or privileged → fail/restricted/true |
| readOnlyRootFilesystem | true → pass/null; false or unset → warn/null |
| capabilities.drop | includes `ALL` → pass/restricted/false; otherwise → warn/restricted/true |
| capabilities.add | One check per added cap via `evaluateAddedCapability`. `ALL` or any `DANGEROUS_CAPS` → fail/baseline/true. Not in `BASELINE_ALLOWED_CAPS` (e.g. `NET_RAW`) → warn/baseline/true. In `BASELINE_ALLOWED_CAPS` except `NET_BIND_SERVICE` (e.g. `CHOWN`) → warn/restricted/true. `NET_BIND_SERVICE` → pass/restricted/false. No caps added → one pass/null check "No capabilities added". |
| seccompProfile | `RuntimeDefault` or `Localhost` → pass/restricted/false; unset → warn/restricted/true; `Unconfined` → fail/baseline/true |
| AppArmor | `RuntimeDefault`, `Localhost` or unset → pass/baseline/false; `Unconfined` → fail/baseline/true |
| SELinux | unset, or `type` in `BASELINE_SELINUX_TYPES` (or unset) with `user` and `role` unset → pass/baseline/false; `type` outside the set, or `user`/`role` set → fail/baseline/true |
| procMount | `Default` or unset → pass/baseline/false; `Unmasked` → fail/baseline/true |
| hostPort | none → pass/baseline/false; any `ports[].hostPort` → warn/baseline/true |
| pod: hostNetwork / hostPID / hostIPC | one check each; false → pass/baseline/false; true → fail/baseline/true |
| pod: hostPath volumes | none → pass/baseline/false; any → fail/baseline/true, detail lists paths |
| pod: volume types | all in `RESTRICTED_VOLUME_TYPES` or hostPath (covered above) → pass/restricted/false; any other type (nfs, iscsi, …) → warn/restricted/true |
| pod: sysctls | none, or all in `BASELINE_SAFE_SYSCTLS` → pass/baseline/false; any other → fail/baseline/true |
| pod: automountServiceAccountToken | effective false (pod overrides SA) → pass/null; effective true or unset → warn/null |
| pod: serviceAccountName | non-default → info/null; `default` or unset → info/null ("uses the namespace default SA") |
| pod: imagePullSecrets | info/null listing names from the pod and the SA |
| pod: IRSA | info/null with the role ARN, if annotated |

`counts` tallies `level` across all checks.

### 5.4 `pod-distribution-utils.ts`

```ts
export interface NodeGroup {
  nodeName: string; node: NodeSummary | null; zone: string | null;
  pods: DeploymentPodSummary[]; readyPods: number; restarts: number;
  statusCounts: Record<string, number>;          // keyed by displayStatus
}
export interface ZoneGroup { zone: string | null; nodes: NodeGroup[]; podCount: number }
export interface DistributionRisk { id: 'single-replica' | 'single-node' | 'single-zone' | 'node-concentration'
  | 'unscheduled' | 'zone-unknown' | 'spread-skew' | 'node-not-ready'; level: 'info' | 'warn' | 'fail'; message: string }
export function groupPodsByNode(pods: DeploymentPodSummary[], nodes: NodeSummary[]): { scheduled: NodeGroup[]; unscheduled: DeploymentPodSummary[] };
export function groupNodesByZone(groups: NodeGroup[]): ZoneGroup[];
export function assessDistributionRisks(input: { groups: NodeGroup[]; unscheduled: DeploymentPodSummary[];
  desiredReplicas: number; topologySpreadConstraints: unknown[] | undefined; nodesAvailable: boolean }): DistributionRisk[];
```

Pods with a `deletionTimestamp` are shown but excluded from risk math. Groups are sorted by pod count descending, then by name.

**Risks**

- `single-replica`: desired == 1. Info.
- `single-node`: at least 2 scheduled pods, all on one node. Fail.
- `single-zone`: at least 2 scheduled pods, every node's zone is known, and only one distinct zone. Warn.
- `node-concentration`: n ≥ 3 and some node hosts more than ⌈n/2⌉ pods. Warn.
- `unscheduled`: count > 0. Warn, includes the first `unschedulableMessage`.
- `zone-unknown`: nodes are unavailable, or zone labels are missing. Info.
- `spread-skew`: for each TSC on `topology.kubernetes.io/zone` or `kubernetes.io/hostname`, the observed max − min across domains that host pods exceeds `maxSkew`. Warn. The domain key is `group.zone` for the zone key and `group.node?.hostname ?? group.nodeName` for the hostname key (the hostname label can differ from the node name). Pods whose domain is null are skipped for that TSC. The message notes that empty eligible domains aren't visible.
- `node-not-ready`: a hosting node is NotReady or cordoned. Warn.

### 5.5 `sensitive-value-utils.ts`

```ts
export const MASK = '••••••••';
export const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration';   // also imported by electron/deployment-full-details.ts
export const HIDDEN_ANNOTATIONS: readonly string[] = [LAST_APPLIED];
export function isSensitiveEnv(name: string, value: string): boolean;
// name matches /(PASS(WORD)?|PASSWD|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH|DSN|CONN(ECTION)?_?STR)/i
// or value matches /^(eyJ|AKIA|ASIA|sk-|ghp_|gho_|github_pat_|xox[bpas]-|Bearer\s)/i or contains "://<user>:<pass>@"
export function maskTemplateEnv(template: PodTemplate): PodTemplate;   // deep clone; masks sensitive literal env values
export function displayAnnotations(annotations: Record<string, string> | undefined,
  opts?: { strippedBytes?: Record<string, number> }): { key: string; value: string; hidden: boolean }[];
// keys in HIDDEN_ANNOTATIONS that are still present -> value `(${byteLength} bytes, hidden; use Edit YAML)`, hidden: true
// each strippedBytes entry (key absent from annotations because main removed it) -> same placeholder with that count
// others verbatim; result sorted by key; a key present in both is emitted once (present value wins for the count)
```

**Literal env values.** These aren't Secret data, but they can hold credentials, so they are masked with no reveal toggle. Users who own the deployment can still see them through Edit YAML, which is existing behaviour. `byteLength` uses `new TextEncoder().encode(v).length`.

**Hidden annotations.** `displayAnnotations` is applied to every annotation display on this page: the deployment in OverviewSection (called with `{ strippedBytes: details.lastAppliedBytes != null ? { [LAST_APPLIED]: details.lastAppliedBytes } : undefined }`), and the ReplicaSet annotations in RevisionDetailPanel (no `strippedBytes`; `HIDDEN_ANNOTATIONS` is the backstop). Template annotations in diffs are unaffected; they never carry `last-applied-configuration`.

### 5.6 `container-insights-utils.ts`

```ts
export interface ParsedImage { raw: string; registry: string | null; repository: string; tag: string | null;
  digest: string | null; isLatest: boolean; isUntagged: boolean }
export interface EnvEntry { name: string; source: 'literal' | 'configMapKeyRef' | 'secretKeyRef' | 'fieldRef' | 'resourceFieldRef';
  display: string; masked: boolean; refName: string | null; refKey: string | null; optional: boolean }
export interface ProbeSummary { handler: 'httpGet' | 'tcpSocket' | 'exec' | 'grpc' | 'unknown'; target: string;
  initialDelaySeconds: number; periodSeconds: number; timeoutSeconds: number; failureThreshold: number; successThreshold: number }
export interface ContainerFlag { id: string; level: 'info' | 'warn' | 'fail'; message: string }
export interface ContainerInsight {
  name: string; kind: 'init' | 'sidecar' | 'main'; image: ParsedImage; effectivePullPolicy: string;
  runningImageIDs: string[];      // distinct imageIDs from pod container statuses (actual digests)
  command: string[]; args: string[]; workingDir: string | null;
  ports: { name: string | null; containerPort: number; protocol: string; hostPort: number | null }[];
  env: EnvEntry[]; envFrom: { kind: 'configMap' | 'secret'; name: string; prefix: string | null; optional: boolean }[];
  volumeMounts: { name: string; mountPath: string; subPath: string | null; readOnly: boolean; volumeType: string }[];
  resources: { requests: Record<string, string>; limits: Record<string, string> };
  probes: { liveness: ProbeSummary | null; readiness: ProbeSummary | null; startup: ProbeSummary | null };
  lifecycle: { postStart: string | null; preStop: string | null };
  flags: ContainerFlag[];
}
export function parseImageRef(ref: string): ParsedImage;
export function describeProbe(probe: unknown, ports: ContainerInsight['ports']): ProbeSummary | null;
export function buildContainerInsights(template: PodTemplate, pods: DeploymentPodSummary[] | null): ContainerInsight[];
```

**Effective pull policy.** `Always` when the tag is `latest` or missing and there is no digest. Otherwise `IfNotPresent`. An explicit value wins.

**Flags**

- `latest-tag`, `no-tag`: warn.
- `no-requests-cpu`, `no-requests-memory`: warn.
- `no-limits-memory`: warn.
- `no-limits-cpu`: info, because it's often deliberate.
- `no-readiness`, `no-liveness`: warn, main containers only.
- `no-startup`: info.
- `liveness-equals-readiness`: info.
- `pull-never`: info.
- `multiple-digests`: warn, when `runningImageIDs.length > 1`.

**Probe targets.** For example `GET http://:8080/healthz`, `TCP :5432`, `exec: cat /tmp/ready` or `gRPC :9090`. Named ports are resolved against the container's ports.

**Env display.** `secretKeyRef` displays as `secret <name> / <key>`. There is no value to show because secrets are never fetched. Literal values flagged by `isSensitiveEnv` display `MASK` with `masked: true`.

### 5.7 `networking-utils.ts`

```ts
export interface PortMapping { serviceName: string; serviceType: string; servicePort: number; protocol: string;
  targetPort: string; nodePort: number | null;
  resolved: { container: string; containerPort: number; portName: string | null } | null }   // null -> warn
export function mapServicePorts(services: Jsonified<V1Service>[], template: PodTemplate): PortMapping[];
// targetPort int -> containerPort match; string -> ports[].name match; unset -> equals port
export interface IngressRoute { ingress: string; className: string | null; host: string; path: string; pathType: string;
  serviceName: string; servicePort: string; tls: boolean }
export function ingressRoutesForServices(ingresses: Jsonified<V1Ingress>[], serviceNames: Set<string>): IngressRoute[];
export function describeNetworkPolicy(np: Jsonified<V1NetworkPolicy>): { name: string; policyTypes: string[];
  ingressRules: number; egressRules: number; defaultDenyIngress: boolean; defaultDenyEgress: boolean };
```

When the NetworkPolicy list is `ok` and empty, the UI shows the info line "No NetworkPolicy selects these pods (all traffic allowed)".

### 5.8 `deployment-rollout-utils.ts`

```ts
export interface RolloutSummary { desired: number; current: number; updated: number; ready: number; available: number;
  unavailable: number; progressPercent: number; isPaused: boolean; isComplete: boolean; isStalled: boolean;
  observedGenerationStale: boolean;
  strategy: { type: 'RollingUpdate' | 'Recreate'; maxSurge: string | null; maxUnavailable: string | null };
  conditions: { type: string; status: string; reason: string | null; message: string | null; lastTransitionTime: string | null }[];
  minReadySeconds: number; progressDeadlineSeconds: number; revisionHistoryLimit: number }
export function getRolloutSummary(d: DeploymentObj): RolloutSummary;
export interface HpaSummary { name: string; min: number; max: number; current: number; desired: number;
  metrics: { label: string; target: string; current: string | null }[]; atMax: boolean; conditions: RolloutSummary['conditions'] }
export function summarizeHpa(hpa: Jsonified<V2HorizontalPodAutoscaler>): HpaSummary;
export function summarizePdb(pdb: Jsonified<V1PodDisruptionBudget>): { name: string; minAvailable: string | null;
  maxUnavailable: string | null; currentHealthy: number; desiredHealthy: number; disruptionsAllowed: number; blocksEviction: boolean };
```

**Defaults.** `replicas` 1, `maxSurge` and `maxUnavailable` 25%, `minReadySeconds` 0, `progressDeadlineSeconds` 600, `revisionHistoryLimit` 10.

**Derived values**

- `progressPercent`: `desired === 0 ? 100 : round(min(updated, available) / desired * 100)`.
- `isStalled`: Progressing is False with reason `ProgressDeadlineExceeded`.
- `isComplete`: Progressing is True with reason `NewReplicaSetAvailable`, and `updated == desired == available`.
- `observedGenerationStale`: `status.observedGeneration < metadata.generation`.
- `blocksEviction`: `disruptionsAllowed === 0`.

The header status badge reuses `getDeploymentStatus` from `resource-utils.ts`.

## 6. Components

Folder: `src/components/dashboard/views/deployment-details/`. Every file stays under ~350 lines.

- Only `DeploymentFullView` is a container that calls hooks, IPC and actions.
- All other components are presentational: props in, callbacks out, wrapped in `React.memo`. Derived data comes from `useMemo` in the parent.

```
DeploymentFullView.tsx          container: useDeploymentFullDetails, derived memo data, modals, section nav, layout
├─ DeploymentHeader.tsx         name, ns, cluster, status badge, age (TimeAgo), live indicator, last-updated,
│                               actions: Back, Refresh, Scale, Restart, Edit YAML; HPA warning line; refresh-error line
├─ SectionNav.tsx               sticky jump nav (IntersectionObserver for active section)
├─ SectionShell.tsx             <section id> + header bar (w-1 h-8 bg-orange-500 rounded-full) + SectionUnavailable
│                               + SectionNote + LevelBadge exports
├─ OverviewSection.tsx          strategy, selector, minReady/progressDeadline/revisionHistoryLimit, paused,
│                               conditions, labels & annotations (collapsible; displayAnnotations)
├─ RevisionTimeline.tsx         horizontal timeline + RevisionHoverCard + keyboard nav
├─ RevisionDetailPanel.tsx      selected revision facts, change list, per-revision events, compare toggle,
│                               "Open ReplicaSet" link, "Show YAML diff"
├─ RevisionDiffEditor.tsx       embedded Monaco DiffEditor (mounted on demand) + "Pop out"
├─ RolloutSection.tsx           replica stat tiles + progress bar + HPA card + PDB card + banners
├─ PodDistribution.tsx          zone columns → node cards (pod dots), risk banners
├─ SchedulingConstraints.tsx    nodeSelector, affinity/anti-affinity, tolerations, TSCs, priorityClassName…
├─ DeploymentPodsTable.tsx      VirtualizedTable of pods with revision + logs action
├─ ContainersSection.tsx        ContainerCard list grouped Init / Sidecars / Containers
├─ ContainerCard.tsx            image (+digest, flags), ports, command/args, env, envFrom, mounts, resources, probes, lifecycle
├─ SecurityPosture.tsx          PSS level vs namespace PSA, pod checks, per-container matrix
├─ NetworkingSection.tsx        services + port mapping, ingress routes, network policies
├─ ConfigStorageSection.tsx     ConfigMap refs, Secret refs (names only), volumes summary, PVC table
└─ EventsSection.tsx            All/Warnings filter, newest first, paginated
```

**`SectionShell` API**

```tsx
interface SectionShellProps<T> {
  id: string; title: string; namespace: string;
  result?: SectionResult<T>;                               // omit for sections driven only by the deployment object
  unavailableLabel?: string;                               // e.g. "list services", "read nodes"
  scope?: 'namespace' | 'cluster';                         // default 'namespace'; 'cluster' for nodes / namespace reads
  children: React.ReactNode | ((data: T) => React.ReactNode);
}
```

- **Children resolution.** With `result` omitted, `children` must be a node and is rendered as-is (a function child is a programming error: rendered as `null` with a dev-only `console.error`). With `result` given, a function child is called only when `result.status === 'ok'`, with `result.data`; a node child is rendered only for `ok`.
- For `ok`, `SectionShell` renders `SectionNote` above the children when `note` is set: a `text-xs text-gray-400` line with a Lucide `Info` icon.
- For `forbidden`, it renders `SectionUnavailable` with a `Lock` icon: "Not available: missing permission to {unavailableLabel} in {namespace}" for `scope:'namespace'`, and "Not available: missing permission to {unavailableLabel} (cluster-scoped)" for `scope:'cluster'`.
- For `error`, it renders `SectionUnavailable` with a yellow `AlertTriangle` and the message.
- Sub-lists that hold their own result (for example Networking's three lists) use exported `SectionUnavailable` and `SectionNote` directly.

### 6.1 `DeploymentFullView` props and behaviour

```ts
type FullViewResourceType = 'pod' | 'node' | 'replicaset' | 'service' | 'ingress' | 'networkpolicy'
  | 'horizontalpodautoscaler' | 'poddisruptionbudget' | 'persistentvolumeclaim' | 'configmap' | 'serviceaccount';
interface DeploymentFullViewProps {
  clusterName: string; namespace: string; name: string;
  liveDeployment: { metadata?: { resourceVersion?: string } } | undefined;
  onBack: () => void;
  onResourceClick: (resource: { name: string; namespace?: string }, type: FullViewResourceType) => void;
  onOpenLogs?: (pod: LogTarget, containerName: string) => void;
  onOpenYaml?: (resource: unknown) => void;
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}
```

The view renders inside `ErrorBoundary name="DeploymentFullView" resetKey={`${clusterName}/${namespace}/${name}`}`.

**Derived data.** These are memoized with `useMemo` on `details`, so each is computed once per fetch:

- `buildRevisionTimeline`
- `getRolloutSummary`
- `groupPodsByNode` / `groupNodesByZone` / `assessDistributionRisks`
- `buildContainerInsights`
- `evaluateSecurityPosture`
- `mapServicePorts` / `ingressRoutesForServices`
- `buildRevisionByHash`
- `targetingHpa` (the first `ok` HPA)

Callbacks passed to children use `useCallback`.

**Page states**

- **`loading` with no cache:** section skeletons (`SkeletonLoader`).
- **`not-found`:** a card "Deployment `<ns>/<name>` no longer exists in `<cluster>`" with Back.
- **`forbidden`:** a red error card "You don't have permission to read this deployment".
- **`error`:** a red error card with the message and a `GlassButton primary` Retry.

**Actions.** These reuse existing IPC and are already Safe-Mode enforced in main.

- **Scale.** Opens the existing `ScaleModal` with `currentReplicas = spec.replicas ?? 1`. `ScaleModal` seeds `useState(currentReplicas)` once, so it is mounted only while open. Each open is a fresh mount and reads the latest count:

  ```tsx
  {isScaleOpen && <ScaleModal isOpen onClose={closeScale}
    currentReplicas={details.deployment.spec?.replicas ?? 1} resourceName={name} onScale={handleScale} />}
  ```

  It is deliberately **not** keyed by `details.fetchedAt`: a live refresh landing while the modal is open would remount it and wipe the number the user is typing. A refresh during an open modal only changes the value the next open starts from. `onScale` calls `window.k8s.scaleDeployment(...)`.
  - On success: `showToast('Scaled to N', 'success')`, then `refresh()`.
  - On failure: `showToast(err.message, 'error')` and rethrow, so the modal stays open (its existing behaviour).
- **HPA warning.** When `targetingHpa` exists, `DeploymentHeader` renders `text-xs text-yellow-400` with a Lucide `AlertTriangle` *under the action row*: "HPA <name> manages replicas (min N / max M); a manual scale will be overridden." It isn't in a tooltip, because `Tooltip` is single-line and `ScaleModal` has no warning slot.
- **Restart.** Opens `ConfirmModal variant="warning"`: "Rolling restart deployment `<name>`?". `onConfirm` calls `window.k8s.restartDeployment(...)`.
  - On success: toast, then `refresh()`.
  - On error: an error toast. The error is swallowed so the modal closes.
- **Edit YAML.** `onOpenYaml({ ...details.deployment, type: 'deployment' })`, the existing editor flow.
- **Logs.** Available from the pods table and the node-card pod dots. `App.handleOpenLogs` (App.tsx 843–852) builds the log tab's `allContainers` from `pod.spec.containers` + `pod.spec.initContainers` and falls back to `[containerName]`, so the page must pass a pod-shaped object that carries every container name. That way the existing LogViewer container selector lists main, sidecar and init containers, the same as the Pods view. No changes to App, BottomPanel or LogViewer.

  Pure helpers in `src/utils/deployment-log-utils.ts` (new, with `deployment-log-utils.test.ts`):

  ```ts
  export interface LogTarget {
    name: string; namespace: string;
    spec: { containers: { name: string }[]; initContainers: { name: string }[] };
  }
  /** containers = kind 'main'; initContainers = kind 'init' and 'sidecar' (sidecars are init containers in the spec).
   *  When pod.containers is empty, falls back to the template's containers/initContainers names. */
  export function toLogTarget(pod: DeploymentPodSummary, template: PodTemplate): LogTarget;
  /** first kind 'main' entry of pod.containers, else template.spec.containers[0].name, else '' */
  export function firstMainContainerName(pod: DeploymentPodSummary, template: PodTemplate): string;
  ```

  `DeploymentFullView` owns one `handleOpenPodLogs = useCallback((pod: DeploymentPodSummary) => onOpenLogs?.(toLogTarget(pod, template), firstMainContainerName(pod, template)), [onOpenLogs, template])` and passes it to `DeploymentPodsTable` and `PodDistribution` as `onOpenPodLogs?: (pod: DeploymentPodSummary) => void`. Presentational components never build the target themselves. The Logs button is hidden when `onOpenLogs` is undefined or `firstMainContainerName` returns `''`.

  `DashboardContent` passes its existing `onOpenLogs` (typed `(pod: any, containerName: string) => void` today), which is assignable to the narrower `LogTarget` signature.

Explain-with-AI is not added.

### 6.2 Layout and section order

1. **Header.** `bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl p-6`.
2. **Sticky `SectionNav`.** `sticky top-0 z-10 bg-white/5 border border-white/10 backdrop-blur-xl rounded-xl`, inside the existing `overflow-y-auto` content scroller. `DashboardHeader` is outside that scroller, so the two don't collide.
3. **Overview and Rollout.** Side by side at `xl:grid-cols-2`.
4. **Revision History.** Full width.
5. **Pod Distribution**, then Scheduling Constraints, then Pods.
6. **Containers.**
7. **Security Posture.**
8. **Networking** and **Config & Storage.** `xl:grid-cols-2`.
9. **Events.**
10. **Topology.** Collapsed by default. Mounts `<ResourceTopology clusterName resource={details.deployment} />` only when expanded.

A non-ok section never affects the rest of the page.

### 6.3 Revision timeline (key feature)

**Layout.** A horizontal track (`h-px bg-white/10`) inside an `overflow-x-auto` container.

- Nodes are evenly spaced, at least 96 px apart, with the oldest on the left. Equal spacing keeps nodes readable when revision gaps range from minutes to months.
- Each connector shows the relative gap, for example "3d".
- The current node is scrolled into view on mount and whenever the current revision changes.

**Node.** A 28 px round `button` labelled `#7`.

- **Current:** `bg-green-500/20 border-green-500/40 text-green-300` with a "Current" pill.
- **Active non-current** (an old RS still has pods mid-rollout): `bg-yellow-500/10 border-yellow-500/30 text-yellow-400` with "Rolling".
- **Historical:** `bg-white/5 border-white/10 text-gray-300`.
- **Selected:** `ring-2 ring-blue-500/50`.
- **Warning events:** a red count badge.
- **Rolled back** (`previousRevisions.length > 0`): a `RotateCcw` icon.

**Hover/focus card.** `RevisionHoverCard` is defined in `RevisionTimeline.tsx` and positioned absolutely inside the timeline container. It doesn't use `Tooltip`, which is single-line.

- Style: `bg-[#1e1e1e] border border-white/10 rounded-xl shadow-xl p-3 z-50 w-80`, with a Framer fade/scale of 150 ms.
- Shows on `mouseenter` and `focus`. Hides on `mouseleave`, `blur` and `Escape`.
- Content:
  - revision number
  - absolute time plus `TimeAgo`
  - change-cause, or "No change-cause recorded"
  - images
  - ready/desired replicas
  - the first 3 `summarizeChanges` lines, then "+N more"
  - warning event count

**Selection.** Click, Enter or Space selects a node. The initial selection is the current revision. `RevisionDetailPanel` shows:

- the ReplicaSet name (click → `onResourceClick({ name, namespace }, 'replicaset')`) and pod-template-hash
- created time and change-cause
- `previousRevisions`, as "Rolled back; previously revisions 2, 4"
- replica counts and images
- RS annotations through `displayAnnotations`
- the full change list against the comparison target, each item with an added/removed/changed icon and green/red/blue text
- `eventsForRevision`, up to 20

**Compare toggle.** A `ToggleGroup` with "vs previous" (default) and "vs current".

- The `vs current` option has `disabled: true` and `title: 'Selected revision is current'` when the selection is current. If the selection becomes current while "vs current" is chosen, the toggle resets to "vs previous".
- For the oldest retained revision, "vs previous" shows "Initial retained revision — older revisions pruned (revisionHistoryLimit = N)" when `revision > 1`, otherwise "Initial revision".

**Keyboard and ARIA**

- The container is `role="listbox"` with `aria-label="Revision history"`.
- Nodes are `role="option"` with `aria-selected` and a roving `tabIndex`. ←/→ move focus and selection, and Home/End jump to the ends.
- The current node has `aria-current="true"`.
- Each node's `aria-label` reads like "Revision 7, created 2 hours ago, current, 3 of 3 ready".

**Empty states**

- RS section not ok: `SectionUnavailable`.
- No RS: "No ReplicaSets retained (revisionHistoryLimit = 0?)".
- One revision: a single node with "No earlier revisions to compare".

### 6.4 Monaco diff reuse

**`RevisionDiffEditor.tsx`.** "Show YAML diff" in `RevisionDetailPanel` mounts this component. It is collapsed by default, so Monaco loads only on demand.

- It renders `DiffEditor` from `@monaco-editor/react` with the options `RevisionDiffModal` uses today: `readOnly`, minimap off, `fontSize: 13`, `diffWordWrap: 'on'`, `originalEditable: false`, theme `vs-dark`, height 480px. `renderSideBySide` is driven by local state.
- **Layout toggle.** An always-visible `ToggleGroup` with "Side by side" / "Inline" sits in the editor's label row. Its initial value is computed once on mount: `window.matchMedia('(min-width: 1024px)').matches ? 'side' : 'inline'`. It doesn't follow later resizes; the user's choice wins after mount. The pop-out modal stays side-by-side, as today.
- **Masked env.** Both sides are built from `maskTemplateEnv` output, so a changed sensitive env value is `MASK` on both sides and Monaco shows no difference for that line. The change list in `RevisionDetailPanel` is the authoritative place for it ("env X changed (value hidden)"). The diff editor shows a `text-xs text-gray-400` note under the label row when any change in the current list has `before === MASK || after === MASK`: "Some changed values are hidden; see the change list."
- Inputs: `left` and `right`, each `{ label, createdAt, yaml }`. `DeploymentFullView` builds them with `useMemo` from `revisionToYaml(revisionEntryToYamlInput(entry))` for the selected pair.
- The column label row copies the modal's style: red-tinted "Revision X · date" on the left, green-tinted on the right.
- A "Pop out" button opens `RevisionDiffModal` with the same `left` and `right` objects, so no YAML is recomputed.

**`RevisionDiffModal.tsx` refactor (prop contract change).**

```ts
export interface RevisionDiffSide { label: string; createdAt: string; yaml: string }
interface RevisionDiffModalProps { isOpen: boolean; onClose: () => void; left: RevisionDiffSide; right: RevisionDiffSide }
```

- The local `Revision` interface and the local `revisionToYaml` are deleted.
- `label` is the full display string (for example `Revision 7`), so the modal never prefixes it. The subtitle renders `{left.label} → {right.label}`. Each column header renders `{side.label} · {formatted side.createdAt}` with the existing red/green tints. The same rule applies to `RevisionDiffEditor`'s label row.

**`DeploymentDetails.tsx` (drawer) update.** It builds the sides where it currently sets `diffPair`. `DrawerRevision` is declared in `DeploymentDetails.tsx` and matches the existing `k8s.getDeploymentRevisions` return shape:

```ts
interface DrawerRevision {
  name: string; revision: string;
  creationTimestamp: string | Date;   // client-node returns Date; structured clone keeps it a Date over IPC
  spec?: { replicas?: number; selector?: unknown; template?: PodTemplate };
}

const toSide = (rev: DrawerRevision): RevisionDiffSide => ({
  label: `Revision ${rev.revision}`, createdAt: String(rev.creationTimestamp),
  // passed through unchanged so js-yaml dumps a Date exactly as today (byte-identical output)
  yaml: revisionToYaml({ revision: rev.revision, name: rev.name, createdAt: rev.creationTimestamp,
    replicas: rev.spec?.replicas, selector: rev.spec?.selector, template: rev.spec?.template }),
});
```

Drawer YAML output is byte-identical to today except that sensitive env literals are now masked.

**Why not `DiffModal`.** The yaml-editor `DiffModal` is not reused because it's an apply-confirmation dialog with Confirm/Cancel semantics. What's reused is the Monaco DiffEditor configuration.

### 6.5 `ToggleGroup` changes (`src/components/shared/ToggleGroup.tsx`)

- `ToggleOption` gains `disabled?: boolean` and `title?: string`.
- Each button gets `disabled={option.disabled}`, `aria-disabled={option.disabled || undefined}`, `title={option.title}`, and `opacity-40 cursor-not-allowed` when disabled. `onClick` returns early when disabled.
- `const id = useId();` and `layoutId={`toggle-bg-${id}`}`. Two groups on the same page (revision compare and events filter) no longer share or steal the animated pill.
- Existing usages (for example `DashboardHeader`) don't pass the new fields, so their behaviour is unchanged. The animation stays within each group.

### 6.6 Other sections

**RolloutSection**

- Six stat tiles: Desired, Current, Updated, Ready, Available, Unavailable.
  - Tile: `bg-white/5 border border-white/10 rounded-xl p-3`.
  - Value: `text-2xl font-bold text-white`.
  - Label: `text-xs text-gray-400`.
  - Unavailable > 0 is shown in yellow.
- A progress bar of `progressPercent`: a `bg-white/10` track with a `bg-blue-500` fill, or green when complete. Framer animates the width.
- Banners:
  - stalled (red, with the condition message)
  - paused (yellow)
  - observedGeneration stale (info: "Controller hasn't observed latest spec yet")
- HPA card: min/max/current/desired, metrics as target vs current, and an "At max replicas" warn.
- PDB card: minAvailable/maxUnavailable and disruptionsAllowed. When `blocksEviction`, warn "Node drains will block while 0 disruptions are allowed". When replicas > 1 and no PDB exists, info "No PodDisruptionBudget — voluntary disruptions can evict all replicas".

**PodDistribution**

- One column per zone. The header shows the zone name (or "Unknown zone"), pod count and a share bar.
- Each node card shows:
  - the name (click → node drawer)
  - instance type, capacity type and node pool
  - a Ready/cordoned badge
  - a pod count bar
  - pod dots coloured by status: green for Running and ready, yellow for Pending or not ready, red for failed or CrashLoop, gray for Terminating. Each dot is a `button` with an `aria-label` that opens the pod drawer.
  - the restart sum
- An "Unscheduled" card lists pending pods with the scheduler message.
- Risk banners sit above the columns.
- If nodes are `forbidden` or `error`, pods are still grouped by `nodeName` with zone "Unknown", and the section's `SectionUnavailable` message is shown as an info line.

**SchedulingConstraints.** Shows:

- `nodeSelector` chips
- required/preferred node affinity as readable expressions (`zone In [a,b]`, weight)
- pod affinity/anti-affinity (topologyKey + selector)
- tolerations (`key=value:effect`, `Exists`, tolerationSeconds)
- TSCs (`maxSkew`, `topologyKey`, `whenUnsatisfiable`, `minDomains`)
- `priorityClassName`, `schedulerName`, `runtimeClassName`, `terminationGracePeriodSeconds`

Raw JSON goes in a collapsible `<pre className="font-mono text-xs">`. It serializes only an object picked from the scheduling fields: `nodeSelector`, `affinity`, `tolerations`, `topologySpreadConstraints`, `priorityClassName`, `schedulerName`, `runtimeClassName`, `terminationGracePeriodSeconds`. It never serializes the whole `template.spec`, which would expose unmasked env literals and bypass §5.5.

**DeploymentPodsTable**

- Columns:
  - Name
  - Status (theme status map)
  - Ready `x/y`
  - Restarts: yellow above 0, red at 5 or more, with the `lastTerminationReason` in the `title`
  - Node
  - Pod IP (mono)
  - Age (`TimeAgo`)
  - Revision: `#n` via `buildRevisionByHash`, or "?"
  - QoS
  - CPU and Memory
  - Actions: a Logs icon button that calls `stopPropagation` then `onOpenPodLogs(pod)` (§6.1 "Logs")
- Rows are pre-mapped once with `useMemo` to `{ ...summary, status: displayStatus, age: createdAt, cpu: podMetrics[name]?.cpu, memory: podMetrics[name]?.memory }`. The `cpu` and `memory` keys are `undefined` when metrics are absent. This lets `useResourceSorting`'s `name`, `status`, `restarts`, `age`, `cpu` and `memory` comparators apply. Missing cpu/memory render "–" and sort as 0 (the same as the Pods view), via `useResourceSorting` unchanged.
- Revision, QoS, Node and Pod IP are `sortable: false`.
- The table uses `VirtualizedTable` inside a container of height `min(40 + rows × 52, 520)` px, because AutoSizer needs an explicit height.
- Row click: `onResourceClick({ name, namespace }, 'pod')`.

**ContainersSection / ContainerCard**

- Groups appear in the order Init, Sidecars, Containers.
- Each card contains:
  - name and kind badge
  - the image split into registry/repository/tag/digest (`font-mono`), with `:latest` and "no tag" flags in yellow
  - running digest(s)
  - the effective pull policy
  - a ports table: name, containerPort, protocol, and hostPort (warn)
  - command and args (mono, wrapped)
  - an env table: name, source badge and display. `secretKeyRef` shows a `Key` icon with "secret name / key". Masked literals show `MASK` with the title "Value hidden: looks sensitive".
  - envFrom
  - volume mounts: path, volume name and type, RO badge
  - resources, using the visual style of `ContainerResources`, with inline missing flags
  - probes and lifecycle hooks
- Main containers are expanded by default. The rest are collapsed.

**SecurityPosture**

- Top row:
  - The PSS level badge: Restricted green, Baseline yellow, Privileged red, labelled "approx.".
  - The namespace PSA enforce label when `namespace` is ok.
  - "New pods would be rejected by namespace enforcement" when `pssLevel` is below the enforced level.
  - pass/warn/fail/info counts.
- Then the pod-level checks.
- Then a per-container matrix:
  - Rows are check ids, columns are containers, and cells are `LevelBadge`s.
  - Badges always pair an icon (`CheckCircle2`, `AlertTriangle`, `XCircle`, `Info`) with text.
  - Each cell's `title` shows the detail, the value source and "PSS <profile>" when `pssViolation`.
  - Rows with multiple per-cap checks collapse into one "Added capabilities" row whose cell shows the worst level and lists the caps.

**NetworkingSection**

- Services table: name (clickable), type, clusterIP, and the port mapping `port → targetPort → container:containerPort (name)`, warned when unresolved. Also LoadBalancer ingress hostname/IP and NodePort.
- Ingress routes: host, path, a TLS lock, class, and service:port.
- NetworkPolicies: name, types, rule counts, default-deny badges and the "no policies" info line.
- Each sub-list handles its own `SectionResult`.

**ConfigStorageSection**

- ConfigMap references by name, clickable, with "via" chips.
- Secret references, names only and **not clickable**, with "via" chips (including `imagePullSecrets`).
- A volumes summary. hostPath is shown in red.
- A PVC table: claim, phase, class, capacity and access modes. A missing claim shows a red "Not found".

**EventsSection**

- A `ToggleGroup` for All/Warnings.
- List rows styled like `ResourceEvents`, each with an involved-object chip such as `ReplicaSet/web-6d4f`.
- 20 per page.
- The section `note` (missing RS or pods) renders through `SectionShell`.

**OverviewSection.** Labels are shown verbatim. Annotations go through `displayAnnotations`, so `last-applied-configuration` renders as `(N bytes, hidden; use Edit YAML)` in gray italics.

## 7. Theme and accessibility

**Surfaces and buttons**

- Panels: `bg-white/5 border border-white/10 rounded-xl`.
- Hover: `hover:bg-white/10`.
- Hover cards: `bg-[#1e1e1e]`.
- Section headers: `text-2xl font-bold text-white` with the `w-1 h-8 bg-orange-500 rounded-full` bar.
- `GlassButton`: primary for Refresh and Scale, secondary for Back.
- Restart uses the existing orange accent pattern from the drawer.

**Status colour classes** come from static maps (`STATUS_CLASSES: Record<'green'|'yellow'|'red'|'blue'|'gray', string>`), not template-literal classes, so Tailwind purge keeps them.

**Text.** IDs, IPs, images and hashes use `font-mono`. Labels are `text-xs text-gray-400`. Body text is `text-sm text-gray-300`.

**Motion.** Framer Motion handles collapses and hover cards. `useReducedMotion()` disables the transforms.

**Accessibility**

- Every icon-only button has an `aria-label`.
- Each section is a `<section aria-labelledby>`.
- The timeline keyboard model is described in §6.3.
- Focus rings use `focus-visible:ring-2 focus-visible:ring-blue-500/50`.
- Status is never conveyed by colour alone.
- Disabled toggle options carry `aria-disabled`.
- Full WCAG conformance needs manual testing with assistive technology and an expert review.

**Z-index.** The sticky nav is `z-10`, hover cards are `z-50`, and modals stay at `z-[200]`.

## 8. Performance

- Nothing is fetched until the tab opens, and each load is one IPC round trip.
- The fetch makes no cluster-wide lists. Node and PVC reads are individual, capped, run at concurrency 8, and have deadlines.
- Utilities run once per `details` change via `useMemo`. Sections are `React.memo`. Callbacks are stable, including the latest-ref `onNavigate`.
- Monaco and Topology mount on demand. The pods table is virtualized.
- There are no intervals. Refresh fires only when the watcher's rv changes, debounced to 1.5 s, or when the user refreshes manually.
- **Worst-case first-load latency.** The page renders after the single aggregate call resolves, and each `settle` timeout covers one API call only. The longest chain is deployment (20 s) → RS (15 s) → pods (15 s) → max(events 15 s, metrics 15 s, nodes phase 20 s), about 70 s of skeleton against an unresponsive API server. This is accepted: the per-section default stays at 15 s because slow-but-healthy list calls on large namespaces can exceed 10 s, and the 20 s phase-1 timeout already fails fast when the API server is down entirely. Typical loads are one to two seconds.

## 9. Testing

**Unit tests** (vitest `*.test.ts`, fast-check where noted)

- **`label-selector-utils.test.ts`**
  - each operator
  - nil vs empty semantics
  - property: labels ⊇ matchLabels ⇒ match
- **`deployment-history-utils.test.ts`**
  - ordering with null revisions
  - current-revision detection: annotation, then hash fallback using pods, then highest
  - `revision-history` parsing
  - `revisionToYaml` key order matches the old modal output on a fixture
  - `revisionToYaml` masks sensitive env
  - `revisionEntryToYamlInput` includes `selector`
  - `eventsForRevision`: uid match; token match; quoted (`"web-6d4f"`) and punctuated (`web-6d4f,`, `web-6d4f.`) names match; **`web-6d4f` does not match a message naming `web-6d4f9`**; RS names containing regex metacharacters are escaped; union is deduplicated
- **`deployment-log-utils.test.ts`**
  - `toLogTarget` puts main containers in `spec.containers` and init + sidecar containers in `spec.initContainers`
  - a pod with an empty `containers` list falls back to template names
  - `firstMainContainerName` skips init/sidecar entries; falls back to the template's first container; returns `''` when neither exists
- **`pod-template-diff-utils.test.ts`**
  - **sensitive env changed** (`DB_PASSWORD` a → b): one change, label `env DB_PASSWORD changed (value hidden)`, `before`/`after` both `MASK`; unchanged sensitive value yields no change
  - property: `diffPodTemplates(t, t)` is empty
  - image change label
  - env added/removed/changed, with masking
  - `restartedAt` change
  - container moved between init and main
  - `summarizeChanges` truncation
- **`security-posture-utils.test.ts`**
  - **all 6 runAsRoot truth-table rows**, including `runAsUser:1000` with runAsNonRoot unset (pass, `pssViolation`), and explicit `runAsNonRoot:false`
  - pod/container override precedence
  - privileged → `'privileged'`
  - a fully restricted template → `'restricted'`
  - `CHOWN` added → warn, `'baseline'` level
  - `NET_RAW` → warn, `'privileged'` level
  - `SYS_ADMIN` → fail
  - `NET_BIND_SERVICE` → pass
  - AppArmor `Unconfined` from the annotation → fail
  - SELinux `type: spc_t` → fail
  - unsafe sysctl → fail
  - nfs volume → restricted violation
  - sidecar detection
  - automount precedence: pod over SA
- **`pod-distribution-utils.test.ts`**
  - property: grouped + unscheduled == input count
  - each risk rule
  - hostname TSC uses `node.hostname` when it differs from `nodeName`, and falls back to `nodeName` when the summary is missing
  - missing node summaries
- **`container-insights-utils.test.ts`**
  - `parseImageRef` for `nginx`, `nginx:1.25`, `ghcr.io/o/r:tag@sha256:…`, `localhost:5000/r` and `r@sha256:…`
  - flags
  - named-port probe
  - `secretKeyRef` display carries no value
- **`networking-utils.test.ts`**: numeric, named and unset targetPort; ingress default backend and rules.
- **`deployment-rollout-utils.test.ts`**: defaults, stalled, complete, paused, HPA and PDB.
- **`sensitive-value-utils.test.ts`**
  - name and value heuristics
  - input not mutated
  - `displayAnnotations` hides `last-applied-configuration` with the correct byte count (including a multi-byte character) and leaves others verbatim
  - `displayAnnotations` with `strippedBytes` and the key absent emits one hidden placeholder with the given count; with the key present too, emits it once
- **`view-labels.test.ts`**
  - build/parse round-trip (fast-check over DNS names)
  - malformed ids → null
  - labels
- **`electron/deployment-full-details.test.ts`** (mocked clients)
  - deployment 404 → `found:false`
  - services 403 → only services `forbidden`
  - uid ownership excludes orphans with the same name
  - RS failure → pods `ok` with the ownership `note`; events `note`
  - events: an **eventTime-only event** (null `lastTimestamp`/`count`, a `series`, `reportingController`) maps to non-null `lastTimestamp`, count from series (or 1) and source; sorting; cap at 300
  - **`pickPodMetrics` with a `ns/name`-keyed Map** returns a pod-name-keyed record and ignores other namespaces' entries
  - managedFields stripped; `kind` defaulted
  - **`last-applied-configuration` is absent from `details.deployment` and `lastAppliedBytes` equals its UTF-8 length** (multi-byte fixture); `lastAppliedBytes` is `null` when the annotation was never set
  - **`settle` call sites:** ServiceAccount 404 → `ok` with `exists:false`; one PVC 404 among three → `ok` with that claim `found:false` and no partial-failure `note`; HPA list 404 → `error` "autoscaling/v2 API not available"; `settle` with no `onNotFound` maps 404 to `error` "…not found (API not available?)"
  - **no Secret API method invoked**
  - 401 rethrows, for a numeric `code: 401` and for a message-only `"Unauthorized"` error (`classifyK8sError` → `'unauthorized'`)
  - `filterHpa` call site keeps only the HPA whose `scaleTargetRef` names this deployment
  - node partial failure → `note`; first node 403 stops further reads (assert call count ≤ concurrency) → `forbidden`; overall node deadline → `error` (fake timers), **and with 40 hanging node reads no new `readNode` call starts after advancing past 20 s** (call count stays at the concurrency limit)
  - PVCs are read in phase 2 even when nodes hang
  - `mapWithConcurrency` honours `shouldStop`
- **`useDeploymentFullDetails` trigger logic.** The rv-change decision is extracted as a pure function so it can be tested without React testing library:

  ```ts
  export function decideLiveRefresh(prev: { lastLiveRv?: string; hadLive: boolean }, liveRv: string | undefined,
    fetchedRv: string | undefined): { action: 'none' | 'debounce'; next: { lastLiveRv?: string; hadLive: boolean } }
  ```

  `'immediate'` is removed: no live transition fetches without the 1500 ms debounce. (Manual Refresh and post-action refreshes call `refresh()` directly and don't go through this function.)

  It lives in `src/hooks/live-refresh-decision.ts` and is tested in `live-refresh-decision.test.ts`. Cases:
  - first observation → none
  - same rv → none
  - new rv equal to fetched → none
  - new rv different → debounce
  - present → absent → **debounce** (not immediate; covers watcher re-seed)
  - present → absent → present (re-seed) → the reappearance is a first observation → none
  - a lagging watcher (fetched rv newer and still differing) never triggers twice for the same live rv

  The effect in §4 delegates to this function.

  `shouldApplyResponse` (same file) cases:
  - latest id, same key, mounted → true
  - older id → false
  - **same id but a different key (stale response from a previous cluster) → false**
  - unmounted → false

  The hook's cache write is keyed by the captured `reqKey`; the manual check "switch cluster while a deployment tab is loading" (below) covers the end-to-end path.

**Integration and manual checks.** There's no React testing library, and vitest only includes `*.test.ts`. Against a kind/EKS cluster:

- The drawer button and the row action both open the tab.
- Opening the same deployment twice dedupes to one tab.
- Back works.
- Switching between two deployment tabs resets the local UI.
- With the same `<ns>/<name>` deployment tab open in two clusters, switching clusters while the page is loading never shows the other cluster's data (in DevTools, the rendered `details.context` always equals the selected cluster).
- Logs from a multi-container pod (sidecar or init) lists every container in the LogViewer selector.
- An image rollout updates live with no repeated fetches (DevTools IPC log).
- A rollback shows the rolled-back icon.
- A namespace-scoped RBAC user gets nodes/namespace "Not available" while the rest renders.
- HPA warning line, PDB card, multi-zone spread.
- `:latest` is flagged, and a privileged sidecar is flagged.
- Secret env refs show names only, and `last-applied-configuration` is hidden.
- Both ToggleGroups animate independently.
- The Pop-out modal and the drawer diff still work.
- Safe Mode blocks Scale/Restart.
- Keyboard navigation through the timeline.

**Build gates:** `npm run lint`, `npx tsc --noEmit`, `npx vitest run`.

## 10. File list

**New**

- `src/types/deployment-details.ts`
- `electron/deployment-full-details.ts`, `electron/deployment-full-details.test.ts`
- `src/hooks/useDeploymentFullDetails.ts`, `src/hooks/live-refresh-decision.ts`, `src/hooks/live-refresh-decision.test.ts`
- In `src/utils/`, each with a `.test.ts`:
  - `label-selector-utils.ts`
  - `deployment-history-utils.ts`
  - `pod-template-diff-utils.ts`
  - `security-posture-utils.ts`
  - `pod-distribution-utils.ts`
  - `container-insights-utils.ts`
  - `sensitive-value-utils.ts`
  - `networking-utils.ts`
  - `deployment-rollout-utils.ts`
  - `deployment-log-utils.ts`
- `src/utils/view-labels.test.ts`
- In `src/components/dashboard/views/deployment-details/`:
  - `DeploymentFullView.tsx`, `DeploymentHeader.tsx`, `SectionNav.tsx`, `SectionShell.tsx`, `OverviewSection.tsx`
  - `RevisionTimeline.tsx`, `RevisionDetailPanel.tsx`, `RevisionDiffEditor.tsx`
  - `RolloutSection.tsx`, `PodDistribution.tsx`, `SchedulingConstraints.tsx`, `DeploymentPodsTable.tsx`
  - `ContainersSection.tsx`, `ContainerCard.tsx`, `SecurityPosture.tsx`
  - `NetworkingSection.tsx`, `ConfigStorageSection.tsx`, `EventsSection.tsx`

**Modified**

- `electron/k8s.ts`: one method.
- `electron/main.ts`: one handler.
- `electron/preload.ts`, `electron/electron-env.d.ts`, `src/vite-env.d.ts`.
- `src/utils/view-labels.ts`.
- `src/components/dashboard/ViewTabBar.tsx`, `DashboardHeader.tsx`, `DashboardContent.tsx`, `views/DeploymentsView.tsx`.
- `src/components/Dashboard.tsx`.
- `src/App.tsx`: sidebar active normalization.
- `src/components/shared/ToggleGroup.tsx`: `disabled`/`title` and the unique `layoutId`.
- `src/components/resources/details/RevisionDiffModal.tsx`: new `left`/`right` prop contract, using the shared `revisionToYaml`.
- `src/components/resources/details/DeploymentDetails.tsx`: builds `RevisionDiffSide`s for the modal.

## 11. Assumptions and open questions

1. **"Full tab" means a `ViewTabBar` tab that renders a full page**, reusing the Helm detail pattern. `BottomPanel` is not used.
2. **Entry points.** A labelled "Full View" button sits in the drawer header next to Scale/Restart, and there's a row icon in the Deployments list. A more prominent in-content `GlassButton` at the top of `DeploymentDetails` could be added later as a prop-only change.
3. **Secret references are not clickable**, so the page can never navigate into a view that renders secret data. Open: should they link to the existing Secret drawer?
4. **Sensitive-looking literal env values are masked with no reveal.** Non-sensitive literals are shown. Open: should all literals be hidden by default?
5. **Live refresh follows deployment object changes only.** Pod-only changes need the Refresh button.
6. **Revision history is bounded by `revisionHistoryLimit`** and by rollback renumbering. A complete audit trail would need audit logs and is out of scope.
7. **The PSS level is an approximation** and is labelled as such. Windows `hostProcess` and version-specific seccomp details aren't modelled.
8. **The timeline is evenly spaced**, not time-proportional.
9. **Out of scope:**
   - Explain-with-AI on the page
   - Delete from the page
   - Rollback-to-revision (a new MUTATE channel; good follow-up)
   - StatefulSet/DaemonSet equivalents
   - Metrics history charts
10. **Clusters older than 1.23** without autoscaling/v2 show HPA as "not available".
11. **`last-applied-configuration` is stripped in main.** Edit YAML re-fetches from the cluster (`App.handleOpenYaml` → `getResourceYaml`), so no consumer needs it. Only its byte count (`lastAppliedBytes`) reaches the renderer.
12. **`ApiException.code` carries the HTTP status for 403/404 on every API group** in client-node 1.4 (existing code relies on it for 401). `classifyK8sError` also checks `statusCode` and `response.statusCode`, and its tests cover each shape.
13. **The sticky `SectionNav` pins correctly** inside the `p-6` content scroller without overlapping `DashboardHeader`. This needs a visual check at implementation time. If it overlaps, use `top-[-1.5rem]` to offset the padding.
14. **File sizes.** `DeploymentFullView.tsx`, `security-posture-utils.ts` and the aggregator are estimated at 350–380 lines. If any goes past 500 at implementation time, split it: derived-data memos go to `useDeploymentDerivedData.ts`, per-check evaluators go to `security-checks.ts`, and phase-2 fetchers go to `deployment-full-details-fetchers.ts`.

## 12. Responses to design review (revision 2)

| # | Finding | Resolution |
|---|---|---|
| 1 | Runs-as-root table incomplete; PSS tag wrong | **Addressed** (§5.3). Exhaustive 6-row table on effective values, first match wins, all rows tagged `pss:'restricted'`. Chose the `pssViolation: boolean` approach; `pssLevel` is computed only from it (`computePssLevel`). All six rows are tested. |
| 2 | PSS caps/AppArmor/SELinux gaps | **Addressed** (§5.3). Added `BASELINE_ALLOWED_CAPS` and `DANGEROUS_CAPS` with per-cap rules (`evaluateAddedCapability`), AppArmor and SELinux checks (with `BASELINE_SELINUX_TYPES`), and `seLinuxOptions` in `EffectiveContainerSecurity`. Also made sysctls (`BASELINE_SAFE_SYSCTLS`) and restricted volume types explicit, so the "approximate" caveat narrows. |
| 3 | `ok` variant has no note | **Addressed** (§3.1, §6). `note?: string` on `ok`. It's set for pods (ownership approximate), nodes and PVCs (partial) and events (missing uid sets). Rendered by `SectionShell`/`SectionNote`. |
| 4 | Metrics map keyed `ns/name` | **Addressed** (§3.3). `pickPodMetrics` looks up `${namespace}/${pod.name}` and emits `Record<podName,…>`. The type is documented and tested. |
| 5 | events.k8s.io mapping | **Addressed** (§3.3). `toDeploymentEvent` uses the specified fallbacks for timestamps, count and source. An eventTime-only test is included. |
| 6 | Refetch loop on rv mismatch | **Addressed** (§4). Triggers only on a change of the live rv against the last observed value, and is skipped if it equals the fetched rv. The ref is reset on key change. The logic is extracted to `decideLiveRefresh` and unit tested, including the lagging-watcher case. |
| 7 | Conditional hooks in `DashboardContent` | **Addressed** (§2.2). All hooks are declared at the top level after `podStatusStats` and before the first route; the branch only consumes values. |
| 8 | ToggleGroup lacks disabled; shared layoutId | **Addressed** (§6.5). `disabled`/`title` on `ToggleOption`, `useId`-based `layoutId`. `ToggleGroup.tsx` is added to the modified list. |
| 9 | Pop-out modal prop mismatch | **Addressed** (§6.4). The modal takes `{left, right}: RevisionDiffSide`. `DeploymentDetails.tsx` builds the sides and is now in the modified list. `RevisionEntry.selector` is added, with `revisionEntryToYamlInput`. |
| 10 | `last-applied-configuration` leaks masked values | **Addressed** (§5.5, §6.6). `HIDDEN_ANNOTATIONS` and `displayAnnotations` show a byte count, applied to the deployment and RS annotation displays, and tested. *(Rationale for keeping it in main superseded in revision 3, finding 2: it is now stripped in main.)* |
| 11 | `onOpenFullView` not stable | **Addressed** (§2.2). Latest-ref `onNavigateRef`; the callbacks have empty deps. |
| 12 | Phase 3 deadline; PVCs placement | **Addressed** (§3.3). 20 s overall node deadline, a 10 s per-node timeout, a short-circuit on the first 403 via `shouldStop`, and PVCs moved to phase 2. |
| 13 | Events filter fallback | **Addressed** (§3.3). Filters by the available uid sets and sets a `note` when RS or pods are missing. |
| 14 | History utils > 500 lines | **Addressed** (§5.2). `diffPodTemplates` and `summarizeChanges` moved to `pod-template-diff-utils.ts`, with their own tests. |
| 15 | Pods table cpu/memory sort keys | **Addressed** (§6.6). Rows map `cpu`/`memory` from `podMetrics` (`undefined` when absent). Non-numeric columns are `sortable:false`. |
| 16 | HPA warning in tooltip | **Addressed** (§6.1). An inline `text-xs text-yellow-400` line under the header actions. |
| 17 | Component instance reused across tabs | **Addressed** (§2.2). `key={activeView}`. |
| 18 | Same-context claim overstated | **Addressed** (§3.4). Reworded to "same as existing methods", noting the shared `KubeConfig` interleaving risk as pre-existing. |
| — | Unverified: GET response includes `kind` | **Addressed** (§3.3). The aggregator defaults `kind`/`apiVersion` after `toPlain` and tests it. |

## 13. Responses to design review (revision 3)

All 16 findings are addressed. None are backlogged or ignored. Findings 2, 3 and 8 were re-checked against source (`App.handleOpenYaml` re-fetches via `getResourceYaml`, `useResourceSorting` parses missing cpu/memory as 0, and `ScaleModal` seeds `useState(currentReplicas)` once).

| # | Finding | Resolution |
|---|---|---|
| 1 | `settle()` loses 404 classification | **Addressed** (§3.3). `settle(p, label, opts?: { timeoutMs, onNotFound })` with the full classification → result mapping written out. `onNotFound` is specified at the ServiceAccount (`exists:false`), PVC (`found:false`) and HPA ("autoscaling/v2 API not available") call sites. `toSaSummary`, `toPvcSummary` and `filterHpa` are exported. One test per call site, plus the default-404 case (§9). |
| 2 | Wrong rationale for keeping last-applied | **Addressed** (§3.1, §3.3, §5.5, assumption 11). Stripped in main after `toPlain` (deployment and owned RSs). `lastAppliedBytes` added to `DeploymentFullDetails`. `displayAnnotations` gains `opts.strippedBytes`. `LAST_APPLIED` constant is shared from `sensitive-value-utils.ts`. Aggregator and util tests added. |
| 3 | "Sort last" contradicts `useResourceSorting` | **Addressed** (§6.6). Missing cpu/memory render "–" and sort as 0 through the unchanged hook. |
| 4 | Node reads continue after deadline | **Addressed** (§3.3). `timedOut` flag set by a 20 s timer, `shouldStop: () => sawForbidden \|\| timedOut`, `clearTimeout` in `finally`. Fake-timer test asserts no new reads start after the deadline. |
| 5 | Env diff raw vs masked | **Addressed** (§5.2, §6.4). Compare raw, display `MASK`; label `env X changed (value hidden)`. The diff editor notes when hidden changes exist, since both Monaco sides are masked. Test added. |
| 6 | Substring match in `eventsForRevision` | **Addressed** (§5.1). Token-boundary regex with an escaped RS name, built once per call. Tests for prefix collision and metacharacters. |
| 7 | `SectionShell` children / cluster scope | **Addressed** (§6). `children: ReactNode \| ((data: T) => ReactNode)` with explicit resolution rules; `scope?: 'namespace' \| 'cluster'` and an explicit `namespace` prop drive the forbidden message. |
| 8 | `ScaleModal` stale initial value | **Addressed, with a deviation** (§6.1). Mounted only while open, which alone guarantees a fresh initial value per open. The suggested `key={details.fetchedAt}` is **not** used: a live refresh during an open modal would remount it and discard the user's typed value. |
| 9 | "Revision Revision 7" | **Addressed** (§6.4). `label` is the full string; subtitle `{left.label} → {right.label}`, column headers `{side.label} · date`. |
| 10 | Action column `dataKey` | **Addressed** (§2.2). `{ label: '', dataKey: 'actions', sortable: false, width: 44, flexGrow: 0, compact: true, cellRenderer }`. |
| 11 | `DrawerRevision` undefined; loose `container` | **Addressed** (§6.4, §5.3). `DrawerRevision` defined in `DeploymentDetails.tsx`; parameter typed `Jsonified<V1Container>`. |
| 12 | Cache not evicted | **Addressed** (§4). Explicit eviction rules: delete on `found:false` and on a fatal first-load error; keep on a failed refresh; re-insert on success for LRU order. |
| 13 | Ambiguous inline toggle | **Addressed** (§6.4). Always-visible "Side by side / Inline" `ToggleGroup`; initial value from `matchMedia('(min-width: 1024px)')` once on mount. |
| 14 | Hostname TSC domain | **Addressed** (§3.1, §3.3, §5.4). `NodeSummary.hostname`; domain key `node?.hostname ?? nodeName`. Test added. |
| 15 | Re-seed spurious refetch | **Addressed** (§4, §9). present → absent now debounces; `decideLiveRefresh` drops `'immediate'`. Test cases updated, including the absent → present re-seed sequence. |
| 16 | `DeploymentEvent.type` collapses | **Addressed** (§3.1). `type: string` with a comment. |

The review's unverified runtime assumptions (`ApiException.code` shape, sticky nav pinning, file-size estimates) are recorded as assumptions 12–14 in §11, each with a check or fallback.

### 13.1 Responses to design review of revision 3 (changes in revision 4)

Both MEDIUM findings and all 9 NITs are addressed. Nothing is backlogged or ignored. `App.handleOpenLogs` (App.tsx 843–852) was re-read to confirm it derives `allContainers` from `pod.spec`.

| # | Finding | Resolution |
|---|---|---|
| 1 | MEDIUM: cross-cluster race on same-key remount | **Addressed, both parts** (§2.2, §4, §9). (1) The component key is `${clusterName}\|${activeView}`, so a cluster switch always remounts and the old instance's response is dropped by `mountedRef`. The view id stays `deployment-detail/<ns>/<name>` because tabs are already stored per cluster. (2) Defence in depth: each fetch captures `(id, reqKey)`, writes the cache under the captured `reqKey`, and applies state only via `shouldApplyResponse` (id, key and mounted all match). Coalescing is per key. The key-change reset bumps `requestIdRef`, clears `pendingRef` and the debounce, and logs a dev `console.error`. `shouldApplyResponse` is a pure function with a "same id, different key → false" test. |
| 2 | MEDIUM: Logs loses container selection | **Addressed, with a deviation** (§3.3 `summarizePod`, §6.1, §6.6, §9). New pure `deployment-log-utils.ts` with `toLogTarget` and `firstMainContainerName`; the prop is typed with `LogTarget`. One `handleOpenPodLogs` in the container feeds the pods table and pod dots. Deviation from the suggested snippet: sidecars go into `spec.initContainers`, not `spec.containers`, because that's where they live in the pod spec. LogViewer only uses the names, so either works, but this keeps the shape truthful. `summarizePod` now emits one entry per spec container (not only those with statuses), so Pending pods still list every container; there's also a template fallback. |
| 3 | NIT: `.then(filterHpa)` | **Addressed** (§3.3). `.then(list => filterHpa(list, name))`, plus a test. |
| 4 | NIT: §4 effect duplicates `decideLiveRefresh` | **Addressed** (§4). The effect body calls `decideLiveRefresh` and stores `next`; the inline version is labelled as commentary only. |
| 5 | NIT: token boundary misses quoted names | **Addressed** (§5.1, §9). Regex is `(^\|[\s"'(])name($\|[\s"',.:)])`. Quoted and punctuated tests added; the `web-6d4f9` negative case is kept. |
| 6 | NIT: `classifyK8sError` 401 diverges from `is401Error` | **Addressed** (§3.3, §9). Also matches `/\b401\b\|Unauthorized/` on the message. Message-only 401 test added. |
| 7 | NIT: metrics can't report `forbidden` | **Addressed** (§3.3). UI text is now "Metrics unavailable (metrics-server missing or no permission)". `getPodMetrics` is unchanged. |
| 8 | NIT: worst-case latency unstated | **Addressed** (§3.3, §8). Each `settle` timeout covers one call; the ~70 s bound is documented. The optional reduction to 10 s is **not** taken, because slow-but-healthy lists on large namespaces can exceed 10 s and would become false section errors. |
| 9 | NIT: Raw JSON scope | **Addressed** (§6.6). It serializes only the eight listed scheduling fields, never `template.spec`. |
| 10 | NIT: action column without handler | **Addressed** (§2.2). Appended only when `onOpenFullView` is defined. |
| 11 | NIT: `DrawerRevision.creationTimestamp` type | **Addressed** (§5.1, §6.4). `string \| Date` on `DrawerRevision` and `RevisionYamlInput.createdAt`. The value goes to `revisionToYaml` unchanged, which keeps drawer YAML byte-identical. `String(...)` is used only for the display `createdAt` on `RevisionDiffSide`. |



