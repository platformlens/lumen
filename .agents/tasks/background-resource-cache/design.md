# Design: Background Resource Cache (always-loaded core kinds)

Revision 4 (amended). This revision resolves the 15 findings of the third review (rev-3 review: 1 HIGH, 5 MEDIUM, 9 NIT); responses are in §14.2. The amendment resolves the 2 findings of the rev-4 review (1 MEDIUM, 1 NIT); responses are in §14.2.1. A second amendment resolves the 1 finding of the amended-rev-4 review (1 MEDIUM); the response is in §14.2.2. The approved parts of revision 3 are unchanged. The 22 second-review findings (§14.1) and the 25 first-review findings (§14.3) stay resolved.

## Overview

Switching dashboard tabs in Lumen tears down and rebuilds watchers, clears list state and refetches over IPC. The Dashboard also remounts whenever the user opens Settings, the editor or the user view. This design moves ownership of six core kinds (Deployments, Pods, Secrets, ConfigMaps, Services, Helm releases) out of React component state and into a main-process `WatchManager`. The `WatchManager` keeps one list+watch session per connected cluster for the life of the connection. The renderer receives a snapshot plus coalesced deltas and stores them in a normalized zustand store (`src/stores/resourceStore.ts`). Views read from that store through per-kind selectors, so switching tabs is a pure re-render: no IPC call, no watch restart and no cleared state. Every push event carries a session id and a sequence number, so late events from an old cluster or an old watcher are dropped. Every async continuation in main checks a per-attempt epoch, so a stopped watch can never leave a live socket. Leak checks are measurable through a diagnostics IPC call.

Locked technology stack (no new dependencies):
- Electron 42.2.0. The steering file says 40.x, but `package.json` pins `^42.1.0`.
- React 18, TypeScript 5 strict, Vite 5.
- `@kubernetes/client-node` 1.4.0: `Watch`, typed `CoreV1Api`/`AppsV1Api` list calls, and `makeInformer` in the existing pod worker.
- zustand 5.0.13, already a dependency. `useShallow` comes from `zustand/react/shallow`.
- zod, for IPC validation through the existing `electron/ipc/validation.ts` (`safeHandle`).
- vitest 4 and fast-check, for tests (`**/*.test.ts`).

---

## 1. Root cause of reload-on-switch

The findings below come from reading the code. I have **not** seen the behavior at runtime. The implementer must reproduce it before the change and verify it again afterwards (§11).

1. **The generic watcher effect is keyed on `activeView` and clears state on every switch.** The "Config Resource Watcher Effect" in `src/components/Dashboard.tsx:391-725` depends on `[clusterName, selectedNamespaces, activeView, watchEpoch]` (line 725). Each time it fires, it:
   - wipes the target list (`config.setter(() => [])`, line 611);
   - starts `watchGenericResource` again. That is a fresh watch with no resourceVersion (`electron/k8s.ts:2203-2287`; `stopGenericWatch` deletes the rv at line 2297), so the server replays a synthetic ADDED for every object;
   - stops every watcher it started when it cleans up (lines 717-722).

   Secrets, Services and ConfigMaps all take this path (`RESOURCE_WATCH_MAP` line 555; secrets are also in `WORKER_BATCH_TYPES`, line 641). Leaving the Secrets tab and coming back always goes empty → skeleton → full replay.
2. **`loadResources()` refetches on every view change.** The effect at `Dashboard.tsx:982-984` depends on `[clusterName, selectedNamespaces, activeView]` and calls `getServices` (805-811) and `getConfigMaps` (925-931) each time those tabs open. That runs at the same time as the watcher replay, so every switch fetches two full lists.
3. **`watcherReady` is reset on every view change** (`Dashboard.tsx:180-184`). The Secrets and PVC views show a skeleton while `secrets.length === 0 && !watcherReady` (`DashboardContent.tsx`, Secrets branch).
4. **The Dashboard unmounts when the main menu changes.** `src/App.tsx:1697-1763` renders `<Settings/>`, `<AuthView/>` or the editor *instead of* `<Dashboard/>`. Coming back mounts it again. All ~35 `useState` lists start empty, and every watcher stops and restarts from scratch. That includes the deployment watcher (`useDashboardWatchers.ts:53-93`), the helm watcher (`Dashboard.tsx:354-389`) and the pod worker hook (`DashboardContent.tsx:160`, `usePodWorker.ts:94-145`).
5. **`watchEpoch` restarts every watcher** after more than 30 s of blur (`Dashboard.tsx:107-128`). It also clears deployments, helm releases and the active generic kind.

Deployments, pods and helm releases already survive tab switches, because their watchers ignore `activeView`. They still reload on Dashboard remount, on namespace change and on an epoch bump.

### Correctness and leak defects found during investigation (fixed by this design)

| # | Defect | Location |
|---|---|---|
| D1 | Deployment and Helm watches only watch `namespaces[0]` when several namespaces are selected. Data for the other namespaces is silently missing. | `k8s.ts:1176-1178`, `k8s.ts:1274-1276` |
| D2 | Watches start without a LIST. When the rv is cleared (410, or after 3 failures), the replay contains only ADDED events, so objects deleted during the gap stay in renderer state forever. | `k8s.ts:1109-1114`, `2253-2262`; renderer merge at `Dashboard.tsx:666-690`, `useDashboardWatchers.ts:66-80` |
| D3 | Generic watch events carry only `resourceType` (for example `"secrets"`). Main already drops late watcher events by generation (`main.ts:2083, 2110`; `k8s.ts:2223`). However, an event **already in IPC flight** when cluster A's watch stops is accepted by cluster B's listener for the same key. | `main.ts:2111`, `Dashboard.tsx:686-708` |
| D4 | Raw objects, including `managedFields` and full Secret `data`, go to the renderer on `k8s:genericResourceChange` for every event, even for worker-batched kinds. `k8s:deploymentChange` and `k8s:podChange` do the same and have no renderer consumers. | `main.ts:2111`, `main.ts:2013`, `main.ts:1956` |
| D5 | On `start-informer`, the pod worker stops the old informer and then *flushes* its pending deltas before the new informer starts, so the old session's deltas are delivered as if they were current. It also never restarts an informer after `error`. | `k8s-pod-worker.ts:141-146`, `193-201` |
| D6 | `app.onWindowFocused` registers an anonymous listener whose disposer calls `removeAllListeners`, which removes every subscriber. | `preload.ts:417-422` |
| D7 | Secret list items keep `metadata.annotations['kubectl.kubernetes.io/last-applied-configuration']`, which contains the Secret's base64 data. | `resource-transform-worker.ts:157-169` |
| D8 | A Helm release DELETED event for the stored revision removes the whole release, even when older revisions still exist (`--keep-history`, or a manual delete of the latest secret). | `src/utils/helm-release-utils.ts:47-51` |
| D9 | When the transform worker hits `error` or `exit`, it sets `transformWorker = null` but never resolves `pendingTransforms`. Those promises hang forever and keep their resolver closures and payloads alive. | `main.ts:263-290` |

---

## 2. Architecture

```
 main process                                                         renderer
┌────────────────────────────────────────────────────┐            ┌──────────────────────────────┐
│ WatchManager (electron/resource-cache/)             │  invoke    │ useResourceSync (App.tsx)    │
│  lastNamespaces (manager-level, default ['all'])    │◄───────────│  startSession / setNamespaces│
│  session { id, context, kc, kcEpoch, seq, stopped } │            │  reqToken guard              │
│  ├ ListWatchStream deployments ─┐ trimmed Maps      │ resources: │                              │
│  ├ ListWatchStream services     │                   │  batch     │ resourceStore (zustand)      │
│  ├ ListWatchStream configmaps   ├─► Coalescer ──────┼──────────► │  kinds[k].byId: Map          │
│  ├ ListWatchStream secrets ─► HelmIndex ─┘ (650 ms) │ (sid, seq) │  kinds[k].status             │
│  └ PodWorkerAdapter ◄─► k8s-pod-worker (utility)    │            │                              │
│ contextEngine ◄─ LIST items + raw Deployment events │            │ Connected*View ─ selectors   │
└────────────────────────────────────────────────────┘            └──────────────────────────────┘
```

### Key decisions

**The main process owns the cache and the renderer mirrors it.** Two alternatives were rejected:
- A renderer-only zustand store fed by the existing watch IPC. It would still lose state on window reload or HMR, and main would still have to restart watches.
- Moving every watch into the pod utilityProcess. It breaks the steering rule that K8s calls live in the main process, and it duplicates `K8sService`'s credential refresh logic.

With the main-side cache, a reload or remount only asks for a snapshot. The watches keep running and remain the single source of truth.

**Pods stay in the existing `k8s-pod-worker` utilityProcess, and the WatchManager drives it.** Pods are the highest-volume kind, and the worker exists to keep their parsing off main (`main.ts:322-410`). `PodWorkerAdapter` (its own file) sends session-tagged lifecycle messages, forwards deltas into the shared coalescer, gets snapshots from the worker's cache, and issues a full **reset** after every informer (re)sync. The reset is how pods get the same re-list correctness as the other kinds (§3.6).

**The four main-process kinds use a hand-rolled `ListWatchStream`, not `makeInformer`.** `makeInformer`'s `ObjectCache` keeps the *raw* objects. Main would then hold every Secret's data and every Helm release blob (100 KB–1 MB each, times history). The hand-rolled stream keeps only trimmed items. It runs a paginated LIST, diffs it against its own trimmed map and emits DELETEs (fixes D2), then watches from the list resourceVersion. This matches the existing hand-rolled watch style in `k8s.ts`.

**Cluster-wide scope by default, namespaced scope as a fallback.** Core kinds are watched cluster-wide regardless of the selected namespaces, and the renderer filters by `selectedNamespaces`. `GenericResourceView` already filters at ~212-221 and `PodsView` at ~252. Changing namespaces is therefore instant, needs no watch restart, and D1 goes away. If the cluster-wide LIST returns 403, that kind switches to `namespaced` mode with one stream per selected namespace (§3.7). The default selection is already `['all']` (`Dashboard.tsx:40`), so the default memory profile does not change. See decision point 1.

**Batching moves to main at 650 ms.** A main-side `Coalescer` replaces the existing 650 ms renderer debounce (`Dashboard.tsx:698-713`). It keeps `Map<kind, Map<id, op>>` with last-write-wins per id, plus an optional per-kind reset. Every 650 ms, if there is data, it flushes **one** `resources:batch` IPC message for all kinds. The renderer applies each message in **one** zustand `set`.

**Non-core kinds stay on demand,** with two small fixes: the D3 key nonce, and map cleanup so the nonce cannot leak (§5.3). Caching them is decision point 2.

**Both pods and main streams build their KubeConfig with `loadFromDefault()`.** `K8sService` always uses `loadFromDefault` (`k8s.ts:170, 241`), and `settings:getKubeconfigPath` returns `~/.kube/config` when unset (`main.ts:2708-2711`). Passing that path to the worker would read pods from a different file than everything else whenever `KUBECONFIG=a:b` is set. The worker already falls back to `loadFromDefault` when `kubeconfigPath` is absent (`k8s-pod-worker.ts:150-155`), so the adapter never sends a path. Honoring `settings_kubeconfigPath` app-wide is out of scope.

---

## 3. Main-process design

### 3.1 Files (all new files under 500 lines)

| File | Responsibility | Est. lines |
|---|---|---|
| `electron/resource-cache/kinds.ts` | `CORE_KIND_DESCRIPTORS` (per kind: list fn, `pageSize`, watch path builder, trimmer, id fn, context-engine kind). Pure `toWireShape`, `toIso`, trimmers, `extractStatusCode` and `mapStatusToMessage`. | ~230 |
| `electron/resource-cache/list-watch.ts` | `ListWatchStream`: paginated LIST, diff, WATCH from rv, epoch guard, bookmarks, backoff, 410/401, abort, health. Injectable `listPage`/`watch`/timers for tests. | ~340 |
| `electron/resource-cache/helm-index.ts` | `HelmIndex`: picks the latest revision per release from labels, decode cache keyed by `uid@rv`, release recompute, label-derived fallback summary, guarded on-demand `readSecret` fetch (§3.5). | ~270 |
| `electron/resource-cache/coalescer.ts` | `Coalescer`: per-kind buffer, per-kind reset, 650 ms flush, `seq`. | ~110 |
| `electron/resource-cache/pod-adapter.ts` | `PodWorkerAdapter`: worker protocol, reset-on-sync, chunk and diagnostics requests, context-engine pod bridge (moved from `main.ts:322-390`), `podUidMap`/`pendingChunkRequests`, namespaced-403 tracking, 401 strike counter and retry timer. | ~320 |
| `electron/resource-cache/watch-manager.ts` | `WatchManager`: session lifecycle, `lastNamespaces`, subscriber and idle timer, mode switching (incl. the cluster-mode retry), auth rebuild, context resync, diagnostics. No `electron` import (deps injected). If it approaches 500 lines, the mode-switching logic moves to `electron/resource-cache/scope-manager.ts`. | ~470 |
| `electron/ipc/resource-cache-ipc.ts` | `registerResourceCacheIpc(manager)`: zod-validated `safeHandle` handlers, `invokeCounts`. | ~120 |
| `electron/transform-worker-client.ts` | `getOrCreateWorker`/`sendToWorker` moved out of `main.ts`, with per-worker pending sets and timeouts (§3.5.1). Injectable worker factory. | ~90 |
| `electron/pod-worker-core.ts` | Pod worker lifecycle core (§3.6): generation state, receipt-time cache replacement, `live()` guard, retry and fast-close guard, chunk reply. Injected informer/kc/post/timers. | ~250 |
| `src/types/resource-cache.ts` | Shared types. Both sides import them with `import type`, following the precedent of `src/types/pod-worker.ts` imported by `main.ts:67`. | ~140 |

Modified files:
- `electron/k8s.ts`: adds `createKubeConfig` (below) and `disposeGenericWatch` (§5.3; `stopGenericWatch` is unchanged). Removes legacy watch methods (§3.10).
- `electron/main.ts`: wiring (§3.7). Transform worker crash and timeout fix (§3.5.1). Removes the legacy pod/deploy/helm IPC (§3.10).
- `electron/k8s-pod-worker.ts` and `src/types/pod-worker.ts`: protocol v2 (§3.6). The lifecycle logic moves to `electron/pod-worker-core.ts`; `k8s-pod-worker.ts` keeps the `parentPort` wiring, `mapLightweightPod` and `DeltaBatchBuffer`. `pods-chunk-reply` gains `sessionId` and `synced` and loses paging. `informer-error` gains `namespace?: string`. `get-pod-count`, `pod-count-reply` and `informer-stopped` are removed (§3.6). `DeltaBatchBuffer` gains a new `clear(): void` method (empties its pending map and cancels its flush timer without posting), which `onLifecycle` uses; it does not exist today.
- `electron/resource-transform-worker.ts` and its types: helm output correlation fields and `failures` (§3.5).
- `electron/preload.ts`, `src/vite-env.d.ts`: the `resources` namespace, legacy removals, and the D6 fix.

`K8sService.createKubeConfig(contextName: string): KubeConfig` builds a **new** `KubeConfig` and calls `loadFromDefault()`. Any error thrown by `loadFromDefault()` (malformed YAML, unreadable file, bad exec stanza) is caught and rethrown as `KubeconfigLoadError` (a named `Error` subclass with the fixed message `'Failed to load kubeconfig'`; the original error is not attached, so no path or file content can leak). It then throws `UnknownContextError` if `kc.getContextObject(contextName)` is null. Otherwise it calls `setCurrentContext(contextName)`. Both error classes are exported from `electron/resource-cache/kinds.ts`. Because the session owns this instance, other IPC calls that run `this.kc.setCurrentContext(...)` on the shared instance (`k8s.ts:275-300`) cannot change the context a live watch uses. A fresh instance also drops cached exec tokens, which `reloadKubeConfig` relies on (`k8s.ts:233-245`). Validating against the fresh config resolves review finding 25: the shared `hasContext` may be stale.

### 3.2 Shared types (`src/types/resource-cache.ts`)

```ts
export type CoreKind = 'deployments' | 'pods' | 'secrets' | 'configmaps' | 'services' | 'helmreleases';
export const CORE_KINDS: readonly CoreKind[];

export type KindPhase = 'loading' | 'ready' | 'reconnecting' | 'error' | 'forbidden';
export interface KindStatus {
  phase: KindPhase;
  error: string | null;          // from mapStatusToMessage only; never err.message / String(err)
  lastSyncedAt: number | null;   // epoch ms of last completed LIST (or pod informer sync)
  mode: 'cluster' | 'namespaced';
}

export interface TrimmedMeta {   // metadata minus managedFields & last-applied annotation
  uid: string; name: string; namespace?: string; resourceVersion?: string;
  creationTimestamp?: string; deletionTimestamp?: string;
  labels?: Record<string, string>; annotations?: Record<string, string>;
  ownerReferences?: Array<{ apiVersion: string; kind: string; name: string; uid: string; controller?: boolean }>;
}
export interface DeploymentItem { id: string; name: string; namespace: string; replicas: number; availableReplicas: number; age: string; status: Record<string, unknown>; spec: Record<string, unknown>; metadata: TrimmedMeta; }
export interface ServiceItem    { id: string; name: string; namespace: string; type: string; clusterIP: string; ports: string; age: string; spec: Record<string, unknown>; metadata: TrimmedMeta; }
export interface ConfigMapItem  { id: string; name: string; namespace: string; data: number; age: string; metadata: TrimmedMeta; } // key count of data + binaryData
export interface SecretItem     { id: string; name: string; namespace: string; type: string; data: number; age: string; metadata: TrimmedMeta; } // key count of data; NEVER values
export interface HelmReleaseItem { id: string; name: string; namespace: string; revision: number; status: string; chart: string; chartVersion: string; appVersion: string; lastUpdated: string; description: string; secretName: string; }
export type PodItem = LightweightPod & { id: string };   // LightweightPod from src/types/pod-worker.ts

export interface KindItemMap { deployments: DeploymentItem; pods: PodItem; secrets: SecretItem; configmaps: ConfigMapItem; services: ServiceItem; helmreleases: HelmReleaseItem; }

export interface KindDelta<K extends CoreKind> {
  reset?: true;                   // store replaces byId with `upserts` instead of merging
  upserts: KindItemMap[K][];
  deletes: string[];              // always [] when reset
  status?: KindStatus;
}
export interface ResourceBatch { sessionId: string; seq: number; kinds: { [K in CoreKind]?: KindDelta<K> }; }
export interface ResourceSnapshot { sessionId: string; context: string; seq: number; kinds: { [K in CoreKind]: { items: KindItemMap[K][]; status: KindStatus } }; }
export interface StartSessionArgs { context: string; namespaces?: string[]; }
```

All timestamp fields (`age`, `lastUpdated`, `TrimmedMeta.creationTimestamp`, `TrimmedMeta.deletionTimestamp`) are **ISO-8601 strings**, never `Date`. Typed LIST calls deserialize timestamps to `Date` (`ObjectSerializer`, `V1ObjectMeta.creationTimestamp: Date`) while WATCH events carry raw JSON strings; §3.3 normalizes both to one shape.

`id` is `metadata.uid`, with a fallback to `${namespace}/${name}` if the uid is missing (persisted objects always have one). Helm releases use `id = ${namespace}/${releaseName}`, because a release spans several secrets.

The item shapes keep the field names the current views use (`name`, `namespace`, `age`, `data`, `type`, `replicas`, `availableReplicas`, `ports`, `clusterIP`; compare `resource-transform-worker.ts:88-169` and `k8s.ts:1569-1578`), so columns and `useResourceSorting` keys keep working. `ConfigMap.dataRaw` is dropped: no renderer code reads it (only `Dashboard.tsx:491` produces it), and the drawer fetches full details through `getConfigMap` (`Dashboard.tsx:1082-1084`).

### 3.3 Trimming rules (`kinds.ts`, pure, unit-tested)

