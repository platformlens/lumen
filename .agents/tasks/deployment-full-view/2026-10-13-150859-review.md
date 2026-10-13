# Full-page Deployment view with revision timeline, distribution and security posture

The change keeps the existing drawer on row click and adds two "Full View" entry points: a labelled button in the deployment drawer header and a trailing icon column in the Deployments list. Both open a `deployment-detail/<ns>/<name>` tab through the existing `ViewTabBar` routing. The page loads lazily through one RBAC-tolerant IPC call, `k8s:getDeploymentFullDetails`. It renders twelve sections: overview, rollout/HPA/PDB, an interactive revision timeline with a change list and embedded Monaco diff, pod distribution by zone and node with risk flags, scheduling constraints, a virtualized pods table, container cards (ports, env, probes, resources), an approximate PSS security posture with a per-container runs-as-root matrix, networking, config and storage, events, and a lazy topology. The implementation follows design rev 4 closely, all 10 utility modules are unit tested against the plan's list, and no HIGH or MEDIUM issues were found.

Watch for: `<TimeAgo/> ago` renders "13/10/2025 ago" for revisions older than 48 h (confirmed). App-level callbacks are re-created on every App render, which defeats the section memoization (confirmed). `npx tsc --noEmit` currently fails on the working tree, but only in lines that other in-progress workstreams are editing (see Gates).

**Verdict**: APPROVED

## High-level view

Navigation reuses the Helm-detail pattern. `DashboardContent` declares the parse/lookup/callback hooks at top level, before any route branch, and keys `DeploymentFullView` by `${clusterName}|${activeView}`. A cluster switch or a tab switch therefore always remounts the view. The header hides search, the namespace filter and the resource count on this view, and the sidebar keeps "Deployments" highlighted.

The main-process aggregator settles every section on its own. A 403 marks only that section `forbidden`, a 404 or timeout marks it `error`, and a 401 is rethrown into `withAuthRetry`. Phase 1 reads the deployment and strips `managedFields` and `last-applied-configuration` (it records the byte count). Phase 2 runs the RS → pods → events/metrics chains in parallel with Services → Ingresses, NetPols, HPAs, PDBs, SA, namespace and PVCs. Phase 3 reads only the nodes that host pods, at concurrency 8, with a 20 s deadline and a stop on the first 403. No Secret API is called, and a test asserts it. The IPC handler validates DNS-1123 inputs with zod, and `mutation-policy` classifies the channel as READ.

The renderer hook keeps a 5-entry stale-while-revalidate cache, keyed and written under the captured `cluster|ns|name`. `shouldApplyResponse` drops late responses. Live refresh fires only when the session deployment watcher's `resourceVersion` changes, with a 1.5 s debounce, so it adds no polling and no new watchers. Both decision functions are pure and tested.

