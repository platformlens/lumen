# Implementation Plan: Deployment Full View

Source of truth: `/Users/MohammedRashid.Matin/Development/lumen/.agents/tasks/deployment-full-view/design.md` (revision 4). Section numbers (§) below refer to it. Do not redesign; when this plan and the design disagree, the design wins.

## Ground rules (from exploration)

- Repo root: `/Users/MohammedRashid.Matin/Development/lumen`, branch `feature/security-improvements`. There is no separate worktree. **The working tree already holds uncommitted user changes** in files this task modifies (`electron/k8s.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/electron-env.d.ts`, `src/App.tsx`, `src/components/Dashboard.tsx`, `src/vite-env.d.ts`, and others). Never revert, stash, reset or reformat them. Make surgical edits only. **Do not commit**: any commit of those files would sweep the user's unrelated work into it. Never `git add` anything under `.agents/`.
- Baseline (checked during planning): `npx tsc --noEmit` passes. `npx vitest run` passes (26 files, 155 tests). `npm run lint` fails repo-wide with about 1608 pre-existing problems, so lint is gated per file: new files must pass `npx eslint <files> --max-warnings 0`; modified files must not gain new problems compared with their pre-edit output.
- Tests: vitest 4 (`vitest.config.ts` includes only `**/*.test.ts`, globals on). fast-check 4 and zod 3 are already installed. There is no React testing library, so `.tsx` files are covered by `tsc` and by the manual checks in item 25.
- Gates used below: `npx vitest run <paths>` (unit), `npx tsc --noEmit` (type check over `src` and `electron`), and `npx eslint <files> --max-warnings 0`.
- Steering rules: Kubernetes calls only in the main process; renderer reaches it through `window.k8s`; pure helpers in `src/utils/` named kebab-case; files under 500 lines; `useMemo`/`useCallback`/`React.memo`; clean up listeners and timers; avoid `any`; never fetch or display secret values; glass theme classes from `.kiro/steering/theme.md`; table sorting through `useResourceSorting`.
- Patterns to follow: Helm detail routing in `src/components/dashboard/DashboardContent.tsx` (~line 953 `onNavigate('helm-release-detail/…')`, ~line 989 route branch). Existing IPC `k8s:getDeploymentRevisions` (`electron/main.ts:676`, `electron/preload.ts:54`, `electron/k8s.ts:1409`). `safeHandle(...)` with zod (`electron/main.ts:~2402`). Shared cross-process types precedent: `src/types/pod-worker.ts`. Main imports from `../src/lib/with-timeout` and `../src/utils/ai-thinking`. Existing tests: `src/utils/resource-utils.test.ts` and `*.pbt.test.ts` for fast-check style; `electron/helm-release-transform.pbt.test.ts` for electron-side tests.
- Scope note: the step brief mentions "8 tested pure utils". The authoritative design (§5, §6.1, §10) defines 10 util modules plus the view-label helpers and `live-refresh-decision.ts`. All of them are planned, each with a test file.

## Plan

### Phase A: shared types and pure utilities (no UI, no IPC)

- [ ] 1. Create the cross-process types exactly as in §3.1: `Jsonified`, `DeploymentObj`, `ReplicaSetObj`, `PodTemplate`, `LabelSelector`, `SectionResult`, `DeploymentPodContainerStatus`, `DeploymentPodSummary`, `NodeSummary`, `DeploymentEvent`, `ServiceAccountSummary`, `NamespaceSummary`, `PvcSummary`, `DeploymentFullDetails`, `DeploymentFullDetailsResponse`. Use `import type` only from `@kubernetes/client-node`.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/types/deployment-details.ts`
      Verify: `npx tsc --noEmit` exits 0.

- [ ] 2. Create `sensitive-value-utils.ts` (§5.5) with `MASK`, `LAST_APPLIED`, `HIDDEN_ANNOTATIONS`, `isSensitiveEnv`, `maskTemplateEnv` (deep clone, input never mutated) and `displayAnnotations` (supports `strippedBytes`; byte length via `TextEncoder`; sorted by key; one entry per key). No Node or DOM-only APIs, because main imports it.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/sensitive-value-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/sensitive-value-utils.test.ts`
      Verify: `npx vitest run src/utils/sensitive-value-utils.test.ts` passes.

