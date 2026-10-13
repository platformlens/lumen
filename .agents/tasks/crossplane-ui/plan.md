# Implementation Plan: Crossplane UI in Lumen

Source of truth: `.agents/tasks/crossplane-ui/design.md` (Draft v3) plus its section "Amendments from review v3" (AM-1 … AM-6), which is BINDING and overrides any earlier conflicting text. Section references below (B.x, AC n, AM-n) point into that file. Do not re-design; implement.

## Hard constraints (every step)

- v1 is READ-ONLY: no new mutating IPC, no Delete for Crossplane objects. Only the existing YAML view/edit flow (Safe Mode governed) remains.
- Work directly in `/Users/MohammedRashid.Matin/Development/lumen` on branch `feature/security-improvements`. No worktree. NEVER `git commit`, `stash`, `reset`, `checkout`, `restore`, `clean`, or discard anything. Leave all changes uncommitted.
- The working tree has UNCOMMITTED user changes (`electron/k8s.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/electron-env.d.ts`, `src/vite-env.d.ts`, `src/App.tsx`, `src/components/Dashboard.tsx`, `SecondarySidebar.tsx`, `src/utils/view-labels.ts`, `KarpenterView.tsx`, `NodesView.tsx`, `LogViewer.tsx`, `TerminalComponent.tsx`, `YamlEditor.tsx`, `terminal.ts`, `package.json`) and many untracked files. Preserve them exactly. Edits to existing files are ADDITIVE `str_replace` insertions only; run `git status --short` and RE-READ the file immediately before each edit; never reformat or reorder existing hunks.
- Do NOT touch `KarpenterView.tsx`, `NodesView.tsx`, `LogViewer.tsx`, `electron/terminal.ts`, `TerminalComponent.tsx`, `YamlEditor.tsx`, `package.json`, or any untracked user file (`src/utils/view-labels.test.ts` must keep passing).
- No new dependencies. Every NEW file < 500 lines. Strict TS, no `any` in new code (external data is `unknown` + guards). Business logic in `electron/` and `src/utils/`. Sorting only through `useResourceSorting`. Tables >100 rows virtualised. Clean up intervals/listeners. Theme per `.kiro/steering/theme.md`.

## Baseline (measured before any change)

- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → 38 files, 311 tests pass.
- `npm run lint` → ALREADY FAILS on the base tree: 1608 problems (1573 errors, 35 warnings), all pre-existing. Therefore lint verification for this feature is:
  1. `npx eslint --max-warnings 0 <every new file>` → 0 problems.
  2. `npm run lint 2>&1 | tail -3` → total problem count ≤ 1608 (no new problems in modified files). AC 19's "lint 0 warnings" is satisfied for feature files, not the pre-existing repo.

## Verification commands (used throughout)

- Types: `npx tsc --noEmit` (covers `src` and `electron`).
- Tests: `npx vitest run` (config includes `**/*.test.ts`, globals on; tests must be `.ts`, no DOM).
- Lint: as above.
- Build: `npx vite build` (builds renderer to `dist/` and main/preload to `dist-electron/`, both gitignored). Do NOT run `npm run build` (it runs electron-builder and `rm -rf`). After the build, confirm `dist/licenses/crossview-LICENSE.txt` exists.
- File size: `wc -l` on every new file → each < 500.

## Process split

- `src/types/crossplane.ts`: shared types + constants (categories, HEALTH_ORDER, ref regexes). Imported by main, preload typings and renderer.
- `src/utils/crossplane-utils.ts`, `src/utils/crossplane-summaries.ts`, `src/utils/crossplane-graph.ts`, `src/utils/crossplane-query-utils.ts`: pure, no Node/Electron imports. Imported by both main and renderer.
- `electron/crossplane-*.ts`: all Kubernetes I/O, caching, concurrency, IPC. Never imported by the renderer.

## IPC contract (B.8, all READ)

`safeHandle(channel, schema, handler)` from `electron/ipc/validation.ts`, schemas in `electron/crossplane-ipc-schemas.ts` (imports only `zod` + `src/types/crossplane`), every object `.strict()`:

