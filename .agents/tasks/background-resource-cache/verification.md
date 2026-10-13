# Verification: background resource cache

## Iteration 2 (review findings from code-review.md)

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | Navigation unbind on blocked navigations | `main.ts` now unbinds on `did-navigate` (committed main-frame, cross-document only; Cmd+R and HMR full reloads still fire it) instead of `did-start-navigation`, so a navigation blocked by `will-navigate` never unbinds. Renderer backstop: `resources:ensureFresh` now returns `{ bound }` (`WatchManager.isBoundTo(senderId)`), and the controller's new `onFocus()` resubscribes when main reports this renderer unbound (single-flight `resubscribe`, falls back to `startSession` if the session is gone) | `watch-manager.test.ts` "isBoundTo reflects navigation unbinds…"; `resource-sync-controller.test.ts` "focus rebinds only when main reports this renderer unbound", "focus with no cluster selected never resubscribes" |
| 2 | ERROR events reset backoff/401 counters | `ListWatchStream.onEvent` resets `attempts`/`authFailures`/`eventsSinceConnect` only after the ERROR branch (progress events only) | `list-watch.test.ts` "consecutive watch ERROR events grow the backoff and drop the rv" (delays `[1000, 2000, 4000]`, 3rd strike re-LISTs), "401 ERROR events reach the 3-strike give-up" |
| 3 | Ghost rows after a WATCH-time cluster 403 | `KindScopes.onStreamPhase` uses `dropStream` (deletes + `onIdsDropped`) on the cluster→namespaced switch | `watch-manager.test.ts` "a WATCH-time cluster 403 deletes the rows the cluster stream owned" (secret deletes and the derived Helm release delete are emitted; namespaced stream starts) |
| 4 | Pod recovery on every focus for non-auth errors | `PodAdapter.isAuthFailed()` (the existing `stoppedByAuth`); `ensureFresh` recovers pods only after the 401 give-up and skips `refresh` for other terminal errors | `watch-manager.test.ts` "focus recovers pods only after the 401 give-up…" |
| 5 | Connected views' memo defeated | `DashboardContent` uses a stable `rowClick` map built once with a latest-ref to `onResourceClick` (Dashboard re-creates `handleResourceClick` every render, so a `useMemo` on it alone would not hold) | tsc + build; behaviour unchanged |
| 6 | Runtime leak procedure not run | Not run, see "Not verified at runtime" below | — |
| 7 | CRLF→LF churn | `src/vite-env.d.ts` and `electron/electron-env.d.ts` restored to CRLF; `git diff --stat` now 58 and 50 lines (feature hunks only) instead of ~600 | — |
| 8 | Unrelated work in the tree | No commits were made (per instructions). When committing, stage only this feature's hunks; the Crossplane, deployment full view, terminal kubeconfig and cluster rename changes are separate | — |