- **Wire-shape normalization (one point, at the stream boundary).** Typed LIST results contain `Date` objects; WATCH events contain strings. `ListWatchStream` passes every LIST item through `toWireShape(item)` before anything else sees it (trimmer, `onListPage`, `HelmIndex`, context engine). `HelmIndex`'s on-demand `readSecret` result (§3.5) goes through `toWireShape` too. `toWireShape` is a pure recursive copy in `kinds.ts` that converts every `Date` to `toISOString()` and leaves all other values as they are (strings are shared by reference, so Secret `data` is not duplicated in memory). For `V1Deployment`, `V1Service`, `V1ConfigMap` and `V1Secret`, the typed property names equal the wire names, so the result has the same shape as a watch object. `ObjectSerializer.serialize` was considered and rejected: the class is not exported from the package root in 1.4.0 (checked: `import * as k from '@kubernetes/client-node'; typeof k.ObjectSerializer === 'undefined'`), and importing from `dist/gen/...` relies on a private path.
- `const toIso = (v: unknown): string | undefined => v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : undefined;` is applied to every timestamp in `trimMeta` and to `age` as a defensive second layer, so a trimmer's output type is correct even if a caller skips `toWireShape`.
- `trimMeta(meta)` copies only the `TrimmedMeta` fields. It drops `managedFields`, `generation`, `selfLink` and the annotation `kubectl.kubernetes.io/last-applied-configuration` (fixes D7). It applies to every kind.
- Secrets: `data = Object.keys(secret.data ?? {}).length`. Values are never copied. `stringData` is write-only and the API never returns it on reads, so it is not counted. Helm release secrets appear in the Secrets list with the same trimmed shape, which keeps today's visibility, and they are also routed to `HelmIndex`.
- ConfigMaps: `data = keys(data) + keys(binaryData)`. Values are dropped.
- Deployments: the same fields as `transformDeployment`, keeping `spec` and `status`. Views and topology read `spec.selector`, status conditions are needed, and `getDeploymentStatus` reads `status`. Because the item keeps `{metadata, spec, status}`, it also works as a raw-shaped input for `extractDeploymentSnapshot` (`context-engine/extractors.ts:62-99`), which §3.9 relies on.
- Services: the same shape as `K8sService.getServices` (`k8s.ts:1569-1578`).
- `mapStatusToMessage(err)` extracts only numeric codes, because node-fetch `FetchError.code` is a string such as `'ECONNRESET'`:
  ```ts
  const e = err as { statusCode?: unknown; code?: unknown; name?: unknown; body?: { code?: unknown } } | null | undefined;
  const code = [e?.statusCode, e?.code, e?.body?.code].find((c): c is number => typeof c === 'number');
  const isNetwork = code === undefined && (typeof e?.code === 'string' || e?.name === 'FetchError');
  ```
  The same `extractStatusCode(err)` helper is used by `ListWatchStream` and the 410/401/403 checks. It returns a fixed string:

  | Code | Message |
  |---|---|
  | 401 | "Authentication failed: refresh credentials" |
  | 403 | "No permission to list <Kind>" |
  | 404 | "Resource type not served by cluster" |
  | 410 | "Resync required" (internal) |
  | 5xx | "Cluster API error (<code>)" |
  | network (`isNetwork`) | "Cannot reach cluster API" |
  | anything else | "Unexpected error" |

  `ApiException.message` embeds the response body and headers (`gen/apis/exception.js:12`), so it is never surfaced. Logs record only the code and kind.

### 3.4 `ListWatchStream` lifecycle

Each stream covers one `(kind, scope)`. Scope is `'*'` for cluster-wide or a namespace name. A stream never caches a `KubeConfig`, `Watch` or API client. On every LIST or WATCH attempt it gets `kc` from `session.kc` and builds `new Watch(kc)` / `kc.makeApiClient(...)` fresh, so an auth rebuild (§3.7) takes effect on the next attempt.

```
start() → LIST (paged) → diff → WATCH(rv) ──event──► apply (rv saved)
              ▲                    │ normal close ≥5 s or ≥1 event    → WATCH(rv) after 500 ms
              │                    │ normal close <5 s and 0 events   → counted as failure → backoff
              │                    │ 410 (HTTP or ERROR event)        → LIST
              │                    │ network / 5xx                    → backoff → WATCH(rv); 3rd consecutive → LIST
              └──── 401 → session.requestAuthRebuild() → backoff → LIST; 3rd consecutive 401 → phase 'error', stop retrying
stop()  → stopped = true; ++epoch; abort controller (if any); clear timer
```

**Attempt epoch (fixes the connect-time abort race).** `Watch.watch()` in client-node 1.4.0 awaits `applyToFetchOptions` and `fetch()` before it *returns* the `AbortController` (`dist/watch.js`: `return controller` is the last statement). It may also call `done(err)` before returning, on non-200 responses. Every attempt therefore works like this:

```ts
const attempt = { epoch: ++this.epoch, done: false };
this.connecting = true;
let ctrl: AbortController;
try {
  ctrl = await new Watch(this.session.kc).watch(path, params,
    (type, obj) => { if (this.stopped || attempt.epoch !== this.epoch) return; this.onEvent(type, obj); },
    (err) => { attempt.done = true; if (this.stopped || attempt.epoch !== this.epoch) return; this.onDone(err); });
} catch (err) {                       // e.g. 'No currently active cluster', applyToFetchOptions failure
  this.connecting = false;
  if (!this.stopped && attempt.epoch === this.epoch) this.onDone(err);
  return;
}
this.connecting = false;
if (this.stopped || attempt.epoch !== this.epoch || attempt.done) { ctrl.abort(); return; }
this.controller = ctrl;
this.lastEventAt = this.now();        // WATCH connected
```

`stop()`, re-LIST, and health aborts all bump `epoch`. A controller that resolves later is aborted at once, so no socket outlives its stream. LIST pages are guarded by the same epoch check, and a superseded page result is discarded.

