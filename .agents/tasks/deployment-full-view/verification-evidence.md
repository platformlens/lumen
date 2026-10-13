# Verification evidence: Deployment Full View (iteration 1, cross-FEAT integration)

No `code-review.md` existed, so this iteration ran the integration gates and the seam checks. No code changes were needed. Nothing was committed.

## Gates

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no errors |
| `npx vitest run` (1st run) | 59/60 files, 591/592 tests. One failure in `electron/resource-cache/watch-manager.test.ts:285`, an untracked file from a parallel workstream that was being edited at the time (mtime 14:53). It has no references to this task's files. |
| `npx vitest run electron/resource-cache/watch-manager.test.ts` ×3 | 20/20 pass each time |
| `npx vitest run` (final) | exit 0, 59 files / 588 tests pass. The file count changed because the parallel workstream is still editing its own files. |
| `npx vitest run electron/deployment-full-details.test.ts src/utils src/hooks` | 28 files / 347 tests pass |
| `npx eslint --max-warnings 0` on every new file (types, aggregator + fetchers + test, hook, live-refresh-decision + test, 10 utils + tests, view-labels.test, the whole `deployment-details/` folder) | exit 0 |
| `npx vite build` | exit 0 (renderer, main, preload bundles built) |

## Modified files: eslint problem counts (no new problems)

| File | Problems | Baseline (FEAT findings) |
|---|---|---|
| electron/k8s.ts + main.ts + preload.ts + electron-env.d.ts + src/vite-env.d.ts | 448 + 18 + 58 + 125 + 115 = 764 | 767 (FEAT-003, same 5 files) |
| src/utils/view-labels.ts | 0 | 0 |
| ViewTabBar.tsx / DashboardHeader.tsx / ToggleGroup.tsx / RevisionDiffModal.tsx | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 4 |
| DashboardContent.tsx | 75 | 75 |
| DeploymentsView.tsx | 9 | 9 |
| Dashboard.tsx | 72 | 72 |
| App.tsx | 18 | 18 |
| DeploymentDetails.tsx | 6 | 8 |

## File size (< 500 lines)

`wc -l` was run on every new file. The largest are `electron/deployment-full-details.test.ts` (441), `DeploymentFullView.tsx` (346), `electron/deployment-full-details.ts` (321) and `security-posture-utils.ts` (305). All are under 500.

## Design §10 file list / plan items 1-24

- All §10 "New" files exist. Extra helpers were added within the design's split rules: `deployment-full-details-fetchers.ts`, `useDeploymentDerivedData.ts`, `status-classes.ts`, `revision-format.ts`, `config-refs.ts` and `Disclosure.tsx`.
- All §10 "Modified" files carry the edits: the preload method, both d.ts declarations, the `safeHandle` zod handler, the K8sService method, view-labels helpers, ViewTabBar icon, DashboardHeader title/hide, the Dashboard drawer "Full View" button + `getResourceCount` + `onOpenYaml`, the DashboardContent hooks after the `podStatusStats` memo + route branch keyed `${clusterName}|${activeView}` + `onOpenFullView`, the DeploymentsView conditional actions column, and the App sidebar normalization.

## Cross-FEAT seams checked

- **IPC channel name.** `k8s:getDeploymentFullDetails` is the same in main.ts (`safeHandle`), preload.ts, both d.ts files and `useDeploymentFullDetails`.
- **Live refresh input.** `DeploymentFullView` reads `liveDeployment.metadata.resourceVersion`. The `deployments` list carries `metadata` from both `K8sService.getDeployments` and the watcher's `transformDeployment`, and the deployment watcher runs regardless of the active view.
- **Dashboard data loading.** `Dashboard.loadResources` uses exact `activeView ===` matches, so the `deployment-detail/` view triggers no extra fetches.
- **Section nav ids.** The 12 `NAV_SECTIONS` ids equal the 12 rendered section ids, in §6.2 order.
- **Secrets.** No Secret API is used in the aggregator or fetchers (only SA `imagePullSecrets` names). Secret refs in `ConfigStorageSection`/`ContainerCard` render as text, not buttons.

## Not run

- **Plan item 25 / design §9 manual UI checklist** (`npm run dev` against a real cluster). It needs interactive GUI use against a live cluster, which this step can't do.