| Channel | Schema | Output |
|---|---|---|
| `crossplane:detect` | `contextOnlySchema` | `CrossplaneDetection` |
| `crossplane:getPackages` | `contextOnlySchema` | `CrossplanePackagesPayload` |
| `crossplane:getDefinitions` | `contextOnlySchema` | `CrossplaneDefinitionsPayload` |
| `crossplane:getComposites` | `contextOnlySchema` | `CrossplaneCompositesPayload` |
| `crossplane:getManagedKinds` | `contextOnlySchema` | `ManagedKindsPayload` |
| `crossplane:scanManaged` | `contextOnlySchema` | `ManagedScanSummary` |
| `crossplane:getManagedItems` | `managedItemsSchema` | `ManagedItemsPayload` |
| `crossplane:getWarningEvents` | `warningEventsSchema` | `CrossplaneWarningEventsPayload` |
| `crossplane:getResource` | `refRequestSchema` (+ Secret rejection) | stripped object |
| `crossplane:getTree` | `refRequestSchema` | `CrossplaneTree` |
| event `crossplane:scanProgress` | main → renderer | `CrossplaneScanProgress` |

Channel names match no MUTATE/DESTRUCTIVE pattern in `mutation-policy.ts` (all `^k8s:…`), so they classify READ. Preload exposes `window.k8s.crossplane.*` positional methods that pack into ONE object; `onScanProgress` returns an unsubscribe that removes only its own listener. Renderer always passes `toCrossplaneRef(x)`.

## Ordered work

Items are grouped into four features (FEAT-001 … FEAT-004, see `task-crossplane-ui/features/`). Each item leaves the tree building.

### FEAT-001 — Shared types, pure utils, sorting (B.6, B.7 layout, B.10, B.14, AM-1, AM-2, AM-4 column helper, AM-6)

- [ ] 1. Create `src/types/crossplane.ts` (B.10 + AM-1): `CROSSPLANE_CATEGORIES` exactly as AM-1, `CrossplaneCategory`, `CrossplaneHealth`, `ConditionStatus`, `HEALTH_ORDER`, `CrossplaneCondition`, `CrossplaneObjectRef`, `CrossplaneRowBase`, `RevisionRow` (replaces `PackageRevisionSummary`), `NeedsAttentionRow = CrossplaneRowBase`, `PackageRow` (`revisions: RevisionRow[]`), `XrdRow`, `CompositionRow`, `CompositeRow`, `ClaimRow`, `OperationRow`, `ManagedRow`, `ProviderConfigRow`, `RuntimeConfigRow`, `ActivationPolicyRow`, `EnvironmentConfigRow`, `UsageRow`, `CrossplaneSectionError`, `CrossplaneDetection` (incl. `kindVersions`, `features`, `majorVersion`, `version`, `coreRunning`), all payload types (B.10 comment list, incl. `providerApiGroups`, `operations`, `claimsSupported`, `errors`, `fetchedAt`, `truncatedKinds`, `skippedMalformed`), `ManagedKindInfo`, `ManagedKindsPayload`, `ManagedScanSummary` (per-kind `byHealth`, `unhealthy` ≤200, `status`), `ManagedItemsPayload`, `CrossplaneEvent`, `CrossplaneWarningEventsPayload`, `CrossplaneTreeNode`, `CrossplaneTree` (`warnings`), `CrossplaneScanProgress`, `DrawerLink`, and exported regex/limit constants `DNS_SUBDOMAIN`, `DNS_LABEL`, `API_VERSION`, `KIND`, `KIND_KEY` (AM-2 decision). All count fields `number`.
      Files: `src/types/crossplane.ts` (~280)
      Verify: `npx tsc --noEmit` exit 0.