Commands run this iteration:

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.node.json` | exit 0 (touched `tsconfig.node.tsbuildinfo` restored with `git checkout`) |
| `npx vitest run electron/resource-cache src/hooks/resource-sync-controller.test.ts` | 8 files, 98 tests passed |
| `npx vitest run` (full suite) | 61 files, 621 tests passed (iteration 1: 614; +7 new tests) |
| `npx eslint --max-warnings 0 electron/resource-cache electron/ipc/resource-cache-ipc.ts src/hooks/resource-sync-controller.ts src/hooks/resource-sync-controller.test.ts src/hooks/useResourceSync.ts src/types/resource-cache.ts` | clean |
| per-file `npx eslint -f unix` on main.ts / preload.ts / DashboardContent.tsx / vite-env.d.ts / electron-env.d.ts | 18 / 38 / 69 / 112 / 120, unchanged from iteration 1 |
| `npm run lint` | 1532 problems (1497 errors, 35 warnings), same as iteration 1, below the 1566 baseline |
| `npx vite build` | succeeded (renderer, main, workers, `preload.mjs`); electron-builder not run |

Still not verified at runtime (finding 6): the design §9 manual procedure (`__lumenDiag` after 50 tab switches, A↔B switching, Cmd+R + 60 s idle stop, pod-worker kill, sleep/resume, `lsof` socket and heap checks) and the Electron `did-navigate` timing were not exercised. They need an interactive `npm run dev` session against a live cluster, which this step cannot drive. Quit `/Applications/Lumen.app` first, then run them before shipping.

---

## Iteration 1

All plan items 1–16 are implemented. Nothing is committed (working tree only). Run date: this iteration, macOS, Node from the repo toolchain.

## Commands run and results

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` (covers `src/` and `electron/`) | exit 0, no errors |
| `npx tsc --noEmit -p tsconfig.node.json` (vite.config.ts) | exit 0 (the tsbuildinfo it touched was restored with `git checkout`) |
| `npx vitest run` (full suite) | 61 files, 614 tests, all passed (baseline was 41 files / 399 tests) |
| `npx vitest run electron/resource-cache electron/pod-worker-core.test.ts electron/k8s-pod-worker-delta-buffer.test.ts electron/transform-worker-client.test.ts electron/helm-release-transform.pbt.test.ts electron/k8s.test.ts electron/k8s-generic-watch.test.ts src/stores/resourceStore.test.ts src/hooks/resource-sync-controller.test.ts src/utils/resource-utils.test.ts` | 16 files, 156 tests, all passed |
| `npx eslint <every new file> --max-warnings 0` (resource-cache/*, ipc/resource-cache-ipc.ts, transform-worker-client*, pod-worker-core*, k8s.test.ts, k8s-generic-watch.test.ts, src/types/resource-cache.ts, resourceStore*, resource-sync-controller*, useResourceSync.ts, useResourceList.ts, CoreResourceViews.tsx, integration.test.ts) | clean (0 errors, 0 warnings) |
| `npm run lint` | 1532 problems (1497 errors, 35 warnings). Baseline in plan.md: 1566 errors. No increase |
| `npx vite build` | succeeded: renderer, main (incl. `k8s-pod-worker.js`, `resource-transform-worker.js`) and `preload.mjs` built. electron-builder was not run |

Per-file eslint counts for modified files (`npx eslint <file> -f unix | count`). "before" = working copy before my edits; "HEAD" = `git show HEAD:<file>` (used where the file was already edited by me or a concurrent change before I measured):

| File | before / HEAD | after |
|---|---|---|
| src/components/Dashboard.tsx | 72 (before) | 61 |
| src/components/dashboard/DashboardContent.tsx | 75 (before) | 69 |
| electron/main.ts | 18 (HEAD) | 18 |
| electron/preload.ts | 60 (HEAD) | 38 |
| electron/k8s.ts | 448 (HEAD) | 436 |
| src/App.tsx | 18 (HEAD) | 18 |
| electron/k8s-pod-worker.ts | 2 (HEAD) | 0 |
| src/vite-env.d.ts / electron/electron-env.d.ts | 116 / 127 (HEAD) | 112 / 120 |
| resource-transform-worker.ts, resource-utils.ts, pod-worker.ts | 0 / 7 / 0 | 0 / 7 / 0 |

## Required behaviours and where they are proven

| Requirement | Evidence |
|---|---|
| Tab switches issue no new LIST calls for the six core kinds | `watch-manager.test.ts` "tab-switch style calls … issue no LIST": 50× (`subscribe` + cluster-mode `setNamespaces` + focus `ensureFresh`) leave `listCalls` and the LIST count unchanged. `integration.test.ts` "repeated subscribe … starts no informer and no LIST" (real pod-worker core). Renderer side: core views read the zustand store only; `Dashboard.tsx`'s generic watch map and `loadResources` no longer contain services/configmaps/secrets, and `getCurrentViewData` returns early for core views. Grep of `Dashboard.tsx`/`DashboardContent.tsx` for `useResourceStore(\|useResourceMap(\|useResourceList(` returns no hits |
| A cluster switch stops the old streams and clears the old data | `watch-manager.test.ts` "a cluster switch stops old streams first …" (old controllers aborted, B snapshot empty, late A events never sent, context engine cleared, 4 streams), "a snapshot during A→B never contains A pods", "A→B→A … never returns a stopped session id". `integration.test.ts` "a cluster switch stops A informers …" (A informer stopped, B reset batch contains only B pods, worker `informers === 1`). Renderer: `resource-sync-controller.test.ts` "ignores a late snapshot under an old token"; store `reset` nulls the session |
| A failed switch keeps the listener alive | `resource-sync-controller.test.ts` "a failed switch (epoch bump, same cluster) re-runs startSession without reset" and "'connecting' … keeps the listener". `App.tsx` bumps `syncEpoch` in both the success and catch paths |
| Listener counts stay flat across repeated switches | `resource-sync-controller.test.ts` "listener count stays flat across repeated switches" (20 switches, always exactly 1, 0 after cleanup). Preload `onBatch` and `onWindowFocused` remove only their own listener (`ipcRenderer.off`) |
| No leaks after stop | `watch-manager.test.ts` "after stop: zero timers, zero controllers, zero streams" (`vi.getTimerCount() === 0`), `integration.test.ts` "stopSession leaves the worker with no informers", list-watch stop/late-controller tests, transform worker client timeout/crash tests, `k8s-generic-watch.test.ts` (`disposeGenericWatch` returns map sizes to baseline) |

Dev-only diagnostics: `resources:getDiagnostics` returns `null` when `app.isPackaged`; `window.__lumenDiag()` is defined only under `import.meta.env.DEV`. It reports active streams, `listCalls` (LIST runs/pages per kind), pod worker `informers`/`informerStarts`, `batchListeners` (IPC listener count), `invokeCounts`, timers and `legacyMaps`.

## Not verified at runtime

- No live cluster was contacted and the Electron app was not launched (`npm run dev` needs an interactive GUI session; a kubeconfig exists but I did not run read-only LIST/WATCH against it without your go-ahead). So the §1 reproduction, the §9 manual procedure (50 tab switches with `__lumenDiag`, A↔B switching, Settings round-trips, Cmd+R + 60 s idle stop, pod-worker kill/respawn, sleep/resume, focus churn, heap snapshots), RBAC 403 fallback and the Granted/expired-token 401 path are covered only by the unit/integration tests above.
- `lsof` socket counts and heap retention were not measured.
- Before running `npm run dev`, quit any installed `/Applications/Lumen.app` (single-instance lock).

## Deviations from the design/plan (deliberate, behaviour-preserving)

1. **Kubeconfig source.** A concurrent change in this checkout added custom kubeconfig support to `K8sService` (`loadKubeConfig()`, `getCustomKubeconfigPath()`). To stay consistent with it (the intent of DP-8), `createKubeConfig` uses `loadKubeConfig()`, and `start-informer` v2 carries an optional `kubeconfigPath` that the worker loads when present. Without a custom path both fall back to `loadFromDefault()` as designed.
2. `mapStatusToMessage(err, kind)` takes the kind (needed for "No permission to list <Kind>").
3. The v2 protocol types are named `WorkerInboundV2` / `WorkerOutboundV2`; the old v1 types were deleted.
4. The `diagnosticsEnabled` gate lives in `registerResourceCacheIpc`, and `WatchManager.getDiagnostics()` returns everything except `invokeCounts`/`handlersRegistered`, which the IPC module merges in.
5. `detachSubscriber(senderId: number)` takes the webContents id.
6. `ListWatchStream.halt(error)` was added so a failed auth rebuild stops retrying without the permanent `stop()`, which lets the same-context recovery path `restart()` it.
7. Pod worker fast-close guard: after 5 fast closes the whole generation is rebuilt through the internal `refresh` path (new `podCache`, `informer-synced` → reset) instead of replacing one rec, so stale pods cannot survive the rebuild.
8. HelmIndex is one instance per session. A decode result for a uid that is no longer the release's max revision is discarded and its state returns to `'none'` (so a later fallback can fetch it).
9. `k8s:watchGenericResource` / `k8s:stopWatchGenericResource` were moved to `safeOn` + zod while their handlers were being changed for D3.
10. The deployment full view's live deployment lookup moved into `ConnectedDeploymentFullView`, so `DashboardContent` subscribes to no core kind.
11. `src/utils/helm-release-utils.ts` is kept; only its own property test uses it now.