- [ ] 3. Create `label-selector-utils.ts` (§3.2) with `selectorToQueryString`, `matchesLabelSelector` (`emptyMatchesAll` option) and `matchesServiceSelector`. It must stay pure, because main imports it.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/label-selector-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/label-selector-utils.test.ts`
      Verify: `npx vitest run src/utils/label-selector-utils.test.ts` passes.

- [ ] 4. Extend `view-labels.ts` (§2.1) with `DEPLOYMENT_DETAIL_PREFIX`, `buildDeploymentDetailViewId` and `parseDeploymentDetailViewId` (null on missing prefix, wrong segment count, empty segment, or a `decodeURIComponent` throw). Add the `getViewLabel` branch: `Deploy: <name>`, falling back to `'Deployment'`. Read the file first and keep the existing branches intact.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/view-labels.ts` (modify), `/Users/MohammedRashid.Matin/Development/lumen/src/utils/view-labels.test.ts` (new)
      Verify: `npx vitest run src/utils/view-labels.test.ts` passes; `npx tsc --noEmit` exits 0.

- [ ] 5. Create `deployment-rollout-utils.ts` (§5.8) with `getRolloutSummary` (defaults, `progressPercent`, `isStalled`, `isComplete`, `observedGenerationStale`), `summarizeHpa` and `summarizePdb`.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/deployment-rollout-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/deployment-rollout-utils.test.ts`
      Verify: `npx vitest run src/utils/deployment-rollout-utils.test.ts` passes.

- [ ] 6. Create `pod-template-diff-utils.ts` (§5.2) with `diffPodTemplates` and `summarizeChanges`. Depends on item 2 (`isSensitiveEnv`, `MASK`). Compare raw values but display masked ones. Ignore `pod-template-hash`. Special labels for `restartedAt` and the initial revision.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/pod-template-diff-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/pod-template-diff-utils.test.ts`
      Verify: `npx vitest run src/utils/pod-template-diff-utils.test.ts` passes.

- [ ] 7. Create `deployment-history-utils.ts` (§5.1) with `RevisionEntry`, `buildRevisionTimeline`, `getCurrentRevision`, `getPreviousRevision`, `buildRevisionByHash`, `eventsForRevision` (token-boundary regex built once per call), `RevisionYamlInput` (`createdAt: string | Date`), `revisionToYaml` and `revisionEntryToYamlInput`.
      `revisionToYaml` must reproduce the key order and js-yaml options of the current local helper in `src/components/resources/details/RevisionDiffModal.tsx`. Read that file and copy the logic, then add `maskTemplateEnv`. Depends on item 2.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/deployment-history-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/deployment-history-utils.test.ts`
      Verify: `npx vitest run src/utils/deployment-history-utils.test.ts` passes, including a fixture asserting byte-identical YAML against the old modal helper's output.

- [ ] 8. Create `security-posture-utils.ts` (§5.3): the exported constants, `resolveEffectiveSecurityContext`, `evaluateRunAsRoot` (all 6 truth-table rows), `evaluateAddedCapability`, `computePssLevel` (from `pssViolation` only), `evaluateSecurityPosture` and `counts`. If the file passes 500 lines, move the per-check evaluators to `/Users/MohammedRashid.Matin/Development/lumen/src/utils/security-checks.ts` (§11.14).
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/security-posture-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/security-posture-utils.test.ts`
      Verify: `npx vitest run src/utils/security-posture-utils.test.ts` passes.

- [ ] 9. Create `pod-distribution-utils.ts` (§5.4) with `groupPodsByNode`, `groupNodesByZone` and `assessDistributionRisks` (all 8 risk ids). Terminating pods are excluded from risk math. The hostname TSC domain is `node?.hostname ?? nodeName`.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/pod-distribution-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/pod-distribution-utils.test.ts`
      Verify: `npx vitest run src/utils/pod-distribution-utils.test.ts` passes.

- [ ] 10. Create `container-insights-utils.ts` (§5.6) with `parseImageRef`, `describeProbe` (resolves named ports), `buildContainerInsights` (effective pull policy, env display with masking, `secretKeyRef` shows name/key only, and the flags). Depends on item 2.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/container-insights-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/container-insights-utils.test.ts`
      Verify: `npx vitest run src/utils/container-insights-utils.test.ts` passes.