- [ ] 2. Create `src/utils/crossplane-utils.ts` with crossview attribution header (B.1): guards `asRecord/asString/asArray`, `getConditions`, `deriveHealth(category | 'generic', conditions, meta, now)` implementing B.6 rules 1–7 including `packageRevision` (revision rule, Inactive → none) and `compositionRevision` (generic) per AM-1, `PROGRESSING_REASONS`, `STUCK_THRESHOLD_MS`; ref helpers `getResourceRefs` (v2 `spec.crossplane.resourceRefs` ?? v1 `spec.resourceRefs`), `getCompositionRef`, `getClaimRef` (claimRef or labels), `getControllerOwner`; `parseCrdName`, `pickReferenceableVersion`, `pickKindVersion`, `resolveKindVersion`, `resolveXrdScope`, `partitionObjectRefs`, `revisionFingerprint`, `crossplaneKey`, `toCrossplaneRef`, `isValidCrossplaneRef` (AM-2), `classifyCrossplaneObject` (AM-1: revisions → packageRevision/compositionRevision, unknown core-group kinds → `null`, `managed` only for non-core groups), `countHealth`, `collectNeedsAttention(...): NeedsAttentionRow[]` (sorted by healthOrder asc, healthSince desc, missing last), `filterCrossplaneEvents`, and `resolveDrawerRefs(category, object, ctx): DrawerLink[]` implementing the AM-2 table exactly (Secret refs and invalid refs → text only). If the file nears 500 lines, move `resolveDrawerRefs` into `src/utils/crossplane-drawer-refs.ts` (same attribution header) — decision made now: put it there from the start.
      Files: `src/utils/crossplane-utils.ts` (~400), `src/utils/crossplane-drawer-refs.ts` (~200)
      Verify: `npx tsc --noEmit` exit 0.

- [ ] 3. Create `src/utils/crossplane-summaries.ts` (attribution header): `summarizePackage`, `summarizeRevision` (→ `RevisionRow`, category `packageRevision`), `summarizeXrd`, `summarizeComposition`, `summarizeCompositionRevision`, `summarizeComposite`, `summarizeClaim`, `summarizeManaged`, `summarizeUsage`, `summarizeProviderConfig`, `summarizeRuntimeConfig`, `summarizeActivationPolicy`, `summarizeEnvironmentConfig`, `summarizeOperation`. Each returns `null` for malformed input (missing name/uid); counts default 0; `row.key = crossplaneKey(...)`; `age = creationTimestamp`.
      Files: `src/utils/crossplane-summaries.ts` (~350)
      Verify: `npx tsc --noEmit` exit 0.

- [ ] 4. Create `src/utils/crossplane-query-utils.ts` (`resolveIntervalMs(settingsSeconds, minIntervalMs)` = max(s*1000, 15000, min), `shouldFetchOnVisible(lastFetchedAt, now, intervalMs)`) and `src/utils/crossplane-graph.ts` (`buildCrossplaneFlow(tree, opts)` per B.7: x = depth×260, 84 px leaf slots, children sorted by (healthOrder, kind, name), >50 children → 50 + summary node, edge colours, animated when progressing, focus flag, `clickable: false` for summary/notFetched).
      Files: `src/utils/crossplane-query-utils.ts` (~40), `src/utils/crossplane-graph.ts` (~170)
      Verify: `npx tsc --noEmit` exit 0.

- [ ] 5. Refactor `src/hooks/useResourceSorting.ts` (AM-6): extract the comparator into exported pure `sortResourceData(data, sortConfig)`; keep special keys `age`, `restarts`, `cpu`, `memory`, `replicas`, `status` in their current order and logic; add the numeric branch (`typeof a[key]==='number' && typeof b[key]==='number'`) immediately before the default string comparison; the hook still returns the property `getSortedData` (and all other current return members unchanged). This file has no user changes (confirm with `git status` first).
      Files: `src/hooks/useResourceSorting.ts`
      Verify: `npx tsc --noEmit` exit 0; existing `npx vitest run` still 311+ passing.

