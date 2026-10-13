# Implementation Plan: Background Resource Cache

Source of truth: `design.md` (revision 4, second amendment, APPROVED in `design-review.md`). Section refs (§) point there. This plan sequences the design; it does not re-decide it. Where the code disagrees with the design, the gap and the assumption taken are listed under "Gaps and assumptions".

## Ground rules for the implementer

- **Work in the workspace root `/Users/MohammedRashid.Matin/Development/lumen`** (there is no separate worktree; `git worktree list` shows only this checkout on `feature/security-improvements`). Use absolute paths.
- **The checkout already has uncommitted user changes** in files this task edits (`electron/main.ts`, `electron/k8s.ts`, `electron/preload.ts`, `electron/electron-env.d.ts`, `src/App.tsx`, `src/components/Dashboard.tsx`, `src/vite-env.d.ts`, `src/hooks/useResourceSorting.ts`, …). Never revert, reformat or `git checkout` them. Do not commit unless a later workflow step tells you to; if you do, stage only this task's hunks.
- **Baseline (measured before planning):** `npx tsc --noEmit` exits 0; `npx vitest run` passes 41 files / 399 tests; `npm run lint` is already red (1566 pre-existing errors). Therefore:
  - New files must be eslint-clean: `npx eslint <new files> --max-warnings 0`.
  - Modified existing files must not gain errors: compare `npx eslint <file> -f unix | wc -l` before and after your edit.
- **Standard verification for every item:** `npx tsc --noEmit` exits 0, plus the vitest command listed on the item. Full `npx vitest run` at items 8, 11, 14, 16.
- Constraints carried from the brief (apply to every item):
  - All K8s calls stay in `electron/`. The renderer uses only `window.k8s.*` through the preload `contextBridge`.
  - IPC inputs are validated with `safeHandle` + zod from `electron/ipc/validation.ts` (the brief says `electron/validation.ts`; the real path is `electron/ipc/validation.ts`).
  - zustand: follow `src/stores/orgStore.ts` (`create`, no middleware). If any selector must return a fresh object, use `useShallow` from `zustand/react/shallow`. The §6.3 selectors return stored references or primitives, so they need none.
  - 650 ms coalescing. Maps keyed by uid. Strip `managedFields` and the `kubectl.kubernetes.io/last-applied-configuration` annotation. Never send Helm release blobs to the renderer.
  - `useResourceSorting` stays the single sorting source.
  - New files under ~500 lines. TS strict, no `any` in new code.
  - Theme/glassmorphism classes for status UI.
  - Every preload `on*` removes only its own listener.
- Tests are vitest 4 (`**/*.test.ts`, globals on, node environment). fast-check 4 is available. There is no jsdom or React testing library, and none is added.

## Decision Points

All design decision points (§13) take the design's recommended option. Override any of them before or during implementation by editing this table; the affected plan items are listed.

| ID | Decision | Chosen option | Rationale | Affects |
|---|---|---|---|---|
| DP-1 | Watch scope for core kinds | **Cluster-wide by default.** Client-side namespace filter. Per-namespace streams only as a 403 fallback. | Namespace switches become instant with no stream restart, and the multi-namespace bug D1 disappears. | 5, 10, 12, 13 |
| DP-2 | Non-core kinds (DaemonSets, Ingresses, RBAC, …) | **Stay on demand.** They only get the D3 key nonce and the generic-watch map cleanup. | Keeps scope to the six kinds the user listed. Caching them can be a follow-up. | 7, 14 |
| DP-3 | Where pods are watched | **Existing `k8s-pod-worker` utilityProcess,** driven by WatchManager via session-tagged protocol v2 with reset-on-sync. | Keeps the highest-volume parsing off the main thread. | 8, 9, 11 |
| DP-4 | Legacy watch IPC (`watchPods`/`watchDeployments`/`watchHelmReleases`, `podWorker` preload namespace, raw per-event sends) | **Remove.** | No other consumer exists in the repo. Removing them halves IPC volume and stops raw objects reaching the renderer. | 15 |
| DP-5 | Idle grace after the renderer reloads or goes away | **60 s,** then `stopSession('no-subscriber')`. | A reload followed by a re-select stays warm, without keeping watches alive indefinitely. | 10, 11 |
| DP-6 | Helm release source | **Derived from the single core Secrets stream** (HelmIndex), with no second helm-selected watch. | One download and one connection per blob. RBAC needs are unchanged. | 6, 10 |
| DP-7 | `selectedNamespaces` ownership | **Stays Dashboard-local** (minimal scope). Known limitation in §7. | Hoisting it into a store changes UX behaviour, so that is the user's call. | 14 |
| DP-8 | `settings_kubeconfigPath` for watches | **Unused.** Watches use `loadFromDefault()`, like the rest of `K8sService`. | Consistent with existing credential and context resolution. App-wide support is a separate change. | 7, 8 |

The brief said "about 7". The design lists 8 (§13 items 1–8), and all 8 are recorded.

Planner decisions (not in §13; also overridable):

