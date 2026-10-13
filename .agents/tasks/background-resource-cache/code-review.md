# Main-process background cache for the six core Kubernetes kinds (pass 2)

This pass checks the iteration-2 fixes for the eight findings from pass 1. The architecture is unchanged. A main-process `WatchManager` keeps one LIST+WATCH session per selected cluster for deployments, pods, secrets, configmaps, services and Helm releases, and `useResourceSync` in `App.tsx` mirrors it into the zustand `resourceStore` through 650 ms coalesced `resources:batch` messages. Tab switches and Dashboard remounts only read the store. All five code findings are fixed, each with a targeted test: the navigation unbind (plus a renderer rebind backstop), the ERROR-event counter reset, ghost rows after a WATCH-time 403, pod recovery on focus, and the defeated `React.memo`. The CRLF churn in the two `.d.ts` files is reverted. No new blocking issue turned up.

Watch for: `electron/preload.ts` still has the CRLF→LF conversion that was reverted in the `.d.ts` files, and it is now 524 lines (HEAD: 490), slightly over the ~500 limit (confirmed). The §9 runtime leak procedure and the Electron `did-navigate` timing are still unverified against a live app.

**Verdict**: APPROVED

## High-level view

The window hook now unbinds on `did-navigate`, which fires only for committed main-frame cross-document navigations. A link blocked by `will-navigate` therefore leaves the subscriber bound. As a backstop, `resources:ensureFresh` returns `{ bound }` from `WatchManager.isBoundTo(sender.id)`. The controller's `onFocus` resubscribes when it is unbound and a cluster is selected, through the existing single-flight `resubscribe`, which falls back to `startSession` when the session is gone.

`ListWatchStream.onEvent` now handles `ERROR` before it resets `attempts`, `authFailures` and `eventsSinceConnect`. Repeated non-410 errors back off exponentially and drop the rv on the third strike, and 401 ERROR events reach the give-up. `KindScopes` uses `dropStream` on the cluster→namespaced switch, so deletes and the derived Helm-release deletes go out. `ensureFresh` recovers pods only after the 401 give-up (`isAuthFailed`) and skips `refresh` for other terminal errors.

`DashboardContent` builds the row-click handlers once over a latest-ref to `onResourceClick`, so the memoized `Connected*View` wrappers no longer re-render on node, event or metrics updates.

The hard constraints still hold for the feature code. The six `resources:*` channels use `safeHandle` + zod, `ensureFresh` keeps `z.undefined()`, there is no `any` in the new modules, the new files are at or under 500 lines (`watch-manager.ts` is exactly 500), and every `on*` the feature touches unsubscribes with `ipcRenderer.off`. The remaining `removeAllListeners` calls are the pre-existing AI stream cancels.

<details>
<summary>Issues (3)</summary>

1. **preload.ts line-ending churn and size** (NIT, confirmed): `electron/preload.ts` changed from CRLF to LF, so `git diff --stat` shows 1014 changed lines against 178 with `--ignore-cr-at-eol`. The file also grew from 490 to 524 lines. Restore CRLF as was done for the `.d.ts` files, and consider moving the `resources` namespace into a small helper module if the 500-line cap is strict.
2. **Runtime leak procedure still not run** (LOW, confirmed): the design §9 checks have not been exercised in `npm run dev`. These are `__lumenDiag` after 50 tab switches, A↔B switching, Cmd+R with the 60 s idle stop, `did-navigate` vs a blocked link, pod-worker kill, sleep/resume, and socket/heap counts. Run them before shipping.
3. **Unrelated work in the same tree** (NIT, confirmed): Crossplane, the deployment full view, terminal kubeconfig, cluster rename and the kubeconfig watcher are still mixed into the uncommitted diff. Stage only this feature's hunks when committing.

</details>

<details>
<summary>Details</summary>

## Navigation unbind and the focus rebind backstop

```ts
win.webContents.on('did-navigate', () => watchManager.onRendererNavigated())
```

The fix relies on a reload committing before the new document runs, so the reloaded renderer's `startSession` arrives after the unbind. This ordering is reasoned from Electron semantics and has not been observed at runtime. It belongs in the §9 checks.

`resubscribe` applies the returned snapshot without checking `snap.context === currentCluster`. That path is reachable only when main's unbound session belongs to a different context than the renderer's selection. `App.tsx` sets `selectedCluster` only after a successful `getNamespaces` pre-flight and does not persist it across reload, so no path to this state was found and it is not counted as a finding. A context check in `resubscribe` would be a cheap guard.

## Verification coverage

The new tests cover each fix: ERROR backoff `[1000, 2000, 4000]` with the third-strike re-LIST and the 401 ERROR give-up, deletes after the WATCH-time 403 (including the Helm-release delete), pods recovering only after the 401 give-up, `isBoundTo` after navigation, and the focus rebind gating. The full suite passes (61 files, 621 tests), along with both tsc projects and the vite build, and lint stays below baseline. None of these were re-run for this review. Not tested: `rowClick` memo stability (checked only by tsc and the build) and the Electron `did-navigate` ordering.

</details>

<details>
<summary>File map</summary>

- `electron/main.ts`: `did-navigate` replaces `did-start-navigation` for the subscriber unbind.
- `electron/ipc/resource-cache-ipc.ts`: `ensureFresh` returns `{ bound }`.
- `electron/resource-cache/watch-manager.ts`: `isBoundTo`, auth-only pod recovery in `ensureFresh`.
- `electron/resource-cache/list-watch.ts`: counter reset moved below the ERROR branch.
- `electron/resource-cache/scope-manager.ts`: `dropStream` on the cluster→namespaced switch.
- `electron/resource-cache/pod-adapter.ts`: `isAuthFailed()`.
- `src/hooks/resource-sync-controller.ts`, `src/hooks/useResourceSync.ts`: `onFocus` rebind backstop.
- `src/types/resource-cache.ts`, `electron/preload.ts`: `EnsureFreshResult`.
- `src/components/dashboard/DashboardContent.tsx`: stable `rowClick` handler map.
- `src/vite-env.d.ts`, `electron/electron-env.d.ts`: CRLF restored.
- Tests: `list-watch.test.ts`, `watch-manager.test.ts`, `resource-sync-controller.test.ts`.

Full diff: `git diff` plus untracked files in `/Users/MohammedRashid.Matin/Development/lumen`.

</details>