- [ ] 6. Tests (B.14 + AM-1 + AM-2 + AM-6) with fixtures in `src/utils/__fixtures__/crossplane-fixtures.ts`: a Claim; a v1 LegacyCluster XR with `spec.resourceRefs` + `spec.claimRef`; a v2 namespaced XR with `spec.crossplane.resourceRefs` and claim labels; MRs with Synced/Ready True, Ready=False Creating (fresh and 16 min old), Synced=False ReconcileError, `LastAsyncOperation=False`, paused annotation, deletionTimestamp; package revisions v2 (RevisionHealthy/RuntimeHealthy), v1 (Healthy only), Inactive; Provider/Function/Configuration v1/v2; XRDs with/without claimNames and with/without `spec.scope`; Compositions with pipeline; Usage with resourceRef and with resourceSelector; Operation/CronOperation/WatchOperation; ProviderConfig with `credentials.secretRef`; an MRD. Test files:
      - `src/utils/crossplane-utils.test.ts`: full B.14 matrix + AM-1 tests (`deriveHealth('packageRevision')` v2/v1/Inactive; classify ProviderRevision → packageRevision, CompositionRevision → compositionRevision, MRD → null, non-core group → managed; unhealthy revision NeedsAttention row → `toCrossplaneRef` → parses `refRequestSchema` imported from `electron/crossplane-ipc-schemas.ts` — so create that schemas file in this step too, item 7 of FEAT-002 only re-uses it).
      - `src/utils/crossplane-drawer-refs.test.ts`: every AM-2 row; Secret → text; unresolvable kindVersion → text; providerConfigRef not found → text, found (incl. namespaced MR namespace match) → link; Usage resourceSelector → text `selector: k=v`; compositeTypeRef with/without XRD; every emitted `ref` parses with `refRequestSchema`.
      - `src/utils/crossplane-summaries.test.ts`: every summariser on fixtures and malformed input (null, missing spec), counts are numbers.
      - `src/utils/crossplane-graph.test.ts`, `src/utils/crossplane-query-utils.test.ts`, `src/hooks/useResourceSorting.test.ts` (numeric 9 before 10 asc/desc, `healthOrder` order, number/undefined falls to string path, age/cpu/memory unchanged).
      Files: `electron/crossplane-ipc-schemas.ts` (~70, B.8 schemas using constants from `src/types/crossplane.ts`), the fixture and test files above.
      Verify: `npx vitest run` — all new tests pass, prior 311 still pass; `npx eslint --max-warnings 0 src/types/crossplane.ts src/utils/crossplane-*.ts src/utils/__fixtures__ src/hooks/useResourceSorting.ts src/hooks/useResourceSorting.test.ts electron/crossplane-ipc-schemas.ts` → 0 problems; `npx tsc --noEmit` exit 0.

### FEAT-002 — Main process service, IPC, preload (B.5, B.7 walk, B.8, B.9, B.12, B.13, AM-3)

- [ ] 7. `electron/k8s.ts` (re-read first, additive): add `export` to the existing `function sanitizeK8sErrorMessage` (line ~58), and add public method `createContextKubeConfig(contextName: string): KubeConfig` to `K8sService` (new `KubeConfig()`, `loadFromDefault()`, throw `Unknown kube context: X` if absent, `setCurrentContext`, return).
      Files: `electron/k8s.ts`
      Verify: `npx tsc --noEmit` exit 0; `git diff electron/k8s.ts` shows only the user's prior hunks plus these two insertions.

- [ ] 8. `electron/crossplane-api.ts`: `CrossplaneApi` interface + `createCrossplaneApi(kcFactory, context, opts)` per B.9 row: clients built with `createConfiguration({ baseServer: new ServerConfiguration(server, {}), authMethods: { default: kc }, promiseMiddleware: [counting] })`; `getApiGroups`, `getGroupResources`, `listPage`, `listAllPages` (B.5 shared list helper: 500/5000, continue, 404/403 errors, one 410 restart, AbortSignal, summarise-and-drop), `get(ref, plural)` (CustomObjectsApi for grouped, `KubernetesObjectApi.read` for core v1), `listCrdMetadata` (PartialObjectMetadataList Accept), `listWarningEventsPage`, `findCoreDeployment` (A3 two selectors, rbac-manager filter); `withTimeout(…, 30_000, label)`; 401 rebuild-and-retry once; `CrossplaneApiError {status,message}` via `sanitizeK8sErrorMessage`; `LUMEN_DEBUG_CROSSPLANE=1` request log; local `createLimiter(n)` semaphore exported for reuse.
      Files: `electron/crossplane-api.ts` (~300)
      Verify: `npx tsc --noEmit` exit 0.