| ID | Decision | Rationale |
|---|---|---|
| PD-1 | **Do not restructure the workflow into FEAT steps.** The existing implement-and-review loop runs this plan. | Per-FEAT coders must commit as they go. In this un-isolated checkout, which has uncommitted user edits in the same files, that would sweep unrelated user work into commits. |
| PD-2 | **Diagnostics are dev-only.** `resources:getDiagnostics` is registered always, but returns `null` unless `!app.isPackaged` (injected flag `diagnosticsEnabled`). `window.__lumenDiag` is defined only under `import.meta.env.DEV`. | Satisfies "dev-only guarded diagnostics" without changing the zod contract per build. |
| PD-3 | **Diagnostics gain `listCalls`,** which the design's §9 interface lacks. Shape: `listCalls: Record<Exclude<CoreKind,'pods'\|'helmreleases'>, { runs: number; pages: number }>` from `ListWatchStream` counters (cumulative per session, summed across a kind's streams), plus `podWorker.informerStarts` (count of informer constructions, i.e. pod LISTs, since the last `start-informer`). | The brief asks for counts of active streams, IPC listeners and LIST calls. Streams and listeners are already in §9; LIST calls are added here. |
| PD-4 | **`DeltaBatchBuffer.clear()` empties the pending map without posting, and keeps the `setInterval`.** | The buffer flushes on a module-lifetime `setInterval(150 ms)` (`k8s-pod-worker.ts:78`), not a one-shot timer. Cancelling it, as §3.1 says, would stop all later flushes. With an empty map the interval is a no-op. The §11 test becomes "no post on the next interval tick". |

## Gaps and assumptions

- Line numbers in the design were taken before the current uncommitted edits. They are within a few lines (e.g. `createWindow` is at `main.ts:3215`, `whenReady` at `3308`, legacy watch handlers at `1900-2028` and `2874-2910`). Locate code by symbol, not by line.
- Intermediate items keep `tsc` and vitest green, but the running app is only expected to work end-to-end after item 15. Between items 11 and 14, the old renderer pod path talks to removed or changed main handlers.
- `getDiagnostics` (PD-2) returning `null` in packaged builds means §9's manual procedure runs only under `npm run dev`.

---

# Implementation Plan

- [ ] 1. Add the shared cache types.
      Create `src/types/resource-cache.ts` exactly as in §3.2:
      - `CoreKind`, `CORE_KINDS`, `KindPhase`, `KindStatus`, `TrimmedMeta`;
      - the six item types, `KindItemMap`, `KindDelta`, `ResourceBatch`, `ResourceSnapshot`, `StartSessionArgs`;
      - `ResourceCacheDiagnostics` from §9 extended with PD-3 `listCalls`, plus `podWorker.informerStarts`.

      `PodItem` imports `LightweightPod` via `import type` from `./pod-worker`. ISO-string timestamps only.
      Files: `src/types/resource-cache.ts`
      Verify: `npx tsc --noEmit` exits 0; `npx eslint src/types/resource-cache.ts --max-warnings 0` is clean.

- [ ] 2. Implement the pure kind layer and its tests.
      `electron/resource-cache/kinds.ts` contains:
      - `toWireShape`, `toIso`, `trimMeta`;
      - per-kind trimmers for deployments, services, configmaps and secrets (§3.3; field shapes from `resource-transform-worker.ts` `transformDeployment` and `K8sService.getServices` ~`k8s.ts:1569`);
      - `itemId` (uid, falling back to `ns/name`);
      - `extractStatusCode` and `mapStatusToMessage` (fixed strings only);
      - `KubeconfigLoadError` and `UnknownContextError`;
      - `CORE_KIND_DESCRIPTORS` (list fn per scope using typed `CoreV1Api`/`AppsV1Api` `list*ForAllNamespaces` / `listNamespaced*`, `pageSize` 100 for secrets and 500 otherwise, watch path builder, trimmer, id fn, context-engine kind).

      The descriptors' optional `onListPage`/`onListComplete` hooks are typed here but wired by WatchManager (item 10).
      Files: `electron/resource-cache/kinds.ts`, `electron/resource-cache/kinds.test.ts`
      Verify: `npx vitest run electron/resource-cache/kinds.test.ts` passes. It covers every §11 kinds bullet:
      - stripping of managedFields and last-applied;
      - the sentinel-value deep search for Secret and ConfigMap values;
      - the id fallback;
      - the mapStatusToMessage non-echo;
      - extractStatusCode for `ECONNRESET`, `statusCode`, `code` and `body.code`;
      - typed-Date vs raw-JSON parity for all four kinds.

- [ ] 3. Implement the Coalescer.
      `Coalescer` (§3.8):
      - `push(kind, op)`, last write wins;
      - `setStatus`;
      - `resetKind(kind, items)`;
      - a single 650 ms `setTimeout`, armed only on the first push or reset;
      - `flush()` building `ResourceBatch` with `seq: ++session.seq` and sending only to a bound, non-destroyed subscriber;
      - `clear()` without flushing;
      - `hasTimer()` for diagnostics.

      Timers and `now` are injectable.
      Files: `electron/resource-cache/coalescer.ts`, `electron/resource-cache/coalescer.test.ts`
      Verify: `npx vitest run electron/resource-cache/coalescer.test.ts` passes. It covers last-write-wins, delete-after-upsert, reset discarding earlier ops, pushes after a reset, one timer, no timer while empty, and seq increments.