- [ ] 11. Create `networking-utils.ts` (§5.7) with `mapServicePorts`, `ingressRoutesForServices` and `describeNetworkPolicy`.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/networking-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/networking-utils.test.ts`
      Verify: `npx vitest run src/utils/networking-utils.test.ts` passes.

- [ ] 12. Create `deployment-log-utils.ts` (§6.1 "Logs") with `LogTarget`, `toLogTarget` (main → `spec.containers`; init and sidecar → `spec.initContainers`; template fallback) and `firstMainContainerName`.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/utils/deployment-log-utils.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/utils/deployment-log-utils.test.ts`
      Verify: `npx vitest run src/utils/deployment-log-utils.test.ts` passes.

- [ ] 13. Create `live-refresh-decision.ts` (§4, §9) with `decideLiveRefresh` (actions `none` | `debounce` only) and `shouldApplyResponse`.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/hooks/live-refresh-decision.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/hooks/live-refresh-decision.test.ts`
      Verify: `npx vitest run src/hooks/live-refresh-decision.test.ts` passes.

### Phase B: main process and IPC

- [ ] 14. Create the aggregator `electron/deployment-full-details.ts` (§3.3).
      Exports:
      - `DeploymentDetailsClients`, `fetchDeploymentFullDetails`
      - `classifyK8sError` (code, statusCode or response.statusCode; message-only 401 regex)
      - `settle` (per-call timeout through `withTimeout` from `../src/lib/with-timeout`; `onNotFound`; rethrows `'unauthorized'`)
      - `toPlain`, `summarizePod`, `summarizeNode`, `toSaSummary`, `toPvcSummary`, `filterHpa`, `toDeploymentEvent`, `filterOwned`, `pickPodMetrics`, `mapWithConcurrency` (with `shouldStop`)

      Behaviour:
      - Phase 1 is the deployment read: 20 s timeout, `kind`/`apiVersion` defaults, and a strip of `LAST_APPLIED` from the deployment and from owned ReplicaSets, recording `lastAppliedBytes`.
      - Phase 2 is the parallel sections, with the chains described in §3.3 and PVCs included.
      - Phase 3 is the node reads: concurrency 8, 10 s per read, a 20 s overall deadline that also stops new reads, and a stop on the first 403.

      Caps: 300 events, 100 nodes, 50 PVCs. Never call any Secret API. Log only labels and classifications. Import `LAST_APPLIED` from `../src/utils/sensitive-value-utils` and the selector helpers from `../src/utils/label-selector-utils`. If the file passes 500 lines, move the phase-2 fetchers to `/Users/MohammedRashid.Matin/Development/lumen/electron/deployment-full-details-fetchers.ts`.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/electron/deployment-full-details.ts`, `/Users/MohammedRashid.Matin/Development/lumen/electron/deployment-full-details.test.ts`
      Verify: `npx vitest run electron/deployment-full-details.test.ts` passes (every case in the test list below); `npx tsc --noEmit` exits 0.