- [ ] 9. `electron/crossplane-discovery.ts` (attribution header): `detect` (B.5 steps 1–6, kindVersions via `pickKindVersion`), `resolveGroupKinds(api, cache, refs, limit)`, `buildManagedKinds` (ProviderRevision objectRefs path + `crdMetadata` fallback, fingerprint). `electron/crossplane-snapshots.ts`: `fetchPackages` (two-phase, ProviderConfig phase, `providerApiGroups`, fingerprint callback), `fetchDefinitions` (incl. Function used-by), `fetchComposites` (XR/claim/usage/operations sections), `fetchWarningEvents` (B.5 algorithm), per-fetch 6-slot limiter, per-section error mapping, "Cluster unreachable". `electron/crossplane-tree.ts`: B.7 walk (definitions first, ascend ≤4, BFS descend, concurrency 8, Secret notFetched, missing/forbidden/error, depth 6, 300 nodes, cycle guard, warnings).
      Files: `electron/crossplane-discovery.ts` (~280), `electron/crossplane-snapshots.ts` (~420; if >480 split warning events into `electron/crossplane-events.ts`), `electron/crossplane-tree.ts` (~220)
      Verify: `npx tsc --noEmit` exit 0.

- [ ] 10. `electron/crossplane.ts` `CrossplaneService({ kubeConfigFactory, emitProgress, apiFactory?, now? })`: per-context LRU(3) cache with B.5 TTLs; in-flight dedupe where `force` skips cache but JOINS any in-flight promise for the same key (AM-3); `peekManagedKinds`; `latestRevisionFingerprint` + eviction; `scanManaged` always awaits `getManagedKinds(ctx,{force:false})` and `force` bypasses only the scan-summary cache (AM-3); single scan with AbortController cancel on context change; per-kind promise map; shared 6-slot MR limiter; 50k row cap; 250 ms throttled progress; `getManagedItems` steps 1–4; `getResource` (Secret rejection, strip `managedFields` + `kubectl.kubernetes.io/last-applied-configuration`); `getTree`; `invalidateKubeConfigs`. `electron/crossplane-ipc.ts` `registerCrossplaneIpc(service)`: ten `safeHandle` registrations using the schemas, `validateK8sParam` defence in depth on ref fields, Secret rejection message "Secrets are not fetched by the Crossplane view".
      Files: `electron/crossplane.ts` (~400), `electron/crossplane-ipc.ts` (~90)
      Verify: `npx tsc --noEmit` exit 0.

- [ ] 11. Wiring (re-read each file first; additive only): `electron/main.ts` — import, instantiate `crossplaneService` (guarded `win.webContents.send` progress), call `registerCrossplaneIpc(crossplaneService)` inside `registerIpcHandlers()`, add `crossplaneService.invalidateKubeConfigs()` inside the `k8s:forceCredentialRefresh` handler. `electron/preload.ts` — `crossplane` block next to `helm` (B.8 signatures, `onScanProgress` removing only its listener). `electron/electron-env.d.ts` (inline `import('../src/types/crossplane').X` style) and `src/vite-env.d.ts` (`import type`) — typings for `window.k8s.crossplane`.
      Files: `electron/main.ts`, `electron/preload.ts`, `electron/electron-env.d.ts`, `src/vite-env.d.ts`
      Verify: `npx tsc --noEmit` exit 0; `npx vite build` succeeds.

- [ ] 12. Tests with a fake `CrossplaneApi` (B.14 electron list + AM-3): `electron/crossplane.test.ts`, `electron/crossplane-discovery.test.ts`, `electron/crossplane-snapshots.test.ts`, `electron/crossplane-tree.test.ts`, shared fake in `electron/__fixtures__/fake-crossplane-api.ts`. Must cover: detection variants; TTL/force/in-flight dedupe incl. forced call joining in-flight (AM-3); `scanManaged` uses non-forced kind index; pagination/cap/410/404; 403 partial; status-0 rejection; scan cancel; LRU; Secret refusal + stripping; tree ascend/descend v1 and v2, namespace inheritance, missing/forbidden, 300 cap, cycle, cold/rejected definitions; mixed-version kind index and the exact `P + V + Σ pages` request count; `getPackages` cold no MR discovery; fingerprint eviction; ProviderRevisions 403; warning events (cold index, page 3, 403, 10-page cap); `getManagedItems` join + post-cancel direct list; IPC schemas reject malformed input / extra keys / Secret.
      Verify: `npx vitest run` all pass; `npx eslint --max-warnings 0 electron/crossplane*.ts electron/__fixtures__` → 0; `npm run lint` total ≤ 1608.

### FEAT-003 — Navigation, query hook, five views (B.4, B.4.1–B.4.5, B.11, AM-4, AM-5)