- [ ] 4. Make the transform worker client robust (D9) and extend the helm transform contract.
      - Move `getOrCreateWorker`/`sendToWorker` out of `electron/main.ts` (~lines 258-300) into `electron/transform-worker-client.ts`, exactly per §3.5.1: per-worker pending sets, a 15 s timeout, `failAll` that never nulls a newer worker, an injectable `createWorker`, and an exported `pendingTransformCount()`.
      - `main.ts` imports `sendToWorker` from it. The node, replicaset and generic callers keep their call sites unchanged.
      - In `electron/resource-transform-worker.ts`, helmrelease output adds `secretUid` and `secretResourceVersion`, and `TransformResponse` gains `failures?: Array<{ index; uid?; message }>`, filled whenever a per-event transform throws.

      Files: `electron/transform-worker-client.ts`, `electron/transform-worker-client.test.ts`, `electron/main.ts`, `electron/resource-transform-worker.ts`, `electron/helm-release-transform.pbt.test.ts` (extend)
      Verify: `npx vitest run electron/transform-worker-client.test.ts electron/helm-release-transform.pbt.test.ts` passes. Covered:
      - the W1 error → W2 created → W1 exit case leaves W2's request pending and `transformWorker` still pointing at W2;
      - W1's own requests resolve with `'worker error'`;
      - the timeout removes the id from both maps;
      - helm output carries `secretUid`/`secretResourceVersion`;
      - a corrupt blob yields a `failures[]` entry.

      Also `npx tsc --noEmit` exits 0.

- [ ] 5. Implement `ListWatchStream`.
      Implements §3.4 completely:
      - paginated LIST through injected `listPage`, with `toWireShape` → `onListPage` → trim into a temporary trimmed-only map, and early upserts on the first sync;
      - the diff with deletes and `deletedMeta`, then `onListComplete`;
      - the continue-token 410 restart;
      - WATCH from rv with bookmarks and `timeoutSeconds` 300–600;
      - the attempt-epoch connect guard (abort a late controller, handle `done` before return);
      - the normal-close hot-loop guard (≥5 s or ≥1 event → re-watch after 500 ms; otherwise counted as a failure);
      - backoff `min(1000·2^n, 30000)·(0.8..1.2)`, with at most one timer;
      - the 3-strike rv drop;
      - 401 → `requestAuthRebuild()`, and phase `error` at the 3rd;
      - 410 → re-LIST;
      - `lastEventAt` rules, `checkHealth(now)` (5 min) and `ensureFresh(ms)` with the 660 s floor;
      - `restart()`, `stop()`;
      - `getDiagnostics()` returning `{ kind, scope, phase, connecting, hasController, hasTimer, lastEventAt, epoch }`;
      - PD-3 counters `listRuns` and `listPages`.

      The `kc` is read from an injected `getKc()` on every attempt; the stream never caches it.
      Files: `electron/resource-cache/list-watch.ts`, `electron/resource-cache/list-watch.test.ts`
      Verify: `npx vitest run electron/resource-cache/list-watch.test.ts` passes. It uses fake timers and a fake `listPage`/`watch`, and covers every §11 list-watch bullet:
      - pagination, re-list deletes, a 410 ERROR event, the backoff cap, the 3-failure rv drop;
      - stop during LIST, stop during a pending `watch()`, `done` before return;
      - `lastEventAt`, health, 401×3 and `restart`, fast close;
      - limit 100/500;
      - the LIST hook calls and the trimmed-only temp map;
      - a superseded page skipping `onListPage`;
      - `ensureFresh` 120 s / 300 s / 0;
      - `listRuns`/`listPages` counting.

- [ ] 6. Implement `HelmIndex`.
      Implements §3.5 and the §3.5.1 response handling:
      - `bySecretUid`/`byRelease`;
      - label and secret-name parsing;
      - the rv-change reset of decode state;
      - the raw-in-hand single decode path for the max revision;
      - decode batches of ≤50 posted synchronously at the end of each `onListPage`, with watch decodes batched per 650 ms;
      - correlation by `secretUid@secretResourceVersion` and by `failures[].uid`;
      - `corrupt` exclusion;
      - the label-derived fallback summary;
      - the guarded `readSecret` fallback fetch (one in flight per release, all four mismatch rules);
      - the whole-request failure retry with `retryOnce`;
      - helm phase tracking (`initialDecodesPending`, `onFirstListComplete`);
      - `clear()` emitting deletes for all releases;
      - diagnostics `helmDecodeCacheSize` and `helmFallbackFetchesInFlight`.

      Dependencies are injected: `sendToTransformWorker`, `readSecret`, `emit(upsert|delete)`, `getSessionId`, and timers. HelmIndex never retains raw secrets.
      Files: `electron/resource-cache/helm-index.ts`, `electron/resource-cache/helm-index.test.ts`
      Verify: `npx vitest run electron/resource-cache/helm-index.test.ts` passes, covering every §11 helm-index bullet. That includes:
      - same-page v3-then-v2: one decode, zero `readSecret`;
      - cross-page revisions;
      - decode in flight plus an older event → no `readSecret`;
      - delete latest → a label-derived v2 summary, then one `readSecret`, then the full summary;
      - a newer-rv fetch result → `'failed'`, then a MODIFIED decode with no refetch;
      - a fetch overtaken by the watch;
      - whole-request failure → one retry fetch → `'failed'`;
      - the partial 49+1 response;
      - helm phase with hooks;
      - a stale-session result dropped.