- [ ] 15. Wire the aggregator through the main process, the preload bridge and both type declaration files. Depends on item 14.
      - **`K8sService.getDeploymentFullDetails`** in `electron/k8s.ts` (§3.4). Add it next to `getDeploymentRevisions` (line ~1409). Create the clients inside the `withAuthRetry` closure and pass `getPodMetrics: () => this.getPodMetrics(contextName, [namespace])`. `AppsV1Api`, `CoreV1Api`, `NetworkingV1Api`, `AutoscalingV2Api` and `PolicyV1Api` are already imported, so reuse those imports.
      - **IPC handler** in `registerIpcHandlers()` in `electron/main.ts`: `safeHandle('k8s:getDeploymentFullDetails', z.tuple([...]), ...)` with the exact zod schema from §3.5. Find `classify()`/mutation policy (grep `enforceMutationPolicy`) and confirm the channel defaults to `READ`; add no MUTATE entry.
      - **Preload method** `getDeploymentFullDetails` on the top-level `window.k8s` object in `electron/preload.ts`, next to line 54.
      - **Type declarations:** declare `getDeploymentFullDetails(contextName: string, namespace: string, name: string): Promise<DeploymentFullDetailsResponse>` in `electron/electron-env.d.ts` and `src/vite-env.d.ts`, wherever `getDeploymentRevisions` is declared, using `import('…/types/deployment-details').DeploymentFullDetailsResponse` type imports.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/electron/k8s.ts`, `/Users/MohammedRashid.Matin/Development/lumen/electron/main.ts`, `/Users/MohammedRashid.Matin/Development/lumen/electron/preload.ts`, `/Users/MohammedRashid.Matin/Development/lumen/electron/electron-env.d.ts`, `/Users/MohammedRashid.Matin/Development/lumen/src/vite-env.d.ts`
      Verify: `npx tsc --noEmit` exits 0; `npx vitest run` passes in full.

### Phase C: shared renderer changes and the data hook

- [ ] 16. Update `ToggleGroup` (§6.5).
      - Add `disabled?` and `title?` to `ToggleOption`.
      - Each button gets `disabled`, `aria-disabled`, `title`, and the classes `opacity-40 cursor-not-allowed` when disabled. `onClick` returns early when disabled.
      - Use a `useId()`-based `layoutId={`toggle-bg-${id}`}`.
      - Existing call sites (for example `DashboardHeader`) need no change.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/components/shared/ToggleGroup.tsx`
      Verify: `npx tsc --noEmit` exits 0; `npx eslint src/components/shared/ToggleGroup.tsx --max-warnings 0` adds no new problems.

- [ ] 17. Refactor `RevisionDiffModal` to the `{ isOpen, onClose, left, right }: RevisionDiffSide` contract (§6.4). Delete its local `Revision` interface and local `revisionToYaml`. The subtitle is `{left.label} → {right.label}` and each column header is `{side.label} · date`. Export `RevisionDiffSide`. Then update the drawer `DeploymentDetails.tsx`: declare `DrawerRevision`, add a `toSide` helper that calls the shared `revisionToYaml` from item 7, and build `left`/`right` where `diffPair` is set today. Depends on item 7.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/components/resources/details/RevisionDiffModal.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/resources/details/DeploymentDetails.tsx`
      Verify: `npx tsc --noEmit` exits 0; `npx vitest run src/utils/deployment-history-utils.test.ts` still passes (byte-identical YAML fixture).

- [ ] 18. Create the `useDeploymentFullDetails` hook (§4).
      - **Cache.** Module-level LRU cache, max 5 entries, keyed `${cluster}|${ns}|${name}`, with the eviction rules from §4.
      - **Requests.** `requestIdRef`, `currentKeyRef` (latest-ref), `mountedRef` and per-key `pendingRef` coalescing. Writes go to the cache under the captured `reqKey`, and state is applied only when `shouldApplyResponse` passes.
      - **Key-change reset effect.** Declare it first and skip it on mount. It bumps the id, clears pending and the debounce, resets state from cache or to `loading`, logs a dev `console.error`, then fetches.
      - **Live trigger effect.** Deps `[liveResourceVersion]`. It delegates to `decideLiveRefresh` and schedules a 1500 ms debounce.
      - **Return value.** `refresh`, `dismissError`, `liveUpdates`.
      - **Cleanup.** On unmount, clear timers and set `mountedRef` to false.
      Depends on items 1, 13 and 15.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/hooks/useDeploymentFullDetails.ts`
      Verify: `npx tsc --noEmit` exits 0; `npx vitest run src/hooks` passes.

### Phase D: full-view components (folder `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/`)

All of these are presentational and wrapped in `React.memo`, except `DeploymentFullView`. Each file stays under ~350 lines. Use static `STATUS_CLASSES` maps, not template-literal classes. Follow the accessibility rules in §7.

