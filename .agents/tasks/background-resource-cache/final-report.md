# Final report: background resource cache

Status: implemented and approved in code review (pass 2). Nothing has been committed. The working tree also holds unrelated in-progress work, so stage only the hunks listed below when you commit.

Deployments, pods, secrets, configmaps, services and Helm releases now load once per connected cluster. They stay live in the background, and switching tabs is a pure re-render: no IPC call, no watch restart, no state cleared. Nodes and the other kinds keep their existing on-demand watchers.

## 1. Architecture

```
main process                                             renderer
WatchManager (one session per cluster, id + seq)
 ├─ KindScopes → ListWatchStream × {deployments, services,
 │               configmaps, secrets} (cluster-wide, 403 → per-ns)
 ├─ HelmIndex   ← secrets stream (releases derived, blobs decoded
 │               in the transform worker, never sent)
 ├─ PodWorkerAdapter ↔ k8s-pod-worker utilityProcess (protocol v2)
 └─ Coalescer (650 ms) ── resources:batch ──► useResourceSync (App.tsx, single listener)
                                                   └─► resourceStore (zustand, Map per kind)
resources:startSession / setNamespaces / ... ◄────────  └─► useResourceMap/List/Status/Count
                                                           └─► Connected*View (one kind each)
```

- **Main-process list+watch streams.** `WatchManager` (`electron/resource-cache/watch-manager.ts`) owns one session per selected cluster. Each session has a fresh `KubeConfig` from `K8sService.createKubeConfig`, a session id and a monotonic `seq`. Each `ListWatchStream` (`list-watch.ts`) runs a paginated LIST, diffs against the previous list so deletes are emitted, and then WATCHes from the resourceVersion with bookmarks. It re-LISTs on 410. Backoff is jittered and capped at 30 s, the rv is dropped after 3 strikes, and the stream asks for an auth rebuild on 401. A per-attempt epoch guard means a stopped stream can never leave a live socket. Streams are cluster-wide by default. On a cluster-scope 403, `scope-manager.ts` switches that kind to per-namespace streams and drops the rows the cluster stream owned. Pods stay in the existing `k8s-pod-worker` utilityProcess, now driven through a session-tagged protocol v2 (`pod-worker-core.ts`, `pod-adapter.ts`) with a reset on every informer sync. Objects are trimmed in `kinds.ts`: `managedFields` and the last-applied annotation are stripped, and error messages are fixed strings that never echo the API body.
- **IPC snapshot+delta contract.** `electron/ipc/resource-cache-ipc.ts` registers six `resources:*` invoke channels through `safeHandle` with zod validation: `startSession`, `stopSession`, `setNamespaces`, `subscribe`, `ensureFresh` and `getDiagnostics`. `startSession`/`subscribe` return a `ResourceSnapshot` (session id, seq, every kind's items and status). After that, main pushes `ResourceBatch`es on one `resources:batch` channel. The `Coalescer` sends them at most every 650 ms, last write wins per id, with a per-kind `reset` for pod resyncs. The renderer drops a batch whose session id does not match or whose seq is not newer. A seq gap or repeated mismatches trigger a single-flight resubscribe. `ensureFresh` (on window focus and on `powerMonitor` resume) returns `{ bound }`, so a renderer that main has unbound rebinds itself.
- **Normalized Zustand store with per-kind selectors.** `src/stores/resourceStore.ts` follows the `orgStore.ts` pattern. It holds one `Map` keyed by uid per kind, plus status, session id and seq. Each batch does a single `set()`, and only the kinds it touches get new `Map`s. `useResourceSync` / `resource-sync-controller.ts` is mounted once in `App.tsx` and owns the only batch listener. `useResourceList.ts` exposes `useResourceMap`, `useResourceList`, `useResourceStatus` and `useResourceCount`. `CoreResourceViews.tsx` holds memoized wrappers that each subscribe to one kind and show a status banner (reconnecting, error or forbidden) while keeping the rows visible. Namespace filtering happens on the client (`filterByNamespaces`), and sorting still goes through `useResourceSorting`.
- **Helm releases from the Secrets stream.** `helm-index.ts` indexes `helm.sh/release.v1` Secrets from the single core secrets stream, by secret uid and by release. It decodes only the max revision per release in the transform worker, in batches of 50 or fewer, and correlates results by `uid@resourceVersion`. Until a decode lands, it falls back to a summary built from the labels, and it does a guarded one-off `readSecret` when the latest revision is deleted. Raw release blobs never reach the renderer and are not kept in main. The Helm phase mirrors the secrets phase.
- **Leak prevention.** Every preload `on*` the feature touches removes only its own named listener with `ipcRenderer.off`. This includes `resources.onBatch` and the D6 fix to `app.onWindowFocused`. `stopSession` aborts every controller, clears every timer, the coalescer and HelmIndex, and stops the pod informers. Tests assert zero timers and controllers after a stop. A cluster switch stops the old session before the new one starts. Main unbinds the subscriber on `did-navigate`, `render-process-gone` and `destroyed`, then waits a 60 s idle grace before `stopSession('no-subscriber')`. One 60 s health interval covers all streams. The transform-worker client tracks pending requests per worker with a 15 s timeout (D9). The non-core generic watch keys now get a nonce, and `disposeGenericWatch` removes their map entries (D3). The legacy per-event watch IPC (`watchPods`/`watchDeployments`/`watchHelmReleases`, the `podWorker` preload namespace, raw `*Change` sends) is removed. Dev-only diagnostics: `await window.__lumenDiag()` reports active streams, `listCalls`, informers, listener count, invoke counts, timers and legacy map sizes. It returns `null` in packaged builds.

## 2. Files changed (this feature)

New:
- `electron/resource-cache/`: `watch-manager.ts`, `scope-manager.ts`, `list-watch.ts`, `helm-index.ts`, `pod-adapter.ts`, `coalescer.ts`, `kinds.ts`, plus `*.test.ts` for each and `integration.test.ts`
- `electron/ipc/resource-cache-ipc.ts`
- `electron/pod-worker-core.ts`, `electron/pod-worker-core.test.ts`
- `electron/transform-worker-client.ts`, `electron/transform-worker-client.test.ts`
- `electron/k8s.test.ts`, `electron/k8s-generic-watch.test.ts`
- `src/types/resource-cache.ts`
- `src/stores/resourceStore.ts`, `src/stores/resourceStore.test.ts`
- `src/hooks/resource-sync-controller.ts`, `src/hooks/resource-sync-controller.test.ts`, `src/hooks/useResourceSync.ts`, `src/hooks/useResourceList.ts`
- `src/components/dashboard/views/CoreResourceViews.tsx`

Modified (feature hunks only; some of these files also contain unrelated user edits):
- `electron/main.ts`, `electron/k8s.ts`, `electron/preload.ts`, `electron/k8s-pod-worker.ts`, `electron/resource-transform-worker.ts`
- `electron/electron-env.d.ts`, `src/vite-env.d.ts`
- `electron/helm-release-transform.pbt.test.ts`, `electron/k8s-pod-worker-delta-buffer.test.ts`
- `src/App.tsx`, `src/components/Dashboard.tsx`, `src/components/dashboard/DashboardContent.tsx`
- `src/types/pod-worker.ts`, `src/utils/resource-utils.ts`, `src/utils/resource-utils.test.ts`
- `.kiro/steering/structure.md`, `.kiro/steering/watcher-debugging.md` (gitignored)

Deleted:
- `src/hooks/useDashboardWatchers.ts`, `src/hooks/usePodWorker.ts`, `src/hooks/usePodWorker.pbt.test.ts`
- `electron/k8s-pod-worker-chunk.pbt.test.ts`

No dependency was added. `zustand` (^5.0.12) was already in `package.json`.

Not part of this feature, but in the same tree: Crossplane, the deployment full view, terminal kubeconfig, cluster rename, the kubeconfig watcher, `PanelTabStrip`, a number of `src/utils/*` modules, and the `fix:pty` Electron target bump in `package.json`.

## 3. Verified vs not verified

Verified (from `verification.md`, iteration 2; not re-run for this report):

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.node.json` | exit 0 |
| `npx vitest run` (full) | 61 files, 621 tests passed (baseline 41 / 399) |
| `npx vitest run electron/resource-cache src/hooks/resource-sync-controller.test.ts` | 8 files, 98 tests passed |
| `npx eslint --max-warnings 0` on all new feature files | clean |
| `npm run lint` | 1532 problems (1497 errors), below the pre-existing 1566 baseline. No modified file gained errors |
| `npx vite build` | succeeded (renderer, main, workers, preload). electron-builder not run |

Behaviours proven by tests:
- 50 tab-switch-style calls issue no LIST and start no informer.
- A cluster switch stops the old streams and never leaks A's data into B.
- A failed switch keeps the listener alive.
- The listener count stays at 1 across 20 switches.
- A stop leaves zero timers and controllers.
- The ERROR-event backoff grows, and 401s reach the give-up.
- A WATCH-time 403 deletes the ghost rows.
- Focus rebinds only when this renderer is unbound.

Not verified at runtime:
- No live cluster was contacted and the Electron app was not launched.
- The design §9 manual leak procedure has not been run. It covers `__lumenDiag` after 50 tab switches, A↔B switching, Settings round-trips, Cmd+R with the 60 s idle stop, pod-worker kill and respawn, sleep/resume, focus churn, and `lsof` socket and heap snapshots.
- The Electron `did-navigate` ordering after a reload is reasoned from Electron's documented behaviour, not observed. The same goes for the blocked-link case.
- The RBAC 403 per-namespace fallback and the Granted/expired-token 401 path against a real API server are covered only by unit and integration tests.
- `rowClick` memo stability in `DashboardContent` is checked only by tsc and the build.
- `notes.md` (plan item 16) was not produced, because the manual run did not happen.

To run the manual checks, quit `/Applications/Lumen.app` first (single-instance lock), then `npm run dev`.

## 4. Decision points (all take the recommended option; override any of them)

| ID | Decision | Chosen | Rationale |
|---|---|---|---|
| DP-1 | Watch scope for core kinds | Cluster-wide by default, with a client-side namespace filter and per-namespace streams only as a 403 fallback | Namespace switches are instant with no stream restart, and the multi-namespace bug D1 goes away. The cost is memory and bandwidth for the whole cluster |
| DP-2 | Non-core kinds | Stay on demand, plus the D3 key nonce and map cleanup | Keeps scope to the six kinds you listed. Caching them can come later |
| DP-3 | Where pods are watched | Existing `k8s-pod-worker` utilityProcess, driven by WatchManager over session-tagged protocol v2 | Keeps the highest-volume parsing off the main thread |
| DP-4 | Legacy watch IPC | Removed | It had no other consumer. Removing it halves IPC volume and stops raw objects reaching the renderer |
| DP-5 | Idle grace after a reload or when the renderer goes away | 60 s, then `stopSession('no-subscriber')` | A reload followed by re-selecting the cluster stays warm, and watches are not kept alive indefinitely |
| DP-6 | Helm release source | Derived from the core Secrets stream (HelmIndex) | One download and one connection per blob. RBAC needs are unchanged |
| DP-7 | `selectedNamespaces` ownership | Stays Dashboard-local | Hoisting it into a store changes UX behaviour, so that is your call |
| DP-8 | `settings_kubeconfigPath` for watches | Not wired as an app-wide setting. Watches use the same kubeconfig resolution as `K8sService` | Stays consistent with existing context resolution. See the deviation note below |

Planner decisions:
- **PD-1:** no FEAT-step restructuring. Per-step commits would have swept your uncommitted edits into commits.
- **PD-2:** diagnostics are dev-only. The IPC returns `null` when packaged, and `__lumenDiag` exists only under `import.meta.env.DEV`.
- **PD-3:** diagnostics add `listCalls` and `podWorker.informerStarts`, so LIST counts can be measured.
- **PD-4:** `DeltaBatchBuffer.clear()` empties the buffer without posting and keeps the module-lifetime interval, because cancelling it would stop all later flushes.

DP-8 deviation: a concurrent change in this checkout added custom kubeconfig support to `K8sService` (`loadKubeConfig()`). `createKubeConfig` and the pod worker's `start-informer` therefore follow that path when a custom kubeconfig is set, and fall back to `loadFromDefault()` otherwise.

## 5. Follow-ups and known limitations

- **Before shipping:** run the §9 runtime leak procedure and the `did-navigate` reload check under `npm run dev` against a real cluster, and record the results in `notes.md`.
- **Line endings and size:** `electron/preload.ts` was converted from CRLF to LF (178 real changed lines show as 1014). Restore CRLF before committing. The file is now 524 lines, over the ~500 guideline, so consider moving the `resources` namespace into a small helper module. `watch-manager.ts` is exactly 500 lines.
- **Mixed tree:** commit only this feature's hunks. Crossplane, the deployment full view, terminal kubeconfig, cluster rename, the kubeconfig watcher and the `fix:pty` bump are separate work.
- **DP-7 limitation:** a Dashboard remount (Settings and back) resets `selectedNamespaces` to `['all']`. In cluster mode this has no effect. In namespaced (403) mode, the per-namespace streams stop and the kind shows `forbidden` until you re-select namespaces.
- **Cheap guard:** `resubscribe` does not check that `snap.context` matches the current cluster. No path to a mismatch was found.
- **Memory:** cluster-wide watching (DP-1) holds every core object in the cluster, trimmed, in main and in the renderer. Very large clusters may want a namespace-scoped mode.
- **Out of scope:**
  - multi-window support (one subscriber per manager);
  - Helm's ConfigMap and SQL storage drivers;
  - caching non-core kinds (DP-2);
  - the AI stream `removeAllListeners` calls in preload, which are backlogged;
  - splitting `Dashboard.tsx` further.