- **LIST**: a typed API call with `{ limit: descriptor.pageSize, _continue }`. `CORE_KIND_DESCRIPTORS` sets `pageSize: 100` for secrets (a page can hold Helm release blobs of 100 KB–1 MB each, plus their typed copies) and `pageSize: 500` for deployments, services and configmaps. Scope `'*'` uses `list<Kind>ForAllNamespaces`, a namespace uses `listNamespaced<Kind>({ namespace })`.

  **LIST hook contract (replaces rev 3's `onListed`).** Descriptors may define two optional hooks:
  ```ts
  interface CoreKindDescriptor {
    // ...list fn, pageSize, watch path, trimmer, id fn (unchanged)
    // Called once per LIST page, synchronously, with the toWireShape'd raw items of that page.
    // The raw page array is released when it returns; hooks must not keep references to raw items.
    onListPage?(rawItems: KubernetesObject[], ctx: { first: boolean }): void;   // first = this is the stream's first LIST
    // Called once after the last page, with ids owned before this LIST and absent from it.
    onListComplete?(deletedIds: string[], deletedMeta: Map<string, { name: string; namespace?: string }>): void;
  }
  ```
  Per page, the stream (a) runs `toWireShape` on the page items, (b) calls `onListPage(rawItems, { first })`, (c) trims every item into the temporary `Map<id, TrimmedItem>`, and (d) during the **first** sync only, pushes that page's trimmed upserts to the coalescer so the UI responds early. The temporary map holds **trimmed items only**; raw objects never outlive their page, so at most one page of raw secrets (≤100, §3.4 page size) is in memory at a time. When the last page arrives:
  1. Compute `deletedIds` (previously owned ids missing from the new list) and `deletedMeta` (name/namespace from the old trimmed map), then emit those deletes to the coalescer (fixes D2).
  2. Replace the owned map with the temporary map; on re-lists, push the upserts for changed items.
  3. Save `metadata.resourceVersion` from the last page.
  4. Set `lastSyncedAt = lastEventAt = now()` and phase `ready`.
  5. Call `onListComplete(deletedIds, deletedMeta)`.

  Hook users:
  - **Deployments**: `onListPage` forwards each raw item to the context engine as `ADDED`; `onListComplete` forwards each deleted id as `DELETED` with a `{ metadata: { name, namespace } }` stub from `deletedMeta` (§3.9).
  - **Secrets**: `onListPage` calls `HelmIndex.onSecret('ADDED', raw)` for each item with `type === 'helm.sh/release.v1'` (HelmIndex keeps only labels/rv and queues decodes; see §3.5 for how decode input is held); `onListComplete` calls `HelmIndex.onSecretDeleted(uid)` for every deleted id (a no-op for non-helm uids), and on the first LIST also calls `HelmIndex.onFirstListComplete()` (§3.5 Helm phase). This routes re-list diff deletes to HelmIndex, so a release whose secrets were deleted during a watch gap is removed or falls back.
  - Services and ConfigMaps define no hooks.

  An epoch-superseded page (§3.4 attempt epoch) is discarded **before** `onListPage` runs, so hooks never see pages from an aborted LIST. A LIST restarted after a 410 continue-token expiry calls `onListPage` again for the replacement pages; that is safe because both hook consumers upsert idempotently.

  Re-lists never clear items first, so there is no empty flash. If the continue token has expired (410 on a page), the LIST restarts once without `_continue`. Further failures follow the backoff.
- **WATCH params**: `{ allowWatchBookmarks: true, resourceVersion: rv, timeoutSeconds: 300 + random(0..300) }`. In the event callback:
  - `ADDED` / `MODIFIED`: trim, then upsert.
  - `DELETED`: delete by id.
  - All three set `rv = obj.metadata.resourceVersion`.
  - `BOOKMARK`: set rv only.
  - `ERROR` with `code === 410`: bump epoch, abort, re-LIST.
  - Every event sets `lastEventAt = now()` and resets `attempts = 0` and `authFailures = 0`.
- **Normal close (`done(null)`) and the hot-loop guard.** The stream records `connectedAt = now()` and `eventsSinceConnect = 0` when a controller is stored, and increments the counter on every event. On `done(null)`:
  - if `now - connectedAt >= 5000` or `eventsSinceConnect > 0`: a healthy server-side timeout. Re-WATCH from rv after **500 ms** (the same delay as `k8s.ts:2266`).
  - otherwise (a proxy, idle-timeout LB or APF rejection that answers 200 and closes at once): treat it as a failure. `attempts++`, normal backoff, and the 3-strike rule below applies, so the stream falls back to a re-LIST and then backs off to 30 s instead of spinning.
- **Backoff**: `delay = min(1000 * 2^attempts, 30000) * (0.8 + 0.4*rand)`. After 3 consecutive failures, the rv is discarded and the next attempt is a LIST (the same rule as `k8s.ts:2258-2262`). From the first failure the phase is `reconnecting`, and items are kept. Each stream holds at most **one** `setTimeout` handle, and scheduling a new one clears the old one.
- **401**: increment `authFailures` and call `session.requestAuthRebuild()` (debounced per session, §3.7), then back off and re-LIST. At `authFailures === 3`, set phase `error` with "Authentication failed: refresh credentials" and schedule nothing. The stream sits idle until `onCredentialsChanged()` or `ensureFresh()` calls `restart()`, which resets the counters.
- **Health**: `lastEventAt` is `null` only while the initial LIST is in flight. It is set at LIST completion, at WATCH connect (when the controller is stored), and on every event. A single 60 s session interval checks every stream:
  - `lastEventAt === null`, `connecting`, or a pending backoff timer: skipped.
  - Otherwise, if `now - lastEventAt > 5 min`: bump epoch, abort, re-WATCH from rv.

  `powerMonitor.on('resume')` runs the check through `ensureFresh(0)` (wiring in §3.7: `powerMonitor` is new to `main.ts` and is registered after `app.whenReady()`), and window focus through `ensureFresh(300_000)`. The 5-minute interval threshold is safe even when the server sends no bookmarks: `timeoutSeconds ≤ 600` already cycles each watch, and a healthy stream that gets aborted only re-watches from rv, which costs one request and no replay. The check covers dead sockets after sleep and App Nap. It replaces `watchEpoch` for core kinds.
- **`ListWatchStream.ensureFresh(maxSilenceMs)`** applies the same floor as the pod worker (§3.6):
  ```ts
  const threshold = maxSilenceMs === 0 ? 0 : Math.max(maxSilenceMs, 660_000);
  // skip if lastEventAt === null, connecting, or a backoff timer is pending (same rule as the interval)
  if (threshold === 0 || this.now() - this.lastEventAt > threshold) { /* bump epoch, abort, re-WATCH from rv */ }
  ```
  So any non-zero caller (focus) only aborts a stream that has been silent for longer than a full server-side `timeoutSeconds` cycle (≤600 s) plus margin, which a healthy quiet watch cannot be: it re-connects (and sets `lastEventAt`) at least every 600 s. Healthy quiet streams are never churned by alt-tab, and an aborted-then-resumed rv is never older than ~11 min, which keeps 410-driven secrets re-LISTs rare. `0` (power resume) always re-watches every stream. The 60 s health interval keeps its own 5-minute threshold and does not go through this floor; it runs at most once a minute, not once per focus. A stream in phase `error` after three 401s is restarted by the manager's `ensureFresh` (§3.7), independent of the threshold.
- **Generation guard**: `stopped` and `epoch` are checked first in every async continuation (list page resolve, watch callback, done, timer). The session id guard (§4) is the second layer.

### 3.5 Helm releases (`helm-index.ts`)

**Current behavior**: there is no shell-out to `helm`. Both `K8sService.getHelmReleases` (`k8s.ts:3811-3846`) and the realtime path (`k8s.ts:1261-1358`, `main.ts:2867-2904`) list or watch Secrets with `fieldSelector=type=helm.sh/release.v1`. The transform worker decodes `data.release`: base64, an optional second base64 layer, gzip, then JSON (`resource-transform-worker.ts:221-262`). The renderer then dedupes to the latest revision (`helm-release-utils.ts`).

**Decision: derive Helm releases from the single core Secrets stream.** No second label- or field-selected watch. Because Secrets are always loaded, every Helm release secret already arrives on that stream. A dedicated helm watch would download each release blob a second time (100 KB–1 MB × revision history) and keep a second connection open per scope. Deriving from one stream means one download and one connection. It also needs the same RBAC as today, since secret list permission is required either way.

**Derivation:**
- Helm-typed secrets reach `HelmIndex` through exactly three entry points, all *before* trimming:
  - **LIST pages**: `onListPage` → `HelmIndex.onSecret('ADDED', raw)` per helm-typed item (§3.4 hook contract).
  - **LIST diff deletes**: `onListComplete` → `HelmIndex.onSecretDeleted(uid)` per deleted id; unknown uids are ignored.
  - **WATCH events**: every event with `type === 'helm.sh/release.v1'` → `HelmIndex.onSecret(eventType, raw)` (`DELETED` calls `onSecretDeleted(uid)` internally).

  The index keeps two maps:
  - `bySecretUid: Map<uid, { releaseId, revision, rv, name, namespace, labelStatus?: string, summary | null, decodeState: 'none' | 'pending' | 'failed', corrupt: boolean, retryOnce: boolean }>`
  - `byRelease: Map<releaseId, Set<uid>>`

  `labelStatus` is Helm's standard `status` label, kept so the index can build a label-derived fallback summary (below) without the blob.

  **Decode state (rev-4 review finding 1).** `decodeState`, `corrupt` and `retryOnce` describe the entry's current `(uid, rv)`. Whenever an event or LIST item carries a different `rv` for a known uid, the entry's `summary` is set to `null`, `decodeState` to `'none'`, and `corrupt`/`retryOnce` to `false` before any other rule runs. Meaning of each state:
  - `'none'`: never decoded at this rv and nothing in flight.
  - `'pending'`: a decode request (from event/LIST data or from a fallback fetch) is in flight for this `(uid, rv)`.
  - `'failed'`: the last attempt at this rv ended without a summary and the index will not try again on its own. If `corrupt === true` the blob itself failed to decode (a `failures[]` entry) and the uid is excluded from max-revision selection. If `corrupt === false` (fallback fetch failed, or a second whole-request failure) the uid stays selectable and shows the label-derived summary.

  HelmIndex never retains raw secrets in its maps. A raw object is held only between the `onSecret` call that delivered it and the posting of its decode request (end of the same `onListPage` call, or end of the 650 ms watch decode window); after that only the worker has it. "Raw in hand" below means the uid delivered by the current `onSecret` call.

  `releaseId` and `revision` come from Helm's standard secret labels (`name`, `version`, `owner=helm`). If the labels are missing, it falls back to parsing the secret name `sh.helm.release.v1.<name>.v<rev>`. If both fail, the secret is decoded to find out.
- **Decode only the latest revision, and only with the raw in hand.** On each change, the index recomputes the max-revision uid (among non-`corrupt` uids) for the affected release. The single path that decodes from event or LIST data is: the uid delivered by the *current* `onSecret` call is the release's max, it has no summary at its rv, `decodeState !== 'pending'` and `corrupt === false`. Then the raw is queued for decode and `decodeState = 'pending'`. On the initial LIST that is one decode per release instead of one per history entry. Re-lists and label-only MODIFIED events with an unchanged rv are cache hits (summary present, or `'pending'`, or `corrupt`). A re-LIST or event carrying a `'failed'`, non-`corrupt` uid that is still max re-decodes it from the raw in hand; this is the "next event or re-LIST tries again" path.
- Decodes go through the existing transform worker in batches, at most 50 secrets per request. During a LIST, the decode request(s) for a page are posted synchronously at the end of that page's `onListPage` call, so the raw secrets are handed to the worker (structured clone) and released with the page; the decode queue never holds raw secrets across pages. Watch-event decodes are batched per 650 ms window. Only the summary is kept (no manifest, values or chart files). Because revisions of one release can span LIST pages, a lower revision decoded on an earlier page may be superseded by a higher one on a later page; that costs at most one extra decode per release on the initial LIST and is accepted.
- **Worker contract change** (`resource-transform-worker.ts` + types):
  ```ts
  // helmrelease output adds:
  secretUid: string; secretResourceVersion: string;
  // TransformResponse adds (all resource types; existing callers ignore it):
  failures?: Array<{ index: number; uid?: string; message: string }>;
  ```
  The index correlates successes through `secretUid@secretResourceVersion` and failures through `uid`. A result whose `(uid, rv)` is no longer the current max revision is ignored.
- After every add, modify or delete, the affected release is recomputed. It shows the latest-revision summary among its remaining secrets. It emits `upsert(helmreleases, summary)` if the release still has secrets and `delete(helmreleases, releaseId)` if none remain, which fixes D8.
- **Fallback to an older revision without a blob (fixes rev-3 finding 3; option (a); trigger tightened by rev-4 review finding 1).** The fallback fetch fires only when **all** of the following hold after a recompute:
  1. the picked max-revision uid has `summary === null`;
  2. its `decodeState === 'none'` (never `'pending'`, never `'failed'`);
  3. it is **not** the uid delivered by the current `onSecret` call (that uid, if max, takes the raw-in-hand decode path above).

  That is precisely "this revision became max after its raw was released and was never decoded". The typical case is the latest revision being deleted (by a watch DELETED or a re-LIST diff) while the previous one was never decoded. It never fires while a decode for the max uid is in flight, so a release whose revisions arrive out of order on one page (v3 then v2), span LIST pages, or receive an older-revision event in the same 650 ms window as a MODIFIED on the max costs no extra download. When it fires, `HelmIndex` fetches that one secret on demand through an injected dependency:
  ```ts
  // HelmIndex deps (injected by WatchManager)
  readSecret(namespace: string, name: string): Promise<KubernetesObject>;
  // WatchManager implementation: session.kc.makeApiClient(CoreV1Api).readNamespacedSecret({ name, namespace }),
  // result passed through toWireShape.
  ```
  Rules:
  - The release immediately emits a **label-derived summary** for the new max revision (`revision` from labels/name, `status` from `labelStatus`, `name`/`namespace`/`secretName`; `chart`, `chartVersion`, `appVersion`, `description` = `''`, `lastUpdated` = the secret's `creationTimestamp`). The deleted revision's summary is never shown again.
  - At most **one in-flight fetch per release** (`fetchInFlight: Map<releaseId, { uid, rv, sessionId }>`). A recompute that picks a different uid while a fetch is in flight records the new target; the stale result is ignored on arrival and a fetch for the current target is issued then.
  - The fetch result is applied only if `sessionId === session.id`, the session is not stopped, and the fetched `metadata.uid`/`resourceVersion` still equal the index entry's `(uid, rv)` for the release's current max revision.
  - Issuing the fetch sets the uid's `decodeState = 'pending'` immediately, so later recomputes in the same window do not issue a second fetch. An ignored result is handled by mismatch type (rev-4 amended review finding 1); none of these cases re-issues a fetch for the same `(uid, rv)`:
    - **Session mismatch** (or session stopped): do nothing. `clear()` has already dropped the entry and `fetchInFlight`.
    - **uid mismatch** (the release's max changed while the fetch was in flight): the fetched uid, if still in the index at the rv it was fetched at and still `'pending'` from this fetch, returns to `'none'`; then the recompute runs for the new target (this is the "stale result, fetch the current target" rule above).
    - **rv mismatch, same uid, entry rv unchanged since issue** (the fetch is *ahead* of the watch: the server already has a newer rv the watch has not delivered): `decodeState = 'failed'`, `corrupt = false`, and the recompute is **not** re-run. The label-derived summary stays. The MODIFIED event (or re-LIST item) carrying the newer rv resets the entry to `'none'` through the rv-change rule and decodes it from the raw in hand, with no further `readSecret`.
    - **rv mismatch, same uid, entry rv changed since issue** (the watch is ahead of the fetch: a newer event arrived while the fetch was in flight): do nothing. The rv-change rule already reset the entry and the raw-in-hand path owns its `decodeState`; the stale result must not overwrite it.
    "Entry rv unchanged since issue" is tested by comparing the entry's current rv with the `rv` recorded in `fetchInFlight` when the fetch was issued.
  - An accepted result is sent through the normal decode path (one-item transform request, `decodeState` stays `'pending'`) and then follows the usual success/failure rules.
  - **Fetch failure** (any error, including 404 because the secret was deleted meanwhile, 403, network): `decodeState = 'failed'`, `corrupt = false`; the label-derived summary stays. Logged `warn('[HelmIndex] fallback fetch failed', code)` once per uid, code only. No automatic retry; the next event or re-LIST for that release delivers the raw and re-decodes it through the raw-in-hand path (a new rv also resets the state to `'none'`).
  - `HelmIndex.clear()` (session stop) drops `fetchInFlight`; late results fail the session check.

  The same label-derived summary is used whenever the max revision has no decoded summary yet: initial LIST or watch decodes still `'pending'`, a fallback fetch in flight, or a `'failed'` non-`corrupt` uid. The release never disappears and never shows a deleted revision's data.
- Decode requests and fallback fetches capture `session.id`. A result that arrives after the session has stopped is dropped.
- **Decode failure** (a corrupt blob, or an entry in `failures`): `decodeState = 'failed'`, `corrupt = true`. `console.warn('[HelmIndex] decode failed', uid, message)` runs once per uid, without contents. That secret is left out of max-revision selection until its rv changes, and the release falls back to the next-highest revision: its decoded summary if it has one, otherwise the fallback fetch and label-derived summary above. If no secret remains in the index, the release is deleted. The secret itself stays in the Secrets list, and the release phase is unaffected.
- **Helm phase.** `helmreleases` stays `loading` until (a) the Secrets stream has completed its first full LIST **and** (b) every decode request issued for that LIST has settled (success, `failures[]` entry, or whole-request failure). `HelmIndex` tracks this with `initialDecodesPending: number` and `firstListComplete: boolean`. Every decode request issued from an `onListPage` call with `ctx.first === true` increments the counter, and each settle decrements it. `onFirstListComplete()`, called from the Secrets descriptor's `onListComplete` of the first LIST, sets `firstListComplete = true`. Fallback fetches do not count. Once `firstListComplete && initialDecodesPending === 0`, helm mirrors the Secrets phase and error (`forbidden` included), because its data comes from that stream. This prevents `HelmReleasesView` from flashing its empty state while the first decodes run. A later re-LIST does not return helm to `loading`.
- `HelmReleaseDetail`, history, rollback and uninstall keep using the existing on-demand IPC (`k8s.ts:3852-3960`).
- Not supported (unchanged): Helm's ConfigMap and SQL storage drivers.

#### 3.5.1 Transform worker robustness (fixes D9)

The client moves into `electron/transform-worker-client.ts` (~90 lines, unit-tested with a fake `Worker` factory) and `main.ts` imports `sendToWorker` from it. Pending requests are tracked **per worker instance**, so a dying worker can only fail its own requests. This matters because today `'error'` nulls `transformWorker` (`main.ts:277-280`), the next `sendToWorker` creates W2, and then W1's `'exit'` fires (`main.ts:281-284`); a global "fail all pending" in that handler would fail W2's requests and null W2.

```ts
const pendingTransforms = new Map<string, { resolve: (r: TransformResponse) => void; worker: Worker; timer: NodeJS.Timeout }>();
const workerPending = new WeakMap<Worker, Set<string>>();
let transformWorker: Worker | null = null;

function getOrCreateWorker(): Worker {
  if (transformWorker) return transformWorker;
  const w = createWorker(workerPath);                 // injectable for tests
  const mine = new Set<string>();
  workerPending.set(w, mine);
  const settle = (id: string, r: TransformResponse) => {
    const p = pendingTransforms.get(id); if (!p) return;
    clearTimeout(p.timer); pendingTransforms.delete(id); mine.delete(id); p.resolve(r);
  };
  const failAll = (reason: string) => {
    for (const id of [...mine]) settle(id, { id, resourceType: 'unknown', events: [], error: reason } as TransformResponse);
    if (transformWorker === w) transformWorker = null;   // never null a newer worker
  };
  w.on('message', (r: TransformResponse) => settle(r.id, r));
  w.on('error', (err) => { console.error('[Worker] Transform worker error:', err); failAll('worker error'); void w.terminate(); });
  w.on('exit', (code) => { if (code !== 0) console.error('[Worker] Transform worker exited with code', code); failAll('worker exited'); });
  transformWorker = w;
  return w;
}

export function sendToWorker(req: TransformRequest): Promise<TransformResponse> {
  return new Promise((resolve) => {
    const w = getOrCreateWorker();
    const timer = setTimeout(() => {
      const p = pendingTransforms.get(req.id); if (!p) return;
      pendingTransforms.delete(req.id); workerPending.get(p.worker)?.delete(req.id);
      console.warn('[Worker] transform timeout', req.resourceType);
      resolve({ id: req.id, resourceType: req.resourceType, events: [], error: 'timeout' } as TransformResponse);
    }, 15_000);
    pendingTransforms.set(req.id, { resolve, worker: w, timer });
    workerPending.get(w)!.add(req.id);
    w.postMessage(req);
  });
}
```

`pendingTransforms.size` is reported in diagnostics. This also fixes the same hang for the existing node and replicaset transform callers, which keep their call sites unchanged.

**How HelmIndex reads a response.** `handleRequest` sets `response.error` whenever *any* event fails and still returns the successful `events` (`resource-transform-worker.ts:268-305`). With the `failures[]` field added (§3.5), HelmIndex therefore:
1. Applies every entry in `events`, matched by `secretUid@secretResourceVersion` (ignoring results that are no longer the current max revision).
2. Applies every entry in `failures` per uid (fallback to the next decoded revision, or excluded; `warn` once per uid).
3. Treats the **whole request** as failed only when `error` is set **and** `events.length === 0` **and** `failures` is empty or absent. That is exactly the crash, exit and timeout responses produced by the client above. The raw blobs in that request went to the dead or timed-out worker and are not held anywhere, so the retry must re-fetch (rev-4 review finding 1):
   - For each uid in the request whose `(uid, rv)` is still current and `retryOnce === false`: set `decodeState = 'none'`, `retryOnce = true`, then run the release recompute immediately. If the uid is still the max, it now satisfies the fallback-fetch trigger, so the retry is exactly **one** `readSecret` plus a one-item decode, under the existing one-in-flight-per-release and session/(uid, rv) guards.
   - For each uid with `retryOnce === true` (its retry also came back as a whole-request failure): `decodeState = 'failed'`, `corrupt = false`. No further fetch; the label-derived summary stays until the next event or re-LIST delivers the raw.
   - A uid that is no longer the current max (or whose rv changed) is ignored.
   - Whole-request failures of first-LIST decodes still settle `initialDecodesPending`; the retry fetch does not count toward it (fallback fetches never do), so the helm phase is not held in `loading` by a crashed worker.
   - There is no tight loop: each `(uid, rv)` gets at most one retry fetch. `HelmIndex.clear()` on session stop drops all entries, including `retryOnce` flags.

### 3.6 Pod worker protocol v2 and `PodWorkerAdapter`

**Worker changes (`k8s-pod-worker.ts`, `src/types/pod-worker.ts`):**
- Inbound messages:
  - `start-informer { sessionId, context, mode: 'cluster' | 'namespaced', namespaces: string[] }`. There is no `kubeconfigPath` field, so the worker always uses `loadFromDefault`.
  - `stop-informer { sessionId }`
  - `refresh { sessionId, maxSilenceMs }`
  - `get-pods-chunk { requestId, sessionId }`
  - `get-diagnostics { requestId }`
- Outbound messages: `pod-delta-batch { sessionId, ... }`, `informer-synced { sessionId, count }`, `informer-error { sessionId, statusCode: number | null, recoverable: boolean, namespace?: string }`, `pods-chunk-reply { requestId, sessionId, synced, pods }`, `diagnostics-reply { requestId, ... }`.
- **Removed from the protocol** (types deleted from `src/types/pod-worker.ts:28-39` and handlers deleted from the worker and `main.ts`): `get-pod-count`, `pod-count-reply` and `informer-stopped`. `get-pod-count`/`pod-count-reply` only fed `onPodWorkerCount` (removed, §3.10). `informer-stopped` drove the context-engine clear at `main.ts:394-397`; `stopSession` already calls `contextEngine.clearKind('Pod')` (§3.7), which replaces it.
- **Worker state and the liveness rule.** The worker keeps module-level state that is replaced, never mutated across sessions:
  ```ts
  let currentSessionId: string | null = null;
  let currentGen = 0;                                  // bumped synchronously on every lifecycle receipt
  let podCache = new Map<string, LightweightPod>();    // replaced (not cleared) on every lifecycle receipt
  let cacheSynced = false;                             // true once informer-synced was posted for currentGen
  let recs: InformerRec[] = [];
  let sessionKc: KubeConfig | null = null;             // one per start-informer, shared by its informers
  let lastStart: StartInformerMsg | null = null;       // reused by refresh
  let lifecycle: Promise<void> = Promise.resolve();

  interface InformerRec {
    informer: Informer<V1Pod>; sid: string; gen: number; ns: string | null;
    disposed: boolean; synced: boolean; errored: boolean;
    forbidden: boolean;                                // namespaced-mode 403: terminal for this rec, no retry
    lastEventAt: number; attempts: number; fastCloses: number; retryTimer?: NodeJS.Timeout;
  }
  const live = (r: InformerRec) => !r.disposed && r.gen === currentGen;
  ```
  Every informer callback (`add`, `update`, `delete`, `connect`, `error`) starts with `if (!live(rec)) return;`. Because `podCache`, `deltaBuffer` and `cacheSynced` belong to `currentGen`, a callback from an old generation can never write into them.
- **Lifecycle receipt is synchronous; only informer I/O is chained.** `start-informer`, `stop-informer` and `refresh` do this **on receipt, before any `await`** (fixes review-2 finding 2):
  ```ts
  function onLifecycle(msg: StartInformerMsg | StopInformerMsg | RefreshMsg) {
    if (msg.type !== 'start-informer' && msg.sessionId !== currentSessionId) return;   // stale stop/refresh
    if (msg.type === 'refresh' && !needsRefresh(msg.maxSilenceMs)) return;            // nothing silent: no-op
    const old = recs; recs = [];
    for (const r of old) { r.disposed = true; clearTimeout(r.retryTimer); }
    currentGen++;
    currentSessionId = msg.type === 'stop-informer' ? null : msg.sessionId;
    podCache = new Map(); cacheSynced = false; deltaBuffer.clear();                   // D5: clear, never flush
    if (msg.type === 'start-informer') { lastStart = msg; sessionKc = null; }        // new kc for every start
    if (msg.type === 'stop-informer') { lastStart = null; sessionKc = null; }
    const gen = currentGen;
    lifecycle = lifecycle.then(async () => {
      await Promise.allSettled(old.map((r) => r.informer.stop()));
      if (gen !== currentGen || !lastStart) return;           // superseded while stopping
      if (!sessionKc) sessionKc = buildKc(lastStart.context); // loadFromDefault + setCurrentContext; refresh reuses it
      await startInformers(lastStart, gen);
    }).catch((err) => {                                       // e.g. buildKc: context missing from kubeconfig
      console.error('[pod-worker] lifecycle failed', (err as Error)?.name);
      if (gen === currentGen && currentSessionId) post({ type: 'informer-error', sessionId: currentSessionId, statusCode: null, recoverable: false });
    });
  }
  ```
  So the moment main posts `start-informer(B)`, any `get-pods-chunk` processed after it sees B's (empty, unsynced) cache, never A's. Same-session restarts (mode switch, namespace change, credentials change, refresh) also get a new `podCache`, so pods of a removed namespace cannot survive in it.
- **Informers are never restarted after we stop them.** Disposal sets `disposed = true` first, clears the retry timer, then calls `informer.stop()`. Every restart (refresh, credentials, namespace or mode change) **builds new `InformerRec`s with new informers**, which do a fresh LIST. `informer.start()` is only ever called again by the error-retry timer on a rec that is still `live`. This matters because `informer.stop()` on a connected informer makes node-fetch emit `AbortError` on the body (`node-fetch/lib/index.js:1457-1464`), `watch.js` passes it to `done`, and `cache.js` `doneHandler(err)` fires the `ERROR` callbacks **before** its `stopped` check (`cache.js:90-98`). Without the `disposed` flag that self-inflicted error would schedule a retry on a stopped informer (a leaked socket outside `recs`) or abort a freshly started request.
- **Informer construction.** `cluster` mode creates one informer on `/api/v1/pods?timeoutSeconds=<300..600>`. `namespaced` mode creates one per namespace on `/api/v1/namespaces/<ns>/pods?timeoutSeconds=…`. `Watch.watch` builds `new URL(cluster.server + path)` and then adds the informer's params, so the embedded `timeoutSeconds` survives. All informers of one `start-informer` share **one** `sessionKc` (fixes review-2 finding 20): `ExecAuth.tokenCache` is per `KubeConfig` instance (`config.js:40-43`, `exec_auth.js:4`), so N namespaced informers with their own configs would run N `aws eks get-token` processes at start and at every expiry. `makeInformer` still creates its own `Watch` per informer (`informer.js:12-15`). A new `sessionKc` is built only on `start-informer`, which is what `onCredentialsChanged` sends, so fresh credentials still drop the cached token. `refresh` reuses it.
- **Connect race.** `startInformers` calls `await rec.informer.start()` and then, if `!live(rec)`, calls `void rec.informer.stop()` again. By then `informer.request` is set (`cache.js:128` assigns it after `await watch.watch`), so the socket is aborted, and the resulting `AbortError` callback is ignored because `disposed` is set. For an internal auto re-watch that races a stop (inside `doneHandler(null)` between `_stop()` and the assignment at `cache.js:128`), the socket cannot be aborted from outside. It is bounded by the embedded `timeoutSeconds ≤ 600`, and its events are ignored by `live()`. That limit is documented in §8.
- **Error handling.** The `error` handler is:
  ```ts
  informer.on('error', (err: unknown) => {
    if (!live(rec)) return;
    if ((err as Error)?.name === 'AbortError') return;     // only our own stop() aborts
    rec.errored = true; rec.synced = false;
    const code = extractStatusCode(err);                    // same numeric-only helper as §3.3
    clearTimeout(rec.retryTimer);
    if (code === 403 && lastStart?.mode === 'cluster') {   // adapter switches pods to namespaced mode
      post({ type: 'informer-error', sessionId: rec.sid, statusCode: 403, recoverable: false });
      return;
    }
    if (code === 403) {                                     // namespaced mode: this namespace is forbidden
      rec.forbidden = true;                                 // terminal for this rec; no retry timer
      post({ type: 'informer-error', sessionId: rec.sid, statusCode: 403, namespace: rec.ns ?? undefined, recoverable: false });
      maybePostSynced();                                    // the other recs may now be all synced
      return;
    }
    if (code === 401) {                                     // adapter drives recovery (fresh sessionKc)
      post({ type: 'informer-error', sessionId: rec.sid, statusCode: 401, recoverable: false });
      return;                                               // errored stays true; no retry timer
    }
    post({ type: 'informer-error', sessionId: rec.sid, statusCode: code ?? null, recoverable: true });
    rec.retryTimer = setTimeout(() => {
      if (!live(rec)) return;
      rec.errored = false;
      void rec.informer.start().then(() => afterStart(rec));
    }, backoff(rec.attempts++));                            // §3.4 formula, ≤30 s
  });
  ```
  Retrying `start()` on the same informer after the library's own error is the intended client-node recovery (`doneHandler` does not restart on non-410 errors), and it keeps rv-based resume. A runtime error does not change `podCache` or `cacheSynced`. The adapter shows `reconnecting`, and the next `informer-synced` reset repairs any drift.
- **Sync detection.** `Informer.start()` resolves rather than throwing when the LIST fails (`cache.js:111-113` fires the `error` callbacks and returns). `afterStart(rec)`: if `!live(rec)`, stop and return; otherwise `rec.synced = !rec.errored`. When the rec is synced, `attempts = 0`, then `maybePostSynced()` runs:
  ```ts
  function maybePostSynced() {
    if (cacheSynced) return;                                 // already posted for currentGen
    const active = recs.filter((r) => !r.forbidden);
    if (active.length === 0 || !active.every((r) => r.synced)) return;
    deltaBuffer.flush(); cacheSynced = true;
    post({ type: 'informer-synced', sessionId: currentSessionId!, count: podCache.size });
  }
  ```
  Forbidden recs are excluded from the all-synced check, so one forbidden namespace never blocks the others. If **every** rec is forbidden, `informer-synced` is never posted; the adapter detects that case from the `informer-error` messages (below). `informer-error` carries only the numeric code (and the namespace name for a namespaced 403), never a string.
- **Fast-close guard (same rule as §3.4).** client-node re-watches immediately on a normal close (`doneHandler(null)` → `CONNECT` → `watch`). The `connect` handler counts `fastCloses` when a connect follows the previous one by less than 5 s with no events in between. At 5 consecutive fast closes the rec is disposed and replaced by a new rec after the §3.4 backoff (scheduled on a worker-level timer guarded by `gen === currentGen`). Any event resets `fastCloses`.
- **Freshness.** Each rec sets `lastEventAt` on add/update/delete, on `connect` (which `cache.js:104` fires on every re-watch, so a healthy informer refreshes it at least every `timeoutSeconds ≤ 600 s`), and when `start()` completes. `needsRefresh(maxSilenceMs)` is true when any non-forbidden, non-401-errored rec's silence exceeds `max(maxSilenceMs, 660_000)`, or when `maxSilenceMs === 0` (power resume). Forbidden and 401-errored recs are excluded because they are silent by design and their recovery is driven by the adapter (401) or by `setNamespaces`/credentials changes (403); otherwise every focus after 11 minutes would rebuild them only to hit the same error. The 660 s floor means a quiet but healthy informer is never rebuilt on window focus; only a socket that missed its own timeout cycle (dead after sleep or App Nap) is. When `refresh` fires, the **whole set** is rebuilt through `onLifecycle`, because `podCache` belongs to the generation. That costs one pods LIST, only after resume or a dead socket. The informer-synced reset then removes pods deleted during the gap (the previous text's claim that `stop(); start()` re-lists was wrong: `stop()` keeps `resourceVersion`, so `start()` only re-watches; building new informers is what forces the LIST and `deleteItems`).
- **`get-pods-chunk { requestId, sessionId }`** bypasses the chain and replies at once:
  ```ts
  post({ type: 'pods-chunk-reply', requestId: msg.requestId, sessionId: currentSessionId, synced: cacheSynced,
         pods: msg.sessionId === currentSessionId && cacheSynced ? Array.from(podCache.values()) : [] });
  ```
  It is **one unpaged structured-clone message** by design. A `LightweightPod` is ~300 B, so 20k pods is ~6 MB per reply, which is fine for one in-process `postMessage`. The adapter must not reintroduce `offset`/`limit` paging, because paging across replies reopens the cross-generation window this design closes.
- **Diagnostics.** `get-diagnostics` replies `{ informers: recs.length, podCacheSize, sessionId: currentSessionId, gen: currentGen, retryTimers }`.

**`PodWorkerAdapter` (main):**
- It drops any worker message whose `sessionId !== session.id`.
- **Namespaced 403 (fixes rev-3 finding 4).** The adapter keeps `forbiddenNamespaces: Set<string>`, cleared whenever it posts `start-informer`. On `informer-error { statusCode: 403, namespace }` (namespaced mode), it adds the namespace. If `forbiddenNamespaces.size` equals the number of namespaces in the current `start-informer`, pods go to phase `forbidden` with `"No permission to list Pods in: <ns1, ns2>"`. Otherwise, the status error is set to that message, and the phase stays `loading` until `informer-synced` arrives, at which point the reset-on-sync sets `ready` and keeps the error text. A cluster-mode 403 (no `namespace`) still triggers the switch to namespaced mode (§3.7).
- **401 / auth rebuild (fixes rev-3 finding 5).** The adapter keeps `pod401Count: number`. On `informer-error { statusCode: 401 }`:
  1. Count at most one 401 per posted `start-informer` (the adapter tracks `startsPosted` and `last401Start`; in namespaced mode every informer of one start can report 401, and those must count once). If this is the first 401 for the current start, `pod401Count++` and pods go to `reconnecting`; otherwise ignore the message.
  2. If `pod401Count >= 3`: set pods `error` "Authentication failed: refresh credentials", post `stop-informer { sessionId }`, and stop. Nothing retries until a reset event (below).
  3. Otherwise call `session.requestAuthRebuild()` (the same ≤1-per-10 s debounce the main streams use, §3.7; the debounce is irrelevant to the worker because the worker builds its own `sessionKc`), then, after the §3.4 backoff for `pod401Count` (scheduled on one adapter-level timer, cleared on session stop and on any newer `start-informer`), re-post `start-informer` for the session with the current mode and namespaces. The worker builds a **new** `sessionKc` on every `start-informer` (§3.6), so the exec token cache is dropped and a fresh token is fetched.

  `pod401Count` resets to 0 on `informer-synced`, on `onCredentialsChanged()`, and on the manager's error-restart paths (`ensureFresh` restarting errored kinds, and the idempotent `startSession` terminal-error recovery), each of which also re-posts `start-informer` when pods are in `error`. The worker side of this rule is in the error handler above: a 401 sets `errored` and schedules **no** retry, so the adapter is the only driver of 401 recovery.
- Delta mapping: `add`/`update` become `coalescer.push('pods', upsert({ ...pod, id: pod.uid }))`, and `delete` becomes `push('pods', delete(uid))`. Each delta is also forwarded to the context engine with the existing pseudo-raw logic, which moves here from `main.ts:340-381` together with `podUidMap`.
- **Reset on every sync (fixes review finding 3).** On each `informer-synced`, which covers the first sync, a respawn, a restart, a namespace change, a credentials change and a refresh, the adapter requests `get-pods-chunk`. When the reply arrives, it calls `coalescer.resetKind('pods', chunk.map(withId))` and sets the status to `ready`. `resetKind` throws away any buffered pod ops, which are older than the chunk because the worker answers in order. Ops pushed afterwards write into the reset buffer. The renderer replaces `byId` with the reset items, so pods deleted during an outage, or pods in a removed namespace, disappear. On reset, the adapter also rebuilds `podUidMap` from the chunk and sends the context engine DELETED for every uid that disappeared.
- **Snapshots and chunk replies.** `getSnapshotPods()` sends `get-pods-chunk { requestId, sessionId: session.id }` with a 10 s timeout. A reply is accepted as data only if `reply.sessionId === session.id && reply.synced`. Otherwise (the worker is still on the old generation, or the new informers have not synced) it yields `{ pods: [], phase: 'loading' }`, and the next `informer-synced` reset fills the store. On timeout it yields `[]` with phase `reconnecting`. The chunk requested by the reset-on-sync path applies the same check, and an unaccepted reply is ignored (a later `informer-synced` will request again). `pod-delta-batch` messages are only applied when `msg.sessionId === session.id`; the worker stamps them with `currentSessionId` at flush time, and its buffer is cleared on every generation change, so deltas never cross generations.
- **`PodWorkerPort` (fixes review-2 finding 4).** `main.ts` implements the port that the manager receives:
  ```ts
  interface PodWorkerPort {
    post(msg: WorkerInbound): boolean;   // false when no live worker (respawn pending or quitting)
    isAvailable(): boolean;
  }
  let respawnPending = false;
  let quitting = false;
  const podWorkerPort: PodWorkerPort = {
    isAvailable: () => !!podWorker && !respawnPending && !quitting,
    post(msg) {
      if (quitting || respawnPending) return false;
      if (!podWorker) podWorker = spawnPodWorker();        // lazy first spawn only
      podWorker.postMessage(msg);
      return true;
    },
  };
  // in spawnPodWorker's exit handler (replaces main.ts:401-408):
  worker.on('exit', (code) => {
    if (podWorker === worker) podWorker = null;
    if (code === 0 || quitting) return;
    respawnPending = true;
    setTimeout(() => {
      respawnPending = false;
      if (quitting) return;
      podWorker = spawnPodWorker();
      manager.onPodWorkerRespawned();
    }, 2000);
  });
  ```
  `ensurePodWorker()` (`main.ts:413-416`) is deleted; every caller goes through the port, so nothing can spawn a second worker inside the 2 s window. `before-quit` sets `quitting = true` **before** `podWorker.kill()`, because `kill()` exits non-zero and would otherwise schedule a respawn.
- **Behaviour while the worker is unavailable.** If `post` returns false, `getSnapshotPods()` returns `{ pods: [], phase: 'reconnecting' }` immediately (no 10 s wait), and lifecycle messages are not queued: `onPodWorkerRespawned()` resends the current state anyway.
- **Respawn.** `onPodWorkerRespawned()` resolves all `pendingChunkRequests` with `null` (counted as a timeout), sets pods to `reconnecting`, and sends `start-informer` for the current session (or nothing if there is no session).
- All worker messages are handled by `manager.onPodWorkerMessage(msg)`. The `spawnPodWorker` switch in `main.ts` is reduced to that delegation (§3.10).

### 3.7 Session lifecycle (`WatchManager`)

```ts
class WatchManager {
  constructor(deps: {
    createKubeConfig(ctx: string): KubeConfig;            // throws UnknownContextError
    sendToTransformWorker(req: TransformRequest): Promise<TransformResponse>;
    podWorker: PodWorkerPort;                             // §3.6: post(msg): boolean, isAvailable()
    contextEngine: { handleResourceEvent(kind: string, type: 'ADDED'|'MODIFIED'|'DELETED', raw: unknown): void; clearKind(kind: string): void };
    now?: () => number; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout; setInterval?: …; clearInterval?: …;
  });
  startSession(args: StartSessionArgs, sender: Subscriber): Promise<ResourceSnapshot>;
  subscribe(sender: Subscriber): Promise<ResourceSnapshot | null>;   // gap / backstop recovery
  setNamespaces(namespaces: string[]): void;
  ensureFresh(maxSilenceMs: number): void;
  onCredentialsChanged(): void;
  onPodWorkerMessage(msg: WorkerOutbound): void;
  onPodWorkerRespawned(): void;
  onRendererNavigated(): void;                 // did-start-navigation (main frame, not same-document)
  detachSubscriber(sender: Subscriber): void;  // render-process-gone / destroyed
  stopSession(reason: string): void;
  getDiagnostics(): Promise<ResourceCacheDiagnostics>;
}
interface Subscriber { id: number; isDestroyed(): boolean; send(channel: 'resources:batch', batch: ResourceBatch): void; }
```

- **`lastNamespaces`** lives on the manager, **outside** any session. It starts as `['all']`. `setNamespaces` *always* records it, even when no session exists. That handles React effect order: Dashboard's child effect runs before `App.tsx`'s `startSession` effect. `startSession({ context, namespaces })` overwrites `lastNamespaces` when `namespaces` is given.
- **`startSession({ context, namespaces })`** first cancels the idle timer.
  - **Same context, live session (idempotent path):** re-bind the subscriber, run `resyncContextEngine()` (§3.9), and apply `namespaces` like `setNamespaces` does. **Terminal-error recovery (fixes review-2 finding 11):** if any kind or stream is in phase `error` (the "Unknown kube context" rebuild failure, three 401s, or a 404), call `deps.createKubeConfig(context)` again.
    - On `UnknownContextError`: reject with `Error('Unknown kube context')`. On `KubeconfigLoadError`: reject with `Error('Failed to load kubeconfig')`. In both cases the session stays as is (its kinds already show the error) and only the error name is logged (`warn`).
    - On success: assign `session.kc`, bump `kcEpoch`, and `restart()` every stream in phase `error` (counters reset, fresh LIST with diff). If pods are in `error`, reset `pod401Count` and post `start-informer` for the session. Kinds that were `ready` are untouched.
    - Kinds in `namespaced` mode (including `forbidden` ones) get the one-shot cluster-mode retry described under "Return to cluster mode" below. Otherwise `forbidden` kinds recover through `setNamespaces`.

    Then return `buildSnapshot(session)`. This covers StrictMode double effects, Fast Refresh, re-selecting the same cluster after fixing kubeconfig or credentials, and re-selecting after a reload.
  - **Otherwise:**
    1. Call `deps.createKubeConfig(context)`. On `UnknownContextError`, reject with `Error('Unknown kube context')`; on `KubeconfigLoadError`, reject with `Error('Failed to load kubeconfig')`. In both cases leave any existing session untouched and log only the error name (`warn`). Any other thrown value is treated as `KubeconfigLoadError`.
    2. Call `stopSession('switch')`.
    3. Create `{ id: \`${++counter}-${randomUUID().slice(0,8)}\`, context, kc, kcEpoch: 0, seq: 0, stopped: false }`.
    4. Set every kind to `loading`/`cluster`.
    5. Start four `ListWatchStream`s and send `start-informer`.
    6. Return `buildSnapshot`, which at this point is empty and loading.
- **`buildSnapshot(session)`** (fixes findings 2 and 5) runs in this order:
  1. `pods = await adapter.getSnapshotPods()`.
  2. **Then, in the same synchronous tick after that await resolves:** if `session !== this.session || session.stopped`, return `this.session ? this.buildSnapshot(this.session) : Promise.reject(new Error('Session superseded'))`. Otherwise read `seq = session.seq` and copy every main-side map and status.

  Reading `seq` *after* the await is correct for two reasons:
  - The chunk reflects every pod delta the worker had applied before replying. Batches that flushed during the await have `seq ≤ snapshot.seq` and are dropped by the renderer, so nothing they contained can resurrect pods the chunk had already removed.
  - The main maps include everything the coalescer still holds, and the next batch re-applies those ops idempotently.
- **`stopSession(reason)`**:
  1. Set `session.stopped = true`.
  2. `stop()` every stream. This bumps its epoch, aborts its controller and clears its timer.
  3. `podWorker.post({ type: 'stop-informer', sessionId })`. A `false` return (respawn pending or quitting) is fine: a respawned worker starts with no session, and `onPodWorkerRespawned` sends nothing when there is no session.
  4. Clear the coalescer without flushing, clear HelmIndex, and clear the health interval and the idle timer.
  5. Call `contextEngine.clearKind('Deployment')` and `clearKind('Pod')`.
  6. Set `this.session = null` and log `console.info('[WatchManager] stop session', id, reason)`.

  Afterwards the manager owns no timers, no controllers and no listeners. A connecting watch is aborted on return (§3.4). `lastNamespaces` is kept.
- **Mode switching (per kind):** when the cluster-scope LIST returns 403, the kind switches to `mode: 'namespaced'` and starts one stream per entry in `lastNamespaces`. If `lastNamespaces` is `['all']`, the phase becomes `forbidden` with "No permission to list <Kind> cluster-wide. Select specific namespaces." and the kind waits for `setNamespaces`. `setNamespaces(ns)` diffs the stream set for namespaced kinds only:
  - A removed namespace's stream is stopped and deletes are emitted for the ids it owned.
  - An added namespace gets a new stream.
  - **`['all']` while namespaced (fixes rev-3 finding 10):** every per-namespace stream of that kind is stopped, deletes are emitted for all ids they owned (through the coalescer, so the renderer list empties), and the phase becomes `forbidden` with the same "No permission to list <Kind> cluster-wide. Select specific namespaces." message. For pods, the adapter posts `stop-informer` and pushes `resetKind('pods', [])`, then sets `forbidden` with the Pods variant of the message. Helm releases mirror Secrets (`HelmIndex.clear()` emits deletes for all releases).
- **Return to cluster mode (fixes rev-3 finding 10).** A kind stays in `namespaced` mode until one of two triggers retries cluster scope **once**:
  - `onCredentialsChanged()` (new identity may have wider RBAC);
  - the idempotent `startSession` error-recovery path (§3.7), which now also covers kinds in `namespaced` mode or `forbidden` phase.

  The retry starts a fresh cluster-scope stream for the kind. Its existing per-namespace streams keep running until the cluster LIST completes. On success, the cluster stream adopts the kind: the per-namespace streams are stopped, the kind's owned map is the cluster stream's map (its LIST diff against the union of the namespaced streams' ids emits deletes for anything that vanished), and `mode` becomes `'cluster'`. On 403, the cluster stream is stopped and the kind stays namespaced, with no further retry until the next trigger. Pods follow the same rule: the adapter posts `start-informer { mode: 'cluster' }`, and on a cluster-mode 403 falls back to `start-informer { mode: 'namespaced' }` as today.

  A 403 on one namespace stream marks only that stream. The kind is `ready` if at least one stream is ready, and `error` lists the forbidden namespaces. Pods follow the same mode: the adapter re-sends `start-informer` with `mode: 'namespaced'`, and the reset-on-sync rule removes the pods of dropped namespaces. Cluster-mode kinds ignore `setNamespaces`.
- **Auth rebuild:** `session.requestAuthRebuild()` runs at most once per 10 s per session, shared by all streams and the pod adapter. It calls `deps.createKubeConfig(session.context)`, assigns `session.kc` and bumps `kcEpoch`. Streams pick up the new `kc` on their next attempt. If the rebuild throws `UnknownContextError`, every kind goes to `error` with "Unknown kube context"; if it throws `KubeconfigLoadError`, every kind goes to `error` with "Failed to load kubeconfig". In both cases all streams stop retrying and the adapter posts `stop-informer`.
- **`onCredentialsChanged()`** runs an immediate, non-debounced rebuild. It then calls `restart()` on every stream (epoch bump, abort, re-LIST with diff, counters reset), resets `pod401Count`, sends `start-informer` again for pods with the same session id, and runs the one-shot cluster-mode retry for namespaced kinds (below). It is wired to `awsService.on('credentialsChanged')` (`main.ts:3190`), next to the existing handler, which fits the Granted live-detection flow.
- **`ensureFresh(ms)`** calls `stream.ensureFresh(ms)` on all streams (which applies the 660 s floor for non-zero `ms`, §3.4), sends `refresh { maxSilenceMs: ms }` to the pod worker (same floor in `needsRefresh`, §3.6), and calls `restart()` on any stream stuck in `error` after three 401s. If pods are in `error` after three 401s, it resets `pod401Count` and re-posts `start-informer`. Callers: window focus → `ensureFresh(300_000)`; `powerMonitor` resume → `ensureFresh(0)`.
- **Window lifecycle (wired in `main.ts`):** the per-window `webContents` handlers below are registered **inside `createWindow()`** (`main.ts:3208`), right after the `BrowserWindow` is constructed, so every window gets them, including the one macOS recreates through `app.on('activate')` (`main.ts:3293`) after `window-all-closed` did not quit. They are attached to that window's own `webContents`, so they are released with it; nothing is registered at module level.
  - `webContents.on('did-start-navigation', (d) => d.isMainFrame && !d.isSameDocument && manager.onRendererNavigated())`. This covers Cmd+R, an HMR full reload, and the initial load. `onRendererNavigated()` begins with `if (!this.session) return;`, so the initial load (and any navigation with no session) neither unbinds anything nor arms a timer. With a session, it marks the subscriber unbound (batches are discarded) and starts a **60 s idle timer**, clearing any previous idle timer first so at most one exists.
  - `render-process-gone` and `destroyed` call `detachSubscriber`, which does the same.
  - Any `startSession` or `subscribe` cancels the timer. If it expires, `stopSession('no-subscriber')` runs.
  - After a reload, `selectedCluster` is `null` (`App.tsx:41`, not persisted). If the user re-selects the same cluster within 60 s, the idempotent path returns the warm snapshot with the same `sessionId`. Otherwise the session stops.
- `window-all-closed` calls `stopSession('all-windows-closed')` and `before-quit` calls `stopSession('quit')`, next to the existing `k8sService.stopAllWatchers()` (`main.ts:418-441`, `3273-3290`). On macOS the app keeps running after `window-all-closed`; a window recreated by `activate` starts with `selectedCluster = null` and a fresh `startSession` when the user picks a cluster.
- `powerMonitor.on('resume', () => manager.ensureFresh(0))`. `powerMonitor` is **new** to `main.ts` (not used today). It is added to the existing `electron` import and the handler is registered inside the `app.whenReady().then(...)` block, because `powerMonitor` cannot be used before the `ready` event. The handler is registered once per app lifetime, so there is nothing to remove.
- **Single window:** Lumen has one `BrowserWindow` (`win`), so the manager holds one subscriber. A different sender replaces it. Multi-window support is out of scope.

### 3.8 Coalescer and IPC send

- `push(kind, op)` writes to `buffers[kind].ops.set(id, op)`, last write wins. A delete overrides an earlier upsert and the reverse. `setStatus(kind, status)` stores the latest status.
- `resetKind(kind, items)` replaces the kind's buffer with `{ reset: true, ops: Map(items as upserts) }`. Later `push` calls modify that map: an upsert sets an entry, a delete removes one.
- The first push or reset arms one `setTimeout(flush, 650)`. While empty, no timer exists.
- `flush()` builds `ResourceBatch { sessionId, seq: ++session.seq, kinds }`. For a reset kind it emits `{ reset: true, upserts: [...ops.values()], deletes: [] }`. It clears the buffers, then calls `subscriber.send('resources:batch', batch)` only if a subscriber is bound and `!subscriber.isDestroyed()`.
- Unsent batches are discarded. `seq` still increments, so a later snapshot's `seq` covers them. The main maps and the worker cache already hold the state for the next snapshot.

### 3.9 Context engine bridge (fixes review finding 6)

Today the context engine is filled by the ADDED replay of an rv-less watch, and its reconciliation depends on that replay (`context-engine.ts:73-84`). With LIST+WATCH:
- The deployments descriptor's `onListPage(rawItems)` forwards every item of each LIST page as `handleResourceEvent('Deployment', 'ADDED', raw)`, page by page, before the page is trimmed and released (§3.4 hook contract). `rawItems` are already `toWireShape`d (§3.3), so the context engine receives string timestamps from LIST exactly as it does from WATCH, and `extractDeploymentSnapshot`'s `age` (`extractors.ts:103`) has one type. Its `onListComplete(deletedIds, deletedMeta)` then forwards every diff delete as `'DELETED'` with a `{ metadata: { name, namespace } }` stub built from `deletedMeta`.
- Watch events forward raw objects as `'ADDED' | 'MODIFIED' | 'DELETED'`, which keeps the current behavior at `main.ts:1993-1998`.
- Pods use the adapter's existing pseudo-raw bridge (§3.6), plus DELETED events on reset.
- **`resyncContextEngine()`** runs on the idempotent `startSession` path. `App.handleClusterSelect` always sends `context:clusterSwitch` first (`App.tsx:774`), which calls `contextEngine.onClusterSwitch()` and wipes the store (`context-engine.ts:102-115`). Both messages come from the same renderer, so Electron delivers them in order, and the clear always lands before the resync. The resync replays each trimmed `DeploymentItem` (raw-shaped enough for `extractDeploymentSnapshot`, §3.3) as `ADDED`. For pods it requests a **fresh** `get-pods-chunk { requestId, sessionId }` from the worker (the same 10 s timeout as snapshots) and replays it as pseudo-raw `ADDED` pods, accepting the reply only if `reply.sessionId === session.id && reply.synced`; it also rebuilds `podUidMap` from that reply. An unaccepted or timed-out reply replays nothing: the next `informer-synced` reset feeds the engine anyway. The adapter does **not** retain any chunk after a reset is applied (rev 3's "last chunk" is dropped), so main never holds a full pod copy beyond the in-flight reply. The buildSnapshot chunk and the resync chunk are requested independently; that is two in-process messages on a re-select, which is acceptable. It is idempotent because the engine upserts.
- Secrets, ConfigMaps and Services were not fed to the context engine before, and they still are not. When the session stops, `clearKind` runs for Deployment and Pod.

Alternative rejected: making `context:clusterSwitch` stop the session. That would throw away the warm cache on every same-cluster re-select, including the reload-and-reselect case this design keeps warm.

### 3.10 Legacy code removed

These channels lose their only consumers. They are removed together with their preload methods and their `src/vite-env.d.ts` / `electron/electron-env.d.ts` types.
- **Main IPC**:
  - `k8s:watchDeployments` / `k8s:stopWatchDeployments`
  - `k8s:watchHelmReleases` / `k8s:stopWatchHelmReleases`
  - `k8s:watchPods` / `k8s:stopWatchPods` (no `src/` caller)
  - `start-pod-informer` / `stop-pod-informer`
  - the `get-pods-chunk` handler (`main.ts:~2219`)
- **Main sends**:
  - `k8s:deploymentChange`, `k8s:podChange`
  - `k8s:deploymentBatchChange`, `k8s:podBatchChange`, `k8s:helmReleaseBatchChange`
  - `k8s-pod-delta-batch`, `k8s-pod-informer-synced`, `k8s-pod-informer-error` (`main.ts:330, 379-386`). Leaving these in place would double pod IPC volume.
- **Main globals**: `deploymentBatchBuffer`, `podBatchBuffer`, `helmBatchBuffer`, and the legacy scope trackers `lastPodWatchScope` / `lastDeploymentWatchScope` (`main.ts:227-228`, used at 1897-1899 and 1969-1971). The `context:clusterSwitch` handler (`main.ts:2385-2392`) loses its two scope resets and keeps `contextEngine.onClusterSwitch()` and `k8sService.clearWatchResourceVersions()` (still needed by node and non-core generic watches). `pendingChunkRequests` and `podUidMap` move into `PodWorkerAdapter`. The `spawnPodWorker` message switch delegates to `manager.onPodWorkerMessage(msg)`, and its exit/respawn calls `manager.onPodWorkerRespawned()` after the new worker is assigned.
- **K8sService**: `startDeploymentWatch`, `startHelmReleaseWatch`, `startPodWatch` and their stop methods.
- **Preload**:
  - `onDeploymentChange`, `onPodChange`, `onPodBatchChange`, `onDeploymentBatchChange`
  - `watchDeployments`, `stopWatchDeployments`, `watchPods`, `stopWatchPods`
  - the `podWorker` namespace (`preload.ts:~460-482`), along with `onPodWorkerCount` and its types
  - `helm.watchHelmReleases`, `helm.stopWatchHelmReleases`, `helm.onHelmReleaseBatchChange` (`vite-env.d.ts:294-296`)
- **Kept**: `helm.getReleases` (one-shot list; **no current renderer caller**, only its type at `vite-env.d.ts:289`), detail, history, rollback and uninstall. Decision: keep it rather than remove it, because it is a small, side-effect-free invoke that the Helm detail/rollback flows may want for a manual refresh, and removing it is unrelated to this change. It is not used by the cache and not counted in diagnostics.
- **Pod worker protocol**: `get-pod-count`, `pod-count-reply`, `informer-stopped` and their `main.ts` handlers (§3.6).

`k8s:genericResourceChange` stays for non-core kinds. Secrets leave the generic path, so raw Secret data is no longer sent (fixes D4 for Secrets). The raw duplicate send for the remaining worker-batched kinds (replicasets, PVs, PVCs, `main.ts:2111`) is dropped, because the renderer consumes only the batch channel for those kinds (`Dashboard.tsx:686-700`).

The implementer greps `src/` for each removed symbol before deleting it. Any surviving consumer is migrated to the store, or the symbol is kept and the reason recorded in the task notes.

---

## 4. Data correctness

- **Event handling**: ADDED and MODIFIED upsert by id. DELETED removes by id. Re-list diffs emit deletes, and pod (re)syncs emit a `reset`. Every apply is idempotent and last-write-wins, so replaying a buffered op after a snapshot is safe.
- **Snapshot and delta ordering**: the snapshot's `seq` is read *after* the pod chunk resolves, in the same tick as the map copies (§3.7). The renderer drops batches with `seq <= snapshot.seq`.
- **Session isolation** has three layers:
  1. In main, `stopped` and the epoch guards on every continuation.
  2. In main, a `sessionId` filter on every worker and decode result.
  3. In the renderer, the store drops any batch whose `sessionId !== store.sessionId`, increments `droppedBatches`, and logs `console.debug`.

  Late snapshots are handled by the renderer request token (§6.2) and main's superseded check (§3.7).
- **Cluster switch order**:
  1. The renderer bumps `reqToken`, so earlier snapshot promises are ignored.
  2. The renderer calls `store.reset(ctx)`. Lists go empty and phases go to `loading`, so old-cluster data never shows under the new name.
  3. The renderer invokes `startSession(B)`.
  4. Main stops session A *synchronously* before creating B.
  5. The renderer applies B's snapshot, only if the token still matches.
- **Gap detection and backstop**: if `batch.seq > state.seq + 1`, or 5 consecutive batches with a *different* non-null session id arrive while the store already holds a snapshot, `applyBatch` returns `'gap'` or `'resubscribe'`. The controller then calls `subscribe()` **under the same request token** (single-flight, never while the initial `startSession` is pending) and applies the result only if that token is still current. Batches that arrive before the first snapshot are dropped without counting, because the snapshot covers them. The exact rules are in §6.1 and §6.2. With ordered Electron IPC neither case is expected; this is a safety net, not the primary guard.
- **Namespace change**: in cluster mode there is no watch restart, and views filter with `filterByNamespaces` (§6.3). In namespaced mode, stream diffs (§3.7) and the pod reset delete the items of removed namespaces.

---

## 5. IPC contract

### 5.1 Invoke channels (`electron/ipc/resource-cache-ipc.ts`, via `safeHandle`)

`safeHandle` validates `undefined` when no argument is passed (`validation.ts:33`), so channels without arguments use `z.undefined()`.

| Channel | Input (zod) | Returns | Failure behaviour |
|---|---|---|---|
| `resources:startSession` | `z.object({ context: z.string().min(1).max(253), namespaces: NamespacesSchema.optional() })` | `ResourceSnapshot` | Schema failure rejects with "IPC validation failed" and an audit log entry (existing `safeHandle` behavior). An unknown context (`createKubeConfig` throws `UnknownContextError`) rejects with `Error('Unknown kube context')`. Any other kubeconfig load failure (`KubeconfigLoadError`, e.g. malformed YAML) rejects with `Error('Failed to load kubeconfig')`, a fixed string that never includes the raw message; the existing session is untouched and only the error name is logged. `Error('Session superseded')` is possible only during a concurrent switch, and the renderer ignores it because of the token. API failures do **not** reject: they surface as per-kind `status`. |
| `resources:subscribe` | `z.undefined()` | `ResourceSnapshot \| null` (null when there is no session) | Never rejects. A pod chunk timeout yields pods `[]` with phase `reconnecting`. |
| `resources:stopSession` | `z.undefined()` | `true` | Idempotent. |
| `resources:setNamespaces` | `z.object({ namespaces: NamespacesSchema })` | `true` | Schema failure rejects. Always records `lastNamespaces`. With no session, nothing else happens. |
| `resources:ensureFresh` | `z.undefined()` | `true` | Never rejects. Calls `manager.ensureFresh(300_000)`; streams and the pod worker apply the 660 s floor (§3.4, §3.6), so the effective threshold is 660 s. Resume uses `ensureFresh(0)` directly in main and is not exposed over IPC. |
| `resources:getDiagnostics` | `z.undefined()` | `ResourceCacheDiagnostics` | Never rejects. The worker diagnostics part has a 2 s timeout and is `null` on timeout. |

`NamespacesSchema = z.array(z.union([z.literal('all'), z.string().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/).max(63)])).min(1).max(100)`.

The IPC module counts each invoke in `invokeCounts`, keyed by channel, for diagnostics.

### 5.2 Push channel and preload

`resources:batch` → `ResourceBatch`. All kinds share one channel, so the renderer has exactly one listener.

```ts
resources: {
  startSession: (args: StartSessionArgs) => ipcRenderer.invoke('resources:startSession', args),
  subscribe: () => ipcRenderer.invoke('resources:subscribe'),
  stopSession: () => ipcRenderer.invoke('resources:stopSession'),
  setNamespaces: (namespaces: string[]) => ipcRenderer.invoke('resources:setNamespaces', { namespaces }),
  ensureFresh: () => ipcRenderer.invoke('resources:ensureFresh'),
  getDiagnostics: () => ipcRenderer.invoke('resources:getDiagnostics'),
  onBatch: (cb: (batch: ResourceBatch) => void) => {
    const listener = (_e: IpcRendererEvent, batch: ResourceBatch) => cb(batch);
    ipcRenderer.on('resources:batch', listener);
    return () => { ipcRenderer.off('resources:batch', listener); };
  },
  listenerCount: () => ipcRenderer.listenerCount('resources:batch'),   // fixed channel; diagnostics only
},
```

The types go in `src/vite-env.d.ts` (and the mirrored `electron/electron-env.d.ts`) under `window.k8s.resources`, using `import type` from `src/types/resource-cache.ts`.

D6 fix: `app.onWindowFocused` stores its named listener and disposes it with `ipcRenderer.off('app:windowFocused', listener)`.

### 5.3 Non-core generic watch keys (D3) without leaks

- **Renderer**: in `Dashboard.tsx`'s generic effect, each watch key becomes `${view}@${clusterName}#${++watchNonceRef.current}`, and namespaced keys append `:${ns}`. A late in-flight event carries the old key, and the existing `activeWatchKeys.has(resourceType)` check (`Dashboard.tsx:686, 705`) drops it.
- **Main**: `WATCH_KEY_TO_WORKER_TYPE` lookups use the base key, `resourceType.split('@')[0]`.
- **Leak prevention**: unique keys would grow the generation maps without bound. `K8sService` keys these maps as `` `generic:${resourceType}` `` (`k8s.ts:2211, 2290`), and `startGenericWatch` calls `stopGenericWatch(resourceType)` as its first line on **every internal reconnect** (`k8s.ts:2209`, reached from the reconnect timer at `k8s.ts:2271-2274`). The reconnect path deletes `activeWatchers` before that call (`k8s.ts:2270`), so today `stopGenericWatch` only bumps the generation there and the rv survives. `stopGenericWatch` is therefore **left unchanged**, and a new method does the final cleanup:
  ```ts
  disposeGenericWatch(resourceType: string) {
    this.stopGenericWatch(resourceType);                 // bumps gen, aborts, clears active/rv/attempts if active
    const k = `generic:${resourceType}`;
    this.watchGenerations.delete(k);
    this.watchResourceVersions.delete(k);
    this.watchReconnectAttempts.delete(k);
  }
  ```
  After the delete, the existing `gen !== this.watchGenerations.get(watcherKey)` checks (`k8s.ts:2228, 2239, 2272, 2279`) compare against `undefined` and always drop late callbacks, so no `?? -1` is needed.
  - Only the `k8s:stopWatchGenericResource` IPC handler calls `disposeGenericWatch`. It also runs `genericWatchGenerations.delete(resourceType)` on the main-side map.
  - The sizes of these maps are reported as `legacyMaps` in diagnostics (§9).

### 5.4 Payload trimming summary

The list payloads contain:
- no `managedFields`;
- no last-applied annotation;
- no Secret or ConfigMap values;
- no Helm blobs or manifests.

The pod payload is the existing `LightweightPod`. Full objects still come only from detail fetches (`getSecret`, `getConfigMap`, `getDeployment`, `helm.getRelease`).

---

## 6. Renderer design

### 6.1 Store (`src/stores/resourceStore.ts`)

It follows the existing `create` pattern in `src/stores/orgStore.ts`, with no middleware.

```ts
interface KindSlice<K extends CoreKind> { byId: ReadonlyMap<string, KindItemMap[K]>; status: KindStatus; }
interface ResourceStoreState {
  sessionId: string | null; context: string | null; seq: number;
  droppedBatches: number; consecutiveMismatches: number;    // diagnostics + backstop
  kinds: { [K in CoreKind]: KindSlice<K> };
  reset(context: string | null): void;                      // all kinds → empty Map, phase 'loading'
  applySnapshot(s: ResourceSnapshot): void;                 // replaces everything in one set()
  setAllStatus(status: Pick<KindStatus, 'phase' | 'error'>): void;
    // one set(); every kind gets a NEW status object { ...old, phase, error }; every byId reference is kept.
    // Used by handleStartError (§6.2). Does not touch sessionId/seq.
  applyBatch(b: ResourceBatch): 'applied' | 'dropped' | 'gap' | 'resubscribe';
}
```

- `applyBatch` does one `set()` per batch. Only the kinds present in the batch get a **new** `Map`:
  - with `reset`: `new Map(upserts.map(i => [i.id, i]))`;
  - otherwise: copy the map, apply deletes, then apply upserts.

  Kinds not in the batch keep the same `byId` and `status` references, so their subscribers do not re-render.
- **The single rule for `reset`, `applySnapshot` and `applyBatch`** (fixes review-2 finding 3):
  ```ts
  reset(context) {
    set({ context, sessionId: null, seq: 0, consecutiveMismatches: 0, kinds: emptyKinds('loading') });
  },
  applySnapshot(snap) {
    set({ sessionId: snap.sessionId, seq: snap.seq, consecutiveMismatches: 0, kinds: kindsFromSnapshot(snap) });
  },
  applyBatch(b) {
    const s = get();
    if (s.sessionId === null) return 'dropped';                // awaiting snapshot: it covers this batch; NOT counted
    if (b.sessionId !== s.sessionId) {
      const n = s.consecutiveMismatches + 1;
      set({ droppedBatches: s.droppedBatches + 1, consecutiveMismatches: n });
      return n >= 5 ? 'resubscribe' : 'dropped';
    }
    if (b.seq <= s.seq) return 'dropped';                      // already covered by the snapshot
    if (b.seq > s.seq + 1) { /* apply anyway (idempotent ops) */ applyKinds(b); set({ seq: b.seq, consecutiveMismatches: 0 }); return 'gap'; }
    applyKinds(b); set({ seq: b.seq, consecutiveMismatches: 0 });   // one set() in the implementation
    return 'applied';
  },
  ```
  `reset` always nulls `sessionId`. So after an A→B switch, A's in-flight batches are dropped by the null check (they cannot match B, and they are not counted), and the 10 s worst-case pod-chunk await during `startSession` cannot produce a spurious `'resubscribe'`. Mismatches are counted only once a snapshot has set a session id, which is the only state in which a mismatch means main has moved on without telling the renderer.
- The store holds no derived arrays.

### 6.2 Sync hook (`src/hooks/useResourceSync.ts` over `src/hooks/resource-sync-controller.ts`), mounted once in `App.tsx`

The logic below lives in a plain controller so it can be unit-tested without a DOM (§11). The hook only wires React effects to it. The effect is shown inline for clarity.

The hook takes `selectedCluster` and `syncEpoch`, and owns `reqTokenRef`, `prevClusterRef` and `disposeRef`. Because it is mounted in `App.tsx`, a Dashboard remount does not touch it. **It does not read `connectionStatus` (fixes rev-3 finding 1).** `App.handleClusterSelect` (`src/App.tsx:764-833`) sets `connectionStatus = 'connecting'` while `selectedCluster` is still the old cluster A, and on pre-flight failure it sets `'error'` and leaves `selectedCluster = A` with A's Dashboard mounted. Gating on `connectionStatus` would dispose the only batch listener in those states and never restore it. `selectedCluster` is only ever set non-null after a successful pre-flight (`App.tsx:788`; the only other setter is `null` at ~1676), so it alone is a sufficient gate.

**`syncEpoch` (new App state).** `App.tsx` adds `const [syncEpoch, setSyncEpoch] = useState(0)`. `handleClusterSelect` calls `setSyncEpoch((e) => e + 1)` in **both** paths:
- the success path, right after `setSelectedCluster(clusterName)` / `setConnectionStatus('connected')` (React batches them, so a real switch re-runs the effect once);
- the `catch` path, after `setConnectionStatus('error')`.

The hook is mounted as `useResourceSync(selectedCluster, syncEpoch)`. Each connect attempt therefore re-runs the effect exactly once:
- **Successful switch A→B**: `selectedCluster` changes; normal switch.
- **Successful re-select of A**: `selectedCluster` is unchanged, the epoch bump re-runs the effect, and the idempotent `startSession(A)` runs `resyncContextEngine()` after `context:clusterSwitch` cleared the engine (this is what the rev-3 `connectionStatus` dependency used to trigger).
- **Failed switch to B (or failed retry of A)**: `selectedCluster` is still A, the bump re-runs the effect, the cleanup disposes the old listener and the re-run immediately installs a new one, followed by an idempotent `startSession(A)` that re-feeds the context engine and returns a fresh snapshot. A batch listener is never missing while a Dashboard is mounted.
- During `'connecting'` nothing re-runs, so the listener stays installed and A's data keeps updating.

```ts
useEffect(() => {
  const prev = prevClusterRef.current;
  prevClusterRef.current = selectedCluster;
  const token = ++reqTokenRef.current;
  if (!selectedCluster) {
    if (prev) {                               // non-null → null only (back to cluster list)
      void window.k8s.resources.stopSession();
      useResourceStore.getState().reset(null);
    }
    return;
  }
  const store = useResourceStore.getState();
  if (store.context !== selectedCluster) store.reset(selectedCluster);   // no flash on idempotent re-run
  const off = window.k8s.resources.onBatch((b) => {
    if (token !== reqTokenRef.current) return;
    const r = useResourceStore.getState().applyBatch(b);
    if (r === 'gap' || r === 'resubscribe') resubscribe(token);
  });
  disposeRef.current = off;
  startSessionFor(token);   // startPending = true; startSession({ context, namespaces: namespacesRef.current })
                            //   .then(snap => token === reqTokenRef.current && applySnapshot(snap))
                            //   .catch(err => token === reqTokenRef.current && handleStartError(err))
                            //   .finally(() => { startPending = false; })
  return () => { reqTokenRef.current++; off(); disposeRef.current = null; };
}, [selectedCluster, syncEpoch]);
```

- **`resubscribe(token)`** keeps the **same token**. It never bumps `reqTokenRef`, so the effect's `onBatch` listener (which closes over `token`) keeps delivering batches afterwards. It is single-flight and does not run during the initial start:
  ```ts
  let startPending = false;      // true from startSession() call until it settles
  let resubscribing = false;
  function resubscribe(token: number) {
    if (startPending || resubscribing || token !== reqTokenRef.current) return;
    resubscribing = true;
    window.k8s.resources.subscribe()
      .then((snap) => {
        if (token !== reqTokenRef.current) return;
        if (snap) useResourceStore.getState().applySnapshot(snap);
        else startSessionFor(token);            // session gone: same token, sets startPending
      })
      .catch(() => { /* subscribe never rejects (§5.1); nothing to do */ })
      .finally(() => { resubscribing = false; });
  }
  ```
  `startSessionFor(token)` is the same code the effect uses for its initial `startSession` (it sets `startPending = true` and clears it in `finally`). Both flags live in the controller (§11) and are reset by `dispose()`.
- `handleStartError` ignores `'Session superseded'`. For any other error it calls `useResourceStore.getState().setAllStatus({ phase: 'error', error })` with `error` = "Unknown kube context" or "Failed to load kubeconfig" when the rejection message is exactly one of those fixed strings, otherwise "Failed to start resource sync" (never the raw message), and shows a toast through the existing `showToast`.
- **Window reload**: `selectedCluster` starts as `null` (`App.tsx:41`) and `prev` is `null`, so nothing stops. Main's idle timer (§3.7) keeps the session warm for 60 s. If the user re-selects the cluster in that window, the idempotent path returns the warm snapshot with the same id.
- **Fast Refresh / StrictMode**: the cleanup bumps the token and disposes only its own listener. The re-run sees `store.context === selectedCluster`, skips the reset, and gets the idempotent snapshot. `import.meta.hot?.dispose(() => disposeRef.current?.())` is a backstop.
- **Focus**: `window.addEventListener('focus', () => window.k8s.resources.ensureFresh())`, registered in its own effect with cleanup. It does not use `app.onWindowFocused`. Main maps it to `ensureFresh(300_000)` with the 660 s floor (§3.4, §5.1), so alt-tabbing never churns healthy quiet watches.
- **Namespaces**: `namespacesRef` mirrors the latest `selectedNamespaces`, which is lifted to App through a callback (below). Dashboard has an effect on `selectedNamespaces` that calls `window.k8s.resources.setNamespaces(selectedNamespaces)` and reports the value up through an `onNamespacesChange` prop that writes `namespacesRef`. Main records it whether or not a session exists, which resolves review finding 10.

### 6.3 Selector hooks (`src/hooks/useResourceList.ts`)

```ts
export function useResourceMap<K extends CoreKind>(kind: K) {
  return useResourceStore((s) => s.kinds[kind].byId);
}
export function useResourceList<K extends CoreKind>(kind: K, selectedNamespaces: string[]) {
  const byId = useResourceMap(kind);
  const nsKey = selectedNamespaces.join(',');
  return useMemo(() => filterByNamespaces(Array.from(byId.values()), nsKey.split(',')), [byId, nsKey]);
}
export function useResourceStatus(kind: CoreKind) {
  return useResourceStore((s) => s.kinds[kind].status);   // stable reference; no useShallow needed
}
export function useResourceCount(kind: CoreKind | null, selectedNamespaces: string[]): number {
  const nsKey = selectedNamespaces.join(',');
  // The selector returns a primitive, so zustand's Object.is check re-renders the caller
  // only when the count actually changes, not on every batch of that kind.
  return useResourceStore(
    useCallback((s: ResourceStoreState) => (kind ? countInNamespaces(s.kinds[kind].byId, nsKey) : -1), [kind, nsKey]),
  );
}
```

`countInNamespaces(byId, nsKey)` is a pure helper in `src/utils/resource-utils.ts`: `byId.size` when `nsKey` contains `all`, otherwise a loop over `byId.values()` counting `nsOf(it)` hits. It runs on every store change (O(n) for the active kind only, about 1 ms for 20k items), which is cheaper than re-rendering the 1589-line `Dashboard`.

**Rule: `Dashboard` and `DashboardContent` never subscribe to any `byId` and never select a non-primitive from the resource store.** Their only store reads are `useResourceCount` (a number) and non-reactive `useResourceStore.getState()` inside event handlers. A lint-free way to check this during review: grep both files for `useResourceStore(` / `useResourceMap(` / `useResourceList(`; the only hit allowed is inside `useResourceCount`.

`filterByNamespaces` and `nsOf` are pure functions in `src/utils/resource-utils.ts`. `nsOf` reads `item.namespace` for every core kind. `countInNamespaces` is added there too. Selectors return a stored `Map` reference, a stored status reference, or a primitive. They never return a fresh object, which avoids zustand v5's "getSnapshot should be cached" loop. No `useShallow` is needed anywhere.

---

## 7. View migration

A new file, `src/components/dashboard/views/CoreResourceViews.tsx` (~280 lines), holds thin connected wrappers. Each wrapper subscribes to **one** kind.

| Wrapper | Reads | Renders |
|---|---|---|
| `ConnectedDeploymentsView` | `useResourceList('deployments', ns)`, `useResourceStatus` | The existing `DeploymentsView`, which already sorts with `useResourceSorting`. |
| `ConnectedPodsView` | `useResourceList('pods', ns)`, status, and the `podMetrics`/`nodes` props | The existing `PodsView`. The pod enrichment and `useResourceSorting` move here from `DashboardContent.tsx` (Pods branch) and are wrapped in `useMemo`. |
| `ConnectedServicesView` / `ConnectedConfigMapsView` / `ConnectedSecretsView` | their own kind | `GenericResourceView`, with the column definitions moved unchanged from `DashboardContent.tsx`. It keeps its internal `useResourceSorting`. |
| `ConnectedHelmReleasesView` | `'helmreleases'` | The existing `HelmReleasesView` (prop `helmReleases`, `isLoading = phase === 'loading' && size === 0`). |
| `useOverviewPodStats(selectedNamespaces)` | pods map | The `podStatusStats` memo moved from `DashboardContent.tsx:183-204`, keeping its stable-reference trick. It iterates `byId.values()` and skips any pod where `!ns.includes('all') && !ns.includes(pod.namespace)`. Today the pod worker itself is scoped to `selectedNamespaces` (`DashboardContent.tsx:160-164`, `k8s-pod-worker.ts:158-166`), so the stats reflect the selection; with cluster-wide streams the filter has to move here to keep that behaviour. `OverviewView` gets deployments from `useResourceList('deployments', ns)`. Overview `isLoading = pods.phase === 'loading' && pods.size === 0`. The hook is called from a small `ConnectedOverviewView` wrapper, not from `DashboardContent`. |

Prop mapping, which is the same for every wrapper (resolves review finding 12):
- `isLoading = status.phase === 'loading' && list.length === 0`.
- `isUpdating = status.phase === 'reconnecting'`. The existing small spinner (`GenericResourceView.tsx:360`, `PodsView.tsx:502`) now means "reconnecting, data may be stale". `useDashboardWatchers`' old `isUpdating` flag is removed.
- `PodsView`: `isSynced = status.phase === 'ready'`, `error = status.error`.
- `reconnecting`, `error` or `forbidden` phases also show the existing warning or error glass card above the table, and the stale rows stay visible.

Edits to `DashboardContent.tsx`:
- Remove `usePodWorker`, the local pod sorting, and the props `pods`, `deployments`, `services`, `configMaps`, `secrets`, `helmReleases`, `helmReleasesLoading`, `onPodWorkerCount` and `isUpdating`.
- Each core branch renders its connected wrapper.
- `DashboardContent` stays `React.memo` and subscribes to no core kind (the §6.3 rule). A pod MODIFIED batch therefore re-renders only `ConnectedPodsView` or `ConnectedOverviewView`, and only if mounted. An ADDED/DELETED batch that changes the active view's visible count additionally re-renders `Dashboard` once (the header count), and because Dashboard's handlers are inline functions that breaks `DashboardContent`'s memo for that render. That is bounded by count changes, not by batch rate. Memoizing Dashboard's handlers with `useCallback` is not required for correctness and is left out of scope.

Edits to `Dashboard.tsx`:
- Remove the `deployments`, `pods`, `services`, `configMaps` and `secrets` state, the `helmReleases*` state, the `useDashboardWatchers` call, the helm watcher effect (354-389), and the `services`/`configmaps`/`secrets` entries in `shapeResource`, `RESOURCE_WATCH_MAP` and `WORKER_BATCH_TYPES`.
- Remove the `services`/`configmaps` branches of `loadResources` and the matching lines in the cluster-wipe effect (263-311).
- **`getCurrentViewData`** (`Dashboard.tsx:206`, used only at line 757 to decide `setLoading(true)` in `loadResources`): the `overview`, `pods`, `deployments`, `services`, `configmaps` and `secrets` branches (lines 207-209, 211, 231, 232) are replaced by one early check, `if (coreKindForView(activeView) !== null || activeView === 'overview') return true;`. Core and overview views no longer read Dashboard's `loading` flag (their loading state comes from `status.phase`, §7 prop mapping), so returning `true` just prevents a pointless `setLoading(true)`. It does not read the store, so it adds no subscription.
- **Header count**: Dashboard calls exactly one `const coreCount = useResourceCount(coreKindForView(activeView), selectedNamespaces)` at top level. `coreKindForView(view): CoreKind | null` is a pure helper in `src/utils/resource-utils.ts` backed by an explicit table (view ids as used in `Dashboard.tsx`/`DashboardContent.tsx`; the Helm view id is `'helm-releases'`, `Dashboard.tsx:1311`, `DashboardContent.tsx:947`):

  | `activeView` | `CoreKind` |
  |---|---|
  | `'deployments'` | `'deployments'` |
  | `'pods'` | `'pods'` |
  | `'secrets'` | `'secrets'` |
  | `'configmaps'` | `'configmaps'` |
  | `'services'` | `'services'` |
  | `'helm-releases'` | `'helmreleases'` |
  | anything else, including `'overview'` | `null` |

  ```ts
  const VIEW_TO_CORE_KIND: Readonly<Record<string, CoreKind>> = {
    deployments: 'deployments', pods: 'pods', secrets: 'secrets',
    configmaps: 'configmaps', services: 'services', 'helm-releases': 'helmreleases',
  };
  export const coreKindForView = (view: string): CoreKind | null =>
    Object.prototype.hasOwnProperty.call(VIEW_TO_CORE_KIND, view) ? VIEW_TO_CORE_KIND[view] : null;
  ```
  The `hasOwnProperty` check keeps `'constructor'`/`'toString'` from resolving through the prototype. `getResourceCount` returns `coreCount` when `coreKindForView(activeView)` is non-null, and keeps its existing logic otherwise. Because `useResourceCount` selects a number (§6.3), Dashboard re-renders only when the visible count changes (a pod added or removed in the selected namespaces), not on every MODIFIED batch. For non-core views the selector returns the constant `-1` and never triggers a render.
- **`handleNavigate`** (`Dashboard.tsx:1130-1160`) does a non-reactive read:
  ```ts
  const s = useResourceStore.getState();
  // deployments: iterate s.kinds.deployments.byId.values(), match d.name/d.namespace (DeploymentItem has metadata too)
  // pods:        iterate s.kinds.pods.byId.values(), match p.name/p.namespace   (LightweightPod has no metadata)
  ```
  The other kinds keep their current lookups. When a resource is not found, the code falls back to the existing on-demand fetch.
- `watchEpoch` stays only for the node watcher and the non-core generic effect.
- `handleScaleDeployment`'s `await loadResources()` (~line 1270) is dropped for deployments, because the watch delivers the change.
- A new effect `[selectedNamespaces]` calls `setNamespaces` and the `onNamespacesChange` prop (§6.2).

Files removed:
- `src/hooks/useDashboardWatchers.ts` (its only consumer is Dashboard).
- `src/hooks/usePodWorker.ts` and `usePodWorker.pbt.test.ts`. The property tests move to `resourceStore.test.ts` and run against `applyBatch`: idempotent add/update, delete no-op, order independence, and reset replacing the map.

`useDashboardState.ts` has no importers (dead today). It stays untouched and is out of scope.

Sorting: `useResourceSorting` remains the single source of truth. Views call it exactly as they do today, and no sorting logic goes into the store.

**Known limitation (review finding 24):** `selectedNamespaces` is Dashboard-local state (`Dashboard.tsx:40`). A remount (Settings and back) resets it to `['all']`, and that value is sent to main. In cluster mode, which is the default and the common case, this changes nothing. In namespaced (403) mode, the per-namespace streams stop and the kind shows `forbidden` until the user re-selects namespaces. That matches today's behavior, where namespace selection is also lost on remount. Hoisting `selectedNamespaces` into a store is decision point 7.

---

## 8. Error handling matrix

| Operation | Failure | Recoverable? | Caller sees | Logged |
|---|---|---|---|---|
| LIST (cluster scope) | 403 | yes: switch to namespaced | kind `mode='namespaced'`; `forbidden` if ns=`['all']` | `info` once per kind |
| LIST / WATCH | 401 | yes, ≤3 consecutive per stream | Debounced shared kc rebuild (≤1 per 10 s per session) plus re-LIST. After the 3rd consecutive 401: phase `error` "Authentication failed: refresh credentials", no more retries until `onCredentialsChanged`/`ensureFresh`. | `warn` per 401 (code + kind only), `error` at give-up |
| kc rebuild | context removed from kubeconfig | no | all kinds `error` "Unknown kube context" | `warn` |
| LIST continue | 410 | yes | transparent restart without `_continue` | `info` |
| WATCH | 410 (HTTP or ERROR event) | yes | transparent re-LIST with diff | `info` |
| WATCH | normal close ≥5 s or after ≥1 event | yes | transparent re-watch from rv after 500 ms | none |
| WATCH | `stop()` while connecting | n/a | controller aborted on return (§3.4) | none |
| LIST / WATCH | ECONNRESET / ETIMEDOUT / 5xx / DNS | yes: backoff ≤30 s, forever while the session lives | phase `reconnecting`, items kept | `warn` on the 1st and every 10th attempt |
| LIST | 404 | no | phase `error` "Resource type not served by cluster" | `error` once |
| Helm decode | invalid blob / `failures[]` entry | per item | release falls back to the next decoded revision, or is left out; the secret stays listed | `warn` once per uid (no contents) |
| Transform worker | crash / exit / 15 s timeout | yes (new worker on next send) | only that worker's pending promises resolve with `error` (§3.5.1); a newer worker is never nulled or failed | `error` (crash), `warn` (timeout) |
| Pod worker | crash (exit ≠ 0) | yes (existing 2 s respawn) | pods `reconnecting`, then `onPodWorkerRespawned` restarts the informer and the sync triggers a reset | `error` |
| Pod informer | LIST error (5xx / network) | yes (worker backoff ≤30 s) | pods `reconnecting` | `warn` (code only) |
| Pod informer | 403 in cluster mode | yes: switch to namespaced | `start-informer { mode: 'namespaced' }`; `forbidden` if ns=`['all']` | `info` once |
| Pod informer | 403 on one namespace (namespaced mode) | no, for that namespace (until `setNamespaces`/credentials change) | rec marked `forbidden`, no retry; `informer-synced` still posted for the other recs; pods `ready` with error "No permission to list Pods in: ns1, ns2"; `forbidden` if every rec is forbidden | `info` once per namespace |
| Pod informer | 401 | yes, ≤3 consecutive (counted once per `start-informer`) | worker: rec `errored`, **no** retry. Adapter: `requestAuthRebuild()` + backoff + re-post `start-informer` (fresh `sessionKc` → fresh exec token); pods `reconnecting`. 3rd consecutive 401: pods `error` "Authentication failed: refresh credentials", `stop-informer`. Counter resets on `informer-synced`, `onCredentialsChanged`, `ensureFresh` error restart and same-context `startSession` recovery. | `warn` per 401 (code only), `error` at give-up |
| Pod informer | internal re-watch racing `stop()` | bounded | socket lives ≤ `timeoutSeconds` (600 s), events ignored by `live(rec)` | none |
| Pod informer | `AbortError` from our own `stop()` | n/a | ignored (`disposed` flag + name check); no retry, no `informer-error` | none |
| Pod informer | 5 consecutive fast closes | yes | rec replaced after backoff; pods stay `ready` with last data | `warn` once per rebuild |
| Pod chunk | reply for another generation or unsynced | yes | treated as `[]`/`loading`; the next `informer-synced` reset fills it | none |
| Pod worker | `post` during the 2 s respawn window | yes | `post` returns false; snapshot pods `[]`/`reconnecting` immediately; `onPodWorkerRespawned` resends `start-informer` | none |
| WATCH | normal close <5 s with 0 events | yes | counted as failure: backoff, 3-strike re-LIST | `warn` on 1st and every 10th |
| `startSession` (same context) | session has kinds in `error` | yes if kubeconfig is fixed | kc rebuilt, errored streams restarted; else rejects `Unknown kube context` | `info` / `warn` |
| Helm decode | whole-request failure (crash/exit/timeout, no events, no failures) | yes, once | each still-current max uid reset to `decodeState: 'none'` + `retryOnce`, retried by one `readSecret` + one-item decode; a second whole-request failure sets `'failed'` (label-derived summary stays) | `warn` |
| Pod chunk | 10 s timeout | yes | snapshot pods `[]` + `reconnecting`; the next sync reset repairs it | `warn` |
| `send` to renderer | webContents destroyed / navigating | yes | subscriber unbound, 60 s idle stop | `info` |
| IPC validation | bad args | no | rejected promise "IPC validation failed: …" | audit log (existing) |
| `startSession` | unknown context | no | rejects `Error('Unknown kube context')`; renderer phase `error` + toast; the existing session is untouched | `warn` |
| `startSession` / kc rebuild | kubeconfig fails to load (malformed YAML, unreadable file) → `KubeconfigLoadError` | yes, once the file is fixed and the cluster re-selected | rejects `Error('Failed to load kubeconfig')` (fixed string); existing session untouched. During an auth rebuild: all kinds `error` "Failed to load kubeconfig" | `warn` (error name only) |
| Helm fallback fetch | `readSecret` fails (404, 403, network) | per release | label-derived summary stays (revision/status correct, chart fields blank) | `warn` once per uid (code only) |
| Helm fallback fetch | result has same uid but newer rv than the index entry (watch lagging) | yes, on the next event/re-LIST with that rv | entry `'failed'`, non-corrupt; label-derived summary stays; no re-fetch | none |
| Cluster-mode retry for a namespaced kind | 403 again | yes (next trigger) | kind stays namespaced; per-namespace streams untouched | `info` |
| Renderer cluster switch | pre-flight fails | yes | `syncEpoch` bump re-runs the sync effect for the still-selected cluster: listener re-installed, idempotent `startSession`, fresh snapshot | none (existing App toast) |
| `startSession` | superseded by a newer call | n/a | rejects `Error('Session superseded')` or returns the current snapshot; the renderer ignores it via the token | none |

Invariants and their owners:
- *No old-session data is ever shown.* Owned by the renderer store (session id check, reset on switch, request token), with main's `stopped`/epoch guards as backup. The store is the last layer before pixels.
- *No secret values in renderer lists.* Owned by the `kinds.ts` trimmers in main, because main is the trust boundary.
- *One live session at a time.* Owned by `WatchManager.startSession`.
- *Bounded timers and sockets.* Owned by `ListWatchStream` (≤1 timer and ≤1 controller each, epoch-guarded connect) and the session (one health interval, one idle timer, one coalescer timer). The pod worker is bounded by `timeoutSeconds`.
- *No unresolved worker promises.* Owned by `sendToWorker` (timeout) and the per-worker crash handlers in `transform-worker-client.ts`.
- *The pod cache only holds the current generation's pods.* Owned by the pod worker (`onLifecycle` replaces `podCache` on receipt, `live()` guards every callback), because only the worker can order cache writes against lifecycle messages. The adapter's `sessionId`/`synced` check on chunk replies is the second layer.
- *At most one pod worker process.* Owned by `PodWorkerPort` in `main.ts` (`respawnPending`, `quitting`).

---

## 9. Leak-prevention plan

1. **Preload**: every `on*` returns `() => ipcRenderer.off(channel, listener)` for its own named listener. `app.onWindowFocused` gets the same fix (D6). The AI stream `removeAllListeners` calls (`preload.ts:175-177`, `210-212`) are backlogged and not changed here.
2. **Main**: `stopSession` (§3.7) releases every resource. `ListWatchStream.stop()` bumps its epoch, aborts its controller and clears its timer, and a connect that resolves late is aborted (§3.4). The coalescer clears its timer. Transform promises always settle (§3.5.1). Generic-watch maps delete their keys through `disposeGenericWatch` when the renderer stops a watch (§5.3). Pod informers are disposed before stop and never restarted after it, and a respawn can only produce one worker (§3.6). The legacy per-kind globals are removed (§3.10).
3. **Renderer**: a single `onBatch` listener, owned by `useResourceSync` and disposed in the effect cleanup, plus an HMR `dispose` backstop. No other component subscribes to IPC for core kinds. Connected views use zustand hooks, which unsubscribe automatically.
4. **Diagnostics** (`resources:getDiagnostics`):
   ```ts
   interface ResourceCacheDiagnostics {
     sessionId: string | null; context: string | null; seq: number;
     lastNamespaces: string[];
     streams: Array<{ kind: CoreKind; scope: string; phase: KindPhase; connecting: boolean; hasController: boolean; hasTimer: boolean; lastEventAt: number | null; epoch: number }>;
     counts: Record<CoreKind, number>;
     timers: { health: boolean; idle: boolean; coalescer: boolean; authRebuild: boolean };
     helmDecodeCacheSize: number;
     helmFallbackFetchesInFlight: number;   // ≤ number of releases; 0 after stop
     pendingTransforms: number;
     podWorker: { informers: number; podCacheSize: number; sessionId: string | null; gen: number; retryTimers: number; pendingChunkRequests: number; available: boolean } | null;
     invokeCounts: Record<'startSession'|'subscribe'|'stopSession'|'setNamespaces'|'ensureFresh'|'getDiagnostics', number>;
     handlersRegistered: Record<'startSession'|'subscribe'|'stopSession'|'setNamespaces'|'ensureFresh'|'getDiagnostics', boolean>;
     // from a registry Set kept by registerResourceCacheIpc; ipcMain.handle registrations are not
     // EventEmitter listeners, so ipcMain.listenerCount() would always report 0 for them.
     subscriberBound: boolean;
     legacyMaps: { activeWatchers: number; watchGenerations: number; watchResourceVersions: number; genericWatchGenerations: number };
   }
   ```
   The renderer adds `window.k8s.resources.listenerCount()` and `store.droppedBatches`. The implementer also adds a dev-only helper, `window.__lumenDiag = async () => ({ main: await window.k8s.resources.getDiagnostics(), batchListeners: window.k8s.resources.listenerCount(), dropped: useResourceStore.getState().droppedBatches })`. It is registered in `useResourceSync` only when `import.meta.env.DEV`, and the procedure below can be run from the DevTools console.
5. **Verification procedure** (run during implementation, with results recorded in the task notes):
   1. Connect, wait until every kind is `ready`, and take D0 = `await __lumenDiag()`.
   2. Switch through the Deployments, Pods, Secrets, ConfigMaps, Services and Helm tabs 50 times, then take D1. Expected:
      - `invokeCounts` in D1 equals D0, except `ensureFresh` and `getDiagnostics`.
      - `streams.length`, `batchListeners === 1`, `timers`, `podWorker.informers` and `legacyMaps.activeWatchers` are unchanged.
      - No `connecting: true` stream remains after 5 s.
   3. Switch 50 times between non-core tabs (DaemonSets, Ingresses, PVCs). Expected: the `legacyMaps` sizes are unchanged from before the run (± the one active view).
   4. Switch clusters A↔B 10 times, including two rapid double-clicks. Expected:
      - `streams.length === 4` (cluster mode).
      - `sessionId` changes on each real switch.
      - `podWorker.sessionId === sessionId`, `podWorker.informers === 1`, `podWorker.retryTimers === 0`.
      - The Pods tab right after each switch shows either B's pods or the loading skeleton, never A's pods (checks the §3.6 receipt-time `podCache` replacement).
      - `droppedBatches` may grow, but no item with A's namespace and name pair appears under B.
      - `batchListeners === 1`.
      - On the main side, `lsof -p <main pid> -a -i TCP | wc -l` stabilizes and does not grow by 4 per switch.
   5. Go to Settings and back 10 times. Expected: `startSession` is not invoked, the `sessionId` is unchanged, and the lists are populated immediately.
   6. Reload with Cmd+R, re-select the same cluster within 60 s. Expected: the same `sessionId`, and the store is populated directly from the snapshot. Then reload and wait 70 s without re-selecting. Expected: the main log shows `stop session … no-subscriber`, and `getDiagnostics().sessionId === null`.
   7. Delete a pod while the pod worker is killed (`kill <utility pid>`), and switch tabs and focus the window during the 2 s respawn window. After the respawn, the pod is no longer listed, `ps` shows exactly one pod-worker utility process, and `podWorker.informers` matches the scope (1 in cluster mode).
   8. On a quiet cluster, record `getDiagnostics()` right after a stream (re)connect, then refocus the window 20 times, finishing **within 4 minutes** of that (re)connect so the 60 s / 5-minute session health interval (§3.4) cannot fire during the run. If the run has to take longer, compare against a control run of the same duration with no focus events; any epoch bump must be matched by a health abort in the main log, never by `ensureFresh`. Expected: `podWorker.gen` does not change (the 660 s floor means focus does not rebuild healthy informers), `podWorker.retryTimers === 0`, and every `streams[].epoch` value is unchanged from before the first focus (the same floor in `ListWatchStream.ensureFresh` means focus does not abort healthy main-process watches).
   9. Take DevTools heap snapshots after each phase. Retained size should stay flat within ±10% after GC.
   10. Start a cluster switch to an unreachable context (pre-flight fails) while A is shown. Expected: `batchListeners === 1` throughout, the `sessionId` is still A's, and a pod or deployment change in A appears in the UI within ~1 s after the failure.

---

## 10. Business-logic placement and conventions

- All Kubernetes API calls stay in the main process: `electron/resource-cache/*` plus `K8sService.createKubeConfig`. Pods stay in the existing utilityProcess.
- The renderer talks to main only through `window.k8s.resources.*` and the preload `contextBridge`.
- Pure logic has no Electron imports, so vitest can unit-test it: trimmers, `mapStatusToMessage`, the HelmIndex reducer, the coalescer, the list diff, `filterByNamespaces`/`coreKindForView`, and the store reducers.
- Every new file stays under 500 lines. `Dashboard.tsx` (1589 lines) gets shorter. Splitting it further is out of scope.
- TypeScript strict, no `any`. Raw K8s objects are typed as `KubernetesObject` from `@kubernetes/client-node`, or as `Record<string, unknown>` with narrowing helpers like the existing `prop()` (`resource-transform-worker.ts:33-38`).

---

## 11. Testing

**Unit tests** (vitest, `*.test.ts`):

- **`electron/resource-cache/kinds.test.ts`**:
  - Trimmers drop `managedFields` and the last-applied annotation.
  - Secret and ConfigMap values never appear in the output (deep string search for a sentinel value).
  - The `id` fallback works.
  - `mapStatusToMessage` never echoes the input message or body.
  - `extractStatusCode` returns `undefined` for a `FetchError` with `code: 'ECONNRESET'` (classified as network), and `401` for `{ statusCode: 401 }` / `{ code: 401 }` / `{ body: { code: 401 } }`.
  - **Typed-LIST vs raw-WATCH parity**: the same deployment, secret, configmap and service fed once as a typed object (with `Date` timestamps) through `toWireShape` + trimmer and once as a raw JSON object through the trimmer produce deep-equal output, and every timestamp in the output is a string.
- **`electron/resource-cache/list-watch.test.ts`** (fake `listPage`/`watch` and fake timers):
  - Pagination merges pages.
  - A re-list emits deletes for missing ids.
  - A 410 ERROR event triggers a re-list.
  - Backoff follows its sequence and caps at 30 s.
  - 3 failures drop the rv.
  - `stop()` while a LIST is in flight produces no further emits and no timers.
  - **`stop()` while the `watch()` promise is pending**: the controller resolved later is aborted, and `hasController === false`.
  - **`done(err)` called before `watch()` returns**: the controller is not stored and exactly one retry is scheduled.
  - `lastEventAt` is null during the initial LIST and set after the LIST and after connect.
  - Health check: skips connecting or backoff streams, and aborts and re-watches after 5 min of silence.
  - 401: calls `requestAuthRebuild`, sets `error` after the 3rd consecutive 401, and `restart()` resets the counter.
  - **Fast close**: `done(null)` 100 ms after connect with zero events increments `attempts` and schedules a backoff delay ≥ 800 ms; three in a row trigger a re-LIST. `done(null)` after 6 s, or after one event, re-watches after 500 ms with `attempts` unchanged.
  - The secrets descriptor requests `limit: 100`, the others `limit: 500`.
  - **LIST hooks**: a 3-page LIST calls `onListPage` three times with `first: true` and the page's raw items, then `onListComplete` once; a re-LIST calls them with `first: false` and passes the missing ids plus their name/namespace in `deletedMeta`. The temporary map holds trimmed items only (assert no `managedFields`/`data` values reachable from the stream after page 1 is processed). A superseded page never reaches `onListPage`.
  - **`ensureFresh(120_000)` on a stream connected 3 min ago does not abort** (epoch unchanged, no new `watch()` call). `ensureFresh(300_000)` after 11 min of silence aborts and re-watches from rv. `ensureFresh(0)` always re-watches.
- **`electron/resource-cache/helm-index.test.ts`**:
  - The latest revision wins.
  - Only the max-revision secret is decoded.
  - Deleting the latest revision falls back to the previous one.
  - Deleting the last secret removes the release.
  - The decode cache skips an unchanged `uid@rv`.
  - Results are correlated through `secretUid`.
  - A `failures[]` entry falls back or leaves the release out.
  - **Partial failure**: a response with `error` set, 49 `events` and 1 `failures` entry applies the 49 summaries.
  - **Whole-request failure** (`error: 'worker exited'`, no events, no failures) retries each still-current max uid through the `readSecret` path: exactly one `readSecret` call plus one one-item decode per affected max uid. If that retry also returns a whole-request failure, the uid ends `decodeState: 'failed'`, `corrupt: false`, keeps the label-derived summary, and no further `readSecret` is issued.
  - **Same-page v3 then v2 issues exactly one decode and zero `readSecret` calls**: one `onListPage` delivering v3 before v2 of the same release posts a single decode (for v3) and never calls `readSecret`.
  - **Decode in flight + older-revision event → no `readSecret`**: with v3's decode `'pending'`, a WATCH `ADDED`/`DELETED` on v1 in the same window recomputes the release without calling `readSecret`; v3's result then sets the summary.
  - **Cross-page revisions**: page 1 delivers v1 and v10, page 2 delivers v2; exactly one decode (v10) and zero `readSecret` calls.
  - **rv change resets decode state**: a MODIFIED on a `'failed'` (`corrupt: true`) max uid with a new rv makes it selectable again and decodes it from the event's raw.
  - **Helm phase**: stays `loading` after the Secrets LIST completes while initial decodes are pending, then becomes `ready` once they settle (including failures).
  - A decode result from a stale session is dropped.
  - **Re-list missing the latest secret of a release emits delete/fallback**: with revisions v1..v3 indexed, `onSecretDeleted(uid_v3)` from `onListComplete` makes the release show v2 (decoded or label-derived); `onSecretDeleted` for every revision emits `delete(helmreleases, releaseId)`.
  - **Delete latest revision → release shows previous revision number/status without a re-LIST**: with v3 decoded and v2 never decoded, a WATCH `DELETED` for v3 immediately emits a label-derived summary with `revision: 2` and v2's status label, calls `readSecret(ns, 'sh.helm.release.v1.<name>.v2')` once, and after the decode emits the full v2 summary.
  - **Fallback fetch guards**: two recomputes while a fetch is in flight issue one fetch; a fetch result whose rv differs from the index entry, or that arrives after `clear()`, is ignored; a rejected `readSecret` keeps the label-derived summary and logs once.
  - **Fallback fetch returns a newer rv for the same uid**: `readSecret` resolves with the same uid and a newer `resourceVersion` than the entry → exactly one `readSecret` call, entry `decodeState === 'failed'` and `corrupt === false`, label-derived summary shown. A later WATCH `MODIFIED` with that rv decodes from the raw in hand (one decode request) with no further `readSecret`.
  - **Fallback fetch overtaken by the watch**: while a fetch for `(uid, rv1)` is in flight, a `MODIFIED` with `rv2` arrives and queues a raw-in-hand decode; the fetch then resolves with `rv1` → result ignored, entry stays `'pending'` for `rv2`, no second `readSecret`, and the `rv2` decode result is applied.
  - **Helm phase with hooks**: `initialDecodesPending` counts only requests from `first: true` pages; helm becomes `ready` only after `onFirstListComplete()` and the last of those settles.
- **`electron/resource-cache/coalescer.test.ts`**:
  - Last write wins, and delete-after-upsert holds.
  - `resetKind` discards earlier ops, and later pushes modify the reset map.
  - A single timer runs, with no timer while empty.
  - `seq` increments.
- **`electron/resource-cache/pod-adapter.test.ts`**:
  - Mismatched-session messages are dropped.
  - Every `informer-synced` triggers a chunk request and a `reset`.
  - **A respawn while a pod was deleted during the outage**: the reset excludes the pod, and the context engine gets DELETED.
  - **Namespaced `setNamespaces` that removes a namespace**: that namespace's pods are deleted.
  - The chunk timeout returns `[]` and `reconnecting`.
  - **A chunk reply with `sessionId !== session.id` or `synced: false` yields `[]`/`loading`** and does not trigger a reset.
  - **Port unavailable**: when `post` returns false, `getSnapshotPods()` resolves immediately with `[]`/`reconnecting` and no request stays pending.
  - **Pod 401**: an `informer-error { statusCode: 401 }` calls `requestAuthRebuild` and re-posts `start-informer` after backoff; three consecutive 401s (several from one start counting once) set pods `error` "Authentication failed: refresh credentials" and post `stop-informer`; an `informer-synced` in between resets the counter; `onCredentialsChanged` after give-up re-posts `start-informer` with the counter at 0.
  - **Namespaced 403**: with namespaces `ns1, ns2, ns3`, a 403 for `ns2` followed by `informer-synced` sets pods `ready` with error "No permission to list Pods in: ns2"; 403s for all three set `forbidden`.
  - **Resync uses a fresh chunk**: `resyncContextEngine` sends a new `get-pods-chunk`, replays only an accepted reply, and the adapter holds no chunk reference after a reset is applied.
- **`electron/resource-cache/watch-manager.test.ts`** (injected fakes):
  - Same-context `startSession` is idempotent and calls `resyncContextEngine`.
  - A switch stops every stream before new ones start.
  - Late events from the old session never reach `send`.
  - **A late snapshot from a superseded session** (A→B→A with the pod chunk delayed) never carries a stopped session id.
  - **A batch flushed during the snapshot's chunk await** has `seq ≤ snapshot.seq`.
  - `setNamespaces` before `startSession` is recorded and used.
  - A 403 switches the kind to namespaced mode.
  - `setNamespaces` adds and removes streams and emits deletes.
  - The auth rebuild is debounced across 4 streams.
  - `onRendererNavigated` followed by 60 s with no subscriber stops the session, and a `startSession` within 60 s cancels the timer.
  - Deployment LIST items reach the context engine as ADDED.
  - `getDiagnostics` reports zero timers and zero controllers after stop.
  - **Terminal-error recovery**: a session whose kinds are `error` after a failed auth rebuild is recovered by a same-context `startSession` once `createKubeConfig` succeeds (errored streams restart, `ready` streams untouched); with `createKubeConfig` still throwing, it rejects `Unknown kube context`.
  - `onRendererNavigated()` with no session arms no timer (`timers.idle === false`).
  - **Snapshot during A→B never contains A pods**: with a fake worker that answers chunk requests from its current generation, `startSession(B)` issued while A's cache is full returns `pods: []` with phase `loading`.
  - **Kubeconfig load failure**: `createKubeConfig` throwing `KubeconfigLoadError` makes `startSession` reject with exactly `'Failed to load kubeconfig'` and leaves the existing session's id and streams unchanged.
  - **`setNamespaces(['all'])` while namespaced**: per-namespace streams stop, deletes are emitted for all their ids, and the phase is `forbidden`.
  - **Cluster-mode retry**: `onCredentialsChanged()` on a namespaced kind starts one cluster-scope stream; on success the per-namespace streams stop and `mode === 'cluster'`; on 403 the kind stays namespaced and no further retry is scheduled.
  - **Secrets re-list deletes reach HelmIndex**: a re-LIST missing a helm secret calls `HelmIndex.onSecretDeleted(uid)`.
  - **Focus does not churn**: `ensureFresh(300_000)` on a session whose streams connected 4 min ago leaves every stream epoch unchanged.
- **`src/stores/resourceStore.test.ts`**:
  - A mismatched session is dropped, and 5 consecutive mismatches return `'resubscribe'`.
  - `seq <= current` is dropped, and a gap is reported.
  - Untouched kinds keep the same `byId` reference.
  - `reset` replaces the map.
  - A snapshot replaces all state.
  - The fast-check properties migrated from `usePodWorker.pbt.test.ts` pass.
- **`src/hooks/resource-sync-controller.test.ts`**. The repo has no `@testing-library/react`, jsdom or happy-dom, so no dependency is added. The hook's logic lives in a plain `createResourceSyncController(api, store)` in `src/hooks/resource-sync-controller.ts`, which holds the token, `prevCluster`, `onSync(selectedCluster, syncEpoch)`, `dispose` and `resubscribe`. `useResourceSync` is a ~30-line wrapper over it. The test drives the controller with a mocked `api`:
  - **A late snapshot under an old token is ignored.**
  - **A batch before the snapshot is not counted**: after `reset(B)`, five batches from A return `'dropped'`, `consecutiveMismatches` stays 0, and no `subscribe()` call is made.
  - **Resubscribe keeps delivery working**: after a `'resubscribe'` result and a resolved `subscribe()`, a following batch with the new session id is applied.
  - **Single-flight**: ten `'resubscribe'` results while one `subscribe()` is pending produce exactly one `subscribe()` call, and none at all while the initial `startSession` is pending.
  - A non-null → null transition calls `stopSession`.
  - An initial null does not.
  - The controller's entry point is `onSync(selectedCluster, syncEpoch)` (the effect body of §6.2); it has no `connectionStatus` input.
  - **`'connecting'` does not dispose the listener**: with A synced, simulating App's `'connecting'` state (no change to `selectedCluster` or `syncEpoch`) makes no `onSync` call, `api.onBatch`'s disposer is not called, and a following A batch is applied.
  - **A failed switch re-runs `startSession` for the current cluster**: `onSync('A', 1)` then `onSync('A', 2)` (the catch-path bump) disposes the old listener, installs exactly one new listener, calls `startSession({ context: 'A' })` again, does not call `reset` (store context unchanged), and applies the returned snapshot.
  - **A successful re-select** (`onSync('A', 3)`) calls `startSession` for A (idempotent path) with no reset.
  - **`handleStartError` uses `setAllStatus`**: a rejection `'Unknown kube context'` sets every kind's phase to `error` with that text and keeps every `byId` reference; an arbitrary message maps to "Failed to start resource sync".
- **`src/utils/resource-utils` tests**: `filterByNamespaces`; `coreKindForView` maps every row of the §7 table, including `'helm-releases'` → `'helmreleases'`, and returns `null` for `'overview'`, `'helmreleases'` (not a view id), `'daemonsets'` and `'constructor'`.
- **`src/stores/resourceStore.test.ts`** also covers `setAllStatus`: one `set()`, new status objects for all kinds, unchanged `byId` references, unchanged `sessionId`/`seq`.
- **`k8s-pod-worker-delta-buffer.test.ts`**: a `clear()` test (the new method: pending deltas are discarded, no post happens on the next tick, and the flush timer is cleared).
- **`electron/k8s.test.ts` (or the existing K8sService test file, with `vi.mock('@kubernetes/client-node')`)**: `createKubeConfig` wraps a `loadFromDefault` throw as `KubeconfigLoadError` whose message is exactly `'Failed to load kubeconfig'` and contains no part of the original message; a missing context throws `UnknownContextError`.
- **`electron/pod-worker-core.test.ts`**. To make the worker testable, its lifecycle logic (state, `onLifecycle`, `live`, error/retry, fast-close guard, `needsRefresh`, chunk reply) moves into `electron/pod-worker-core.ts` (~250 lines) with injected `makeInformer`, `buildKc`, `post` and timers. `k8s-pod-worker.ts` keeps only the `process.parentPort` wiring and `mapLightweightPod`/`DeltaBatchBuffer`. The fake informer can fire `error` synchronously from `stop()` with an `AbortError`, as the real one does. Tests:
  - **`stop()` of a connected informer triggers no retry and no `informer-error`** (fake fires `AbortError` from `stop()`; assert zero `start()` calls after dispose and no posted `informer-error`).
  - A same-session restart (refresh, namespace change) creates **new** informers and never calls `start()` on a disposed one.
  - **Receipt-time replacement**: with A's cache populated, post `start-informer(B)` and, before the chain runs, `get-pods-chunk(B)` → reply has `sessionId: B`, `synced: false`, `pods: []`.
  - Late `add` callbacks from a disposed rec do not change `podCache`.
  - A 403 in cluster mode posts `recoverable: false` and schedules nothing; a 500 schedules exactly one retry timer.
  - **Namespaced, one ns 403 → `informer-synced` still posted, no retry timer for that rec**: with three namespaced recs, a 403 on `ns2` posts `informer-error { statusCode: 403, namespace: 'ns2', recoverable: false }`, sets `forbidden`, and once `ns1`/`ns3` sync, `informer-synced` is posted; `retryTimers` counts 0 for `ns2`. With all three forbidden, no `informer-synced` is posted and no timers exist.
  - **401 schedules no retry**: a 401 posts `informer-error { statusCode: 401, recoverable: false }`, leaves the rec `errored`, and creates no retry timer; `needsRefresh(300_000)` ignores it.
  - **Removed messages**: `get-pod-count` is ignored (no reply), and the worker never posts `informer-stopped` or `pod-count-reply`.
  - Five fast closes replace the rec after backoff; an event resets the counter.
  - `needsRefresh(120_000)` and `needsRefresh(300_000)` are false for an informer that connected 3 minutes ago; true after 11 minutes or for `0`.
  - One `buildKc` call per `start-informer` regardless of namespace count; none for `refresh`.
- **`k8s-pod-worker-chunk.pbt.test.ts`** is deleted: it tests the `offset`/`limit` slicing that the unpaged reply removes.
- **`electron/transform-worker-client.test.ts`** (fake `Worker` factory):
  - W1 `error` → `sendToWorker` creates W2 → W1 `exit` fires: W2's pending request is still pending and later resolves from W2's `message`; `transformWorker` still points at W2.
  - W1's own pending requests resolve with `error: 'worker error'`.
  - The 15 s timeout resolves with `error: 'timeout'` and removes the id from both maps.
- **`electron/k8s-generic-watch.test.ts`** (fake `Watch`): an internal reconnect keeps the rv (the next `watch()` call gets `resourceVersion`), and `disposeGenericWatch` removes the `generic:<key>` entries from all three maps and makes a late callback a no-op. `K8sService`'s constructor calls `loadFromDefault()`; the test uses `vi.mock('@kubernetes/client-node')` for `KubeConfig`/`Watch`. If that proves impractical, the same two properties are verified manually through `legacyMaps` in §9 step 3 and the main log's "resuming from rv=" line, and the task notes record it.
- **`src/utils/resource-utils` tests** also cover `countInNamespaces` and the overview stats filter: pods in unselected namespaces are excluded, and `['all']` includes everything.
- **`resource-transform-worker` tests**: helm output includes `secretUid`/`secretResourceVersion`, and a corrupt blob yields a `failures[]` entry.

**Integration and manual checks.** The repo has no Electron e2e harness, so these cannot be automated:
- First, reproduce the reported reload on the current build. Open Secrets, switch to Pods, then switch back. Expect the skeleton plus a full replay in the main log (`[k8s] Starting generic watch for secrets`).
- After the change, confirm that tab switches start no watch.
- Run the §9 procedure against a real cluster with more than 1k secrets and some Helm releases.
- Test namespace-restricted RBAC (the 403 fallback).
- Test sleep and resume.
- Test an expired Granted session, which triggers the 401 path, followed by `assume`.
- `npm run lint`, `npx tsc --noEmit` and `npx vitest run` must pass. Then run `npm run build` up to the vite step.

---

## 12. Edge cases

- **Rapid A→B→A switching**: each `startSession` stops the previous session synchronously. The renderer applies only snapshots and batches whose request token is current. Main never returns a snapshot that carries a stopped session id (§3.7). Connecting watches are aborted on return.
- **Re-selecting the same cluster** is idempotent. It re-feeds the context engine after `clusterSwitch` cleared it.
- **Kube context deleted from kubeconfig while connected**: the next auth rebuild fails and every kind shows `error` "Unknown kube context". A re-select is rejected.
- **Namespace deleted**: the server sends DELETED for the objects in it. In namespaced mode, that stream gets a 404 or 403 and that namespace is marked.
- **Very large clusters**: LIST pages of 500 (100 for secrets), trimmed maps only, and no Helm blobs retained, with one decode per release. Rough main memory is ~1–2 KB per trimmed item, so 20k secrets plus configmaps come to ~40 MB. Pods live in the utilityProcess. See decision point 1.
- **Window minimized or App Nap**: the health interval, `resume`/focus `ensureFresh`, and the pod `refresh` cover it.
- **StrictMode double effects**: the token plus idempotent `startSession`. The cleanup disposes only its own listener.
- **Item missing a uid**: falls back to the `ns/name` id, which cannot collide with a UUID.
- **Helm release with only an `uninstalled` revision (keep-history)**: shown with that status, which matches today.
- **Helm secret without standard labels** (very old Helm 3 versions): name parsing is used, then a decode.

---

## 13. Decision points for the user

1. **Cluster-wide watching by default (chosen).** Core kinds are watched cluster-wide, and the namespace selection is a client-side filter. Namespace switches are instant and multi-namespace correctness is fixed (D1). The cost is the memory and bandwidth of everything in the cluster, even when you only look at one namespace. Restricted RBAC falls back to per-namespace streams. Alternative: always scope to the selected namespaces. That uses less data but restarts streams on every namespace change.
2. **Non-core kinds (DaemonSets, Ingresses, RBAC, …) stay on demand (chosen).** They still reload when their tab opens. They only get the stale-event nonce and the map cleanup (§5.3). Optional follow-up: move them into the store with a 60 s keep-alive after the tab is left. Not in scope unless you ask for it.
3. **Pods stay in the existing utilityProcess (chosen).** The WatchManager drives them through a session-tagged protocol with reset-on-sync. Alternative: move pods into the main-process `ListWatchStream`. That gives one code path but adds main-thread parsing.
4. **Remove the dead legacy watch IPC (chosen):** `watchPods`, `watchDeployments`, `watchHelmReleases`, the `podWorker` preload namespace, and the raw per-event sends. This reduces IPC volume and stops raw objects reaching the renderer. Any external script that relies on those channels would break. I found none in the repo.
5. **Idle grace when the renderer goes away or reloads: 60 s (chosen).** Alternatives: stop immediately (cheaper, but every reload cold-starts) or never stop until quit.
6. **Helm releases derived from the Secrets stream (chosen)** instead of a separate helm-selected watch. The RBAC requirement is the same as today.
7. **`selectedNamespaces` stays Dashboard-local (chosen, minimal scope).** Hoisting it into a store would keep the namespace selection across Settings round-trips and avoid the namespaced-mode reset (§7 known limitation). It is a small change but it changes UX behavior, so I'm leaving it to you.
8. **`settings_kubeconfigPath` stays unused for watches (chosen).** Both pods and main streams use `loadFromDefault`, consistent with the rest of `K8sService`. Making the setting work app-wide is a separate change.

---

## Assumptions

- "Tabs" means both the ViewTabBar resource tabs and switching away from the dashboard via the main menu and back. Both are covered.
- The app has one window, as today.
- Both main streams and the pod worker read kubeconfig through `loadFromDefault`, honoring `KUBECONFIG`, the same way `K8sService` already does.
- No React DOM test environment is installed (checked `package.json`). That is why the sync logic is a plain controller (§11).
- How often the API server sends bookmarks is unverified at runtime. The design does not rely on it (§3.4 health rationale).
- I could not observe runtime behavior at design time. The root-cause claims in §1 come from reading the code and must be confirmed with the §11 reproduction before and after implementation.

---

## 14. Responses to review findings

### 14.1 Revision 3: responses to the second review

| # | Sev | Resolution |
|---|---|---|
| 1 | HIGH | **Addressed.** `InformerRec` with `disposed` and `gen`; `live(rec)` guards every callback; `AbortError` from our own `stop()` is ignored; retry timers check `live` and are cleared on dispose. Every same-session restart builds new informers (fresh LIST), and `start()` is never called on a stopped informer. The Freshness text is corrected (stop/start only re-watches from rv), and `refresh` now rebuilds with a 660 s silence floor so focus does not trigger LISTs on healthy informers (§3.6). Worker-core tests added (§11). |
| 2 | HIGH | **Addressed.** `onLifecycle` replaces `podCache`, clears the delta buffer, bumps `currentGen` and sets `currentSessionId` synchronously on receipt; only informer I/O is chained. `pods-chunk-reply` carries `sessionId` and `synced`; the adapter treats a mismatched or unsynced reply as `[]`/`loading`. Snapshot-during-switch tests in the worker core and manager (§3.6, §11). |
| 3 | HIGH | **Addressed.** One rule: `reset` nulls `sessionId`/`seq`/`consecutiveMismatches`; `applyBatch` drops without counting while `sessionId === null`; mismatches count only after a snapshot. `resubscribe` keeps the same token, is single-flight, and never runs while the initial `startSession` is pending. §4 now points to §6.1/§6.2 instead of saying "fresh token". Controller tests added (§4, §6.1, §6.2, §11). |
| 4 | MEDIUM | **Addressed.** `PodWorkerPort { post(): boolean; isAvailable() }` with `respawnPending` and `quitting`; `ensurePodWorker` is deleted; the respawn timer assigns the worker before `onPodWorkerRespawned()`; `before-quit` sets `quitting` before `kill()`. Snapshot returns `[]`/`reconnecting` immediately while unavailable (§3.6). |
| 5 | MEDIUM | **Addressed.** `transform-worker-client.ts` tracks pending ids per worker; `failAll` settles only that worker's ids and nulls `transformWorker` only if it is still that worker (§3.5.1). Test for the W1-error → W2 → W1-exit sequence (§11). |
| 6 | MEDIUM | **Addressed.** HelmIndex applies `events` and `failures` per item; whole-request failure only when `error` is set with no events and no failures; those uids get one retry in the next window (§3.5.1). Tests for partial and whole-request failure (§11). |
| 7 | MEDIUM | **Addressed, with a different mechanism than suggested.** `toWireShape` (Date → ISO, recursive, pure) at the stream boundary for every LIST item, plus `toIso` in trimmers. `ObjectSerializer.serialize` was not used because it is not exported from the package root in 1.4.0 (verified at runtime). Context-engine LIST input is the normalized object. Parity test added (§3.2, §3.3, §3.9, §11). |
| 8 | MEDIUM | **Addressed.** `useResourceCount` selects a primitive via `countInNamespaces`; the rule "Dashboard and DashboardContent never subscribe to a `byId`" is stated, with a grep check. The §7 claim is corrected: Dashboard re-renders only when the visible count changes (§6.3, §7). |
| 9 | MEDIUM | **Addressed.** `useOverviewPodStats(selectedNamespaces)` filters by namespace and is called from `ConnectedOverviewView`. Test added (§7, §11). |
| 10 | MEDIUM | **Addressed.** `stopGenericWatch` is unchanged (internal reconnect keeps its rv); a new `disposeGenericWatch` deletes the `generic:`-prefixed keys and is called only from `k8s:stopWatchGenericResource`. The `?? -1` text is removed (§5.3). |
| 11 | MEDIUM | **Addressed.** The idempotent `startSession` path rebuilds the kc and restarts errored streams (and pods) when any kind is in `error`; it rejects `Unknown kube context` if the rebuild still fails (§3.7). Manager test added. |
| 12 | MEDIUM | **Addressed.** A normal close under 5 s with zero events counts as a failure (backoff + 3-strike re-LIST); a healthy close re-watches after 500 ms. The pod informer gets an equivalent fast-close guard (§3.4, §3.6). Tests added. |
| 13 | NIT | **Addressed.** `getCurrentViewData` core/overview branches (lines 207-209, 211, 231, 232) become one early `return true` (§7). |
| 14 | NIT | **Addressed.** `mainListenerCounts` is replaced by `handlersRegistered` from a registry in `resource-cache-ipc.ts`, plus `subscriberBound` (§9). |
| 15 | NIT | **Addressed.** `pageSize: 100` for secrets, 500 for the others, in `CORE_KIND_DESCRIPTORS` (§3.4). |
| 16 | NIT | **Addressed.** Helm stays `loading` until the first Secrets LIST and its decodes have settled (§3.5). |
| 17 | NIT | **Addressed.** Numeric-only `extractStatusCode` and `isNetwork` classification (§3.3). |
| 18 | NIT | **Addressed.** D4 reference corrected to `main.ts:2013`; `lastPodWatchScope`/`lastDeploymentWatchScope` and their resets in `context:clusterSwitch` (`main.ts:2385-2392`) added to §3.10. |
| 19 | NIT | **Addressed.** `powerMonitor` stated as new, imported from `electron`, registered inside `app.whenReady()` (§3.4, §3.7). |
| 20 | NIT | **Addressed.** One `sessionKc` per `start-informer`, shared by its informers; `refresh` reuses it (§3.6). This supersedes revision 2's per-informer KubeConfig. |
| 21 | NIT | **Addressed.** The unpaged chunk reply and its expected size (~6 MB at 20k pods) are stated; the paging PBT test is deleted (§3.6, §11). |
| 22 | NIT | **Addressed.** `onRendererNavigated` starts with `if (!this.session) return;` (§3.7). Test added. |

### 14.2 Revision 4: responses to the third review (rev-3 review)

All 15 findings are addressed, each with the reviewer's recommended fix. Nothing is backlogged or ignored.

| # | Sev | Resolution |
|---|---|---|
| 1 | HIGH | **Addressed (recommended fix).** `useResourceSync(selectedCluster, syncEpoch)` no longer reads `connectionStatus`; deps are `[selectedCluster, syncEpoch]`. App adds `syncEpoch` state and bumps it in both the success and the `catch` paths of `handleClusterSelect` (`App.tsx:764-833`). Effect: `if (!selectedCluster) { if (prev) { stopSession(); reset(null); } return; }`. A failed switch re-installs the listener and runs an idempotent `startSession` for the still-selected cluster (§6.2). Controller tests: `'connecting'` does not dispose the listener; a failed switch re-runs `startSession` for the current cluster (§11). §8 row and §9 step 10 added. |
| 2 | MEDIUM | **Addressed (recommended fix).** Descriptor hooks `onListPage(rawItems, { first })` and `onListComplete(deletedIds, deletedMeta)` replace `onListed`. The temporary map holds trimmed items only, and raw objects never outlive their page; per-page helm decode requests are posted at the end of each page. Deployments: `onListPage` → ADDED, `onListComplete` → DELETED. Secrets: `onListPage` → `HelmIndex.onSecret('ADDED', raw)` for helm-typed items, `onListComplete` → `HelmIndex.onSecretDeleted(uid)` for every deleted id. `initialDecodesPending` settles relative to `onFirstListComplete()` from the first LIST's `onListComplete` (§3.4, §3.5, §3.9). Tests: list-watch hook contract; helm-index "re-list missing the latest secret of a release emits delete/fallback" (§11). |
| 3 | MEDIUM | **Addressed (option (a)).** `HelmIndex` gets an injected `deps.readSecret(ns, name)` implemented with the session `kc` and `CoreV1Api.readNamespacedSecret`, result passed through `toWireShape`. When the recomputed max revision has no summary, the index fetches and decodes that one secret, guarded by session id and `(uid, rv)`, with one in-flight fetch per release. A label-derived summary is shown immediately and kept on fetch failure, so a deleted revision's summary is never shown (§3.5). Test: "delete latest revision → release shows previous revision number/status without a re-LIST" plus guard tests (§11). §8 row added. |
| 4 | MEDIUM | **Addressed (recommended fix).** Namespaced 403: `rec.forbidden = true`, no retry, `informer-error { sessionId, statusCode: 403, namespace: rec.ns, recoverable: false }`. Forbidden recs are excluded from the all-synced check (`maybePostSynced`) and from `needsRefresh`. The adapter sets pods `ready` with "No permission to list Pods in: ns1, ns2", or `forbidden` if every rec is forbidden. `informer-error` gains `namespace?: string` (§3.1, §3.6). Worker-core test: "namespaced, one ns 403 → informer-synced still posted, no retry timer for that rec"; adapter test (§11). §8 rows split. |
| 5 | MEDIUM | **Addressed (recommended fix).** Adapter on `informer-error` 401: `session.requestAuthRebuild()`, re-post `start-informer` (fresh `sessionKc`, fresh token) after backoff, count consecutive 401s (once per `start-informer`, so N namespaced informers count once), and on the 3rd set pods `error` "Authentication failed: refresh credentials" and post `stop-informer`. The counter resets on `informer-synced`, `onCredentialsChanged`, the `ensureFresh` error restart and the same-context `startSession` recovery. The worker sets `errored` on 401 and schedules no retry (§3.6, §3.7). §8 row and pod-adapter and worker-core tests added (§11). |
| 6 | MEDIUM | **Addressed (recommended fix, both parts).** `ListWatchStream.ensureFresh` applies `threshold = maxSilenceMs === 0 ? 0 : Math.max(maxSilenceMs, 660_000)`, and focus calls `ensureFresh(300_000)`; resume keeps `0` (§3.4, §3.7, §5.1, §6.2). §9 step 8 now also asserts `streams[].epoch` is unchanged after 20 focus events. Test: "ensureFresh(120_000) on a stream connected 3 min ago does not abort", plus a manager-level focus test (§11). |
| 7 | NIT | **Addressed.** Explicit `VIEW_TO_CORE_KIND` table in §7, including `'helm-releases'` → `'helmreleases'`; everything else (including `'overview'`) → `null`, with an own-property check. Unit test covers every row plus `'overview'`, `'helmreleases'` and `'constructor'` (§11). |
| 8 | NIT | **Addressed.** `setAllStatus(status: Pick<KindStatus, 'phase' \| 'error'>)` added to the store interface (one `set()`, new status objects, `byId` kept); `handleStartError` uses it (§6.1, §6.2). Store and controller tests added. |
| 9 | NIT | **Addressed.** `resyncContextEngine` requests a fresh `get-pods-chunk` and replays it only if `sessionId` matches and `synced` is true; the retained chunk is dropped (§3.9). Adapter test added. |
| 10 | NIT | **Addressed.** Namespaced `setNamespaces(['all'])` stops all per-namespace streams, emits deletes for their ids and sets `forbidden` (pods: `stop-informer` + empty reset). `onCredentialsChanged()` and the idempotent `startSession` error-recovery path retry cluster mode once per trigger (§3.7). Manager tests added. |
| 11 | NIT | **Addressed.** `get-pod-count`, `pod-count-reply` and `informer-stopped` are removed (types, worker and `main.ts` handlers); `stopSession`'s `clearKind('Pod')` replaces the `informer-stopped` handler. `DeltaBatchBuffer.clear()` is listed as a new method in the `k8s-pod-worker.ts` modified-files entry (§3.1, §3.6, §3.10). |
| 12 | NIT | **Addressed (reworded, kept).** §3.10 now says `helm.getReleases` is kept with no current renderer caller, and records why it is kept rather than removed. |
| 13 | NIT | **Addressed.** CONNECT callback is `cache.js:104`; LIST-failure ERROR callbacks are `cache.js:111-113` (§3.6). |
| 14 | NIT | **Addressed.** `did-start-navigation`, `render-process-gone` and `destroyed` handlers are registered inside `createWindow()` (`main.ts:3208`), so a window recreated by `activate` gets them. `window-all-closed` uses the reason `'all-windows-closed'`; `before-quit` keeps `'quit'` (§3.7). |
| 15 | NIT | **Addressed.** `createKubeConfig` wraps any `loadFromDefault()` failure as `KubeconfigLoadError`; `startSession` (both paths) rejects with the fixed `Error('Failed to load kubeconfig')`, leaves the existing session untouched and logs only the error name. An auth rebuild hitting it sets all kinds `error` "Failed to load kubeconfig" (§3.1, §3.7, §5.1, §8). Tests added (§11). |

#### 14.2.1 Revision 4 amendment: responses to the rev-4 review

Both findings are addressed with the reviewer's recommended fix. Nothing is backlogged or ignored. Only §3.5, §3.5.1 step 3, the §8 helm whole-request row, §9 step 8 and the §11 helm-index tests changed.

| # | Sev | Resolution |
|---|---|---|
| 1 | MEDIUM | **Addressed (recommended fix).** `bySecretUid` entries gain `decodeState: 'none' \| 'pending' \| 'failed'`, plus `corrupt` and `retryOnce`, all reset when the rv changes. Decoding from event/LIST data happens only for the uid delivered by the current `onSecret` call, and sets `'pending'`. The fallback fetch fires only when the max uid has `summary === null`, `decodeState === 'none'` and is not the current `onSecret` subject; issuing it sets `'pending'`. A `failures[]` entry sets `'failed'` + `corrupt` (excluded from max selection). A fetch failure sets `'failed'` without `corrupt` (label summary stays). A whole-request failure resets still-current max uids to `'none'` + `retryOnce`, so the retry is one `readSecret` + one-item decode; a second whole-request failure sets `'failed'`. This replaces "retry in the next 650 ms decode window" (§3.5, §3.5.1 step 3, §8). The label-summary sentence now lists exactly the states it covers. Tests: same-page v3-then-v2 (one decode, zero `readSecret`); decode in flight + older-revision event (no `readSecret`); cross-page v1/v10/v2; rv change resets decode state; the whole-request test now asserts exactly one `readSecret` per affected max uid and none after a second failure (§11). |
| 2 | NIT | **Addressed (recommended fix).** §9 step 8 runs the 20 focus events within 4 minutes of a stream (re)connect. A longer run must be compared with a no-focus control run of the same duration, and any epoch bump must match a health abort in the main log. |

#### 14.2.2 Revision 4 second amendment: responses to the amended-rev-4 review

The single finding is addressed with the reviewer's recommended fix. Only the §3.5 fallback-fetch rules, the §8 matrix and the §11 helm-index tests changed.

| # | Sev | Resolution |
|---|---|---|
| 1 | MEDIUM | **Addressed (recommended fix).** Ignored fallback-fetch results are now split by mismatch type (§3.5). A same-uid rv mismatch with the entry rv unchanged since issue (fetch ahead of the watch) sets `'failed'`, `corrupt = false`, and does not re-run the recompute; the label summary stays and the newer event/re-LIST decodes from the raw in hand. A uid mismatch resets the old uid to `'none'` and recomputes for the new target. A session mismatch does nothing. One extra case is made explicit: a same-uid rv mismatch where the entry rv changed since issue (watch ahead of the fetch) does nothing, so the stale result cannot clobber the raw-in-hand decode's `'pending'` state. New §8 row. Tests: "fallback fetch returns a newer rv for the same uid" (exactly one `readSecret`) and "fallback fetch overtaken by the watch" (§11). |

### 14.3 Revision 2: responses to the first review (kept for history)

Superseded parts: row 1's "per-informer KubeConfig" is replaced by review-2 finding 20, and row 14's "`stopGenericWatch` deletes its map keys, guarded by `?? -1`" is replaced by review-2 finding 10 (`disposeGenericWatch`).

| # | Sev | Resolution |
|---|---|---|
| 1 | HIGH | **Addressed.** Per-attempt epoch with abort-on-late-return and `attempt.done` handling (§3.4) and tests (§11). Pod worker: per-informer KubeConfig, re-`stop()` after `start()` if superseded, embedded `timeoutSeconds` to bound the internal re-watch race, which is documented in §8. |
| 2 | HIGH | **Addressed.** Renderer request token replaces the context check (§6.2). Main's `buildSnapshot` superseded check after the await (§3.7). A 5-mismatch `'resubscribe'` backstop in the store (§6.1). Tests in store, hook and manager. |
| 3 | HIGH | **Addressed (chosen: `reset` flag).** `KindDelta.reset`. The adapter resets pods on every `informer-synced`, and the coalescer gets `resetKind` (§3.2, §3.6, §3.8). Respawn and namespace-removal tests. |
| 4 | MEDIUM | **Addressed.** (a) per-informer `synced/errored` tracking; (b) serialized lifecycle chain plus per-call captured `sid`; (c) a `refresh` message with per-informer `lastEventAt`, driven by `ensureFresh` and the health interval (§3.6). |
| 5 | MEDIUM | **Addressed.** `seq` and the maps are read synchronously after the chunk await (§3.7, §4). Test added. |
| 6 | MEDIUM | **Addressed.** The deployments `onListed` forwards LIST items and diff deletes. `resyncContextEngine()` runs on the idempotent path. Stop-on-clusterSwitch rejected, with the reason given (§3.9). |
| 7 | MEDIUM | **Addressed.** The worker contract adds `secretUid`, `secretResourceVersion` and `failures[]`. The optional label-based latest-revision optimization is adopted (§3.5). |
| 8 | MEDIUM | **Addressed.** Pending promises are resolved on crash and exit, plus a 15 s timeout and a diagnostics entry (§3.5.1, D9). The wrong assumption is removed from §8. |
| 9 | MEDIUM | **Addressed (chosen: `loadFromDefault` everywhere).** No `kubeconfigPath` is sent to the worker. The "closes a gap" assumption is removed (§2, Assumptions, decision point 8). |
| 10 | MEDIUM | **Addressed.** Manager-level `lastNamespaces` defaults to `['all']` and is always recorded. `startSession` accepts `namespaces` (§3.7, §5.1, §6.2). |
| 11 | MEDIUM | **Addressed.** `prevClusterRef` stops only on a non-null → null transition. Reload relies on the idle timer, started on `did-start-navigation`. The §9 Cmd+R step is rewritten as "re-select within 60 s" plus a "no re-select → stopped" check. The separate first-mount `subscribe` was removed because idempotent `startSession` covers HMR. |
| 12 | MEDIUM | **Addressed.** `handleNavigate` uses non-reactive `getState()` with pods matched on `name/namespace`. `isUpdating` maps to `phase === 'reconnecting'`. `isSynced`/`error` are mapped. There is one top-level `useResourceCount(coreKindForView(activeView), ns)` with defined semantics (§6.3, §7). |
| 13 | MEDIUM | **Addressed.** The §3.10 removal list is extended (pod-worker sends, `get-pods-chunk`, preload `podWorker`, helm watch preload, globals moved into the adapter, switch delegation). |
| 14 | MEDIUM | **Addressed.** `stopGenericWatch` and `k8s:stopWatchGenericResource` delete their map keys, guarded by `?? -1` (§5.3). D3 reworded to in-flight IPC only. `legacyMaps` added to diagnostics and verification. |
| 15 | MEDIUM | **Addressed.** A single rule: a debounced shared `requestAuthRebuild` (≤1 per 10 s), streams resolve `kc` on every attempt, and 3 consecutive 401s mean `error` until credentials change or `ensureFresh` (§3.4, §3.7, §8). |
| 16 | MEDIUM | **Addressed.** Diagnostics add `invokeCounts`, `podWorker`, `pendingTransforms`, `legacyMaps` and per-stream `connecting`/`epoch`. A DEV-only `__lumenDiag` console helper. The procedure is rewritten around those numbers plus an `lsof` socket check (§9). |
| 17 | MEDIUM | **Addressed.** `lastEventAt` initialization is defined. Null, connecting and backoff streams are skipped. The rationale for the threshold versus `timeoutSeconds` is given (§3.4). |
| 18 | NIT | **Addressed.** `stringData` is dropped from the count (§3.3). |
| 19 | NIT | **Addressed.** Memos derive from `nsKey.split(',')` (§6.3). |
| 20 | NIT | **Addressed.** No `useShallow`. The status selector is plain (§6.3). |
| 21 | NIT | **Addressed.** D5 description corrected (§1). |
| 22 | NIT | **Addressed.** `z.undefined()` for channels without arguments (§5.1). |
| 23 | NIT | **Addressed.** The `mapStatusToMessage` table, and `ApiException.message` is never surfaced (§3.3, §6.2). |
| 24 | NIT | **Backlogged as a known limitation and decision point 7.** In cluster mode, the default, it has no effect. In namespaced mode it matches today's behavior, where the selection is also lost on remount. Hoisting changes UX, so the user decides. |
| 25 | NIT | **Addressed.** `createKubeConfig` validates against a fresh `KubeConfig` and throws `UnknownContextError`. The `hasContext` dependency is removed (§3.1, §5.1). |