- [ ] 19. Create the page shell components.
      - **`SectionShell.tsx`** (§6 API). Exports `SectionShell`, `SectionUnavailable`, `SectionNote`, `LevelBadge` and `STATUS_CLASSES`.
      - **`SectionNav.tsx`.** Sticky, with an IntersectionObserver that is disconnected on unmount.
      - **`DeploymentHeader.tsx`.** Name/ns/cluster, status badge via `getDeploymentStatus`, `TimeAgo`, live indicator plus its tooltip, last updated, Back/Refresh/Scale/Restart/Edit YAML, the HPA warning line, and the dismissible refresh-error line.
      - **`OverviewSection.tsx`.** Uses `displayAnnotations` with `strippedBytes`.
      - **`RolloutSection.tsx`.** Stat tiles, progress bar, banners, HPA card and PDB card.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/SectionShell.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/SectionNav.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/DeploymentHeader.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/OverviewSection.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/RolloutSection.tsx`
      Verify: `npx tsc --noEmit` exits 0; `npx eslint src/components/dashboard/views/deployment-details --max-warnings 0` passes.

- [ ] 20. Create the revision components (§6.3, §6.4).
      - **`RevisionTimeline.tsx`.** Track, nodes and the `RevisionHoverCard` (positioned absolutely, `z-50`, Framer fade, respects `useReducedMotion`). Listbox/option ARIA with roving tabindex and ←/→/Home/End/Enter/Space keys. Auto-scrolls the current node into view.
      - **`RevisionDetailPanel.tsx`.** Facts, RS link through `onResourceClick(…,'replicaset')`, `displayAnnotations`, the change list, `eventsForRevision` (up to 20), and the compare `ToggleGroup` using the item 16 `disabled`/`title` options with the reset rule.
      - **`RevisionDiffEditor.tsx`.** Monaco `DiffEditor` mounted on demand, the side/inline `ToggleGroup` seeded once from `matchMedia`, the hidden-values note, and a Pop-out that opens `RevisionDiffModal` with the same sides.
      Depends on items 6, 7, 16 and 17.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/RevisionTimeline.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/RevisionDetailPanel.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/RevisionDiffEditor.tsx`
      Verify: `npx tsc --noEmit` exits 0; eslint on the three files passes.

- [ ] 21. Create `DeploymentFullView.tsx`, the container component (§6.1, §6.2).
      - **Data.** Calls `useDeploymentFullDetails` with `liveDeployment?.metadata?.resourceVersion`. Derives the memoized data listed in §6.1.
      - **States.** Loading skeletons (`SkeletonLoader`), not-found, forbidden and error cards (Retry).
      - **Actions.** Scale through `ScaleModal`, mounted only while open. Restart through `ConfirmModal variant="warning"`. Edit YAML through `onOpenYaml({...deployment, type:'deployment'})`. `handleOpenPodLogs` built with `toLogTarget` and `firstMainContainerName`.
      - **Wrapper.** `ErrorBoundary name="DeploymentFullView" resetKey=…`.
      - **Layout.** At this step it renders the header, nav, Overview + Rollout, and Revision History. Item 23 adds the remaining sections.
      If the file grows past 500 lines, move the memos into `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/useDeploymentDerivedData.ts`.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/DeploymentFullView.tsx`
      Verify: `npx tsc --noEmit` exits 0; eslint on the file passes.

- [ ] 22. Wire navigation (§2.2). Read every file before editing; several already hold uncommitted user changes.
      - **`ViewTabBar.tsx`.** `getViewIcon` returns `<Layers size={13} />` for the prefix.
      - **`DashboardHeader.tsx`.** `getViewTitle` returns `Deployment: <name>`. Hide the search input, namespace selector and resource count when `parseDeploymentDetailViewId(activeView)` is non-null.
      - **`Dashboard.tsx`.**
        - Add the drawer `headerActions` "Full View" button (`Maximize2`, the Scale-button classes, `title`). It navigates, then closes the drawer.
        - Pass `onOpenYaml` to `DashboardContent`.
        - `getResourceCount` returns 0 for the prefix.
      - **`DashboardContent.tsx`.**
        - Add the `onOpenYaml` prop.
        - Add the top-level hooks right after the `podStatusStats` memo (~line 184): `onNavigateRef`, `deploymentDetail`, `liveDeployment`, `handleOpenDeploymentFullView`, `handleBackToDeployments`.
        - Add the route branch rendering `<DeploymentFullView key={`${clusterName}|${activeView}`} …/>`, near the Helm detail branch (~line 989).
        - Pass `onOpenFullView` to `DeploymentsView`.
      - **`DeploymentsView.tsx`.** Add the optional `onOpenFullView` prop and the conditional `actions` column (`e.stopPropagation()`, `aria-label`).
      - **`App.tsx`.** Normalize `SecondarySidebar activeView` for the prefix.
      Depends on items 4 and 21.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/ViewTabBar.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/DashboardHeader.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/Dashboard.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/DashboardContent.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/DeploymentsView.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/App.tsx`
      Verify: `npx tsc --noEmit` exits 0; `npx vitest run` passes in full; eslint on the modified files adds no new problems relative to their pre-edit output.