- [ ] 7. Add the `K8sService` helpers.
      In `electron/k8s.ts` add:
      - `createKubeConfig(contextName)`: a fresh `KubeConfig` from `loadFromDefault()`; any throw is rethrown as `KubeconfigLoadError` with no cause attached; a missing context throws `UnknownContextError`; then `setCurrentContext`. Error classes are imported from `resource-cache/kinds.ts`.
      - `disposeGenericWatch(resourceType)` per §5.3. `stopGenericWatch` is unchanged.
      - A public `getLegacyMapSizes()` returning `{ activeWatchers, watchGenerations, watchResourceVersions }` for diagnostics.

      Files: `electron/k8s.ts`, `electron/k8s.test.ts` (new; `vi.mock('@kubernetes/client-node')`), `electron/k8s-generic-watch.test.ts` (new)
      Verify: `npx vitest run electron/k8s.test.ts electron/k8s-generic-watch.test.ts` passes. Covered:
      - the `KubeconfigLoadError` message is exactly `'Failed to load kubeconfig'` and leaks nothing;
      - `UnknownContextError`;
      - an internal reconnect keeps the rv;
      - `disposeGenericWatch` deletes `generic:<key>` from all three maps, and a late callback is a no-op.

      If mocking `K8sService` for the generic-watch test is impractical, record that in this item and rely on §9 step 3.

- [ ] 8. Build the pod worker core (protocol v2) as a standalone, tested module.
      - Add the v2 message types to `src/types/pod-worker.ts` alongside the old ones for now, as `WorkerInboundV2`/`WorkerOutboundV2` (§3.6 inbound/outbound lists).
      - Create `electron/pod-worker-core.ts`: `createPodWorkerCore({ makeInformer, buildKc, post, now, setTimeout, clearTimeout, mapPod, deltaBuffer })` implementing the §3.6 worker state and behaviour:
        - `onLifecycle` with receipt-time `podCache` replacement and the `currentGen` bump;
        - `InformerRec` with `live()`, the `disposed`-first disposal, and no restart of stopped informers;
        - the connect-race re-stop;
        - the error handler (AbortError ignored; cluster 403; namespaced 403 → `forbidden`; 401 with no retry; other codes retry with backoff);
        - `afterStart`/`maybePostSynced`, the fast-close guard, `needsRefresh` with the 660 s floor and exclusions;
        - one `buildKc` per `start-informer`;
        - the unpaged `get-pods-chunk` reply with `sessionId`/`synced`;
        - `get-diagnostics` (adds `informerStarts`, PD-3).
      - Add `DeltaBatchBuffer.clear()` (PD-4) in `electron/k8s-pod-worker.ts`. Do not rewire the worker entry yet.

      Files: `src/types/pod-worker.ts`, `electron/pod-worker-core.ts`, `electron/pod-worker-core.test.ts`, `electron/k8s-pod-worker.ts` (clear only), `electron/k8s-pod-worker-delta-buffer.test.ts`
      Verify: `npx vitest run electron/pod-worker-core.test.ts electron/k8s-pod-worker-delta-buffer.test.ts` passes, covering every §11 pod-worker-core bullet:
      - AbortError from `stop()` causes no retry;
      - a same-session restart builds new informers;
      - receipt-time replacement;
      - late `add` ignored;
      - 403 in cluster mode vs 500;
      - namespaced one-ns 403 vs all-ns 403;
      - 401 with no retry;
      - removed messages ignored;
      - five fast closes;
      - `needsRefresh` thresholds;
      - one `buildKc`;
      - `clear()` with no post on the next tick.

      Full `npx vitest run` and `npx tsc --noEmit` stay green.