- [ ] 13. Navigation (re-read each file first; additive): `src/App.tsx` — `hasCrossplane` state, `crossplaneDetectSeq` ref, reset at start of `handleClusterSelect` before the namespace pre-flight, detection after the Karpenter check in the same try with seq guard, reset in the back/`setSelectedCluster(null)` path, pass `hasCrossplane` to `SecondarySidebar`. `SecondarySidebar.tsx` — `hasCrossplane?: boolean` prop, `crossplaneGroup` with five items (`Gauge`, `Package`, `BookOpen`, `Boxes`, `Cloud`), insertion before `access` after the cert-manager block, `openGroups.crossplane: true`. `src/utils/view-labels.ts` — five labels (B.4 table). `DashboardHeader.tsx` — five `titleMap` entries.
      Files: `src/App.tsx`, `src/components/features/sidebar/SecondarySidebar.tsx`, `src/utils/view-labels.ts`, `src/components/dashboard/DashboardHeader.tsx`
      Verify: `npx tsc --noEmit` exit 0; `npx vitest run src/utils/view-labels.test.ts` passes.

- [ ] 14. `src/hooks/useCrossplaneQuery.ts` (B.11: fetcherRef, string key, memoised settings promise, `resolveIntervalMs`, visibility skip + `shouldFetchOnVisible`, request-id stale guard, cleanup, `enabled`, keep data on error). View scaffolding under `src/components/dashboard/views/crossplane/`: `crossplane-columns.ts` (`col<R>()`, `healthColumn()` using `createElement(CrossplaneHealthBadge, { health, reason })` per AM-4), `CrossplaneHealthBadge.tsx`, `CrossplaneEmptyState.tsx` (Retry → `detect(cluster,{force:true})`), `CrossplaneSectionErrors.tsx`, `CrossplaneView.tsx` (detection gate, header with version badge, Updated TimeAgo, Refresh, sub-view switch, sessionStorage tab keys `lumen.crossplane.<subView>.tab`). `DashboardContent.tsx` (re-read; additive): `'crossplane'` in `ResourceType`, route `activeView.startsWith('crossplane-')` → `CrossplaneView`.
      Files: listed above
      Verify: `npx tsc --noEmit` exit 0; `npx eslint --max-warnings 0` on the new files → 0.

- [ ] 15. Views: `CrossplaneOverview.tsx` (B.4.1 incl. AM-4 "+N more unhealthy managed resources" footer → Managed "All unhealthy", Warning-event click only when `isValidCrossplaneRef(toCrossplaneRef(involvedObject))`, Operations chip, scan progress via `onScanProgress` filtered by context with cleanup), `CrossplanePackagesView.tsx` (B.4.2 six tabs), `CrossplaneDefinitionsView.tsx` (B.4.3; `composites` query with `minIntervalMs: 120_000` per AM-5), `CrossplaneCompositesView.tsx` (B.4.4 incl. kind filter, hidden tabs, Operations inner toggle), `CrossplaneManagedView.tsx` + `CrossplaneKindTree.tsx` (B.4.5, `Virtuoso` list, "All unhealthy"/"Unattributed", inactive kinds greyed, truncation banner; accepts a sessionStorage selection `lumen.crossplane.managed.selection = 'unhealthy'`). All tables via `GenericResourceView` with module-level `col<R>()` column constants; health column `dataKey: 'healthOrder'`; NO column uses `dataKey: 'status'` or `'replicas'` (AM-6); count columns are numeric fields. Row click → `onResourceClick(row, 'crossplane')`.
      Files: the six view files (each < 500)
      Verify: `npx tsc --noEmit` exit 0; `npx eslint --max-warnings 0 src/components/dashboard/views/crossplane src/hooks/useCrossplaneQuery.ts` → 0; `npx vite build` succeeds.

### FEAT-004 — Drawer, relationship graph, licence (B.7 renderer, B.9 drawer, AM-1 null category, AM-2 sections, B.1)