- [ ] 23. Create the remaining sections (§6.6) and add them to `DeploymentFullView` in the §6.2 order. Topology is collapsed and mounts `ResourceTopology` only when expanded.
      - **`PodDistribution.tsx`.** Zone columns, node cards and pod-dot buttons, risk banners, an Unscheduled card, and the nodes-unavailable fallback.
      - **`SchedulingConstraints.tsx`.** Readable constraints. The raw JSON contains only the 8 scheduling fields.
      - **`DeploymentPodsTable.tsx`.** `VirtualizedTable` plus `useResourceSorting`, with rows pre-mapped in `useMemo`. Height is `min(40 + rows×52, 520)`. Includes the Logs action and the revision `#n` column.
      - **`ContainersSection.tsx` and `ContainerCard.tsx`.** Grouped Init / Sidecars / Containers. Includes ports, env (masked; secret refs show names only), mounts, resources, probes, lifecycle and flags.
      - **`SecurityPosture.tsx`.** PSS badge "approx." against the namespace PSA, pod checks, and the per-container matrix with a collapsed "Added capabilities" row.
      - **`NetworkingSection.tsx`.** Services and port mapping, ingress routes, and NetworkPolicies, each sub-list handling its own `SectionResult`.
      - **`ConfigStorageSection.tsx`.** ConfigMap references (clickable), Secret references (names only, **not clickable**), a volumes summary with hostPath in red, and a PVC table.
      - **`EventsSection.tsx`.** All/Warnings `ToggleGroup`, 20 per page.
      Files: `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/PodDistribution.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/SchedulingConstraints.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/DeploymentPodsTable.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/ContainersSection.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/ContainerCard.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/SecurityPosture.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/NetworkingSection.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/ConfigStorageSection.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/EventsSection.tsx`, `/Users/MohammedRashid.Matin/Development/lumen/src/components/dashboard/views/deployment-details/DeploymentFullView.tsx` (modify)
      Verify: `npx tsc --noEmit` exits 0; `npx eslint src/components/dashboard/views/deployment-details src/hooks/useDeploymentFullDetails.ts --max-warnings 0` passes; `wc -l` shows every new file under 500 lines.

### Phase E: integration verification

- [ ] 24. Run the full gates: `npx tsc --noEmit` exits 0, and `npx vitest run` passes all tests (155 at baseline plus the new ones). Run eslint on all new files (must pass) and on the modified files (no new problems). Then run `npx vite build`, the renderer and electron bundle without electron-builder, and confirm it succeeds.
      Files: none (fix any seams found).
      Verify: all of the commands above succeed.

- [ ] 25. Run the manual checklist from §9 "Integration and manual checks" with `npm run dev` against a real cluster. Quit any installed Lumen.app first; see `.kiro/steering/dev-troubleshooting.md`. Record each item as done or not runnable. If no cluster is available, state that clearly in the report rather than claiming it passed.
      Files: none.
      Verify: the checklist results are recorded in the report.

## Unit test list (concrete)