- [ ] 9. Implement `PodWorkerAdapter`.
      Implements the §3.6 adapter:
      - drops messages with a mismatched `sessionId`;
      - reset-on-every-`informer-synced` (chunk request → `coalescer.resetKind('pods', …)` → `ready`);
      - `getSnapshotPods()` with a 10 s timeout, the accept rule `reply.sessionId === session.id && reply.synced`, and immediate `[]`/`reconnecting` when `port.post` returns false;
      - `pod-delta-batch` mapping into the coalescer;
      - the context-engine pseudo-raw bridge and `podUidMap`, moved from `main.ts` ~`332-397`, plus DELETED for uids that vanish on reset;
      - `forbiddenNamespaces` (namespaced 403 → error text, or `forbidden` when all are forbidden);
      - the 401 counter (counted once per start, backoff, re-post, give-up at 3 with `stop-informer`), reset rules and the single adapter timer;
      - `onRespawned()`;
      - `resyncContextEngine()` with a fresh chunk and no retained chunk;
      - `getDiagnostics()` (worker `get-diagnostics` with a 2 s timeout, `pendingChunkRequests`, `available`).

      It depends on a `PodWorkerPort` interface, not `utilityProcess`.
      Files: `electron/resource-cache/pod-adapter.ts`, `electron/resource-cache/pod-adapter.test.ts`
      Verify: `npx vitest run electron/resource-cache/pod-adapter.test.ts` passes, covering every §11 pod-adapter bullet:
      - mismatched session dropped; reset per sync;
      - respawn with a pod deleted during the outage;
      - namespaced removal;
      - chunk timeout; unaccepted chunk;
      - port unavailable;
      - 401 ×3 / sync reset / credentials;
      - namespaced 403 for one namespace and for all;
      - fresh resync chunk.

- [ ] 10. Implement `WatchManager`.
      Implements §3.7 (constructor deps as specified, plus `diagnosticsEnabled` from PD-2 and `getLegacyMapSizes`):
      - manager-level `lastNamespaces`;
      - `startSession`: the idempotent path with terminal-error recovery and the one-shot cluster retry, and the new-session path;
      - `buildSnapshot`, with the seq read after the pod-chunk await and the superseded check;
      - `stopSession`, which releases everything;
      - `subscribe`, `setNamespaces` (namespaced diffing, `['all']` while namespaced → `forbidden`);
      - per-kind mode switching on a cluster-scope 403;
      - the return to cluster mode;
      - the 10 s-debounced `requestAuthRebuild`;
      - `onCredentialsChanged`, `ensureFresh`, `onPodWorkerMessage`/`onPodWorkerRespawned`;
      - `onRendererNavigated`/`detachSubscriber` with the 60 s idle timer (DP-5);
      - the single 60 s health interval;
      - `resyncContextEngine` (§3.9);
      - `getDiagnostics` (§9 + PD-3).

      It wires the descriptor hooks: deployments → context engine; secrets → `HelmIndex.onSecret`/`onSecretDeleted`/`onFirstListComplete`, and the helm phase mirrors secrets. There is no `electron` import. If the file passes ~470 lines, move mode switching into `electron/resource-cache/scope-manager.ts`.
      Files: `electron/resource-cache/watch-manager.ts`, optionally `electron/resource-cache/scope-manager.ts`, `electron/resource-cache/watch-manager.test.ts`
      Verify: `npx vitest run electron/resource-cache` passes. It runs every resource-cache test, including every §11 watch-manager bullet:
      - idempotent start; switch order; late events; late snapshot A→B→A; seq during the chunk await;
      - `setNamespaces` before start; 403 → namespaced; namespace add/remove;
      - auth debounce across 4 streams; the 60 s idle;
      - deployment LIST → context engine;
      - zero timers and controllers after stop;
      - terminal-error recovery; no idle timer without a session;
      - an A→B snapshot never contains A pods;
      - kubeconfig load failure; `['all']` while namespaced; cluster-mode retry;
      - secrets re-list → `HelmIndex`;
      - focus does not churn.

      Also assert `listCalls` counts after a LIST and a re-LIST.