Masking is applied wherever values are displayed. Env literals are masked in the container cards, the change list (which compares raw values and displays masked ones), and both diff YAMLs (including the drawer's modal, which now uses the shared `revisionToYaml`). Secret references appear as non-clickable names only. The scheduling raw JSON serializes only the eight scheduling fields.

The UI has one container and memoized presentational sections, uses the theme's static colour maps, and keeps every file under 500 lines (largest: 441). Sorting goes through `useResourceSorting`, and the new files contain no `any`. The remaining gaps are cosmetic or performance NITs.

<details>
<summary>Issues (4)</summary>

1. **"<date> ago" for old revisions** (NIT, confirmed). `TimeAgo` switches to an absolute date after 48 h, so the hard-coded " ago" suffix reads "13/10/2025 ago". Drop the suffix in `RevisionTimeline.tsx:52` and `RevisionDetailPanel.tsx:113`, or render `relativeTimeText()` instead.
2. **Unstable App callbacks defeat section memo** (NIT, confirmed). `onOpenLogs`, `onOpenYaml` and `showToast` are plain functions in `App.tsx` (778, 920, 1172), so every App render rebuilds `usePodLogsHandler`, `handleEditYaml` and `handleScale`/`handleRestart`. That re-renders `PodDistribution`, `DeploymentPodsTable` (columns rebuilt) and `DeploymentHeader`. Hold these in latest-refs the way `onResourceClickRef` already does (`DeploymentFullView.tsx:93,151-175`).
3. **Untested pure helpers in the component folder** (NIT, confirmed). `collectConfigRefs` (`config-refs.ts:43`), which decides which Secret/ConfigMap names are shown, `podStatusColor` (`status-classes.ts:54`) and `buildMatrix` (`SecurityPosture.tsx:47`) have no tests. Move `collectConfigRefs` and `podStatusColor` to `src/utils/` with `*.test.ts`. Cover env/envFrom/volume/projected/imagePullSecrets collection and the status colour mapping.
4. **Pods table re-sorts every render** (NIT, confirmed). `getSortedData(rows)` (`DeploymentPodsTable.tsx:43`) is not memoized, and `handleSort` from `useResourceSorting` is re-created each render, so `handleSortClick` (line 91) is never stable. Wrap the sort in `useMemo(() => sortResourceData(rows, sortConfig), [rows, sortConfig])`.

</details>

<details>
<summary>Details</summary>

### Gates

`npx vitest run` passed (61 files, 614 tests). `npx eslint --max-warnings 0` on all new and touched task files exited 0.

`npx tsc --noEmit` exited 2 on three runs, and the error set changed between runs while other workstreams edited files:

- Run 1: missing `./CrossplaneCompositesView` / `./CrossplaneManagedView` modules. The files appeared minutes later.
- Run 2: `src/stores/resourceStore.ts:58`, `App.tsx` `onNamespacesChange`, and `Dashboard.tsx` `onOpenCrossplaneResource`.
- Run 3: the same, plus `Dashboard.tsx:1266`, where `DashboardContent` is missing `pods/deployments/services/configMaps/secrets` because the resource-cache migration is mid-edit.

None of these errors is in a line this task added, and none of the task's new files produces an error. `verification-evidence.md` records tsc exit 0 at the end of implementation.

One cross-workstream seam is worth tracking (informational, not a finding against this task). The Full View's live refresh reads `liveDeployment` from the `deployments` prop of `DashboardContent` (`DashboardContent.tsx:216-220`). The resource-cache workstream is currently removing that prop from the `Dashboard` call site. Whatever replaces it must still supply list items that carry `metadata.resourceVersion`. Otherwise the page silently degrades to "Not live" (no fetch loop and no error).

### Design deviations and minor behaviours

`toDeploymentEvent` (`electron/deployment-full-details.ts`) takes the source from `reportingComponent` instead of the design's `reportingController`. That is the correct field name on `CoreV1Event`, and the test fixture uses it.

After a successful Scale or Restart, the explicit `refresh()` and the watcher's rv change can each trigger a fetch. This happens when the watcher event lands before the refresh response. It is bounded at one extra round trip per action (likely, from tracing `decideLiveRefresh` against `fetchRef`), so it isn't listed as an issue.

### Tests vs plan

Every bullet in the plan's "Unit test list" has a matching case.

Not tested:
- The `.tsx` components and the hook body (the repo has no React testing library).
- The component-folder helpers listed in Issue 3.
- The manual checklist (plan item 25, design §9), which hasn't been run against a live cluster, as `verification-evidence.md` notes.

</details>

<details>
<summary>File map</summary>

New:
- `src/types/deployment-details.ts`: cross-process `Jsonified`/`SectionResult`/summary types.
- `electron/deployment-full-details.ts`, `electron/deployment-full-details-fetchers.ts`: aggregator, settle/classify, node and PVC fetchers. Plus `deployment-full-details.test.ts`.
- `src/hooks/useDeploymentFullDetails.ts`, `src/hooks/live-refresh-decision.ts` (+ test): cached, race-safe loader and the pure live-refresh and apply decisions.
- `src/utils/{label-selector,deployment-history,pod-template-diff,security-posture,pod-distribution,container-insights,sensitive-value,networking,deployment-rollout,deployment-log}-utils.ts` (+ tests), plus `view-labels.test.ts`.
- `src/components/dashboard/views/deployment-details/*`: the container, 17 sections and parts, and the helpers `useDeploymentDerivedData`, `config-refs`, `revision-format`, `status-classes` and `Disclosure`.

Modified:
- `electron/k8s.ts`: the `getDeploymentFullDetails` method.
- `electron/main.ts`: the zod `safeHandle` handler.
- `electron/preload.ts`, `electron/electron-env.d.ts`, `src/vite-env.d.ts`: the bridge and its types.
- `src/utils/view-labels.ts`: id build/parse helpers and the label.
- `ViewTabBar.tsx`, `DashboardHeader.tsx`: icon, title, and the hidden controls.
- `DashboardContent.tsx`: top-level hooks and the keyed route.
- `DeploymentsView.tsx`: the optional actions column.
- `Dashboard.tsx`: the drawer Full View button, `getResourceCount`, and passing `onOpenYaml` through.
- `App.tsx`: sidebar active-state normalization.
- `ToggleGroup.tsx`: `disabled`/`title` and the per-group `layoutId`.
- `RevisionDiffModal.tsx`, `DeploymentDetails.tsx`: the `left/right` side contract and the shared YAML.

Full diff: `git diff` plus the untracked files above (nothing committed).

</details>