- **`src/utils/sensitive-value-utils.test.ts`**
  - `isSensitiveEnv` name heuristics: `DB_PASSWORD`, `API_KEY`, `GITHUB_TOKEN`, `AUTH_HEADER` → true; `LOG_LEVEL` → false.
  - `isSensitiveEnv` value heuristics: `eyJ…`, `AKIA…`, `sk-…`, `ghp_…`, `Bearer x`, and `postgres://u:p@h` → true.
  - `maskTemplateEnv` masks literal values in containers and initContainers, leaves `valueFrom` untouched, and doesn't mutate its input (deep-equal snapshot before and after).
  - `displayAnnotations` hides `last-applied-configuration` with the correct byte count, including a multi-byte character, and leaves other annotations verbatim and sorted.
  - `strippedBytes` with the key absent emits one hidden placeholder with the given count.
  - The key present in both emits it once.
- **`src/utils/label-selector-utils.test.ts`**
  - `selectorToQueryString` for matchLabels, In, NotIn, Exists and DoesNotExist; nil and `{}` → null.
  - `matchesLabelSelector`: nil → false; `{}` follows `emptyMatchesAll`; each operator; matchLabels AND expressions combined.
  - `matchesServiceSelector`: selectorless → false; subset match.
  - fast-check property: labels ⊇ matchLabels ⇒ match.
- **`src/utils/view-labels.test.ts`**
  - fast-check build/parse round-trip over DNS-1123 namespaces and names, including names with dots.
  - Malformed ids return null: missing prefix, 2 segments, 4 segments, an empty segment, `%E0%A4%A`.
  - `getViewLabel` returns `Deploy: web`, falls back to `Deployment`, and leaves existing labels unchanged.
- **`src/utils/deployment-rollout-utils.test.ts`**
  - Defaults when spec fields are missing (replicas 1, 25%/25%, 0, 600, 10).
  - `progressPercent`, including desired 0 → 100.
  - Stalled (ProgressDeadlineExceeded), complete (NewReplicaSetAvailable with equal counts), paused, and `observedGenerationStale`.
  - `summarizeHpa` metrics and `atMax`.
  - `summarizePdb` `blocksEviction`.
- **`src/utils/pod-template-diff-utils.test.ts`**
  - Sensitive env changed (`DB_PASSWORD` a → b): one change labelled `env DB_PASSWORD changed (value hidden)`, with before and after both `MASK`. An unchanged sensitive value yields no change.
  - fast-check property: `diffPodTemplates(t, t)` is empty.
  - Image change label `image app: v1 → v2`.
  - Env added, removed and changed.
  - `resources.limits.memory` change.
  - `restartedAt` → "Rollout restart triggered".
  - `pod-template-hash` ignored.
  - A container moved from init to main gives removed + added.
  - `before === null` → "Initial revision".
  - `summarizeChanges` truncation gives `more`.
- **`src/utils/deployment-history-utils.test.ts`**
  - Ordering with null revisions last.
  - Current-revision detection: the annotation, then the most-common pod hash, then the highest revision.
  - `revision-history` parsing.
  - `getPreviousRevision`, `buildRevisionByHash`, and `pod-template-hash` removed from `template`.
  - `revisionToYaml` key order is byte-identical to the old modal helper on a fixture, including a `Date` `createdAt`.
  - `revisionToYaml` masks sensitive env.
  - `revisionEntryToYamlInput` includes `selector`.
  - `eventsForRevision`:
    - uid match and token match
    - `"web-6d4f"`, `web-6d4f,` and `web-6d4f.` match
    - `web-6d4f` does **not** match a message naming `web-6d4f9`
    - regex metacharacters in the name are escaped
    - the union is deduplicated and newest first
- **`src/utils/security-posture-utils.test.ts`**
  - All 6 runAsRoot truth-table rows, including `runAsUser:1000` with runAsNonRoot unset (pass, `pssViolation` true) and explicit `runAsNonRoot:false`.
  - Pod/container override precedence, and the `source` values.
  - Privileged → `'privileged'`.
  - A fully restricted template → `'restricted'`.
  - Added capabilities: `CHOWN` → warn/`'baseline'`; `NET_RAW` → warn/`'privileged'`; `SYS_ADMIN` → fail; `NET_BIND_SERVICE` → pass; `cap_net_admin` is normalized.
  - AppArmor `Unconfined` from the annotation → fail.
  - SELinux `type: spc_t` → fail.
  - Unsafe sysctl → fail.
  - nfs volume → restricted violation.
  - hostPath → fail.
  - Sidecar detection.
  - automount precedence: pod over SA.
  - `counts` tallies.