- [ ] 11. Wire main and preload (new API alongside the legacy API).
      - **`electron/ipc/resource-cache-ipc.ts`:** `registerResourceCacheIpc(manager)` with the six §5.1 channels via `safeHandle` and the exact zod schemas (`NamespacesSchema`, `z.undefined()` for no-arg channels), `invokeCounts`, and a `handlersRegistered` registry. The subscriber is built from `event.sender` (`id`, `isDestroyed`, `send`).
      - **`electron/k8s-pod-worker.ts`:** replace the `parentPort` switch with delegation to `createPodWorkerCore`. Remove `get-pod-count`/`pod-count-reply`/`informer-stopped`. In `src/types/pod-worker.ts`, replace the old `WorkerInbound`/`WorkerOutbound` with v2. Delete `electron/k8s-pod-worker-chunk.pbt.test.ts`.
      - **`electron/main.ts`:**
        - Build `podWorkerPort` with `respawnPending`/`quitting`. Delete `ensurePodWorker`. `spawnPodWorker` delegates messages to `manager.onPodWorkerMessage` and its exit respawns via the port, then calls `manager.onPodWorkerRespawned()`.
        - Construct `WatchManager` with `k8sService.createKubeConfig`, `sendToWorker`, the port, `contextEngine` and `diagnosticsEnabled: !app.isPackaged`. Call `registerResourceCacheIpc`.
        - Inside `createWindow()`: `did-start-navigation` (main frame, not same-document) → `onRendererNavigated`; `render-process-gone`/`destroyed` → `detachSubscriber`.
        - Add `powerMonitor` to the electron import and register `on('resume', () => manager.ensureFresh(0))` inside `app.whenReady()`.
        - Hook `awsService.on('credentialsChanged')` → `manager.onCredentialsChanged()`.
        - `before-quit` sets `quitting = true` before `podWorker.kill()` and calls `stopSession('quit')`. `window-all-closed` calls `stopSession('all-windows-closed')`.
        - Remove the legacy `start-pod-informer`/`stop-pod-informer`/`get-pods-chunk` handlers and `k8s-pod-*` sends now, because they cannot work against protocol v2.
      - **`electron/preload.ts`:** add the `resources` namespace exactly as in §5.2 (named listener, `ipcRenderer.off`, `listenerCount`). Fix D6: `app.onWindowFocused` uses a named listener disposed with `ipcRenderer.off`. Audit every other `on*` in preload and convert any `removeAllListeners` disposer to `off`, except the AI stream ones that §9.1 backlogs.
      - **Types:** add the `window.k8s.resources` types to `src/vite-env.d.ts` and `electron/electron-env.d.ts` using `import type`. Keep the `podWorker` preload namespace and types until item 15 so the renderer still compiles.

      Files: `electron/ipc/resource-cache-ipc.ts`, `electron/main.ts`, `electron/k8s-pod-worker.ts`, `src/types/pod-worker.ts`, `electron/preload.ts`, `src/vite-env.d.ts`, `electron/electron-env.d.ts`, `electron/k8s-pod-worker-chunk.pbt.test.ts` (delete)
      Verify:
      - `npx tsc --noEmit` exits 0 and full `npx vitest run` passes. Existing `k8s-pod-worker*.test.ts` must still pass or be updated to v2.
      - `npx vite build` completes (builds main, preload and renderer).
      - `npx eslint electron/ipc/resource-cache-ipc.ts --max-warnings 0` is clean, and eslint error counts for `main.ts`/`preload.ts` do not rise.

- [ ] 12. Add the renderer store and the pure helpers.
      - **`src/stores/resourceStore.ts`:** follows the `orgStore.ts` `create` pattern. Implements the §6.1 state and the single rule for `reset`/`applySnapshot`/`applyBatch` (`'applied'|'dropped'|'gap'|'resubscribe'`, one `set()` per batch, new `Map`s only for touched kinds), `setAllStatus`, `droppedBatches` and `consecutiveMismatches`. No derived arrays.
      - **`src/utils/resource-utils.ts`:** add `nsOf`, `filterByNamespaces`, `countInNamespaces`, `coreKindForView` (the §7 table with the `hasOwnProperty` guard) and `computePodStatusStats(byId, namespaces, prev)`, which is the overview stats function with the stable-reference trick, moved from `DashboardContent.tsx` ~183-204.
      - Migrate the fast-check properties from `src/hooks/usePodWorker.pbt.test.ts` into `resourceStore.test.ts` against `applyBatch` (idempotent add/update, delete no-op, order independence, reset replacement). Do not delete the old test until item 14 removes `usePodWorker`.

      Files: `src/stores/resourceStore.ts`, `src/stores/resourceStore.test.ts`, `src/utils/resource-utils.ts`, `src/utils/resource-utils.test.ts`
      Verify: `npx vitest run src/stores/resourceStore.test.ts src/utils/resource-utils.test.ts` passes. Covered:
      - mismatch dropped; 5 mismatches → `'resubscribe'`; null-session batches not counted;
      - `seq <=` dropped; gap reported;
      - untouched `byId` reference kept; reset replaces; snapshot replaces;
      - `setAllStatus` keeps `byId` and `sessionId`/`seq`;
      - the PBT properties;
      - `filterByNamespaces`, `countInNamespaces`, overview stats filtering;
      - `coreKindForView` for all table rows plus `'overview'`, `'helmreleases'`, `'daemonsets'` and `'constructor'` → `null`.