- [ ] 16. `src/components/Dashboard.tsx` (re-read; additive, B.9 row): `'crossplane'` in the `handleResourceClick` type union; `crossplaneDrawerSeq` ref; `const drawerSeq = ++crossplaneDrawerSeq.current;` at top; early-return Crossplane branch after `setDrawerTab('details')` using `toCrossplaneRef`; Delete hidden for `'crossplane'`; `onOpenCrossplaneResource` passed to `DrawerDetailsRenderer`; ErrorBoundary resetKey gains `-${selectedResource?.kind ?? ''}`. `DrawerDetailsRenderer.tsx` — optional `onOpenCrossplaneResource` prop and `case 'crossplane'`.
      Files: `src/components/Dashboard.tsx`, `src/components/dashboard/DrawerDetailsRenderer.tsx`
      Verify: `npx tsc --noEmit` exit 0.

- [ ] 17. `src/components/resources/details/CrossplaneResourceDetails.tsx` (category = `classifyCrossplaneObject(object, defs) ?? refHint.category ?? null`; `null` → generic sections only via `deriveHealth('generic')`; banner, conditions table, extras lookup by `crossplaneKey` via `useCrossplaneQuery` autoRefresh false, skeleton/"Not in the current snapshot"/inline error, Details | Relationships toggle for claim/composite/managed, disabled when ref fields missing). `CrossplaneDetailSections.tsx` renders the AM-2 table per category from `resolveDrawerRefs` (links → `onOpenResource(ref)`, text-only refs `font-mono`). Visualisers: `CrossplaneTreeGraph.tsx` (`@xyflow/react`, memoised `nodeTypes`, `h-[500px]`, truncation banner, warnings note, red Retry card on root failure), `CrossplaneGraphNode.tsx`, `CrossplaneTreeList.tsx` (`role="tree"`, `aria-level`, keyboard nav). No Delete button anywhere.
      Files: listed above (each < 500)
      Verify: `npx tsc --noEmit` exit 0; `npx eslint --max-warnings 0` on these files → 0.

- [ ] 18. Licence (B.1): fetch crossview `LICENSE` at commit `84436218ccdcacc27d41fac63b3bb77fe232c9af` (`https://raw.githubusercontent.com/crossplane-contrib/crossview/84436218ccdcacc27d41fac63b3bb77fe232c9af/LICENSE`) and write it verbatim to `public/licenses/crossview-LICENSE.txt`. Confirm the attribution header is present in `src/utils/crossplane-utils.ts`, `src/utils/crossplane-summaries.ts`, `src/utils/crossplane-drawer-refs.ts`, `electron/crossplane-discovery.ts`.
      Files: `public/licenses/crossview-LICENSE.txt`
      Verify: `npx vite build` succeeds and `ls dist/licenses/crossview-LICENSE.txt` exists.

### Integration (convergence loop, iteration 1)

- [ ] 19. Full matrix: `npx tsc --noEmit` exit 0; `npx vitest run` all pass (≥ 311 + new); `npx eslint --max-warnings 0 <all new files>` 0 problems; `npm run lint` total ≤ 1608; `npx vite build` succeeds with `dist/licenses/crossview-LICENSE.txt`; `wc -l` every new file < 500; `git status --short` shows the user's original modified/untracked set intact plus only this feature's additions; `git diff` of each pre-modified user file shows the user's hunks untouched. Manual ACs (1–25, needs live clusters with Crossplane v1.20/v2.x) cannot be executed in this environment — record them as not verified.

## Test matrix summary

| Area | File | Key cases |
|---|---|---|
| Health/refs/classify | `src/utils/crossplane-utils.test.ts` | B.14 list + AM-1 (packageRevision v2/v1/Inactive, MRD → null, revision NeedsAttention row → refRequestSchema) |
| Drawer refs | `src/utils/crossplane-drawer-refs.test.ts` | every AM-2 row, Secret/invalid → text, all refs parse |
| Summaries | `src/utils/crossplane-summaries.test.ts` | Claim, v1 XR `spec.resourceRefs`, v2 namespaced XR `spec.crossplane.resourceRefs`, MRs Synced/Ready, package revisions, malformed |
| Graph | `src/utils/crossplane-graph.test.ts` | positions, ordering, >50 collapse, focus, edge colours, notFetched |
| Query utils | `src/utils/crossplane-query-utils.test.ts` | interval floor, visibility |
| Sorting | `src/hooks/useResourceSorting.test.ts` | numeric, healthOrder, special keys unchanged |
| Service | `electron/crossplane*.test.ts` | B.14 electron list + AM-3 |