- **`src/utils/pod-distribution-utils.test.ts`**
  - fast-check property: grouped + unscheduled == input count.
  - Each of the 8 risk rules, firing and not firing.
  - Terminating pods are excluded from risks.
  - The hostname TSC uses `node.hostname` when it differs from `nodeName`, and falls back to `nodeName` when the summary is missing.
  - Missing node summaries give an unknown zone.
  - Sort order.
- **`src/utils/container-insights-utils.test.ts`**
  - `parseImageRef` for `nginx`, `nginx:1.25`, `ghcr.io/o/r:tag@sha256:…`, `localhost:5000/r` and `r@sha256:…`.
  - Effective pull policy.
  - Each flag.
  - `multiple-digests`.
  - Named-port probe target `GET http://:8080/healthz`.
  - `secretKeyRef` display carries no value.
  - Sensitive literal masked.
  - init/sidecar/main kinds.
- **`src/utils/networking-utils.test.ts`**
  - targetPort numeric, named, and unset (resolves to port).
  - Unresolved → `resolved: null`.
  - Ingress default backend and rules, with TLS host detection.
  - `describeNetworkPolicy` default-deny detection.
- **`src/utils/deployment-log-utils.test.ts`**
  - `toLogTarget`: main containers go to `spec.containers`, init + sidecar to `spec.initContainers`.
  - Empty `containers` falls back to the template.
  - `firstMainContainerName` skips init and sidecar entries, falls back to the template, and returns `''` when neither exists.
- **`src/hooks/live-refresh-decision.test.ts`**
  - `decideLiveRefresh`:
    - first observation → none
    - same rv → none
    - new rv equal to fetched → none
    - new rv different → debounce
    - present → absent → debounce
    - present → absent → present → none
    - a lagging watcher never triggers twice for the same live rv
  - `shouldApplyResponse`:
    - latest id, same key, mounted → true
    - older id → false
    - same id, different key → false
    - unmounted → false
- **`electron/deployment-full-details.test.ts`** (mocked clients, vitest fake timers)
  - Deployment 404 → `found:false 'not-found'`; 403 → `'forbidden'`.
  - Services 403 → only services are `forbidden`.
  - uid ownership excludes orphan ReplicaSets with the same name.
  - RS failure → pods `ok` with the ownership `note`; events `note`.
  - Events: an eventTime-only event maps to a non-null `lastTimestamp`, a count from series (or 1), and a source from `reportingController`. Sorted newest first, capped at 300.
  - `pickPodMetrics` turns a `ns/name` Map into a pod-name record and ignores other namespaces.
  - managedFields stripped; `kind`/`apiVersion` defaulted.
  - `last-applied-configuration` is absent and `lastAppliedBytes` equals its UTF-8 length (multi-byte fixture); `lastAppliedBytes` is null when the annotation is absent.
  - SA 404 → `ok exists:false`.
  - One PVC 404 among three → `ok`, that claim `found:false`, no note.
  - HPA list 404 → `error` "autoscaling/v2 API not available".
  - `settle` 404 with no `onNotFound` → `error` "…not found (API not available?)".
  - No Secret API method invoked (spy on every `*Secret*` method of the mocked CoreV1Api).
  - 401 rethrows for `code: 401` and for a message-only `"Unauthorized"`.
  - `filterHpa` keeps only the HPA targeting this deployment.
  - Node partial failure → `note`.
  - First node 403 stops further reads (call count ≤ 8) → `forbidden`.
  - Overall node deadline → `error`, and with 40 hanging reads no new `readNode` call starts after advancing past 20 s.
  - PVCs are read in phase 2 even when nodes hang.
  - `mapWithConcurrency` honours `shouldStop` and the limit.
  - `summarizePod` lists spec containers that have no status yet as `unknown`.