- [ ] 13. Add the sync controller, hook, selectors and App mount.
      - **`src/hooks/resource-sync-controller.ts`:** `createResourceSyncController(api, store)` implementing §6.2:
        - token, `prevCluster`, `onSync(selectedCluster, syncEpoch)`, `dispose`;
        - single-flight `resubscribe` under the same token; `startSessionFor` with `startPending`;
        - `handleStartError` (fixed strings → `setAllStatus`, otherwise "Failed to start resource sync", plus an injected `showToast`);
        - `setNamespacesRef` (called by the hook).

        No `connectionStatus` input.
      - **`src/hooks/useResourceSync.ts`** (~30 lines):
        - wraps the controller in `useEffect([selectedCluster, syncEpoch])`;
        - a separate focus effect with cleanup: `window.addEventListener('focus', …)` → `resources.ensureFresh()`;
        - `import.meta.hot?.dispose` backstop;
        - DEV-only `window.__lumenDiag` (PD-2) returning `{ main: getDiagnostics(), batchListeners: listenerCount(), dropped: droppedBatches }`, declared in `vite-env.d.ts` as optional.
      - **`src/hooks/useResourceList.ts`:** `useResourceMap`, `useResourceList`, `useResourceStatus` and `useResourceCount` exactly as in §6.3.
      - **`src/App.tsx`:** add `const [syncEpoch, setSyncEpoch] = useState(0)`. Bump it in both the success path (after `setSelectedCluster`, ~line 788) and the `catch` path of `handleClusterSelect` (~764-833). Call `useResourceSync(selectedCluster, syncEpoch, showToast)`, and pass an `onNamespacesChange` callback to `<Dashboard>` that writes the controller's namespaces ref.

      Files: `src/hooks/resource-sync-controller.ts`, `src/hooks/resource-sync-controller.test.ts`, `src/hooks/useResourceSync.ts`, `src/hooks/useResourceList.ts`, `src/App.tsx`, `src/vite-env.d.ts`
      Verify: `npx vitest run src/hooks/resource-sync-controller.test.ts` passes with a mocked `api`, covering every §11 controller bullet:
      - a late snapshot under an old token is ignored;
      - pre-snapshot batches are not counted;
      - resubscribe keeps delivery; single-flight (including none during the initial start);
      - non-null → null calls `stopSession`; an initial null does not;
      - `'connecting'` does not dispose the listener;
      - a failed switch re-runs `startSession` with no reset; a successful re-select does the same;
      - `handleStartError` mapping.

      Also `npx tsc --noEmit` exits 0.

- [ ] 14. Migrate the views and fix the non-core generic watch keys (D3).
      - **`src/components/dashboard/views/CoreResourceViews.tsx`** (≤~300 lines):
        - `ConnectedDeploymentsView`, `ConnectedPodsView` (pod metrics enrichment + `useResourceSorting` in `useMemo`, moved from `DashboardContent.tsx` ~337-386), `ConnectedServicesView`/`ConnectedConfigMapsView`/`ConnectedSecretsView` (GenericResourceView with the column definitions moved unchanged), `ConnectedHelmReleasesView`, and `ConnectedOverviewView` (uses `computePodStatusStats` and deployments);
        - the §7 prop mapping (`isLoading`, `isUpdating`, `isSynced`, `error`);
        - a small `CoreKindStatusBanner` above the table. `reconnecting` uses the warning card `bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400` with a `Loader2` `animate-spin` icon. `error` uses `bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400`. `forbidden` uses the yellow card with a `ShieldAlert` icon. Rows stay visible. Icons are from `lucide-react`, with `role="status"` and an `aria-live="polite"` text label.
      - **`DashboardContent.tsx`:**
        - remove `usePodWorker`, local pod sorting, and the props `pods`, `deployments`, `services`, `configMaps`, `secrets`, `helmReleases`, `helmReleasesLoading`, `onPodWorkerCount` and `isUpdating`;
        - core branches render their connected wrappers;
        - it subscribes to no `byId` (the §6.3 rule).
      - **`Dashboard.tsx`:**
        - remove the core-kind `useState`s, the `useDashboardWatchers` call, the helm watcher effect (~354-389), and the services/configmaps/secrets entries in `shapeResource`/`RESOURCE_WATCH_MAP`/`WORKER_BATCH_TYPES`;
        - remove the services/configmaps branches of `loadResources` and the wipe-effect lines;
        - remove `podWorkerCount`;
        - make `getCurrentViewData` return early `true` for core views and overview;
        - the header count uses one `useResourceCount(coreKindForView(activeView), selectedNamespaces)`;
        - `handleNavigate` uses `useResourceStore.getState()` lookups for deployments and pods;
        - drop `await loadResources()` after scaling deployments;
        - add a `[selectedNamespaces]` effect → `window.k8s.resources.setNamespaces` + `onNamespacesChange`;
        - `watchEpoch` remains only for nodes and non-core generic watches;
        - generic watch keys become `${view}@${clusterName}#${++watchNonceRef.current}` (namespaced keys append `:${ns}`).
      - **`electron/main.ts`:** `WATCH_KEY_TO_WORKER_TYPE` lookup uses `resourceType.split('@')[0]`. `k8s:stopWatchGenericResource` calls `k8sService.disposeGenericWatch` and `genericWatchGenerations.delete(resourceType)`. Drop the raw duplicate `k8s:genericResourceChange` send for worker-batched kinds (~line 2117). `secrets` is removed from `WATCH_KEY_TO_WORKER_TYPE`.
      - **Delete** `src/hooks/useDashboardWatchers.ts`, `src/hooks/usePodWorker.ts` and `src/hooks/usePodWorker.pbt.test.ts`.

      Files: `src/components/dashboard/views/CoreResourceViews.tsx`, `src/components/dashboard/DashboardContent.tsx`, `src/components/Dashboard.tsx`, `electron/main.ts`, the three deleted hook files
      Verify:
      - `npx tsc --noEmit` exits 0; full `npx vitest run` passes; `npx vite build` completes.
      - `npx eslint src/components/dashboard/views/CoreResourceViews.tsx --max-warnings 0` is clean, and eslint counts for `Dashboard.tsx`/`DashboardContent.tsx` do not rise.
      - Grepping `Dashboard.tsx`/`DashboardContent.tsx` for `useResourceStore(|useResourceMap(|useResourceList(` returns no hits. This is a review aid only, not a substitute for the build and tests.

- [ ] 15. Remove the legacy watch code (DP-4).
      Before deleting each symbol, grep `src/` and `electron/` for it. Migrate any surviving consumer, or keep it and note why in this file.
      - **Main:** `k8s:watchDeployments`/`stopWatchDeployments`, `k8s:watchHelmReleases`/`stopWatchHelmReleases`, `k8s:watchPods`/`stopWatchPods`; the `k8s:deploymentChange`/`k8s:podChange`/`*BatchChange` sends; the `deploymentBatchBuffer`/`podBatchBuffer`/`helmBatchBuffer`/`lastPodWatchScope`/`lastDeploymentWatchScope` globals and their `before-quit`/`window-all-closed` cleanup lines. The `context:clusterSwitch` handler keeps only `contextEngine.onClusterSwitch()` and `k8sService.clearWatchResourceVersions()`.
      - **K8sService:** `startDeploymentWatch`, `startHelmReleaseWatch`, `startPodWatch` and their stops.
      - **Preload and d.ts:** `onDeploymentChange`, `onPodChange`, `onPodBatchChange`, `onDeploymentBatchChange`, `watchDeployments`, `stopWatchDeployments`, `watchPods`, `stopWatchPods`, the `podWorker` namespace and `onPodWorkerCount` types, and `helm.watchHelmReleases`/`stopWatchHelmReleases`/`onHelmReleaseBatchChange`. Keep `helm.getReleases`.
      - Keep `electron/watcher-batch-buffer.ts`: it is still used by the node and generic watches (`main.ts:2038, 2092`).

      Files: `electron/main.ts`, `electron/k8s.ts`, `electron/preload.ts`, `src/vite-env.d.ts`, `electron/electron-env.d.ts`
      Verify: `npx tsc --noEmit` exits 0, full `npx vitest run` passes, `npx vite build` completes, and eslint counts for the touched files do not rise.

- [ ] 16. Run the manual verification and close out.
      - Under `npm run dev`, first check that no installed Lumen is running (`.kiro/steering/dev-troubleshooting.md`).
      - Run the §11 reproduction and confirm that tab switches start no watch: there must be no `[k8s] Starting generic watch for secrets` in the main log.
      - Run the §9 steps 1–10 with `await __lumenDiag()`, including that `listCalls` does not grow across 50 tab switches.
      - Record the results, and anything that could not be run (no real cluster, RBAC or Granted available), in `.agents/tasks/background-resource-cache/notes.md`.
      - Check every new file is under 500 lines (`wc -l electron/resource-cache/*.ts electron/pod-worker-core.ts electron/transform-worker-client.ts src/stores/resourceStore.ts src/hooks/resource-sync-controller.ts src/components/dashboard/views/CoreResourceViews.tsx`).
      - Update `.kiro/steering/watcher-debugging.md` and `.kiro/steering/structure.md` so they describe the WatchManager/resourceStore architecture and drop the references to `useDashboardWatchers`/`usePodWorker`/`watchEpoch`-for-core-kinds.

      Files: `.agents/tasks/background-resource-cache/notes.md`, `.kiro/steering/watcher-debugging.md`, `.kiro/steering/structure.md`
      Verify: `npx tsc --noEmit` exits 0 and `npx vitest run` passes (the expected total is the baseline 399 minus the deleted chunk/usePodWorker tests plus the new suites). Every new file is ≤500 lines. `notes.md` lists the result of each §9 step, or the reason it could not be run.

## Test inventory (vitest; all new unless noted)

| File | Item |
|---|---|
| `electron/resource-cache/kinds.test.ts` | 2 |
| `electron/resource-cache/coalescer.test.ts` | 3 |
| `electron/transform-worker-client.test.ts`; `electron/helm-release-transform.pbt.test.ts` (extended) | 4 |
| `electron/resource-cache/list-watch.test.ts` | 5 |
| `electron/resource-cache/helm-index.test.ts` | 6 |
| `electron/k8s.test.ts`, `electron/k8s-generic-watch.test.ts` | 7 |
| `electron/pod-worker-core.test.ts`; `electron/k8s-pod-worker-delta-buffer.test.ts` (extended) | 8 |
| `electron/resource-cache/pod-adapter.test.ts` | 9 |
| `electron/resource-cache/watch-manager.test.ts` | 10 |
| `src/stores/resourceStore.test.ts` (with the migrated PBT); `src/utils/resource-utils.test.ts` (extended) | 12 |
| `src/hooks/resource-sync-controller.test.ts` | 13 |
| Deleted: `electron/k8s-pod-worker-chunk.pbt.test.ts` (11), `src/hooks/usePodWorker.pbt.test.ts` (14) | — |
