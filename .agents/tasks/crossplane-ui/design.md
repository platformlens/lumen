# Crossplane UI for Lumen: Requirements and Technical Design

Status: Draft v3. Revised after the second design review (`design-review.md`, CHANGES_REQUESTED, 0 HIGH / 2 MEDIUM / 6 NIT); all 8 findings addressed. Draft v2 had addressed the 22 findings of the first review. Both response tables are at the end.
Scope: a read-only Crossplane section inside Lumen's cluster dashboard, covering Crossplane v1.14+ and v2.x.

---

## Part A: Requirements

### A.1 Summary

Lumen gets a "Crossplane" sidebar group that shows up only when the connected cluster serves the Crossplane API groups. It has five sub-views: Overview, Packages, Definitions, Composites (including v2 Operations when served) and Managed Resources. Every Crossplane object opens in Lumen's existing drawer, which shows a health banner, all conditions, kind-specific references, events, the existing YAML view/edit flow, and a relationship graph (Claim → XR → composed resources, including nested XRs). Managed-resource (MR) kinds are discovered dynamically from provider package revisions. Discovery never downloads CRD bodies, and results are cached in the main process with TTLs. The feature adds no new mutating operations.

### A.2 Functional requirements

FR-1 Detection. On cluster connect, Lumen decides "installed" from one `/apis` discovery call. Version and feature resolution add a bounded set of cached calls only when installed (group-resource calls for each served version of the four Crossplane core groups, typically 8, plus one or two Deployment LISTs; B.5 "Detection"). "Installed" means both `apiextensions.crossplane.io` and `pkg.crossplane.io` are served. The sidebar group renders only when installed. A Crossplane view opened on a cluster without Crossplane (for example a restored tab) shows a "Crossplane not detected" empty state with a Retry button.

FR-2 Version awareness. Detection reports the Crossplane major version, the exact version when the core Deployment is readable, whether the core pod is running, and feature flags: claims, namespaced XRs, MRDs, protection Usages, legacy Usages, EnvironmentConfigs, DeploymentRuntimeConfigs and Operations (alpha). Versions for core kinds are resolved from discovery, never hard-coded.

FR-3 Overview. Shows health count cards for Providers, Functions, Configurations, XRDs, Composite Resources, Claims (only when any XRD offers claims) and Managed Resources. Also shows a "Needs attention" table of every unhealthy object across all categories with reason and message, a provider health list with MR counts, the 20 most recent Warning events whose involved object belongs to a Crossplane, provider (MR/ProviderConfig), XR or claim API group (algorithm in B.5 "Warning events"), and a core-not-running banner. The MR count streams in through a background scan with a progress indicator.

FR-4 Packages. Tabs: Providers, Functions, Configurations, Provider Configs, Runtime Configs (DeploymentRuntimeConfig), and Activation Policies (MRAP, only when MRDs are served). Package rows show the package image, Installed, Healthy, current revision and revision health (v2 `RevisionHealthy`/`RuntimeHealthy`, v1 `Healthy`). Provider rows also show the count of CRDs/MRDs they install, Function rows show how many Compositions reference them, and Configuration rows show dependencies found/installed.

FR-5 Definitions. Tabs: XRDs, Compositions, Environment Configs. XRD rows show XR kind, group, referenceable version, scope (Namespaced/Cluster/LegacyCluster), claim kind, Established, Offered, composition count and instance count. Composition rows show composite type, mode, pipeline steps with function names, revision count and the number of XRs using it.

FR-6 Composites. Tabs: Composite Resources, Claims (hidden when no XRD has `claimNames`), Usages (hidden when no Usage API is served), Operations (hidden unless `ops.crossplane.io` is served). Includes a kind filter for the XR and Claims tabs. XR rows show Synced, Ready, composition, composed count, claim and namespace (v2). The Operations tab lists Operations, CronOperations and WatchOperations read-only (B.4.4).

FR-7 Managed Resources. A left pane holds a Provider → kind tree with per-kind counts and health, with inactive kinds (MRD inactive or not served) greyed. The right pane is a virtualised table for the selected kind: Synced, Ready, external-name, provider config, owning composite, claim and age. There is also an "All unhealthy" pseudo-entry.

FR-8 Drawer. For any Crossplane object the drawer shows:
- a health banner with the deciding condition's reason and message
- a conditions table
- category-specific sections with clickable references that navigate within the drawer
- the existing events section (`ResourceEvents`)
- the existing Edit YAML button
- a Relationships toggle (Graph | List) for claims, XRs and MRs

There is no Delete button for Crossplane objects.

FR-9 Relationship tree. Built from the selected object: walk up to the top-most owner (MR → XR → … → Claim), then walk down through `spec.resourceRef`, `spec.resourceRefs` and `spec.crossplane.resourceRefs`, recursing into nested XRs. Nodes are coloured by health. Missing, forbidden and not-fetched objects are rendered explicitly. Size is bounded, with a visible truncation notice.

FR-10 Filtering and sorting. The dashboard search box filters by name/namespace. The namespace selector filters namespaced rows and keeps cluster-scoped ones. Every table is sortable through `useResourceSorting`, by way of `GenericResourceView`. Count columns sort numerically and the Health column sorts by severity (B.4 "Column conventions").

FR-11 Refresh. A manual Refresh button forces a refetch (bypasses main caches). The visible sub-view auto-refreshes every `max(settings.refreshInterval, 15)` seconds without forcing, so main-process TTLs decide whether the cluster is hit. The full MR scan auto-refreshes at most every 5 minutes. Auto-refresh pauses while the window is hidden and stops on unmount (B.11).

FR-12 Licence compliance. Logic adapted from crossview carries attribution comments, and the Apache-2.0 licence text ships with the app (see B.1).

### A.3 Non-functional requirements

NFR-1 Performance. Request-cost formulas use `pages(n) = max(1, min(10, ceil(n / 500)))`: an empty or not-served kind still costs one LIST, and the 5000-item cap stops at 10 pages. Retries (401 rebuild, 410 restart) are not counted.
- MR discovery (`getManagedKinds`, after detection has cached `/apis` and the core group resources): `P + V` requests. `P = pages(n_providerRevisions)` (1 in practice). V is the sum, over every distinct group named by an active ProviderRevision's `objectRefs` (MR groups and ProviderConfig groups alike) that `/apis` serves, of the number of served versions of that group whose resources are not already cached. Named groups that are not served cost 0. There is no full CRD list.
- MR scan: `Σ over active kinds of pages(n_k)`. Paged at 500, capped at 5000 per kind.
- Snapshot fetchers: `S = Σ over listed sections of pages(n_section)`. `getPackages` adds the uncached ProviderConfig group-version discovery calls (usually 1–4 per provider family, B.5). `getComposites` adds a `getDefinitions` snapshot when that is not cached.
- Warning events: at most 10 pages (5000 events scanned).

Concurrency per context: ≤ 6 per snapshot fetch, ≤ 8 for kind-index discovery, ≤ 6 shared by the MR scan and `getManagedItems`, and 1 for events (pages are sequential). `getComposites` waits for `getDefinitions`, so at most two snapshot fetches overlap. The Overview's peak is therefore ≤ 12 + 8 + 1 = 21 while the kind index is being discovered, and ≤ 12 + 6 + 1 = 19 while the scan lists. A drawer graph loading at the same time adds ≤ 8 tree-child GETs. Snapshots deliberately stay off the MR semaphore (NFR-2). All tables with more than 100 rows are virtualised. IPC payloads carry flattened summaries, not raw objects. The only exceptions are the drawer object and the per-kind items requested explicitly.

NFR-2 Responsiveness. Overview cards for packages, definitions and composites render before the MR scan completes. No synchronous work in main exceeds one page's summarisation.

NFR-3 Isolation. Crossplane calls never mutate `K8sService`'s shared `KubeConfig` current context. Each context gets an isolated `KubeConfig`, so a long scan cannot hit the wrong cluster after a cluster switch.

NFR-4 Security. All IPC is read-only and validated with zod. `crossplane:getResource` and the tree walker never fetch core `Secret`s. `managedFields` and `last-applied-configuration` are stripped from drawer payloads. Error messages are sanitised.

NFR-5 Code quality. Strict TS with no `any` in new code: external data is `unknown` and narrowed with guards. `IColumn.cellRenderer` is typed `(cellData: any, rowData: any)` (`VirtualizedTable.tsx:108`), so every Crossplane column is built with the typed `col<R>()` helper (B.4 "Column conventions") and no renderer parameter is inferred as `any`. Every new file stays under 500 lines. Pure logic lives in `src/utils`. The Tailwind glassmorphism theme follows `.kiro/steering/theme.md`.

NFR-6 Compatibility. Crossplane v1.14+ and v2.x. API facts were last checked against `crossplane/crossplane` `apis/` at `main` @ `58ad722` (A13). Older versions are best effort.

### A.4 Acceptance criteria

1. On a cluster that serves `apiextensions.crossplane.io` and `pkg.crossplane.io`, the sidebar shows a "Crossplane" group with Overview, Packages, Definitions, Composites and Managed Resources after connect. On a cluster without them the group is absent, and switching from a Crossplane cluster to a non-Crossplane cluster removes it.
2. Opening any `crossplane-*` view on a cluster without Crossplane renders the "Crossplane not detected" empty state with a working Retry. No uncaught errors appear.
3. Overview cards show total, healthy, progressing and unhealthy counts per category. These counts match `kubectl get <kind> -A` plus the condition rules in B.6 on the test clusters (v1.20 with claims; v2.x with namespaced XRs).
4. Every object with health `unhealthy` (including progressing objects stuck for more than 15 minutes) appears in "Needs attention" with reason and message. Clicking a row opens the drawer for that object.
5. During the MR scan the Overview shows "Scanning managed resources x / y kinds" and stays interactive. When the scan completes, the MR card and provider MR counts update.
6. Packages → Providers shows, per provider: package, Installed, Healthy, current revision, revision health (v2: RevisionHealthy and RuntimeHealthy; v1: Healthy) and installed CRD/MRD count.
7. Packages → Functions shows the number of Compositions whose `spec.pipeline[].functionRef.name` equals the function name.
8. Definitions → XRDs shows scope (`spec.scope` when present; otherwise `Namespaced` if the XRD was read at `apiextensions.crossplane.io/v2`, else `LegacyCluster`), claim kind or "—", Established, Offered, composition count and instance count. Compositions shows mode, step count with function names, and revision count.
9. Composites lists XRs of every XRD-defined kind, including namespaced v2 XRs with their namespace. The kind filter narrows the list. The Claims tab is hidden when no XRD has `claimNames`, the Usages tab is hidden when no Usage API is served, and the Operations tab is hidden unless `ops.crossplane.io` is served. When shown, Operations lists Operation, CronOperation and WatchOperation objects with the columns in B.4.4, and a failed Operation (`Succeeded=False`) appears in Needs attention.
10. Managed Resources groups kinds by provider with counts, greys inactive kinds, and lists instances of a selected kind in a virtualised table with Synced, Ready, external-name, provider config and owning composite.
11. The drawer for any Crossplane row shows the health banner, every condition, the category sections and the Events section. Edit YAML opens the existing YAML panel. No Delete button is present.
12. Relationships for a Claim, XR or MR renders the full tree (Claim → XR → composed, nested XRs included) with health colouring. Clicking a node loads that object in the drawer. Trees over 300 nodes show a truncation notice. Dangling refs render as "missing".
13. AC 3 to 12 hold on both Crossplane v1.x (claims, `spec.resourceRefs`) and v2.x (`spec.crossplane.resourceRefs`, namespaced XRs, `*.m.*` namespaced MRs, inactive MRDs).
14. Precondition: Lumen was freshly started, connected to a cluster with ≥200 MR kinds (at least one of them empty), detection completed less than 60 seconds ago (so the detection result, `/apis`, the Crossplane core group resources and `kindVersions` are all cached and `CrossplaneView`'s own `detect` call is a cache hit), and no other Crossplane call has run for that context. Opening Managed Resources directly then triggers a cold `getManagedKinds` plus a full MR scan. With the debug request counter enabled (`crossplane` log lines, B.12), these issue exactly `P + V + Σ_k pages(n_k)` requests, summed over active kinds, with `pages`, `P` and `V` as defined in NFR-1 and 401 retries and 410 restarts excluded. The kind index must report `source: 'providerRevisions'`. The counter sees every HTTP request, including client-internal discovery (B.9 `crossplane-api.ts`). None of them target `/apis/apiextensions.k8s.io/v1/customresourcedefinitions` unless the fallback path is reported. A kind served only at a non-preferred version of its group (e.g. a `v1beta1`-only kind in a group whose preferred version is `v1beta2`) is active and scanned.
15. Re-opening any Crossplane view within 15 s issues no new API calls (main cache hit, visible in the debug log). Refresh forces new calls.
16. If listing a section is forbidden (403), the other sections render and a yellow warning card names the forbidden section.
17. Each `crossplane:*` channel rejects malformed input with `IPC validation failed: <channel> — …` and logs an audit entry in category SECURITY.
18. `crossplane:getResource` with `{apiVersion:'v1', kind:'Secret'}` rejects with "Secrets are not fetched by the Crossplane view". Tree nodes for Secrets render as "not fetched".
19. `npx vitest run`, `npm run lint` (0 warnings) and `npx tsc --noEmit` pass. No new or modified-by-this-feature file exceeds 500 lines, except the pre-existing large files (`electron/k8s.ts`, `electron/main.ts`, `electron/preload.ts` (521 lines in the working tree), `Dashboard.tsx`, `DashboardContent.tsx`, `SecondarySidebar.tsx`, `App.tsx`), which receive additive edits only.
20. With a view open, its non-scan queries re-run at the configured interval (min 15 s) with `force=false`, so a tick within a main TTL issues no API calls. The full MR scan re-runs at most every 5 minutes. Only the Refresh button sends `force=true`. There are no calls while the window is hidden and none after navigating away.
21. Files with crossview-derived logic carry the attribution header, and `public/licenses/crossview-LICENSE.txt` exists and ends up in `dist/`.
22. Sorting any count column (CRDs, Used by, Compositions, Instances, Composed, Revisions, Steps, Keys, Users, Activated) orders 9 before 10 ascending. Sorting the Health column orders unhealthy → progressing → paused → unknown → healthy → none ascending.
23. Switching cluster A → B while A's detection is still in flight never shows the Crossplane group on B unless B's own detection says installed.
24. Navigating inside the drawer (graph node or reference click) to a Provider, Function, Configuration, Runtime Config or XRD shows the same category sections (revisions, used-by, installed definitions) as opening that object from its list row.
25. The Overview warning list shows Crossplane-related Warning events even when the cluster has more than 50 unrelated (pod/node) Warning events, newest first by `eventTime ?? lastTimestamp ?? firstTimestamp`.

### A.5 Out of scope (v1)

- Create, delete or patch actions, pause/resume annotations, and package install/upgrade/activation. The existing YAML edit flow is retained and governed by Safe Mode.
- Operations beyond read-only listing: no Operation trigger, CronOperation suspend, operation history graph or `status.pipeline` output rendering. The read-only Operations tab is in scope (FR-6).
- ImageConfigs, the package `Lock` dependency graph, and ManagedResourceDefinition list/detail pages. MRD state is reflected through active/inactive kinds instead.
- Watch-based live updates (see B.9 for the reasoning), global cross-kind search, and an AI prompt specialised for Crossplane.
- Rendering Composition function `input` beyond apiVersion/kind, connection secret contents, cloud-console links and multi-cluster aggregation.

### A.6 Assumptions

- A1 Supported range is Crossplane v1.14+ and v2.x. Kind versions are discovery-driven, so v1beta1 → v1 moves (Functions, EnvironmentConfigs, Usages) are handled automatically.
- A2 ManagedResourceDefinition names follow CRD naming, `<plural>.<group>`. The establisher copies CRD specs from the package (`internal/controller/pkg/revision/establisher.go`).
- A3 (verified) The official chart labels the core Deployment `app: {{ template "crossplane.name" . }}` (`cluster/charts/crossplane/templates/deployment.yaml`), which resolves to `crossplane` unless `nameOverride` is set. The chart's common labels also add `app.kubernetes.io/name: crossplane` to both the core and the rbac-manager Deployments (`_helpers.tpl`, `rbac-manager-deployment.yaml`). Detection tries `app=crossplane` first, then `app.kubernetes.io/name=crossplane` (B.5). With a custom `nameOverride` and no match on either, `coreRunning` is `false` and only a soft warning is shown.
- A4 Composed resources carry a controller ownerReference to their XR in both v1 and v2.
- A5 A `resourceRefs` entry without a namespace is cluster-scoped, unless discovery says the kind is namespaced, in which case it inherits the parent XR's namespace. The idea is adapted from crossview `useResourceData.js`, made deterministic via discovery.
- A6 The user's RBAC can list Crossplane core kinds. Anything forbidden degrades to a per-section warning.
- A7 "Read-only for v1" means no new mutating IPC channel. Editing YAML through the existing panel is allowed (`k8s:updateResourceYaml` is classified MUTATE and blocked in Safe Mode).
- A8 Interval refresh (≥15 s) is acceptable instead of watches.
- A9 The cap of 5000 items per kind and 300 tree nodes is acceptable. Truncation is always surfaced.
- A10 Claims are deprecated in v2 but still shown when any XRD offers them.
- A11 Shared cross-process types go in `src/types/crossplane.ts`. This departs from the "inline types" convention, but has precedent in `src/types/pod-worker.ts` and `src/lib/helm-catalog-types.ts`, because main, preload and renderer need one definition.
- A12 `KubernetesObjectApi.read()` from `@kubernetes/client-node` 1.4.0 handles core-group (`apiVersion: v1`) single-object GETs. It does its own `/api/v1` discovery internally, which is acceptable because the counting middleware (B.9) sees it. Grouped kinds use `CustomObjectsApi` with the plural from the group-resources cache, so they cost no hidden discovery. `createConfiguration`, `ServerConfiguration`, `KubernetesObjectApi` and `CustomObjectsApi` are all exported from the package root (checked with `node -e` in this repo).
- A13 API facts re-checked in revision 2 against `crossplane/crossplane` `apis/` at `main` @ `58ad722`: pkg conditions `Installed`, `Healthy`, `RevisionHealthy`, `RuntimeHealthy`, `RuntimeActive` (`apis/pkg/v1/conditions.go`); XRD v1 `scope` default `LegacyCluster`, v2 `scope` enum `Namespaced;Cluster` default `Namespaced` (`apis/apiextensions/v{1,2}/xrd_types.go`); MRD and MRAP cluster-scoped in `apiextensions.crossplane.io/v1alpha1`; `protection.crossplane.io/v1beta1` `Usage` (namespaced) and `ClusterUsage` (cluster); legacy `apiextensions.crossplane.io/v1beta1` `Usage` (cluster); `ops.crossplane.io/v1alpha1` `Operation`, `CronOperation`, `WatchOperation`, all cluster-scoped, with condition types `Succeeded`, `ValidPipeline`, `Synced`, `Scheduling` (CronOperation) and `Watching` (WatchOperation), reasons `PipelineRunning`/`PipelineSuccess`/`PipelineError`, `ScheduleActive`/`ScheduleInvalid`/`SchedulePaused`, `WatchActive`/`WatchFailed`/`WatchPaused`. The XR `spec.crossplane.*` layout is generated outside `apis/` (not re-checked in source); it matches the Crossplane v2 docs and crossview's dual-field handling, and the implementation reads both layouts anyway. Crossview was also re-checked: `84436218ccdcacc27d41fac63b3bb77fe232c9af` is the current HEAD, `LICENSE` and `crossview-go-server/LICENSE` are Apache-2.0, there is no `NOTICE`, and the cited files exist (`crossview-go-server/services/kubernetes_managed.go`, `src/presentation/hooks/useResourceData.js`, `src/presentation/utils/resourceStatus.js`, `src/domain/usecases/GetFunctionsUseCase.js`, `src/presentation/components/common/ResourceRelations.jsx`). The Helm labels (A3) were verified in revision 3 against the chart templates on `main`.

---

## Part B: Technical design

### Overview

The feature is a vertical slice that follows Lumen's existing patterns:
- A main-process `CrossplaneService` (`electron/crossplane.ts` plus helpers) does all Kubernetes I/O through an isolated per-context `KubeConfig`, caches results per context with TTLs, and returns flattened summaries.
- `registerIpcHandlers()` in `electron/main.ts` exposes ten read-only `crossplane:*` channels via `safeHandle` + zod, and preload bridges them under `window.k8s.crossplane`.
- Pure logic shared by main and renderer lives in `src/utils/crossplane-utils.ts` (conditions, health, refs, summarisers, discovery parsing) and `src/utils/crossplane-graph.ts` (tree → React Flow layout).
- `App.tsx` gains `hasCrossplane` detection like Karpenter and cert-manager, and `SecondarySidebar` renders a Crossplane group.
- `DashboardContent` routes the five `crossplane-*` view IDs to `CrossplaneView`. Rows open in the existing `Drawer` through a new resource type `'crossplane'`, rendered by `CrossplaneResourceDetails` from `DrawerDetailsRenderer`.

Locked stack: Electron 42 / Node, TypeScript 5 strict, React 18, Tailwind, `@kubernetes/client-node` 1.4.0 (`ApisApi`, `CustomObjectsApi`, `KubernetesObjectApi`, `CoreV1Api`, `AppsV1Api`), zod 3 (existing `safeHandle`), `react-virtuoso` (through `GenericResourceView`, and `Virtuoso` for the kind tree), `@xyflow/react` 12, `lucide-react`, `framer-motion` (existing usage only), and vitest 4. No new dependencies.

### B.1 Licence check and reuse decision

`crossplane-contrib/crossview` was cloned at commit `84436218ccdcacc27d41fac63b3bb77fe232c9af`. Its `LICENSE` is Apache License 2.0, and `crossview-go-server/LICENSE` is also Apache-2.0. There is no `NOTICE` file. Lumen is BSD-3-Clause. Apache-2.0 code may be incorporated into a BSD-licensed work provided §4 is honoured: ship a copy of the licence, mark modified files, and keep attributions.

Decision: re-implement in TypeScript, adapting specific crossview logic, with attribution. Crossview is JavaScript with Chakra UI plus a Go server, so no file can be dropped in as-is. What we adapt:
- the ProviderRevision → CRD ownership mapping, used only as the fallback in B.5 (`kubernetes_managed.go`)
- `spec.crossplane.*` / `spec.*` dual-field reference extraction and the namespace-inheritance idea (`useResourceData.js`)
- the per-kind condition rules as a starting point (`resourceStatus.js`, extended in B.6)
- the "function used in compositions" join (`GetFunctionsUseCase.js`)

Compliance actions:
1. Every file containing adapted logic gets this header:
   ```ts
   // Portions adapted from crossplane-contrib/crossview (Apache-2.0),
   // https://github.com/crossplane-contrib/crossview @ 8443621. Modified for Lumen.
   ```
   That applies to `src/utils/crossplane-utils.ts`, `src/utils/crossplane-summaries.ts` and `electron/crossplane-discovery.ts`.
2. Copy crossview's `LICENSE` verbatim to `public/licenses/crossview-LICENSE.txt`. Vite copies `public/` into `dist/`, which electron-builder already packages (`"files": ["dist", …]`), so no builder config change is needed.

### B.2 What crossview does, and what Lumen takes or improves

Crossview pages are: Dashboard (widgets for counts, provider status, resource health, namespace distribution, recent activity), Providers, Functions (with "used in compositions"), XRDs, Compositions, MRDs, MRAPs, Composite Resources (with per-kind sub-pages), Claims, Managed Resources, global Search, and resource details with tabs (Overview, Relations graph, Events, YAML).

Discovery: XR and claim kinds come from XRD `spec.names` and `spec.claimNames`. MR kinds come from listing all CRDs and keeping those whose ownerReferences point to a Provider or ProviderRevision (`kubernetes_managed.go`), then listing every such kind with a 10-way semaphore, 1000 per page and a 5000 cap, cached server-side.

Relations: crossview's graph is a single-hop radial graph of refs extracted from one object (`ResourceRelations.jsx`). It hydrates statuses by listing all instances of each related type.

Health: condition rules per kind (`resourceStatus.js`).

| Topic | Crossview | Lumen decision |
|---|---|---|
| MR kind discovery | Lists all CRDs with full bodies (provider-aws families are hundreds of MB of schemas) | Uses `ProviderRevision.status.objectRefs`, which needs no CRD bodies. The fallback is a metadata-only CRD list (B.5). |
| XR version | `spec.versions[0]` | The version with `referenceable: true`, which is what Crossplane itself uses |
| Revision health | `Healthy` only | v2 `RevisionHealthy` + `RuntimeHealthy`, falling back to v1 `Healthy` |
| MRD/MRAP group | Server probes `pkg.crossplane.io` | `apiextensions.crossplane.io/v1alpha1`, verified in `apis/apiextensions/v1alpha1/mrd_types.go`; versions come from discovery |
| Relations | One hop, radial, hydration by listing whole types | Multi-level tree, bounded GETs of the referenced objects only |
| Auth, SSO, Postgres, contexts | Server features | Not applicable. Lumen uses kubeconfig and has its own context handling |
| Global search | Yes | Backlog |

### B.3 Crossplane concept coverage (v1 vs v2)

All facts below were last checked against `crossplane/crossplane` `apis/` at `main` @ `58ad722` (A13). "Generic" in the health column means the generic rule in B.6 rule 4. Version strings are resolved at runtime from discovery (B.5), and the table only names the known served versions.

| Concept | Group / known versions | Shown in | Health conditions |
|---|---|---|---|
| Provider, Function, Configuration | `pkg.crossplane.io/v1` (Function was v1beta1 before 1.16) | Packages tabs | `Installed`, `Healthy` |
| *Revisions | `pkg.crossplane.io/v1`, `spec.desiredState` Active/Inactive, `status.objectRefs`, label `pkg.crossplane.io/package` | Package drawer revisions table | v2 `RevisionHealthy`, `RuntimeHealthy`, `RuntimeActive`; v1 `Healthy` |
| ProviderConfig / ClusterProviderConfig (v2) / ProviderConfigUsage | Provider groups (e.g. `aws.upbound.io`, `aws.m.upbound.io`) | Packages → Provider Configs, users = `status.users` | none |
| DeploymentRuntimeConfig | `pkg.crossplane.io/v1beta1` | Packages → Runtime Configs, "used by" = packages whose `spec.runtimeConfigRef.name` matches | none |
| ManagedResourceDefinition / MRAP (v2) | `apiextensions.crossplane.io/v1alpha1` | MRD state shown as active/inactive kinds; MRAP tab | MRD `Established`, `Healthy` (display only; MRDs are not listed); MRAP generic |
| XRD | `apiextensions.crossplane.io/v1` (storage) and `v2`; `scope` Namespaced/Cluster/LegacyCluster (v1 default LegacyCluster; v2 enum is Namespaced/Cluster, default Namespaced). The API server applies the default, so a missing `scope` only happens with unusual objects; the fallback rule is in B.6 `summarizeXrd`. `claimNames` only for LegacyCluster | Definitions → XRDs | `Established`, `Offered` (only when claims offered) |
| Composition | `apiextensions.crossplane.io/v1`; `spec.mode` (Pipeline; v1.x may also have `Resources`), `spec.pipeline[].{step,functionRef.name,input,credentials}`, `spec.compositeTypeRef` | Definitions → Compositions, drawer pipeline table | none (`ValidPipeline` is rendered if present) |
| CompositionRevision | `apiextensions.crossplane.io/v1`, `spec.revision`, label `crossplane.io/composition-name` | Composition drawer revisions list and count | generic (B.6 rule 4) |
| XR | XRD-defined; v1/LegacyCluster uses `spec.resourceRefs`, `spec.compositionRef`, `spec.compositionRevisionRef`, `spec.claimRef`, `spec.writeConnectionSecretToRef`; v2 Namespaced/Cluster uses `spec.crossplane.{resourceRefs,compositionRef,compositionRevisionRef,compositionUpdatePolicy}` | Composites → Composite Resources | `Synced`, `Ready`, `Responsive` (rendered) |
| Claim | XRD `claimNames`, namespaced, `spec.resourceRef` → XR; XR has labels `crossplane.io/claim-name`/`-namespace` | Composites → Claims | `Synced`, `Ready` |
| MR | Provider CRDs/MRDs; v2 namespaced `*.m.*` groups; `spec.providerConfigRef{name,kind?}`, `spec.managementPolicies`, `spec.deletionPolicy`, annotation `crossplane.io/external-name`, label `crossplane.io/composite` | Managed Resources | `Synced`, `Ready`, plus upjet `LastAsyncOperation`/`AsyncOperation` (rendered) |
| EnvironmentConfig | `apiextensions.crossplane.io/v1beta1` (storage) | Definitions → Environment Configs | none |
| Usage | Legacy `apiextensions.crossplane.io/v1beta1` Usage (cluster); v2 `protection.crossplane.io/v1beta1` Usage (namespaced) and ClusterUsage; `spec.of`, `spec.by`, `spec.reason`, `spec.replayDeletion` | Composites → Usages | generic (in practice `Ready`) |
| Operation / CronOperation / WatchOperation (v2, alpha) | `ops.crossplane.io/v1alpha1`, all cluster-scoped. Operation `spec.mode`, `spec.pipeline[]`, `status.pipeline[]`; CronOperation `spec.schedule`, `status.lastScheduleTime`, `status.lastSuccessfulTime`, `status.runningOperationRefs`; WatchOperation `spec.watch.{apiVersion,kind,namespace?,matchLabels?}`, `status.watchingResources`, `status.lastScheduleTime`, `status.lastSuccessfulTime` | Composites → Operations (when `features.operations`), plus Needs attention | Operation `Succeeded` (`Unknown`/`PipelineRunning` = running); CronOperation `Synced` + `Scheduling`; WatchOperation `Synced` + `Watching` |
| Events | core `v1` Events with `involvedObject.uid` | Drawer (`ResourceEvents`), Overview warnings | — |

### B.4 Sub-views and why each exists

Navigation uses five view IDs, rendered as a `MenuGroup` `{ id: 'crossplane', title: 'Crossplane' }` in `SecondarySidebar`. It goes right before Access Control (i.e. after Helm). `STANDARD_MENU` is rebuilt inside the component on every render, and the cert-manager block already mutates it with `splice(1, 0, …)`, so fixed indexes are unreliable. The insertion is placed after the cert-manager block:

```tsx
if (hasCrossplane) {
    const accessIdx = STANDARD_MENU.findIndex(g => g.id === 'access');
    STANDARD_MENU.splice(accessIdx === -1 ? STANDARD_MENU.length : accessIdx, 0, crossplaneGroup);
}
```

`crossplaneGroup` is built inline in the component (it holds JSX icons, like the other groups). The `openGroups` initial state gains `'crossplane': true`.

| View id | Label (sidebar / tab bar) | Icon (lucide) | Justification |
|---|---|---|---|
| `crossplane-overview` | Overview / "Crossplane" | `Gauge` | "Is my control plane healthy, and what's broken?" is the first question. It aggregates all categories plus warnings, so users don't have to visit each list. |
| `crossplane-packages` | Packages / "XP Packages" | `Package` | Provider and function health gates everything downstream. Revisions, runtime configs and provider configs are where install and credential problems surface. |
| `crossplane-definitions` | Definitions / "XP Definitions" | `BookOpen` | Platform engineers author XRDs and Compositions. Seeing Established/Offered, pipelines and usage counts explains why XRs don't reconcile. |
| `crossplane-composites` | Composites / "XP Composites" | `Boxes` | App teams create XRs and claims. Usages are grouped here because they reference runtime objects and explain blocked deletions. v2 Operations are grouped here too: they are runtime objects run by the same function pipelines, and a separate view for an alpha API would be mostly empty. |
| `crossplane-managed` | Managed Resources / "XP Managed" | `Cloud` | MRs are the actual cloud resources, organised by provider. This is the only place to find standalone (non-composed) MRs and per-kind failures. |

Tab-bar labels are added to `src/utils/view-labels.ts`. Header titles are added to `titleMap` in `getViewTitle` (`src/components/dashboard/DashboardHeader.tsx`), because its fallback would otherwise render "Crossplane-overview": `'crossplane-overview': 'Crossplane'`, `'crossplane-packages': 'Crossplane Packages'`, `'crossplane-definitions': 'Crossplane Definitions'`, `'crossplane-composites': 'Crossplane Composites'`, `'crossplane-managed': 'Crossplane Managed Resources'`.

#### Column conventions (all tables)

- Every count column stores a `number` in the row (never a pre-formatted string) and renders text through `cellRenderer` if it needs formatting. This applies to CRDs, Used by (`usedByCount`), Compositions, Instances, Composed, Revisions, Steps (`stepCount`), Keys, Users (`userCount`), Activated, Deps (`depsInstalled`) and Count (WatchOperation).
- Every column is built with a typed helper so no renderer parameter is `any` (NFR-5). `IColumn.cellRenderer` is `(cellData: any, rowData: any)` in `VirtualizedTable.tsx:108`, and that file is not edited. The helper lives in `src/components/dashboard/views/crossplane/crossplane-columns.ts`. It is a `.ts` file on purpose: `.eslintrc.cjs` enables `react-refresh/only-export-components` (warn, and lint runs with 0 warnings allowed), which flags non-component exports from `.tsx` files. `healthColumn` therefore renders with `createElement(CrossplaneHealthBadge, { … })` instead of JSX.
  ```ts
  import type { ReactNode } from 'react';
  import type { IColumn } from '../../../shared/VirtualizedTable';

  type TypedColumn<R> = Omit<IColumn, 'cellRenderer'> & { cellRenderer?: (value: unknown, row: R) => ReactNode };

  // GenericResourceView renders rows from the `data: R[]` it is given, so the row passed back is an R.
  // This cast is the single trust point; views never annotate renderer params themselves.
  export function col<R>(c: TypedColumn<R>): IColumn {
    const { cellRenderer, ...rest } = c;
    return cellRenderer ? { ...rest, cellRenderer: (v: unknown, r: unknown) => cellRenderer(v, r as R) } : rest;
  }
  ```
  Column arrays are module-level constants such as `const PROVIDER_COLUMNS: IColumn[] = [col<PackageRow>({ … }), …]`, defined in the view files that use them (a `.tsx` component file may hold non-exported constants). Renderers in view files may use JSX. The helper file also exports the shared `healthColumn<R extends CrossplaneRowBase>(dataKey?, healthKey?)` factory used by every table.
- The Health column uses `dataKey: 'healthOrder'` (a `number`, B.6), `sortable: true`, and `cellRenderer: (_, row) => <CrossplaneHealthBadge health={row.health} reason={row.healthReason} />`, with `row` typed through `col<R>`. The Providers "Rev. Health" column does the same with `revisionHealthOrder` / `revisionHealth`.
- `useResourceSorting` gains a generic numeric branch so both of these sort correctly (B.9, file plan). Without it, every non-special key goes through `toString().toLowerCase()` and sorts "10" before "9".
- Timestamp columns other than `age` (Since, Last schedule, Last success) are stored as ISO strings. ISO-8601 UTC strings sort correctly as strings, so no special casing is needed.
- `GenericResourceView` starts unsorted (`sortConfig = null`), so any default ordering is applied before the data is passed in (e.g. `collectNeedsAttention` pre-sorts).

Rejected alternatives:
- One page with everything: too dense with thousands of MRs, and it defeats lazy MR loading.
- A separate Relationships view: the graph only makes sense rooted at an object, so it lives in the drawer.
- Separate MRD pages: MRD state shows up as active/inactive kinds, and listing MRDs downloads full schemas.

#### B.4.1 Overview layout

Top to bottom:
1. Section header with an orange bar, "Crossplane", a version badge (`v2.4.2`, or `v2.x`/`v1.x` when only the major is known), "Updated <TimeAgo>", and a Refresh button.
2. A yellow banner when `coreRunning === false`. An info chip "Operations (alpha)" when `features.operations`. Clicking it opens Composites on its Operations tab (sessionStorage tab mechanism, B.9 `DashboardContent` row).
3. A grid of stat cards (same `cardStyles` as KarpenterView), one per category: total, healthy (green), progressing (yellow), unhealthy (red). Clicking a card calls `onNavigate(viewId)`. The MR card shows the scan progress until the scan completes.
4. "Needs attention": a `GenericResourceView` wrapped in `<div className="h-[400px]">` (the component has no height prop; it renders `h-full min-h-[400px]`). Columns: Health, Kind, Name, Namespace, Reason, Message and Since (`healthSince`). Rows come from `collectNeedsAttention(...)`, which pre-sorts by `healthOrder` ascending, then `healthSince` descending (missing `healthSince` last). Sources: packages, revisions, XRDs, XRs, claims, usages, activation policies, operations, and the MR scan's `unhealthy` list.
5. Two columns. On the left, provider health (name, package tag, health badge, MR count, "Open" link to `crossplane-managed`). On the right, Warning events: the first 20 of `getWarningEvents` (already filtered and sorted newest first in main), using the KarpenterView event-card styling. When `truncatedScan` is true, a muted footnote says "Scanned the newest 5000 Warning events".

#### B.4.2 Packages tabs and columns

Tabs use the shared `ToggleGroup`.

- Providers: Health, Name, Package (mono), Installed, Healthy, Revision, Rev. Health, CRDs, Age.
- Functions: Health, Name, Package, Installed, Healthy, Revision, Used by, Age.
- Configurations: Health, Name, Package, Installed, Healthy, Revision, Deps (found/installed), Age.
- Provider Configs: Provider, Kind, Name, Namespace, Credentials source, Users, Age.
- Runtime Configs: Name, Used by, Age.
- Activation Policies (only when `features.mrds`): Health, Name, Patterns (`spec.activate`, joined), Activated (count), Age.

#### B.4.3 Definitions

- XRDs: Health, Name, XR Kind, Group, Version, Scope, Claim Kind, Established, Offered, Compositions, Instances, Age.
- Compositions: Name, Composite Type, Mode, Steps (count with function names, truncated), Revisions, XRs, Age.
- Environment Configs: Name, Keys, Age.

#### B.4.4 Composites

There is a kind filter `<select>` (All kinds, then each XR/claim kind), styled `bg-white/5 border border-white/10 rounded-lg`.

- Composite Resources: Health, Name, Namespace, Kind, Composition, Synced, Ready, Composed, Claim, Age.
- Claims: Health, Name, Namespace, Kind, XR, Synced, Ready, Connection Secret, Age.
- Usages: Health, Name, Namespace, Of, By, Reason, Age.
- Operations (only when `features.operations`): an inner `ToggleGroup` with Operations | Cron | Watch. The kind filter is hidden on this tab.
  - Operations: Health, Name, Mode, Steps (`stepCount`), Synced, Succeeded, Age.
  - Cron: Health, Name, Schedule (mono), Synced, Scheduling, Running (`runningCount`), Last schedule, Last success, Age.
  - Watch: Health, Name, Watched kind (`spec.watch.kind`, with apiVersion in `title`), Count (`watchingResources`), Synced, Watching, Last schedule, Age.

  The drawer for operations is generic: health banner, conditions, events, YAML, plus a "Pipeline" table from `spec.pipeline[]` (step, function name) for Operations and from `spec.operationTemplate.spec.pipeline[]` for Cron/Watch. There is no Relationships toggle for operations.

#### B.4.5 Managed Resources

- The left pane (w-72, glass panel) holds the provider → kind tree, flattened into a single `Virtuoso` list because there can be up to about 1000 rows. Provider header rows are collapsible and show a health dot and total count. Kind rows show the label (kind if known, else plural), a count or spinner, and red/yellow mini counts. Inactive kinds are `text-gray-600` with "inactive". A "Show empty kinds" toggle defaults off once the summary is complete. Pseudo-entries are "All unhealthy" and "Unattributed" (kinds with no provider mapping, fallback only).
- The right pane is a `GenericResourceView` with columns Health, Name, Namespace, Synced, Ready, External Name (mono), Provider Config, Composite, Claim and Age. A truncation banner appears when `truncated`.
- Default selection is "All unhealthy" if non-empty, else the first kind with count > 0.

### B.5 Detection, discovery and caching (main process)

#### Detection (`crossplane:detect`)

1. `ApisApi.getAPIVersions()` → `/apis`, the group list with `preferredVersion` and `versions`.
2. `installed = groups.has('apiextensions.crossplane.io') && groups.has('pkg.crossplane.io')`.
3. If installed, fetch `getGroupResources` for each served version of the Crossplane core groups `apiextensions.crossplane.io`, `pkg.crossplane.io`, `protection.crossplane.io` and `ops.crossplane.io` (those that are served). That is typically 8 cached calls, at concurrency 8. Build `kindVersions: Record<CoreKind, apiVersion>`. For each kind, prefer the group's `preferredVersion` if it serves the kind, else the highest version by `v2 > v1 > v1beta2 > v1beta1 > v1alpha1` that serves it.
4. Look up the core Deployment, best effort (`findCoreDeployment` in `crossplane-api.ts`, A3):
   - `AppsV1Api.listDeploymentForAllNamespaces({ labelSelector: 'app=crossplane', limit: 5 })`.
   - Only if that returns no items: `listDeploymentForAllNamespaces({ labelSelector: 'app.kubernetes.io/name=crossplane', limit: 5 })`. This selector also matches the rbac-manager, so drop Deployments whose `metadata.labels.app` ends with `-rbac-manager`, then prefer `metadata.name === 'crossplane'`, else the first remaining one.
   - The version is the tag of the container named `crossplane` in `spec.template.spec.containers` (init containers are ignored), else of the first container. `coreRunning = (status.availableReplicas ?? 0) > 0`.
   - No match on either selector → `coreRunning: false`, `version: null`. 403 on the first LIST → `coreRunning: null`, `version: null`, and the second LIST is skipped.
5. `majorVersion` comes from the parsed tag if available, else `2` when `apiextensions.crossplane.io` serves `v2`, else `1`.
6. Features:
   - `namespacedXrs`: `apiextensions.crossplane.io` serves `v2`
   - `mrds`: kind `ManagedResourceDefinition` is served
   - `protectionUsages`: `protection.crossplane.io` serves `Usage`
   - `legacyUsages`: apiextensions serves `Usage`
   - `environmentConfigs`, `deploymentRuntimeConfigs`, `operations`: the corresponding kinds or groups are served

   `claims` is not known at detection time; it comes from the definitions payload.

`App.tsx` runs detection right after the existing Karpenter check (inside the same connect flow, around `App.tsx:816`). A sequence ref guards against a slow detection from the previous cluster landing after a switch:

```ts
const [hasCrossplane, setHasCrossplane] = useState(false);   // next to hasKarpenter
const crossplaneDetectSeq = useRef(0);

// at the start of handleClusterSelect (App.tsx ~line 763), before the getNamespaces pre-flight
// (so a failed connect can't leave the previous cluster's flag behind):
const seq = ++crossplaneDetectSeq.current;
setHasCrossplane(false);

// after the Karpenter check, inside the same try block:
window.k8s.crossplane.detect(clusterName)
    .then(d => { if (seq === crossplaneDetectSeq.current) setHasCrossplane(d.installed); })
    .catch(e => {
        if (seq !== crossplaneDetectSeq.current) return;
        console.warn('Failed to check Crossplane status', e);
        setHasCrossplane(false);
    });
```

The `onBack` handler that clears the selected cluster (`App.tsx` ~line 1675, `setSelectedCluster(null)`) also does `crossplaneDetectSeq.current++; setHasCrossplane(false);`. The existing Karpenter and cert-manager checks have the same race, but they are left untouched (out of scope, and in files with uncommitted user changes). `CrossplaneView` calls the same method (main cache hit) to decide between the empty state and the content, and guards its own result with the `useCrossplaneQuery` request id.

#### MR kind index (`crossplane:getManagedKinds`)

1. List ProviderRevisions (`kindVersions.ProviderRevision`) and keep `spec.desiredState === 'Active'`. Map each revision to its provider via label `pkg.crossplane.io/package`, falling back to an ownerReference of kind `Provider`.
2. For each `status.objectRefs[]` entry with kind `CustomResourceDefinition` or `ManagedResourceDefinition`, parse `name` as `<plural>.<group>`: split at the first `.`, and reject entries that don't match `/^[a-z0-9-]+\.[a-z0-9.-]+$/`.
3. Partition by plural. `providerconfigs` and `clusterproviderconfigs` become provider-config kinds. `providerconfigusages`, `clusterproviderconfigusages`, `storeconfigs` and `clusterstoreconfigs` are ignored. Everything else is an MR kind. Steps 2–3 are one pure helper, `partitionObjectRefs(revisions): { managed: ParsedRef[]; providerConfigs: ParsedRef[]; groups: string[] }` in `crossplane-utils` (`ParsedRef = { providerName, group, plural }`, `groups` = every distinct group named, ignored plurals included). `getPackages` uses the same helper (B.5 "Snapshot fetchers").
4. Served-version resolution, per (group, version), implemented once as `resolveGroupKinds(api, cache, refs: ParsedRef[], limit)` in `crossplane-discovery.ts` and shared with `getPackages`. Upjet providers serve mixed versions inside one group (e.g. some `ec2.aws.upbound.io` kinds at `v1beta2`, others only at `v1beta1`), so the group's `preferredVersion` alone is not enough. For each distinct MR group `g` that `/apis` serves, call `getGroupResources(g.name, v)` for every `v` in `g.versions` (concurrency 8, cached per `group/version`, subresources such as `foo/status` ignored). If the group isn't served at all, every kind in it is `active: false` (MRD inactive or CRD not established).
5. Per plural, using the pure helper `resolveKindVersion(plural, group, resourcesByVersion)` in `crossplane-utils`:
   - `servedVersions` = the versions whose resource list contains `plural`
   - `active = servedVersions.length > 0`
   - `version` = `g.preferredVersion.version` if it is in `servedVersions`, else the highest in `servedVersions` by `pickKindVersion` order (`v2 > v1 > v1beta2 > v1beta1 > v1alpha1`, unknown suffixes last)
   - `kind` and `namespaced` come from the resource entry at the chosen version

   This is the same rule Detection step 3 uses for core kinds, implemented by the same `pickKindVersion` helper. Inactive kinds keep `version: undefined` and render as "inactive <plural>".
6. Fallback, used only when the ProviderRevision list is forbidden or every active revision has empty `objectRefs`: page through a metadata-only CRD list using `Accept: application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1` with limit 500, and keep CRDs with an ownerReference whose `apiVersion` starts with `pkg.crossplane.io/` and whose kind is `Provider` or `ProviderRevision`. This is crossview's mapping, without the CRD bodies. Then continue from step 3. The payload reports `source: 'crdMetadata'`.

Result: `ManagedKindsPayload { providers: [{ name, health, kinds: ManagedKindInfo[] }], unattributed: ManagedKindInfo[], providerConfigKinds: ManagedKindInfo[], source, errors, fetchedAt }`. The cache entry also stores, outside the payload, the `fingerprint` of the ProviderRevision list it was built from: the sorted `name@resourceVersion` of the active revisions, joined with `,`, computed by the pure `revisionFingerprint(revisions)` in `crossplane-utils`. With the `crdMetadata` fallback the fingerprint is `null`.

#### Shared list helper

Every LIST in the feature (snapshots, ProviderRevisions, the MR scan, the CRD-metadata fallback) goes through one helper in `electron/crossplane-api.ts`:

```ts
listAllPages(gvr: { group: string; version: string; plural: string }, opts: {
  pageSize?: number;           // default 500
  cap?: number;                // default 5000 items
  signal?: AbortSignal;        // checked before each page
  summarize: (obj: unknown) => T | null;   // null = malformed, counted in skippedMalformed
}): Promise<{ items: T[]; truncated: boolean; skippedMalformed: number }>
```

Semantics, identical for every caller:
- It loops on `metadata.continue` until there is no token or `cap` items are collected (`truncated: true`).
- 404 on the first page rejects with `CrossplaneApiError { status: 404 }`. Callers treat that as "kind not served" (feature absent or kind inactive), never as a user-visible error.
- 410 on a continue token restarts the list from scratch once. A second 410 rejects with `status: 410`.
- 403 rejects with `status: 403`.
- Each raw object is summarised and dropped right away, so raw lists are never held in memory.

#### Snapshot fetchers (`getPackages`, `getDefinitions`, `getComposites`)

These live in `electron/crossplane-snapshots.ts`.
- Each fetcher builds a list of section jobs `{ section, gvr, summarize }` and runs them through its own concurrency-6 semaphore (one per fetch call, not shared across fetchers; NFR-1 states the resulting peaks) (`p-limit` style, implemented locally in ~15 lines, no new dependency).
- Versions come from `kindVersions` (detection). A section whose kind is not served is skipped with no request and no error.
- `getDefinitions` sections:
  - XRDs, Compositions, CompositionRevisions
  - EnvironmentConfigs, when served
  - Function "used by" is computed from the Compositions section
- `getPackages` runs in two phases on its own 6-slot semaphore. It never awaits `getManagedKinds`, so package health is not delayed by MR-group discovery.
  - Phase 1 sections, all concurrent:
    - Providers, Functions, Configurations
    - ProviderRevisions, FunctionRevisions, ConfigurationRevisions
    - DeploymentRuntimeConfigs and MRAPs, when served
  - Phase 2, ProviderConfigs. It starts when the ProviderRevisions section settles, and the other phase 1 sections keep running.
    1. Take the active ProviderRevisions and call `partitionObjectRefs(revisions)`. Its `providerConfigs` entries (plurals `providerconfigs` and `clusterproviderconfigs`) are the only discovery input.
    2. Call `resolveGroupKinds` for those refs only. That issues `getGroupResources` for each served version of each ProviderConfig group (usually 1–4 calls per provider family, cached per `group/version` and shared with the kind index), through this fetch's semaphore.
    3. List each active ProviderConfig kind as a section, with `summarizeProviderConfig`.
    4. If the ProviderRevisions section failed (403/5xx/timeout), phase 2 uses `peekManagedKinds(ctx)?.providerConfigKinds` when the kind index happens to be cached, for example from the `crdMetadata` fallback. Otherwise it adds `errors[{ section: 'providerConfigs', status, message: 'Provider revisions unavailable; provider configs not listed' }]`, using the ProviderRevisions failure's status.
  - Fingerprint check. After the ProviderRevisions section succeeds, `getPackages` computes `revisionFingerprint(activeRevisions)`. If a kind-index cache entry exists for the context with a different non-null fingerprint, that entry is evicted, so the next `getManagedKinds` caller rebuilds it. `getPackages` never rebuilds the index and never re-reads its own sections in the same call. An in-flight kind-index build is left alone: it resolves for its current awaiters, and when it settles the service compares its fingerprint with the latest one `getPackages` recorded for the context (`latestRevisionFingerprint`). It caches the result only if they match or no fingerprint was recorded.
  - The payload carries `providerApiGroups: string[]`, which is `partitionObjectRefs(...).groups`: every MR and ProviderConfig group named by active revisions, served or not. No discovery is needed. `getWarningEvents` uses it (below).
- `getComposites` first awaits `getDefinitions(ctx)` (15 s cache) to get the XRD list. Its sections are:
  - one per XRD XR kind, at the XRD's referenceable version (`pickReferenceableVersion`, i.e. the version with `referenceable: true`)
  - one per claim kind, at the same version
  - Usages (legacy and/or protection plus ClusterUsage), when served
  - Operations, CronOperations and WatchOperations, when `features.operations`

  XRDs that are not `Established=True` are still listed. A 404 for their kind is silently skipped.
- Each XR/claim section lists cluster-wide, using `listClusterCustomObject`, which spans all namespaces for namespaced kinds.
- Payloads carry `truncatedKinds: string[]` (section names that hit the 5000 cap) and `skippedMalformed: number`. The view shows a yellow banner "Showing first 5000 <section>" for each truncated section.
- Error mapping is per section (B.12): 404 → skipped, 403/5xx/timeout → `errors[]` entry, and all sections failing with status 0 → rejection "Cluster unreachable".

#### Warning events (`crossplane:getWarningEvents`)

1. Ensure the group sets are available. Await `detect(ctx)`, `getDefinitions(ctx)` and `getPackages(ctx)` together. They are 15–60 s cache hits or in-flight joins when the Overview is open, because it fires the same calls. `getWarningEvents` never awaits `getManagedKinds` and never triggers a scan. A failure in any of these just shrinks the group set, and the matching section error is already reported by that call.
2. `relevantGroups` is the union of:
   - the Crossplane core groups
   - `packages.providerApiGroups`, i.e. every MR and ProviderConfig group named by active ProviderRevisions. This comes straight from `objectRefs`, so MR events are matched without the kind index.
   - every XR and claim group from the XRDs
   - when the kind index is already cached (`peekManagedKinds(ctx)`, no request), every group in it. This only adds groups on the `crdMetadata` fallback path, where ProviderRevisions were unreadable and `providerApiGroups` is empty. On that path, MR-only events appear once the Managed view has warmed the index. The muted footnote under the list says so when `providerApiGroups` is empty and the index is not cached.
3. Page `CoreV1Api.listEventForAllNamespaces({ fieldSelector: 'type=Warning', limit: 500, _continue })` through the adapter method `listWarningEventsPage(continueToken?)`, stopping when there is no continue token or after 10 pages (5000 events scanned, `truncatedScan: true`). A 410 on a continue token stops paging with the events gathered so far and sets `truncatedScan: true`; it does not restart, because events churn fast.
4. Keep an event when the group part of `involvedObject.apiVersion` (the text before `/`, or `''` for core) is in `relevantGroups`. Summarise kept events to `CrossplaneEvent { uid, reason, message, count, involvedObject: CrossplaneObjectRef, timestamp }`, with `timestamp = eventTime ?? lastTimestamp ?? firstTimestamp ?? metadata.creationTimestamp`.
5. Sort by `timestamp` descending, de-duplicate by `uid`, and return the first `limit` (1–200, default 50). The payload is `CrossplaneWarningEventsPayload { events, truncatedScan, scanned, fetchedAt, errors }`. The Overview renders 20.
6. A 403 on the events list returns `events: []` with an `errors` entry `{ section: 'events', status: 403 }`.

#### MR scan and items

`crossplane:scanManaged` covers all active kinds. `crossplane:getManagedItems` covers an explicit `kindKeys` subset.
- Per kind, call `listAllPages({ group, version, plural })`, which uses `CustomObjectsApi.listClusterCustomObject` (all namespaces), page size 500 and a 5000 cap (`truncated: true`).
- 404 → the kind is marked `active: false` and is not an error. A repeat 410 → per-kind error. 403 → per-kind error `{ status: 403 }`.
- Each item is converted with `summarizeManaged(obj, providerName, now)` and the full object is dropped immediately.
- Concurrency is 6. Progress `{ context, scanned, total }` is sent on `crossplane:scanProgress`, throttled to 250 ms.
- Only one scan runs at a time. Starting a scan for a different context aborts the running one: an `AbortController` is checked between pages and kinds, the result `status: 'cancelled'` is returned, and nothing is cached. A second scan request for the same context joins the in-flight promise.
- The summary payload holds per-kind `{ count, truncated, byHealth, error? }` and an `unhealthy` list (health `unhealthy`, capped at 200, sorted by `healthOrder` then lastTransitionTime). Per-kind rows are cached so a later `getManagedItems` is a cache hit, with a total cap of 50,000 cached rows per context. Beyond that, counts are kept and rows are dropped (`rowsCached: false`).
- `getManagedItems(kindKeys, force)` resolves each key independently:
  1. If not `force` and the per-kind rows are cached and fresh (60 s), return them.
  2. Else if a scan for the same context is in flight and that kind is still pending in it, await that kind's per-kind promise. The scan keeps a `Map<kindKey, Promise<KindResult>>`, created when the kind is queued, so this is a join, not a second request.
  3. Else list it directly through the same concurrency-6 semaphore the scan uses, so a scan plus item fetches never exceed 6 concurrent lists per context. Then cache the rows (a direct fetch does not update the scan summary counts).
  4. `force` skips step 1 but still joins an in-flight scan kind (step 2), because that result is at most seconds old.
- If the scan is cancelled while a `getManagedItems` caller is waiting on a kind, that caller falls through to step 3.

#### Cache (per context, LRU of 3 contexts, `now()` injectable)

| Entry | TTL | Notes |
|---|---|---|
| detection | 60 s | `force` bypasses |
| `/apis` groups, group resources (keyed `group/version`), `kindVersions` | 5 min | `force` on any call refetches `/apis`; group resources refetch only for `group/version` pairs that are new, or whose group's `versions` list changed |
| MR kind index | 5 min | Stores its build `fingerprint`. Evicted early when a `getPackages` call sees a different fingerprint, so the next caller rebuilds; an in-flight build that settles with a stale fingerprint is returned to its awaiters but not cached (B.5 "Snapshot fetchers"). `peekManagedKinds(ctx)` returns the fresh cached payload or `null`, with no request and no in-flight join |
| packages, definitions, composites snapshots | 15 s | `force` bypasses |
| MR scan summary | 5 min | `force` bypasses (full rescan). Matches the renderer's 5 min scan cadence (B.11) |
| MR per-kind rows | 60 s | Written by the scan and by `getManagedItems`. `force` on `getManagedItems` refetches only the requested kinds |
| warning events | 15 s | `force` bypasses |
| getResource, tree | not cached | Always fresh, because the drawer is the point of truth |

In-flight de-duplication uses `Map<cacheKey, Promise>`, removed on settle. Rejected promises are not cached.

### B.6 Health model (single source: `src/utils/crossplane-utils.ts`)

```ts
type CrossplaneHealth = 'unhealthy' | 'progressing' | 'paused' | 'unknown' | 'healthy' | 'none';
// HEALTH_ORDER: unhealthy 0, progressing 1, paused 2, unknown 3, healthy 4, none 5
deriveHealth(category: CrossplaneCategory | 'generic', conditions, meta, now): { health, reason?, message?, since? }
```

`healthOrder` is stored as a `number` and sorted by the numeric branch added to `useResourceSorting` (B.9), so its ordering does not rely on string sort.

Rules are evaluated in order. "Deciding condition" means the one whose reason and message populate `healthReason`/`healthMessage` (message truncated to 500 characters).

1. `metadata.deletionTimestamp` set → `progressing` with reason `Deleting` (escalated by rule 7).
2. Annotation `crossplane.io/paused === 'true'`, or `Synced=False` with reason `ReconcilePaused`, or (operations) `Scheduling`/`Watching` with reason `SchedulePaused`/`WatchPaused` → `paused`.
3. Categories `composition`, `environmentConfig`, `runtimeConfig` and `providerConfig` → `none`. These are excluded from counts.
4. The required conditions depend on category:
   - packages: `Installed`, `Healthy`
   - revisions: `RevisionHealthy` (+ `RuntimeHealthy` if present), or `Healthy` when `RevisionHealthy` is absent
   - `xrd`: `Established`, plus `Offered` when `spec.claimNames` is set
   - `composite`, `claim`, `managed`: `Synced`, `Ready`
   - `usage`, `activationPolicy`, and CompositionRevisions use the generic rule. CompositionRevisions have no row category, so their summaries call `deriveHealth('generic', …)`; the `category` parameter is typed `CrossplaneCategory | 'generic'`. Generic rule: required = whichever of `Synced` and `Ready` are present. If neither is present, every condition the object has is required. If it has no conditions, rule 6 gives `unknown`.
   - `operation`, by kind:
     - `Operation`: `Succeeded`. `True` → healthy, `False` → unhealthy (reason `PipelineError`), `Unknown` → progressing (reason `PipelineRunning`). Stuck escalation (rule 7) applies, so a pipeline running for more than 15 minutes is flagged.
     - `CronOperation`: `Synced` and `Scheduling` (`ScheduleInvalid` → unhealthy)
     - `WatchOperation`: `Synced` and `Watching` (`WatchFailed` → unhealthy)

   Inactive revisions (`desiredState: Inactive`) are always `none`.
5. Any required condition `False`:
   - if its reason is in `PROGRESSING_REASONS = {Creating, Deleting, UnpackingPackage, AwaitingActivation, UnknownPackageRevisionHealth, InactivePackageRevision}` → `progressing`
   - otherwise → `unhealthy` (e.g. `ReconcileError`, `Unavailable`, `UnhealthyPackageRevision`)

   For managed resources, `LastAsyncOperation=False` also makes them `unhealthy`; it is rendered with its message, because upjet surfaces cloud API errors there.
6. All required conditions `True` → `healthy`. Any missing or `Unknown` → `progressing` if the object has some conditions, `unknown` if it has none.
7. Stuck escalation: `progressing` whose deciding `lastTransitionTime` (or creationTimestamp) is older than `STUCK_THRESHOLD_MS = 15 * 60_000` → `unhealthy`, with reason prefixed `Stuck: ` (e.g. "Stuck: Creating for 2h").

The renderer only reads `health` from summaries. The drawer calls `deriveHealth` on the full object, using the same function.

XRD scope rule (single place: `summarizeXrd` in `crossplane-utils`, also exported as `resolveXrdScope(obj)` for the tree walker and claim detection):

```ts
const scope = asString(spec.scope) ?? (asString(obj.apiVersion)?.endsWith('/v2') ? 'Namespaced' : 'LegacyCluster');
```

It is keyed on the `apiVersion` the object was actually read at, which is `kindVersions.CompositeResourceDefinition` from detection (`v2` on Crossplane v2, `v1` on v1). Values other than the three known scopes are kept as-is for display and treated as `Cluster` for namespace logic.

### B.7 Relationship tree (`crossplane:getTree`) and graph

The main-side walk lives in `electron/crossplane-tree.ts`, using pure helpers from `crossplane-utils`.

0. Await `getDefinitions(ctx)` (15 s cache, so a cold cache costs one snapshot) to get the XRD set: XR kinds, claim kinds and scopes. If it rejects, the walk continues with an empty XRD set. Ascent then stops at the first owner, and descent still follows `resourceRefs` on the root. The tree carries `warnings: ['Definitions unavailable: <message>']`, shown as a muted note above the graph.
1. GET the root through the adapter's `get(ref)` (B.9: `CustomObjectsApi` for grouped kinds, `KubernetesObjectApi.read` for core `v1`). Failure rejects the call; the drawer shows the error.
2. Ascend at most 4 times:
   - if the object has a controller ownerReference whose `apiVersion/kind` is a known XR kind (from the XRD set loaded in step 0), GET that owner
   - else if the object is an XR with `spec.claimRef` (v1), or with labels `crossplane.io/claim-name`/`crossplane.io/claim-namespace` and the XRD has `claimNames`, GET the claim

   The top-most object fetched becomes `top`.
3. Descend breadth-first from `top`:
   - a claim's child is `spec.resourceRef`
   - an XR's children are `spec.crossplane.resourceRefs ?? spec.resourceRefs ?? []`

   Child namespace is `ref.namespace ?? (isNamespaced(ref) ? parent.metadata.namespace : undefined)`, where `isNamespaced` comes from the group-resources cache (one discovery call for an unknown group).
4. Child GETs run with concurrency 8. Outcomes:
   - core `v1 Secret`: not fetched; state `notFetched`
   - 404: `missing`
   - 403: `forbidden`
   - other errors: `error` with the sanitised message
   - success: summarised; if the child is an XR kind, recurse
5. Limits: depth 6 from `top`, 300 nodes total (`truncated: true` beyond that), and cycle guard on `uid`, falling back to the ref key.
6. Return `{ rootKey: topKey, focusKey, nodes: CrossplaneTreeNode[], truncated, warnings }`. Node fields: `key`, `parentKey`, `ref` with category, `health`, `synced`, `ready`, `healthMessage`, `state` and `depth`.

Renderer layout lives in `src/utils/crossplane-graph.ts` as a pure function, `buildCrossplaneFlow(tree, opts)`:
- left-to-right tidy tree with `x = depth × 260`
- leaves take consecutive `y` slots 84 px apart in DFS order, children sorted by `(healthOrder, kind, name)` so failures come first
- parent `y` = midpoint of its first and last child
- a parent with more than 50 children renders 50 plus a summary node "+N more (x unhealthy)"
- edges are `smoothstep`, stroked by child health (`#ef4444` / `#f59e0b` / `#22c55e` / `#6b7280`), animated when the child is progressing
- the focus node gets `ring-2 ring-blue-500/60`

No dagre or elk is used.

`CrossplaneTreeGraph.tsx` follows `ResourceTopology.tsx`: `useNodesState`/`useEdgesState`, `fitView`, `Background`, `Controls`, `h-[500px]`. It uses its own `nodeTypes = { crossplane: CrossplaneGraphNode }`, memoised. `onNodeClick` calls `onOpenResource(ref)` except for summary and `notFetched` nodes. `CrossplaneGraphNode.tsx` is a 220 px card on `bg-[#1e1e1e]` with the kind in uppercase `text-gray-400`, the name truncated with `title`, the namespace, Synced/Ready pills or a state badge, and a health-coloured left border. Status is never conveyed by colour alone, because the badge text is always present.

The List mode is an indented, keyboard-navigable `<ul role="tree">` with `aria-level`. It is the accessible alternative and is not virtualised (the 300-node cap).

### B.8 IPC contract

All channels are registered in `registerIpcHandlers()` with `safeHandle(channel, schema, handler)`. Every preload method sends exactly one object argument, because `safeHandle` validates `rawArgs[0]` when there is a single argument and a tuple otherwise. Channel names don't match any MUTATE/DESTRUCTIVE pattern in `mutation-policy.ts`, so they classify as `READ`.

| Channel | Input (zod) | Output |
|---|---|---|
| `crossplane:detect` | `{ context, force? }` | `CrossplaneDetection` |
| `crossplane:getPackages` | `{ context, force? }` | `CrossplanePackagesPayload` |
| `crossplane:getDefinitions` | `{ context, force? }` | `CrossplaneDefinitionsPayload` |
| `crossplane:getComposites` | `{ context, force? }` | `CrossplaneCompositesPayload` |
| `crossplane:getManagedKinds` | `{ context, force? }` | `ManagedKindsPayload` |
| `crossplane:scanManaged` | `{ context, force? }` | `ManagedScanSummary` |
| `crossplane:getManagedItems` | `{ context, kindKeys: string[1..50], force? }` | `ManagedItemsPayload` |
| `crossplane:getWarningEvents` | `{ context, limit?: int 1..200 = 50, force? }` | `CrossplaneWarningEventsPayload` |
| `crossplane:getResource` | `{ context, ref }` | `Record<string, unknown>` (managedFields and last-applied stripped) |
| `crossplane:getTree` | `{ context, ref }` | `CrossplaneTree` |
| event `crossplane:scanProgress` | main → renderer | `{ context, scanned, total }` |

Validation rules. These are the canonical zod schemas, in `electron/crossplane-ipc-schemas.ts` (pure: imports only `zod` and `src/types/crossplane`, so tests can import it without Electron). `electron/crossplane-ipc.ts` imports them and registers the handlers. Every object schema is `.strict()`, so unknown keys are rejected. Any failure rejects with "IPC validation failed: <channel> — …" and is audit-logged in SECURITY by the existing `safeHandle`.

```ts
import { z } from 'zod';

// Kube context names may contain ':', '/', '@' (EKS ARNs), so validateK8sParam is not used here.
const contextSchema = z.string().min(1).max(253).refine(s => !s.includes('\0'), 'NUL not allowed');

const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const API_VERSION = /^([a-z0-9]([-a-z0-9.]*[a-z0-9])?\/)?v[0-9]+((alpha|beta)[0-9]+)?$/; // 'v1' or 'group/version'
const KIND = /^[A-Z][A-Za-z0-9]*$/;
const KIND_KEY = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?\/v[0-9]+((alpha|beta)[0-9]+)?\/[a-z0-9]([-a-z0-9]*[a-z0-9])?$/; // group/version/plural

import { CROSSPLANE_CATEGORIES } from '../src/types/crossplane';
// = ['provider','function','configuration','providerConfig','runtimeConfig','activationPolicy',
//    'xrd','composition','environmentConfig','composite','claim','usage','operation','managed'] as const

const refSchema = z.object({
  apiVersion: z.string().max(253).regex(API_VERSION),
  kind: z.string().min(1).max(63).regex(KIND),
  name: z.string().min(1).max(253).regex(DNS_SUBDOMAIN),
  namespace: z.string().min(1).max(63).regex(DNS_LABEL).optional(),
  category: z.enum(CROSSPLANE_CATEGORIES).optional(),
}).strict();

export const contextOnlySchema = z.object({ context: contextSchema, force: z.boolean().optional() }).strict();
export const managedItemsSchema = z.object({
  context: contextSchema,
  kindKeys: z.array(z.string().max(320).regex(KIND_KEY)).min(1).max(50),
  force: z.boolean().optional(),
}).strict();
export const warningEventsSchema = z.object({
  context: contextSchema,
  limit: z.number().int().min(1).max(200).optional(),
  force: z.boolean().optional(),
}).strict();
export const refRequestSchema = z.object({ context: contextSchema, ref: refSchema }).strict();
```

The `import` belongs at the top of the file; it is shown inline here for readability. `contextOnlySchema` serves `detect`, `getPackages`, `getDefinitions`, `getComposites`, `getManagedKinds` and `scanManaged`. `refRequestSchema` serves `getResource` and `getTree`. The installed zod is 3.25.76 and imported as `import { z } from 'zod'` (same as `electron/ipc/validation.ts`). `safeHandle<T extends z.ZodType>(channel, schema, handler)` passes `z.infer<T>` to the handler. `CROSSPLANE_CATEGORIES` lives in `src/types/crossplane.ts` (so the renderer shares it) and is imported here.

The main side also re-runs `validateK8sParam` on `apiVersion`, `kind`, `name` and `namespace` as defence in depth. The handler rejects `ref.kind === 'Secret' && ref.apiVersion === 'v1'`.

Preload (`electron/preload.ts`) adds a `crossplane` namespace next to `helm`:
```ts
crossplane: {
  detect: (context: string, opts?: { force?: boolean }) => ipcRenderer.invoke('crossplane:detect', { context, ...opts }),
  // … one per channel, same shape …
  onScanProgress: (cb: (p: CrossplaneScanProgress) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: CrossplaneScanProgress) => cb(p);
    ipcRenderer.on('crossplane:scanProgress', listener);
    return () => ipcRenderer.removeListener('crossplane:scanProgress', listener); // only this listener
  },
},
```
Preload signatures are positional for the renderer and always pack into one object for IPC:
- `detect | getPackages | getDefinitions | getComposites | getManagedKinds | scanManaged(context, opts?: { force?: boolean })` → `{ context, ...opts }`
- `getManagedItems(context, kindKeys: string[], opts?: { force?: boolean })` → `{ context, kindKeys, ...opts }`
- `getWarningEvents(context, opts?: { limit?: number; force?: boolean })` → `{ context, ...opts }`. Undefined keys are omitted, not sent as `undefined`; structured clone keeps them as present-but-undefined, which zod `.optional()` accepts anyway.
- `getResource(context, ref: CrossplaneObjectRef)` and `getTree(context, ref)` → `{ context, ref }`. The preload does not sanitise `ref`. Every row type extends `CrossplaneObjectRef`, so TypeScript accepts a whole row (or `selectedResource`, which also carries `type`) here, and `.strict()` would then reject it with "Unrecognized key(s)". Cluster-scoped rows may also carry `namespace: ''`, which fails `min(1)`. Every caller therefore passes `toCrossplaneRef(x)`:

  ```ts
  // src/utils/crossplane-utils.ts — the only way a renderer builds an IPC ref.
  export function toCrossplaneRef(r: CrossplaneObjectRef): CrossplaneObjectRef {
    const ref: CrossplaneObjectRef = { apiVersion: r.apiVersion, kind: r.kind, name: r.name };
    if (r.namespace) ref.namespace = r.namespace;   // omit '' and undefined
    if (r.category) ref.category = r.category;
    return ref;
  }
  ```

  The callers are the `'crossplane'` branch of `Dashboard.handleResourceClick` (which covers row clicks, graph and list node clicks, reference clicks, and the post-scale re-fetch with `selectedResource`) and `CrossplaneResourceDetails`' `getTree` call, which passes `toCrossplaneRef({ apiVersion, kind, name: metadata.name, namespace: metadata.namespace, category })`, read from `object` with the `asString` guards. If any required field is missing, the Relationships toggle is disabled with the title "Object has no apiVersion/kind/name". This rule is owned by the renderer helper rather than relaxed in the schema: `.strict()` stays the trust boundary, and the helper keeps payloads minimal.

Typings go in `src/vite-env.d.ts` (`import type { … } from './types/crossplane'`) and `electron/electron-env.d.ts` (inline `import('../src/types/crossplane').X`, matching the existing helm-catalog style).

### B.9 Main-process architecture and file plan

`main.ts` instantiates the service, guarding sends with the same pattern `main.ts` uses elsewhere (e.g. line 119):

```ts
const crossplaneService = new CrossplaneService({
  kubeConfigFactory: (ctx) => k8sService.createContextKubeConfig(ctx),
  emitProgress: (p) => { if (win && !win.isDestroyed()) win.webContents.send('crossplane:scanProgress', p); },
});
``` The existing `k8s:forceCredentialRefresh` handler additionally calls `crossplaneService.invalidateKubeConfigs()` so Granted profile switches take effect.

Why isolated KubeConfigs: `K8sService` mutates `this.kc.setCurrentContext()` per call. A multi-second scan sharing it would query the wrong cluster after a switch. `createContextKubeConfig(ctx)` is the only change to `K8sService`: a new public method that builds `new KubeConfig()`, calls `loadFromDefault()` (the same source `K8sService` uses at `k8s.ts:170`, so `KUBECONFIG` is honoured identically), throws if the context is unknown, sets the current context, and returns it. `CrossplaneApi` caches one per context for 10 minutes (mirroring `RELOAD_INTERVAL_MS`). On a 401 it rebuilds and retries once, mirroring `withAuthRetry`.

Why no watches: `.kiro/steering/watcher-debugging.md` documents watch fragility on large clusters, and MR kinds can number in the hundreds (one held connection per GVR). Crossplane's own MR poll interval defaults to about a minute, so a ≥15 s refresh loses little. Watches for XRs and packages are in the backlog.

| File | New/Mod | Responsibility (target size) |
|---|---|---|
| `electron/crossplane-api.ts` | new | `CrossplaneApi` interface plus the `createCrossplaneApi(kcFactory, context)` adapter: `getApiGroups`, `getGroupResources(group, version)` (`/api/v1` for core), `listPage`, `listAllPages` (B.5), `get(ref, plural)`, `listCrdMetadata` (custom Accept header via a per-call `middleware` `pre` hook), `listWarningEventsPage(continueToken?)` (`CoreV1Api.listEventForAllNamespaces({ fieldSelector: 'type=Warning', limit: 500, _continue })`), `findCoreDeployment`. `get` uses `CustomObjectsApi.getNamespacedCustomObject`/`getClusterCustomObject` with the plural from the group-resources cache for grouped kinds, and `KubernetesObjectApi.read` only for core `v1` kinds. Every API client is built with `new XApi(createConfiguration({ baseServer: new ServerConfiguration(cluster.server, {}), authMethods: { default: kc }, promiseMiddleware: [countingMiddleware] }))`, which mirrors `KubeConfig.makeApiClient` (`config.js`) but adds a `PromiseMiddleware` (`pre(ctx)` returns the counted `RequestContext`, `post(ctx)` passes the response through). That hook increments the per-context request counter and logs the method and path when debug is on. Because it sits on the Configuration, it also counts `KubernetesObjectApi`'s internal discovery. Every request is wrapped in `withTimeout(promise, 30_000, \`crossplane ${method} ${path}\`)` (`src/lib/with-timeout.ts` takes `(promise, ms, label)`; the label never includes bodies). `withTimeout` does not cancel the underlying request. Between pages and kinds, `listAllPages` checks the scan's `AbortSignal`, so a cancelled scan stops issuing new requests and a timed-out request is simply abandoned. Errors are normalised to `CrossplaneApiError { status, message }` using the now-exported `sanitizeK8sErrorMessage`. (~260 lines) |
| `electron/crossplane-discovery.ts` | new | Detection, `kindVersions`, MR kind index and fallback, and `resolveGroupKinds` (shared by the kind index and `getPackages`' ProviderConfig phase), using pure parsers from utils. Carries the crossview attribution. (~250) |
| `electron/crossplane-tree.ts` | new | Tree walk (B.7). (~200) |
| `electron/crossplane-snapshots.ts` | new | Pure-ish fetcher functions taking `(api, detection, deps)`: `fetchPackages`, `fetchDefinitions`, `fetchComposites` (including operations), `fetchWarningEvents`, plus the concurrency-6 semaphore helper. No caching here. (~300) |
| `electron/crossplane.ts` | new | `CrossplaneService`: per-context LRU cache, TTLs, in-flight dedupe, `peekManagedKinds`, the per-context `latestRevisionFingerprint` and kind-index eviction (B.5), wiring of the snapshot fetchers, scan orchestration, cancel and the per-kind promise map, `getManagedItems`, `getResource` (strip and Secret guard), `invalidateKubeConfigs`. (~330) |
| `electron/crossplane-ipc-schemas.ts` | new | The zod schemas from B.8 only. No Electron imports. (~50) |
| `electron/crossplane-ipc.ts` | new | `registerCrossplaneIpc(service)`, called from `registerIpcHandlers()`, using `safeHandle` and the schemas. Keeps `main.ts` growth to about 3 lines. (~80) |
| `electron/k8s.ts` | mod | Add `createContextKubeConfig(contextName)` and `export` the existing `sanitizeK8sErrorMessage`. Additive. |
| `electron/main.ts` | mod | Import, instantiate, call `registerCrossplaneIpc(crossplaneService)` in `registerIpcHandlers()`, invalidate on credential refresh. Additive. |
| `electron/preload.ts`, `electron/electron-env.d.ts`, `src/vite-env.d.ts` | mod | Bridge and typings. Additive. `preload.ts` is already 521 lines in the working tree (490 at HEAD), so it joins the AC 19 pre-existing-large-file list. The ~35-line `crossplane` block is inserted inline next to `helm`. It is not split into a separate preload module: the preload bundling path has no precedent for local imports in this repo, and it is not worth the risk for 35 lines. |
| `src/hooks/useResourceSorting.ts` | mod | Behaviour-preserving refactor plus one branch. Move the comparator body into an exported pure function `sortResourceData(data, sortConfig)`, which the hook's `getSortedData` calls. Add a generic numeric branch just before the default string comparison: `if (typeof a[key] === 'number' && typeof b[key] === 'number') return dir * (a[key] - b[key]);`. Existing special keys (`age`, `restarts`, `cpu`, `memory`, `replicas`, `status`) are untouched and still take precedence. This file has no uncommitted user changes. |
| `src/hooks/useResourceSorting.test.ts` | new | Pure tests of `sortResourceData`: numeric asc/desc (9 before 10), mixed number/undefined falls back to the string path, and the existing `age`/`cpu`/`memory` behaviour unchanged. |
| `src/components/dashboard/DashboardHeader.tsx` | mod | Five additive `titleMap` entries (B.4). |
| `src/types/crossplane.ts` | new | All shared types (B.10). (~250) |
| `src/utils/crossplane-utils.ts` | new | Guards (`asRecord`, `asString`, `asArray`), `getConditions`, `deriveHealth`, `HEALTH_ORDER`, ref extraction (`getResourceRefs`, `getCompositionRef`, `getClaimRef`, `getControllerOwner`), `parseCrdName`, `pickReferenceableVersion`, `pickKindVersion`, `summarizePackage`, `…Revision`, `…Xrd`, `…Composition`, `…Composite`, `…Claim`, `…Managed`, `…Usage`, `…ProviderConfig`, `…RuntimeConfig`, `…ActivationPolicy`, `…EnvironmentConfig`, `countHealth`, `collectNeedsAttention`, `classifyCrossplaneObject`, `crossplaneKey`, `toCrossplaneRef` (B.8), `partitionObjectRefs`, `revisionFingerprint`, `resolveKindVersion`, `filterCrossplaneEvents`. Crossview attribution. Revision 3 added helpers, so the split is decided now instead of left conditional: the `summarize*` functions live in `src/utils/crossplane-summaries.ts` (~300, crossview attribution, imports guards and `deriveHealth` from `crossplane-utils`), and `crossplane-utils.ts` keeps everything else (~330). Main and renderer import summarisers from `crossplane-summaries`. |
| `src/utils/crossplane-graph.ts` | new | `buildCrossplaneFlow`. (~150) |
| `src/hooks/useCrossplaneQuery.ts` | new | Generic hook (B.11). (~120) |
| `src/utils/crossplane-query-utils.ts` (+ `.test.ts`) | new | `resolveIntervalMs`, `shouldFetchOnVisible`. (~30) |
| `src/components/dashboard/views/crossplane/CrossplaneView.tsx` | new | Detection gate, header, refresh, sub-view switch. (~180) |
| `…/crossplane/CrossplaneOverview.tsx` | new | (~350) |
| `…/crossplane/CrossplanePackagesView.tsx` | new | (~300) |
| `…/crossplane/CrossplaneDefinitionsView.tsx` | new | (~260) |
| `…/crossplane/CrossplaneCompositesView.tsx` | new | (~300) |
| `…/crossplane/CrossplaneManagedView.tsx` | new | Uses a sub-component `CrossplaneKindTree.tsx` (~200). (~300) |
| `…/crossplane/CrossplaneHealthBadge.tsx`, `CrossplaneEmptyState.tsx`, `CrossplaneSectionErrors.tsx` | new | Small presentational components |
| `…/crossplane/crossplane-columns.ts` | new | Typed `col<R>()` and `healthColumn()` (B.4 "Column conventions"). `.ts`, no JSX. (~50) |
| `src/components/resources/details/CrossplaneResourceDetails.tsx` | new | Drawer shell: category resolution, snapshot lookup of extras by key (B.9 "Drawer data flow"), banner, conditions, Details/Relationships toggle. A smart component: it calls `window.k8s.crossplane.*` through `useCrossplaneQuery`, like other detail components that fetch on demand. (~260) |
| `src/components/resources/details/CrossplaneDetailSections.tsx` | new | Per-category sections. (~400) |
| `src/components/resources/visualizers/CrossplaneTreeGraph.tsx`, `CrossplaneGraphNode.tsx`, `CrossplaneTreeList.tsx` | new | (~150 / ~90 / ~100) |
| `src/App.tsx` | mod | `hasCrossplane` state, detection on connect, prop to `SecondarySidebar` |
| `src/components/features/sidebar/SecondarySidebar.tsx` | mod | `hasCrossplane` prop, group insertion, `openGroups.crossplane: true`, five lucide imports |
| `src/components/dashboard/DashboardContent.tsx` | mod | `ResourceType` union gets `'crossplane'`. Route `activeView.startsWith('crossplane-')` → `<CrossplaneView subView=… clusterName searchQuery selectedNamespaces onResourceClick onNavigate />`. Deep-linking to the Operations tab (Overview chip) passes no extra route state. Each tabbed sub-view keeps its selected tab in `sessionStorage` under `lumen.crossplane.<subView>.tab`, read in its `useState` initialiser. The chip writes `lumen.crossplane.composites.tab = 'operations'` and then calls `onNavigate('crossplane-composites')`. This works whether or not React remounts the view, and it also preserves tab choice across navigation. An unknown or hidden stored tab falls back to the first visible tab. |
| `src/components/Dashboard.tsx` | mod | Add `'crossplane'` to the `handleResourceClick` type union (`Dashboard.tsx:986`), but not to its include-list: `'crossplane'` is handled by its own early-return branch, inserted right after the existing `setDrawerTab('details')` line and before the include-list `if`, so the shared `catch` at ~line 1111 is untouched. Add `const crossplaneDrawerSeq = useRef(0);` next to the other refs, and one line at the very top of `handleResourceClick`: `const drawerSeq = ++crossplaneDrawerSeq.current;`. It is incremented for every type, so a slow Crossplane fetch can't overwrite a later non-Crossplane selection either. The branch: `` if (type === 'crossplane') { try { const obj = await window.k8s.crossplane.getResource(clusterName, toCrossplaneRef(resource)); if (drawerSeq === crossplaneDrawerSeq.current) setDetailedResource(obj); } catch (err) { if (drawerSeq !== crossplaneDrawerSeq.current) return; console.error('[Crossplane] Failed to load resource', err); setDetailedResource({ error: `Failed to load details: ${err instanceof Error ? err.message : 'Unknown error'}` }); } return; } ``. Only the Crossplane branch checks the sequence; existing branches keep their current behaviour (backlog). `toCrossplaneRef` strips `type` and row extras (B.8). Delete button condition becomes `type !== 'ec2instance' && type !== 'crossplane'`. Pass `onOpenCrossplaneResource={(ref) => handleResourceClick(ref, 'crossplane')}` to `DrawerDetailsRenderer`. Append the kind to the drawer `ErrorBoundary` reset key (`Dashboard.tsx:1488`): `` resetKey={`${selectedResource?.name}-${selectedResource?.type}-${selectedResource?.namespace}-${selectedResource?.kind ?? ''}`} ``, because a claim and its XR often share a name and namespace. For existing types `kind` is usually undefined, so their key only gains a trailing `-`, which doesn't change reset behaviour. The view-keyed `loadResources()` (`Dashboard.tsx:749`) is a no-op for `crossplane-*` IDs (no matching branch, empty `promises`), the same as for `karpenter`, so no edit is needed there. |
| `src/components/dashboard/DrawerDetailsRenderer.tsx` | mod | Optional prop `onOpenCrossplaneResource`, plus `case 'crossplane'` → `CrossplaneResourceDetails` |
| `src/utils/view-labels.ts` | mod | Five labels |
| `public/licenses/crossview-LICENSE.txt` | new | Licence copy |

The edits to files with uncommitted user changes (`k8s.ts`, `main.ts`, `preload.ts`, `Dashboard.tsx`, `SecondarySidebar.tsx`, `App.tsx`, `vite-env.d.ts`, `electron-env.d.ts`, and, as of revision 3, `src/utils/view-labels.ts`, which also has a new untracked `view-labels.test.ts` that must keep passing) are strictly additive insertions made with targeted `str_replace` edits. The working tree is changing in parallel, so the implementer re-runs `git status` and re-reads each target file right before editing it. Existing hunks must not be reformatted or reordered. Note that `.agents/tasks/background-resource-cache/` exists. If that work lands first, re-read `Dashboard.tsx` before editing.

Drawer data flow: rows carry `apiVersion`, `kind`, `name`, `namespace`, `category` and row-specific extras, and deliberately no `metadata` key. That lets the existing `handleOpenYaml(resource)` resolve `name`/`namespace` from the row and take its custom-resource path (`'crossplane'` is not in `RESOURCE_TYPE_MAP`). `detailedResource` is the full object, so `ResourceEvents` (by `metadata.uid`) and AI Explain work unchanged. `CrossplaneResourceDetails` never reads row extras from `selectedResource`. In-drawer navigation goes through `handleResourceClick(ref, 'crossplane')`, which sets `selectedResource = { ...ref, type }` (`Dashboard.tsx` ~line 986), so the extras would be missing. Instead:
- Props are `{ clusterName, object, refHint, onOpenResource }`, where `object = detailedResource` (the full object) and `refHint = selectedResource` (only `category` is read from it, as a hint).
- `category = classifyCrossplaneObject(object, definitionsPayload) ?? refHint.category ?? 'managed'`. `classifyCrossplaneObject` decides from `apiVersion` group and kind: core Crossplane groups map to fixed categories, XR and claim kinds are matched against the XRD list, ProviderConfig kinds by kind name (`ProviderConfig`/`ClusterProviderConfig`), and anything else is `managed`.
- `key = crossplaneKey(object)`, where `crossplaneKey({ apiVersion, kind, namespace, name })` returns `` `${apiVersion}|${kind}|${namespace ?? ''}|${name}` ``. It lives in `crossplane-utils`, and every summariser uses the same function for `row.key`, so both sides always agree.
- Extras are looked up by `key` from the cached snapshots, loaded through `useCrossplaneQuery` with `autoRefresh: false`:
  - package categories (`provider`, `function`, `configuration`, `runtimeConfig`, `providerConfig`, `activationPolicy`) → `getPackages(ctx)`: revisions, `installedDefinitionCount`, `usedByCompositions`, runtime-config "used by", provider-config users
  - `xrd` and `composition` → `getDefinitions(ctx)` + `getComposites(ctx)`, for composition count, instance count, revisions and XRs using it
  - `composite`, `claim`, `managed`, `usage`, `operation`, `environmentConfig` → no extras; every section derives from `object`

  Within 15 s these are main-cache hits, because the views already fetched them. From a cold cache they cost one snapshot.
- While loading, the extras sections show the skeleton loader, and the rest of the drawer (banner, conditions, events, YAML) renders immediately from `object`. If the key isn't in the snapshot (deleted, truncated or forbidden section), the extras sections render "—" with a muted note "Not in the current snapshot". If the snapshot call rejects, they show the error message inline, with no error boundary trip.

### B.10 Key shared types (`src/types/crossplane.ts`)

```ts
export type CrossplaneHealth = 'unhealthy' | 'progressing' | 'paused' | 'unknown' | 'healthy' | 'none';
export type ConditionStatus = 'True' | 'False' | 'Unknown';
export const CROSSPLANE_CATEGORIES = ['provider', 'function', 'configuration', 'providerConfig', 'runtimeConfig',
  'activationPolicy', 'xrd', 'composition', 'environmentConfig', 'composite', 'claim', 'usage', 'operation', 'managed'] as const;
export type CrossplaneCategory = typeof CROSSPLANE_CATEGORIES[number];
export const HEALTH_ORDER: Record<CrossplaneHealth, number> = { unhealthy: 0, progressing: 1, paused: 2, unknown: 3, healthy: 4, none: 5 };
export interface CrossplaneCondition { type: string; status: ConditionStatus; reason?: string; message?: string; lastTransitionTime?: string; }
export interface CrossplaneObjectRef { apiVersion: string; kind: string; name: string; namespace?: string; category?: CrossplaneCategory; }
export interface CrossplaneRowBase extends CrossplaneObjectRef {
  key: string;            // `${apiVersion}|${kind}|${namespace ?? ''}|${name}`
  uid: string; category: CrossplaneCategory;
  age: string;            // creationTimestamp, named `age` for useResourceSorting
  health: CrossplaneHealth; healthOrder: number; healthReason?: string; healthMessage?: string; healthSince?: string;
  synced?: ConditionStatus; ready?: ConditionStatus;
}
export interface PackageRevisionSummary { name: string; revision: number; desiredState: 'Active' | 'Inactive'; image: string; health: CrossplaneHealth; conditions: CrossplaneCondition[]; }
export interface PackageRow extends CrossplaneRowBase { packageRef: string; installed?: ConditionStatus; healthy?: ConditionStatus;
  currentRevision?: string; revisionHealth?: CrossplaneHealth; revisionHealthOrder: number; revisions: PackageRevisionSummary[]; runtimeConfigName?: string;
  installedDefinitionCount: number;     // 0 when unknown; numeric for sorting
  usedByCompositions: string[]; usedByCount: number;
  depsFound: number; depsInstalled: number; }
export interface XrdRow extends CrossplaneRowBase { group: string; xrKind: string; xrPlural: string; version: string;
  scope: 'Namespaced' | 'Cluster' | 'LegacyCluster'; claimKind?: string; claimPlural?: string; established?: ConditionStatus; offered?: ConditionStatus; defaultComposition?: string; }
export interface CompositionRow extends CrossplaneRowBase { compositeApiVersion: string; compositeKind: string; mode: 'Pipeline' | 'Resources';
  steps: { step: string; functionName?: string }[]; stepCount: number; revisionCount: number; latestRevision?: number; }
export interface CompositeRow extends CrossplaneRowBase { scope: XrdRow['scope']; compositionName?: string; compositionRevisionName?: string;
  resourceRefCount: number; claim?: CrossplaneObjectRef; }
export interface OperationRow extends CrossplaneRowBase {
  opKind: 'Operation' | 'CronOperation' | 'WatchOperation';
  mode?: string; stepCount: number; succeeded?: ConditionStatus;                 // Operation
  schedule?: string; scheduling?: ConditionStatus; runningCount: number;         // CronOperation
  watchedApiVersion?: string; watchedKind?: string; watchingResources: number; watching?: ConditionStatus; // WatchOperation
  lastScheduleTime?: string; lastSuccessfulTime?: string; }
export interface ClaimRow extends CrossplaneRowBase { compositeRef?: CrossplaneObjectRef; connectionSecretName?: string; compositionName?: string; }
export interface ManagedRow extends CrossplaneRowBase { kindKey: string; providerName?: string; externalName?: string; providerConfigName?: string;
  managementPolicies?: string[]; compositeName?: string; claim?: string; }
export interface CrossplaneSectionError { section: string; status: number; message: string; }
// Plus: ProviderConfigRow, RuntimeConfigRow, ActivationPolicyRow, EnvironmentConfigRow, UsageRow, CrossplaneDetection,
// CrossplanePackagesPayload, CrossplaneDefinitionsPayload (incl. claimsSupported), CrossplaneCompositesPayload,
// ManagedKindInfo, ManagedKindsPayload, ManagedScanSummary, ManagedItemsPayload, CrossplaneEvent,
// CrossplaneTreeNode, CrossplaneTree (incl. warnings: string[]), CrossplaneScanProgress,
// CrossplaneWarningEventsPayload { events: CrossplaneEvent[]; truncatedScan: boolean; scanned: number }.
// CrossplanePackagesPayload includes providerApiGroups: string[] (B.5 "Snapshot fetchers").
// CrossplaneCompositesPayload includes operations: OperationRow[] (empty when ops.crossplane.io isn't served).
// Every payload has `errors: CrossplaneSectionError[]` and `fetchedAt: string`. Snapshot payloads also have
// `truncatedKinds: string[]` and `skippedMalformed: number`.
// Every count field used as a table column is a `number` (default 0), never a string (B.4 column conventions).
```

Joins computed in the renderer via pure utils on cached payloads:
- XRD composition count: compositions whose `compositeTypeRef` matches XRD group and kind
- XRD instance count: XRs of that kind
- Composition "XRs using": XRs whose `compositionName` matches

Joins computed in main because they need data the renderer doesn't otherwise fetch:
- Function "used by": compositions
- Runtime config "used by": packages
- Provider `installedDefinitionCount`: revision `objectRefs`

### B.11 Renderer state and refresh

```ts
useCrossplaneQuery<T>(
  fetcher: (force: boolean) => Promise<T>,
  key: string,                                   // e.g. `${clusterName}|packages`; a change triggers a fresh load
  opts?: { autoRefresh?: boolean; minIntervalMs?: number; enabled?: boolean },
): { data: T | null; error: string | null; loading: boolean; refreshing: boolean; refresh: () => void }
```

- `fetcher` is stored in a ref (`fetcherRef.current = fetcher` on every render), so inline closures never restart the interval. The only effect dependencies are `key`, `enabled`, `autoRefresh` and the resolved interval, all primitives. That keeps `react-hooks/exhaustive-deps` satisfied under `--max-warnings 0` without suppressions. A single string `key` replaces a `deps` array for the same reason.
- Interval: the hook reads `window.k8s.settings.getAll()` once (module-level memoised promise, shared by all hook instances) and uses `intervalMs = max(refreshInterval * 1000, 15_000, opts.minIntervalMs ?? 0)`, falling back to `refreshInterval = 30` if the call fails.
- Force semantics:
  - initial load and interval ticks call `fetcherRef.current(false)`, so main TTLs decide whether the cluster is hit
  - `refresh()` (the Refresh button, and Retry buttons) calls `fetcherRef.current(true)`, and is the only caller that forces
- A request-id ref discards responses that resolve after `key` changed or after unmount.
- When `document.visibilityState === 'hidden'`, interval ticks are skipped. A `visibilitychange` listener triggers a non-forced fetch on return if at least `intervalMs` has passed since the last fetch.
- Interval, listener and stale guard are all cleaned up on unmount.
- `enabled: false` (e.g. while detection says not installed) suppresses all fetches.
- On error, previous `data` is kept and `error` is set.
- Payload `fetchedAt` drives "Updated <TimeAgo>".

Cadence per query, matched to main TTLs (B.5):

| Query | `minIntervalMs` | Main TTL | Effect |
|---|---|---|---|
| detect | — (`autoRefresh: false` in views, re-checked on Refresh only) | 60 s | |
| packages, definitions, composites, warningEvents | none (settings interval, ≥15 s) | 15 s | Each tick hits the cluster at most once per TTL |
| getManagedKinds | 5 min | 5 min | |
| scanManaged | 5 min | 5 min | Full rescan at most every 5 min while the Overview or Managed view is open |
| getManagedItems (selected kind) | none (settings interval) | 60 s | Selected kind refreshes at most every 60 s |

Each sub-view uses only the queries it needs:

| View | Queries |
|---|---|
| Overview | detect, packages, definitions, composites, scanManaged (`minIntervalMs: 300_000`), warningEvents, plus subscribe/unsubscribe to `onScanProgress` (filtered by `context === clusterName`) |
| Packages | packages |
| Definitions | definitions, composites (for instance counts) |
| Composites | composites, definitions (for kind list and claim support) |
| Managed | getManagedKinds (`minIntervalMs: 300_000`), scanManaged (`minIntervalMs: 300_000`, summary for counts), getManagedItems for the selected kind (key includes the kind key) |

Derived data such as filters, joins, counts and column arrays is memoised with `useMemo`. Column definitions are module-level constants or `useMemo`, and row-click callbacks use `useCallback`.

Theme: section header with `w-1 h-8 bg-orange-500`; cards `bg-white/5 border border-white/10 rounded-xl`. Health badge colours follow the status table: healthy `bg-green-500/10 text-green-400`; progressing `bg-yellow-500/10 text-yellow-400`; unhealthy `bg-red-500/10 text-red-400`; unknown `bg-gray-500/20 text-gray-300`; paused `bg-gray-500/20 text-gray-300` with a `Pause` icon; none `text-gray-500 "—"`. The text label is always present. Section errors render as a yellow warning card listing `section: message`. The empty state is a centred glass card with a `Cloud` icon, "Crossplane not detected on <cluster>", the detection explanation, and a `GlassButton variant="secondary"` "Retry detection" that calls `window.k8s.crossplane.detect(clusterName, { force: true })`. The loading state uses the standard spinner.

### B.12 Error handling

| Operation | Failure | Recoverable? | Caller receives | Logging (main) |
|---|---|---|---|---|
| Any channel input | zod failure | no (programming error) | Rejection "IPC validation failed: …" | AuditLogger SECURITY (existing `safeHandle`) |
| `createContextKubeConfig` | unknown context or kubeconfig load error | no | Rejection "Unknown kube context: X" | `console.error` |
| Any request | 401 | yes: rebuild kc and retry once; a second 401 is final | Rejection `Unauthorized` | `console.warn` on first, `console.error` on final |
| Any request | timeout (30 s) or network error | detect, getResource, tree root: no. Snapshot section, scan kind, tree child: yes | Rejection with message, or a section/kind/node error entry | `console.warn` with channel, GVR and status only (never bodies) |
| detect `/apis` | fails | no | Rejection. `App.tsx` `.catch` → `hasCrossplane=false` + `console.warn` (existing pattern). `CrossplaneView` shows an error card with Retry | `console.warn` |
| detect core Deployment lookup | 403 / error | yes | `coreRunning: null`, `version: null` | debug |
| Snapshot section list (e.g. providerconfigs) | 403 | yes | Section empty plus `errors[{section, status:403, message}]` | `console.warn` |
| Snapshot section list | 404 (kind not served) | yes | Section empty, no error, feature treated as absent | debug |
| Snapshot section list | 5xx / timeout | yes | Section empty plus error entry; other sections intact | `console.warn` |
| All sections of a snapshot fail with status 0 | connectivity | no | Rejection "Cluster unreachable" | `console.error` |
| getPackages ProviderConfigs phase | ProviderRevisions section failed and no cached kind index | yes | Provider Configs tab empty plus `errors[{section:'providerConfigs', …}]`; other package sections intact | `console.warn` (once, with the ProviderRevisions error) |
| getPackages ProviderConfig discovery | `getGroupResources` fails for a group/version | yes | That version is treated as not serving the plural; if no version serves it, the kind is skipped plus an `errors` entry for `providerConfigs:<group>` | `console.warn` |
| MR kind index | ProviderRevisions 403, or every objectRefs empty | yes | Fallback path, `source:'crdMetadata'` | `console.warn` |
| MR kind index | fallback also fails | yes | `providers: []` plus error entry; Managed view shows the warning | `console.warn` |
| Scan kind | 404 | yes | Kind `active:false` | debug |
| Scan kind | 410 on continue | yes: restart once | On a repeat 410, kind error entry, rows so far discarded | `console.warn` |
| Scan kind | more than 5000 items | yes | `truncated: true` | none |
| Scan | superseded by another context | yes | `status:'cancelled'`, not cached. The renderer ignores it if the context changed, otherwise re-requests | debug |
| Malformed object in a list | missing metadata.name or uid | yes | Skipped; payload `skippedMalformed` count | `console.warn` once per list |
| getResource | Secret requested | no | Rejection "Secrets are not fetched by the Crossplane view" | none |
| getResource | 404 / 403 / other | no | Rejection with sanitised message; Dashboard sets `detailedResource = { error }` (existing path) | `console.warn` |
| getTree | definitions snapshot rejects | yes | Walk continues with an empty XRD set; `warnings[]` entry shown as a muted note | `console.warn` |
| getTree | root fetch fails | no | Rejection; drawer graph area shows a red card with Retry | `console.warn` |
| getWarningEvents | 403 on events list | yes | `events: []` plus `errors[{section:'events', status:403}]`; Overview shows the yellow warning card | `console.warn` |
| getWarningEvents | 410 on continue, or 10-page cap | yes | Events gathered so far, `truncatedScan: true` | debug |
| getWarningEvents | a group-set dependency (detect / definitions / packages) fails | yes | Filter uses the groups that are available; no extra error (the dependency's own call reports it) | debug |
| getManagedItems | awaited scan kind cancelled | yes | Falls through to a direct list (B.5) | debug |
| Drawer extras lookup | snapshot rejects, or key not found | yes | Extras sections show the error inline or "Not in the current snapshot"; rest of drawer unaffected | none (the snapshot call logs) |
| getTree | child 404 / 403 / Secret / error | yes | Node `state` `missing`, `forbidden`, `notFetched` or `error` | debug |
| getTree | more than 300 nodes or depth 6 | yes | `truncated:true`; a banner says "Showing first 300 resources" | none |
| Renderer query | any rejection | yes: Retry button, plus next auto-refresh | Error card with message; previous data kept if present | `console.error('[Crossplane] …')` |

Request-count debug log: the counting `pre` middleware on every API client's Configuration (B.9 `crossplane-api.ts`) increments a per-context counter. When `process.env.LUMEN_DEBUG_CROSSPLANE === '1'`, it logs `[crossplane] <ctx> <METHOD> <path> (n=<count>)`. Because it sits on the Configuration, it also sees client-internal requests such as `KubernetesObjectApi`'s discovery. This is used to verify AC 14 and 15. Paths and query strings contain no secrets (field selectors and continue tokens only); bodies are never logged.

### B.13 Invariants and ownership

| Invariant | Enforced in | Why there |
|---|---|---|
| The section is visible only when Crossplane is detected | `App.tsx` state plus `SecondarySidebar` render; `CrossplaneView` re-checks | The App owns per-cluster capability flags. The view guard covers restored tabs and uninstalls |
| No mutating API calls from the feature | `CrossplaneService` (only GET and LIST implemented) and READ channel names | Main is the trust boundary; the renderer can't bypass it |
| Crossplane objects can't be deleted from the drawer | `Dashboard.tsx` delete-button guard | The only renderer path to `deleteResource` |
| YAML edits respect Safe Mode | Existing `k8s:updateResourceYaml` and `enforceMutationPolicy` | Reuses the audited path |
| Secrets are never fetched by the feature | `crossplane-ipc.ts` handler and `crossplane-tree.ts` | Defence in depth at both entry points |
| Bounded API load (page, caps, concurrency, single scan) | `CrossplaneService` / `crossplane-discovery` | Only main knows the global load |
| Requests hit the intended cluster | Isolated per-context `KubeConfig` in `CrossplaneApi` | Avoids `K8sService`'s shared mutable context |
| One health definition | `src/utils/crossplane-utils.ts` `deriveHealth`, used by main summarisers and the drawer | No duplicated logic (code-quality rule) |
| Every table sort goes through `useResourceSorting` | `GenericResourceView` (internal sorting) plus the numeric branch in `sortResourceData` | Single source of truth for sorting. Numeric correctness is fixed there, not per view |
| Count columns are numbers | Summarisers in `crossplane-utils` (typed `number` fields in `src/types/crossplane.ts`) | The type system enforces it at the source |
| Detection results apply only to the cluster that requested them | `App.tsx` `crossplaneDetectSeq` guard | App owns the per-cluster flag |
| Drawer extras match the displayed object | `CrossplaneResourceDetails` lookup by `crossplaneKey(object)` | `selectedResource` is lossy across in-drawer navigation |
| Bounded LIST concurrency: the scan and `getManagedItems` share one 6-slot semaphore per context, each snapshot fetch runs its sections (including `getPackages`' ProviderConfig discovery) through its own 6-slot semaphore, and kind-index discovery runs at 8. Peaks are as stated in NFR-1 | `crossplane.ts` (scan/items), `crossplane-snapshots.ts` (snapshots), `crossplane-discovery.ts` (discovery) | Only main sees all requests. Snapshots stay off the MR semaphore so the Overview cards are never blocked behind a long scan (NFR-2) |
| Package and event views never wait on MR-group discovery | `crossplane-snapshots.ts`: `getPackages` resolves ProviderConfig kinds itself; `getWarningEvents` uses `providerApiGroups` and only `peekManagedKinds` | Keeps core health off the slowest path (NFR-2) |
| IPC refs contain only ref fields | `toCrossplaneRef` at every renderer call site; `.strict()` `refSchema` in main rejects anything else | The schema is the trust boundary; the helper makes the correct shape the easy one |
| A drawer response applies only to the latest selection | `Dashboard.tsx` `crossplaneDrawerSeq` | `handleResourceClick` is the single entry point for drawer selection |

### B.14 Testability

Unit tests (vitest picks up `**/*.test.ts`, so they are `.ts` and need no DOM):

- `src/utils/crossplane-utils.test.ts`:
  - `deriveHealth` matrix: packages v1 and v2, revisions with RevisionHealthy/RuntimeHealthy and with Healthy only, inactive revision → none, XRD with and without claimNames, XR Synced False ReconcileError → unhealthy, Ready False Creating → progressing, then stuck after 16 min with fixed `now` → unhealthy "Stuck: …", paused annotation, deletionTimestamp, no conditions → unknown, composition → none, `LastAsyncOperation=False` → unhealthy
  - ref extraction for v1 `spec.resourceRefs` vs v2 `spec.crossplane.resourceRefs`, `claimRef` vs labels
  - `parseCrdName` valid and invalid
  - `pickReferenceableVersion`, `pickKindVersion` ordering
  - `resolveKindVersion`: a group whose preferred version `v1beta2` lacks plural `foo` while `v1beta1` lists it → `{ active: true, version: 'v1beta1' }`; plural in the preferred version → the preferred one; plural in no served version → `active: false`
  - `resolveXrdScope`: `spec.scope` present wins; absent at `apiextensions.crossplane.io/v2` → `Namespaced`; absent at `/v1` → `LegacyCluster`
  - operation health: `Succeeded` True/False/Unknown(PipelineRunning) → healthy/unhealthy/progressing, running for 16 min → unhealthy "Stuck: …"; CronOperation `Scheduling=False ScheduleInvalid` → unhealthy, `SchedulePaused` → paused; WatchOperation `Watching=False WatchFailed` → unhealthy
  - `crossplaneKey` is stable, with namespace `''` for cluster-scoped objects; `classifyCrossplaneObject` for core kinds, XR/claim via the XRD list, ProviderConfig, and the `managed` fallback
  - every count field on every `summarize*` output is `typeof 'number'`, including on malformed input
  - warning-event filtering: `filterCrossplaneEvents(events, groups, limit)` keeps only matching groups, sorts by `eventTime ?? lastTimestamp ?? firstTimestamp` descending, de-duplicates by uid, and slices to `limit`
  - every `summarize*` against malformed input (null, missing spec)
  - `collectNeedsAttention` ordering, `countHealth`
  - `toCrossplaneRef`: a full `PackageRow` (with `key`, `uid`, `health`, `revisions`, …) plus a `type` key, run through `toCrossplaneRef`, parses with `refRequestSchema` (imported from `electron/crossplane-ipc-schemas.ts`, which imports only `zod` and `src/types/crossplane`, so it loads under vitest; `crossplane-ipc.ts` imports `safeHandle`, which imports `electron`). The raw row fails that parse. A row with `namespace: ''` yields a ref with no `namespace` key.
  - generic health rule: `Ready=True` only → healthy; `Synced=True, Ready=False ReconcileError` → unhealthy; neither present but `Foo=False` → unhealthy on `Foo`; no conditions → unknown
  - `partitionObjectRefs`: providerconfigs/clusterproviderconfigs vs MR plurals vs ignored plurals, `groups` includes ProviderConfig-only groups; `revisionFingerprint` is order-independent and ignores inactive revisions
- `src/components/dashboard/views/crossplane/crossplane-columns.ts` has no dedicated test; `tsc --noEmit` and lint (no `any`) cover it.
- `src/utils/crossplane-graph.test.ts`: deterministic positions, unhealthy-first ordering, collapse at more than 50 children with a correct "+N" count, focus flag, edge colours, and nodes with `notFetched` state not clickable (data flag).
- `electron/crossplane.test.ts` and `electron/crossplane-tree.test.ts`, with a fake `CrossplaneApi` (the service takes `apiFactory` and `now` by injection):
  - detection installed / not installed / v2 / coreRunning variants
  - TTL hit and miss with a fake clock, `force` bypass, in-flight dedupe (one API call for two concurrent requests)
  - pagination with continue, the 5000 cap → truncated, 410 restart once then error, 404 → inactive
  - 403 section → partial payload with errors, all-status-0 → rejection
  - scan cancellation on context change, LRU eviction of a fourth context
  - Secret refusal, managedFields stripping
  - tree: ascend MR → XR → Claim, namespace inheritance via namespaced discovery, missing/forbidden nodes, 300-node truncation, cycle guard, objectRefs → kind index, fallback activation
  - tree with a cold definitions cache: `getTree` triggers exactly one `getDefinitions` load before ascending; a rejected definitions load still returns a tree with `warnings`
  - kind index with mixed versions: the fake API serves group `ec2.example.io` with preferred `v1beta2` (lists `instances`) and `v1beta1` (lists `instances`, `vpcs`) → `vpcs` is active at `v1beta1` and is scanned. The fake also has one empty kind (0 items), one kind with 1200 items, one with 6000 (capped), a ProviderConfig-only group `example.io` named in `objectRefs`, and one named group that `/apis` does not serve. With detection pre-run on the same service instance, the request count for `getManagedKinds` plus `scanManaged` equals `P + V + Σ pages(n_k)` (NFR-1): the empty kind costs 1, the 1200 kind 3, the 6000 kind 10, and the unserved group 0.
  - `getPackages` with a cold kind index issues no MR-group discovery: the fake records zero `getGroupResources` calls for MR-only groups, and one per served version of each ProviderConfig group. A second `getPackages` within the TTL issues none.
  - fingerprint: build the kind index, then change a ProviderRevision's `resourceVersion` and call `getPackages(force)`. The kind-index entry is evicted and the next `getManagedKinds` rebuilds it. A build in flight while the fingerprint changes resolves for its awaiter but is not cached.
  - `getPackages` with ProviderRevisions 403: package sections intact, `errors` has `providerConfigs`, and with a cached `crdMetadata` index the ProviderConfigs are listed from `peekManagedKinds`
  - `getWarningEvents` with a cold kind index makes no discovery calls, and still keeps an event whose `involvedObject.apiVersion` group is an MR group named in `objectRefs`
  - snapshots: an XR kind with 1200 items → 3 pages; with 6000 → `truncatedKinds` contains it; at most 6 concurrent list calls observed (the fake records peak concurrency); 404 section skipped with no error
  - warning events: 3 pages of mostly pod events with Crossplane events on page 3 → returned, newest first; 403 → `errors` entry; 10-page cap → `truncatedScan`
  - `getManagedItems` during a scan joins the in-flight kind promise (no extra list call) and, after cancellation, lists directly
- `src/hooks/useResourceSorting.test.ts`: as in the B.9 file plan.
- `useCrossplaneQuery` is not unit-tested with a DOM (the repo has no React testing setup, and none is added). Its pure parts are extracted into `src/utils/crossplane-query-utils.ts`: `resolveIntervalMs(settingsSeconds, minIntervalMs)` and `shouldFetchOnVisible(lastFetchedAt, now, intervalMs)`. They are tested in `src/utils/crossplane-query-utils.test.ts`. The ticking behaviour is covered by the manual AC 20 check.

Integration/manual checks (cannot be unit tested: IPC wiring, React rendering, real API semantics):
- kind cluster with Crossplane v2.x, `function-patch-and-transform`, `provider-nop` and a namespaced XRD (crossview's `k8s/crossplane-example` manifests work as fixtures)
- a v1.20 cluster with a LegacyCluster XRD plus claims
- a cluster without Crossplane

Walk ACs 1–21, run with `LUMEN_DEBUG_CROSSPLANE=1` for AC 14 and 15, and toggle Safe Mode to confirm YAML save is blocked. Before handoff, run `npx tsc --noEmit`, `npm run lint` and `npx vitest run`. Per the dev-troubleshooting steering, quit any installed Lumen.app before `npm run dev`.

### B.15 Implementation order

1. `src/types/crossplane.ts`, `src/utils/crossplane-utils.ts`, `src/utils/crossplane-summaries.ts`, `src/utils/crossplane-query-utils.ts` and tests. Refactor `useResourceSorting` into `sortResourceData` plus the numeric branch, with its test.
2. `src/utils/crossplane-graph.ts` and tests.
3. `electron/crossplane-api.ts`, `crossplane-discovery.ts`, `crossplane-snapshots.ts`, `crossplane-tree.ts`, `crossplane.ts` and tests. Then the `k8s.ts` additions.
4. `electron/crossplane-ipc.ts`, `main.ts` wiring, preload, and both `.d.ts` files.
5. `App.tsx` detection with the sequence guard, `SecondarySidebar` group, `view-labels`, `DashboardHeader` titles.
6. `useCrossplaneQuery`, `CrossplaneView` plus empty state, then Overview, Packages, Definitions, Composites, Managed.
7. Drawer: `Dashboard.tsx` wiring (including the `ErrorBoundary` reset key) and `DrawerDetailsRenderer` wiring, then `CrossplaneResourceDetails` with the key-based extras lookup, its sections, and the graph and list.
8. Licence file and attribution headers, then lint, tsc, vitest and the manual AC pass.

### B.16 Risks and backlog

- Risk: editing an MR's YAML can change real cloud infrastructure. This is the same exposure as the existing generic CR YAML flow and is mitigated by Safe Mode and the YAML diff modal. A Crossplane-specific warning banner in the YAML tab is in the backlog.
- Risk: MRD name assumption A2. If it is wrong, inactive MRD kinds show only as "inactive <plural>" from objectRefs, and active kinds are unaffected because they come from discovery.
- Risk: Operations are alpha (`ops.crossplane.io/v1alpha1`) and their fields may change. Summarisers read every field defensively and fall back to "—", and the tab is hidden when the group isn't served.
- Backlog: watches for packages and XRs; Operations actions and `status.pipeline` output rendering; fixing the same detection race for Karpenter/cert-manager; applying the `crossplaneDrawerSeq` check to the existing non-Crossplane `handleResourceClick` branches; ImageConfig/Lock dependency graph; global Crossplane search; a Crossplane AI prompt in `electron/prompts.ts`; pause/resume with ConfirmModal; a full-screen relationship view; Composition `input` pretty-printing; `crossplane beta trace` parity, including connection-secret presence checks.

---

## Responses to review findings

### Round 2 (revision 3)

Review: `design-review.md` / `design-review.json` (CHANGES_REQUESTED, 0 HIGH, 2 MEDIUM, 6 NIT). Every finding is addressed and none is ignored. The only deferred piece is out of the review's own scope: finding 3 limited the sequence check to the `'crossplane'` branch, so adding the check to the existing non-Crossplane branches goes to the B.16 backlog.

| # | Sev | Response | Where |
|---|---|---|---|
| 1 | MED | Addressed as proposed. Pure `toCrossplaneRef` in `crossplane-utils` drops row extras and `type`, omits an empty `namespace`, and keeps `category`. It is required at every renderer IPC call site: the Dashboard `'crossplane'` branch, which covers row, graph-node, reference and post-scale clicks, and `CrossplaneResourceDetails`' `getTree`. The preload does not sanitise, and B.8 says so. `.strict()` stays as the trust boundary. Test: a full `PackageRow` plus `type` fails `refRequestSchema` raw and parses after `toCrossplaneRef`, and `''` is omitted. To make that test importable without Electron, the schemas moved to `electron/crossplane-ipc-schemas.ts`, because `safeHandle` imports `electron`. | B.8, B.9 file plan (`Dashboard.tsx`, `crossplane-ipc-schemas.ts`), B.13, B.14 |
| 2 | MED | Addressed. (a) `getPackages` runs in two phases. Its ProviderConfig phase resolves kinds from its own ProviderRevisions through the shared `partitionObjectRefs` + `resolveGroupKinds` (ProviderConfig groups only) and never awaits `getManagedKinds`. The fingerprint check runs after its own revision list, only evicts the kind-index entry for the next caller, and never re-enters. An in-flight build with a stale fingerprint is not cached. If ProviderRevisions fail, it falls back to `peekManagedKinds` and otherwise reports an error. `getWarningEvents` goes further than the suggested peek-only approach: it filters on the new `providerApiGroups` field (every MR and ProviderConfig group named by active `objectRefs`, no discovery needed), so MR events match even with a cold index. `peekManagedKinds` only adds groups on the `crdMetadata` fallback. (b) Every formula uses `pages(n) = max(1, min(10, ceil(n/500)))`. V covers every named, served group (MR and ProviderConfig), counts only uncached versions, and unserved groups cost 0. (c) AC 14 now has an explicit precondition (fresh start, detection < 60 s old, no other Crossplane call), excludes 401/410 retries, and requires `source: 'providerRevisions'`. With detection warm, the formula is `P + V + Σ pages(n_k)` with no `/apis` term. The B.14 test fake includes an empty kind, a capped kind, a ProviderConfig-only group and an unserved group, plus new tests for no MR discovery in `getPackages`/`getWarningEvents` and for fingerprint eviction. | NFR-1, AC 14, B.5 "MR kind index", "Snapshot fetchers", "Warning events", cache table, B.10, B.12, B.13, B.14 |
| 3 | NIT | Addressed. `crossplaneDrawerSeq` is incremented at the top of `handleResourceClick` for every type, so a pending Crossplane fetch can't overwrite a later pod or other selection. The `'crossplane'` branch is an early-return block with its own try/catch that applies the result or error only when the sequence still matches. Adding the guard to the existing branches is backlogged, because it is an existing behaviour in a file with uncommitted user changes. | B.9 `Dashboard.tsx` row, B.13 |
| 4 | NIT | Addressed, with a corrected count. NFR-1 now lists per-path limits: 6 per snapshot fetch, 8 for kind-index discovery, 6 shared by scan and items, 1 for events. Because `getComposites` waits for `getDefinitions`, at most two snapshot fetches overlap, so the Overview peaks at ≤ 21 per context (≤ 19 while the scan lists), and a drawer graph can add ≤ 8. This is tighter than the review's ≈ 25. | NFR-1, B.5 "Snapshot fetchers", B.13 |
| 5 | NIT | Addressed. B.6 rule 4 defines the generic rule: required = the present subset of {`Synced`, `Ready`}, else all conditions, else `unknown`. It applies to `usage`, `activationPolicy` and CompositionRevisions (`deriveHealth('generic', …)`). B.3 now points at it for MRAP, Usage and CompositionRevision, and MRD conditions are marked display-only. Unit tests were added. | B.3, B.6, B.14 |
| 6 | NIT | Addressed. B.3 and NFR-6 both cite `main` @ `58ad722` (A13). FR-1 now says "installed" comes from one `/apis` call, with bounded cached calls only when installed. | FR-1, NFR-6, B.3, B.5 step 3 |
| 7 | NIT | Addressed and re-verified against the chart on `main`. `deployment.yaml` has `app: {{ template "crossplane.name" . }}`, and `_helpers.tpl` adds `app.kubernetes.io/name` to both the core and rbac-manager Deployments. A3 is marked verified with the `nameOverride` caveat. Detection tries `app=crossplane`, then `app.kubernetes.io/name=crossplane`, excluding `*-rbac-manager` and preferring `metadata.name === 'crossplane'`. | A3, A13, B.5 Detection step 4 |
| 8 | NIT | Addressed with the helper option. `crossplane-columns.ts` exports `col<R>()` with a single documented cast, plus `healthColumn()`. It is a `.ts` file using `createElement`, because `.eslintrc.cjs` enables `react-refresh/only-export-components`, which would warn on non-component exports from a `.tsx` file and fail `--max-warnings 0`. | NFR-5, B.4 "Column conventions", B.9 file plan |

Other revision 3 changes:
- The summariser split into `src/utils/crossplane-summaries.ts` is now decided up front, because revision 3 added helpers to `crossplane-utils`. B.1 attribution is updated to match.

### Round 1 (revision 2)

Review: first `design-review.md` (CHANGES_REQUESTED, 1 HIGH, 9 MEDIUM, 12 NIT). Every finding was addressed. Where a round 2 change supersedes a round 1 response, it is noted inline.

| # | Sev | Response | Where |
|---|---|---|---|
| 1 | HIGH | Addressed. MR kinds are resolved per (group, version): every served version's resource list is fetched, `active` = any served version lists the plural, and the version is the preferred one if it lists the plural, else the highest via `pickKindVersion`. The request formula from this round is superseded by NFR-1 / AC 14 in revision 3. Unit tests cover the mixed-version case. | B.5 MR kind index steps 4–5, NFR-1, AC 14, B.14 |
| 2 | MED | Addressed. Events are paged 500/page with a 10-page (5000) cap, filtered by `involvedObject` group against Crossplane, MR/ProviderConfig, XR and claim groups, sorted by `eventTime ?? lastTimestamp ?? firstTimestamp` descending, and sliced to `limit`. Returns `truncatedScan`. The adapter method is `listWarningEventsPage`. | B.5 "Warning events", B.8, B.9, B.12, AC 25 |
| 3 | MED | Addressed. A shared `listAllPages` helper (500/page, 5000 cap, 404/403/410 semantics) is used by every LIST. Snapshot sections run at concurrency 6, XR/claim kinds are listed at the referenceable version, and payloads carry `truncatedKinds` and `skippedMalformed`. `S` added to NFR-1. | B.5 "Shared list helper" and "Snapshot fetchers", NFR-1, B.10 |
| 4 | MED | Addressed. `useResourceSorting` gets a generic numeric branch via an extracted pure `sortResourceData`, with tests. Count fields are typed `number`, Health sorts on `healthOrder` with a badge `cellRenderer`, and `collectNeedsAttention` pre-sorts. | B.4 "Column conventions", B.4.1, B.6, B.9, B.10, B.13, AC 22 |
| 5 | MED | Addressed. `crossplaneDetectSeq` ref guard in `App.tsx`: reset at the start of `handleClusterSelect` (before pre-flight) and in `onBack`. | B.5 Detection, B.13, AC 23 |
| 6 | MED | Addressed. `CrossplaneResourceDetails` resolves its category from the object and its extras by `crossplaneKey(object)` from cached snapshots. It never reads extras from `selectedResource`, and has defined loading, not-found and error states. | B.9 "Drawer data flow", B.13, AC 24 |
| 7 | MED | Addressed. The hook takes `opts { autoRefresh, minIntervalMs, enabled }`. Ticks call `fetcher(false)` and only `refresh()` forces. The scan has `minIntervalMs` 5 min, its summary TTL is raised to 5 min, and items keep a 60 s TTL. There is a per-query cadence table. | B.11, B.5 cache table, FR-11, AC 20 |
| 8 | MED | Addressed. `electron/preload.ts` is added to the AC 19 exemption (additive edit). The optional `preload-crossplane.ts` split is declined: there is no precedent for local imports in the preload bundle, and the block is only ~35 lines. | AC 19, B.9 file plan |
| 9 | MED | Addressed. One rule in `resolveXrdScope`/`summarizeXrd`, keyed on the read apiVersion. AC 8 is updated, and the v1/v2 default was verified in source (A13). Both cases are unit-tested. | AC 8, B.3, B.6, B.14 |
| 10 | MED | Addressed. A read-only Operations tab under Composites (Operation, Cron, Watch sub-tabs) with category `operation`. Health rules were verified against `apis/ops/v1alpha1` (`Succeeded`, `Scheduling`, `Watching` and their reasons). Failed or stuck operations go to Needs attention. A.5 now excludes only Operations actions. | FR-6, A.5, A13, B.3, B.4.4, B.6, B.10, AC 9 |
| 11 | NIT | Addressed. `DashboardHeader.tsx` `titleMap` entries added to the file plan with exact titles. | B.4, B.9 |
| 12 | NIT | Addressed. `withTimeout(promise, 30_000, \`crossplane ${method} ${path}\`)`. Non-cancellation is noted; `AbortSignal` is checked between pages. | B.9 `crossplane-api.ts` |
| 13 | NIT | Addressed. `<div className="h-[400px]">` wrapper. | B.4.1 |
| 14 | NIT | Addressed. Canonical zod schemas in a code block, all `.strict()`, matching the installed zod 3.25.76 and the `safeHandle` signature. | B.8 |
| 15 | NIT | Addressed. `getTree` step 0 awaits `getDefinitions(ctx)`, with defined degradation if that fails. | B.7, B.12, B.14 |
| 16 | NIT | Addressed with both suggestions. Grouped kinds use `CustomObjectsApi` with the cached plural, and `KubernetesObjectApi.read` is used only for core `v1`. All clients are built with a counting `PromiseMiddleware` on the Configuration, so internal discovery is counted too. | A12, B.7, B.9, B.12, AC 14 |
| 17 | NIT | Addressed. `getManagedItems` joins in-flight scan kinds via a per-kind promise map, otherwise lists through the shared semaphore, and falls back to a direct list after cancellation. | B.5 "MR scan and items", B.14 |
| 18 | NIT | Addressed. `selectedResource?.kind` appended to the drawer `ErrorBoundary` `resetKey`. | B.9 `Dashboard.tsx` row |
| 19 | NIT | Addressed. `findIndex(g => g.id === 'access')` insertion after the cert-manager block, plus `openGroups 'crossplane': true`. | B.4 |
| 20 | NIT | Addressed. Snapshot fetchers pre-split into `electron/crossplane-snapshots.ts` (~300); `crossplane.ts` is now ~330. | B.9 file plan |
| 21 | NIT | Addressed. `if (win && !win.isDestroyed())` guard in `emitProgress`. | B.9 |
| 22 | NIT | Addressed. Fetcher kept in a ref, with a primitive `key` string instead of a deps array. Pure timing helpers are extracted for unit tests (there is no React test setup in the repo). | B.11, B.14 |

Also closed from the review's "unverified" list:
- the crossview commit, licence, absence of `NOTICE`, and cited files
- Crossplane package, XRD, MRD/MRAP, Usage and Operations API facts (A13)
- `loadResources()` being a no-op for `crossplane-*` views (`Dashboard.tsx:749`)

Still unverified after revision 3, each with safe degradation:
- the MRD naming assumption (A2)
- the XR `spec.crossplane.*` schema in generated source (both layouts are read)
- whether v2 ProviderRevision `status.objectRefs` lists MRDs and/or CRDs for every provider family (the `crdMetadata` fallback covers empty `objectRefs`)

The Helm label (A3) was verified in revision 3.

---

## Amendments from review v3

Source: `design-review.md` (review of Draft v3, CHANGES_REQUESTED, 0 HIGH / 2 MEDIUM / 4 NIT). Every amendment below is BINDING and overrides any conflicting text earlier in this document. Each is applied exactly as the review's "Fix" text describes.

### AM-1 (review finding 1, MEDIUM): revision categories, row types, classifier null fallback

1. `CROSSPLANE_CATEGORIES` (B.10, and therefore the zod `refSchema` enum in B.8, which imports it) becomes exactly:
   ```ts
   export const CROSSPLANE_CATEGORIES = ['provider', 'function', 'configuration', 'packageRevision', 'providerConfig',
     'runtimeConfig', 'activationPolicy', 'xrd', 'composition', 'compositionRevision', 'environmentConfig',
     'composite', 'claim', 'usage', 'operation', 'managed'] as const;
   ```
2. `deriveHealth` gets explicit rules for the new categories: `packageRevision` uses the B.6 rule 4 revision rule (`RevisionHealthy` + `RuntimeHealthy` if present, else `Healthy`; `desiredState: Inactive` → `none`). `compositionRevision` uses the generic rule. B.6's sentence "CompositionRevisions have no row category, so their summaries call `deriveHealth('generic', …)`" is superseded: they call `deriveHealth('compositionRevision', …)`.
3. Revision summaries are real rows. `PackageRevisionSummary` is removed and replaced by:
   ```ts
   export interface RevisionRow extends CrossplaneRowBase {
     packageName: string; revision: number; desiredState: 'Active' | 'Inactive'; image: string;
   }
   ```
   `PackageRow.revisions` becomes `RevisionRow[]`. Revision rows carry `category: 'packageRevision'`.
4. `export type NeedsAttentionRow = CrossplaneRowBase;` is the return type of `collectNeedsAttention` (element type of its array).
5. Classifier: `classifyCrossplaneObject` maps `pkg.crossplane.io` `*Revision` kinds (ProviderRevision, FunctionRevision, ConfigurationRevision) to `packageRevision`, and `CompositionRevision` to `compositionRevision`. For any other kind in a core Crossplane group (`apiextensions.crossplane.io`, `pkg.crossplane.io`, `protection.crossplane.io`, `ops.crossplane.io`) that is not a known category (ManagedResourceDefinition, ImageConfig, Lock, …) it returns `null`. The drawer fallback (B.9 "Drawer data flow") becomes `classifyCrossplaneObject(object, definitionsPayload) ?? refHint.category ?? null`. A `null` category renders only the generic sections: banner via `deriveHealth('generic', …)`, conditions, events, YAML. It NEVER renders as `managed`. `managed` is returned by the classifier only when the group is NOT a core Crossplane group (and the object is not a ProviderConfig/XR/claim).
6. Tests added to `src/utils/crossplane-utils.test.ts`: `deriveHealth('packageRevision', …)` for v2 (RevisionHealthy/RuntimeHealthy), v1 (Healthy only) and Inactive → none; `classifyCrossplaneObject` ProviderRevision → `packageRevision`, CompositionRevision → `compositionRevision`, MRD → `null`; a Needs-attention row built from an unhealthy revision parses through `toCrossplaneRef` and `refRequestSchema`.

### AM-2 (review finding 2, MEDIUM): drawer sections per category and `resolveDrawerRefs`

New B.9 sub-section "Drawer sections per category". `CrossplaneDetailSections` follows this table exactly. Every clickable reference is built by one pure helper in `src/utils/crossplane-utils.ts`:

```ts
export interface DrawerLink { label: string; ref?: CrossplaneObjectRef; text: string; }   // ref absent → render as text
export function resolveDrawerRefs(
  category: CrossplaneCategory | null,
  object: unknown,
  ctx: { detection: CrossplaneDetection; packages?: CrossplanePackagesPayload; definitions?: CrossplaneDefinitionsPayload },
): DrawerLink[];
```

| Category | Sections | Clickable refs → how `apiVersion` is resolved |
|---|---|---|
| provider / function / configuration | Package (`spec.package`, pull policy, `revisionActivationPolicy`), Revisions table, Installed definitions count (provider), Used by compositions (function), Dependencies (configuration) | runtimeConfigRef → `kindVersions.DeploymentRuntimeConfig`; revision rows → `kindVersions.<Kind>Revision` (category `packageRevision`); used-by → `kindVersions.Composition` |
| packageRevision | Image, revision, desiredState, objectRefs count | owner package → ownerReference apiVersion/kind |
| runtimeConfig / providerConfig / activationPolicy / environmentConfig | Used by packages / users count + credentials source (text) / patterns + activated count / data keys only (values not rendered) | used-by packages → their row ref; ProviderConfig `credentials.secretRef` is text only |
| xrd | Names, versions (served/referenceable), scope, claim names, default composition | compositions → `kindVersions.Composition`; default/enforced composition likewise |
| composition / compositionRevision | Composite type, mode, pipeline steps | functionRef → `kindVersions.Function`; compositeTypeRef → the XRD `<plural>.<group>` from the definitions payload (text if not found); revisions → `kindVersions.CompositionRevision` |
| composite / claim | Composition, revision, update policy, claim/XR, connection secret (text), composed count | compositionRef/RevisionRef → core kindVersions; claimRef / resourceRef use their own apiVersion/kind |
| managed | external-name, providerConfig, managementPolicies, deletionPolicy, owning composite | providerConfigRef → find the `providerConfig` row in `getPackages` with `providerName === row.providerName`, `kind === (ref.kind ?? 'ProviderConfig')` and matching name (and namespace for `ProviderConfig` on a namespaced MR); if not found, text only. Composite → controller ownerReference |
| usage | Of, By, reason, replayDeletion | `resourceRef` → link using `spec.of.apiVersion/kind` (namespace = the Usage's namespace for namespaced Usages); `resourceSelector` → text `selector: k=v,…` |
| operation | Pipeline table; Cron: schedule, running operations; Watch: watched kind | functionRef → `kindVersions.Function`; `runningOperationRefs` → `kindVersions.Operation` |
| `null` (unknown core-group kind) | none beyond the generic sections | none |

Rule for every row: a ref whose kind is `Secret` in core `v1`, or that `toCrossplaneRef` + `refSchema.safeParse` would reject, is emitted with no `ref` and renders as plain `font-mono` text, never as a link. Secret references (`writeConnectionSecretToRef`, ProviderConfig `credentials.secretRef`, claim connection secrets) are never links. `resolveDrawerRefs` is unit-tested per category row above, including: unresolvable kindVersion → text; providerConfigRef not found → text; Usage `resourceSelector` → text; Secret ref → text; compositeTypeRef with and without matching XRD. Implementation decision (planner, keeps renderer code free of electron imports): the B.8 regex constants (`DNS_SUBDOMAIN`, `DNS_LABEL`, `API_VERSION`, `KIND`, `KIND_KEY`) and length limits move to `src/types/crossplane.ts` as exported constants; `electron/crossplane-ipc-schemas.ts` imports them, and `crossplane-utils` exports `isValidCrossplaneRef(ref): boolean` built on the same constants. `resolveDrawerRefs` and the Warning-event click (AM-4) use `isValidCrossplaneRef(toCrossplaneRef(x))` as "parses". The tests assert every emitted `ref` also parses with `refRequestSchema`.

### AM-3 (review finding 3, NIT): `scanManaged` kind list and `force` semantics

- `scanManaged` always calls `getManagedKinds(ctx, { force: false })`, which joins any in-flight build (forced or not).
- `force` on `scanManaged` bypasses only the scan-summary cache.
- General rule for every cached call in `CrossplaneService`: `force` skips the cached value but JOINS any in-flight promise for the same cache key. It never starts a second concurrent fetch for that key. Test: two concurrent calls, one forced, issue one API request.

### AM-4 (review finding 4, NIT): AC 4 cap, footer, Warning-event click, `createElement`, AC 22

- AC 4 now reads: "Every object with health `unhealthy` (including progressing objects stuck for more than 15 minutes) appears in Needs attention with reason and message, except that managed resources are limited to the first 200 by `healthOrder` (the scan's `unhealthy` cap). Clicking a row opens the drawer for that object." When the scan summary's `byHealth` totals show more unhealthy MRs than were included, the Needs-attention table shows a muted footer "+N more unhealthy managed resources" that links to Managed → All unhealthy (`onNavigate('crossplane-managed')` with the Managed view selecting "All unhealthy").
- Warning events (B.4.1 item 5): if `toCrossplaneRef(involvedObject)` parses (structurally valid ref), clicking the event opens the drawer via `handleResourceClick(ref, 'crossplane')` (`onResourceClick(ref, 'crossplane')`); otherwise the event is not clickable (no pointer cursor, no button role).
- B.4 "Column conventions": `healthColumn`'s renderer is `createElement(CrossplaneHealthBadge, { health: row.health, reason: row.healthReason })` (the helper file is `.ts`), not JSX.
- AC 22's count-column list adds Running (`runningCount`), Count (`watchingResources`) and Deps (`depsInstalled`).

### AM-5 (review finding 5, NIT): Definitions view cadence

The Definitions view calls the `composites` query with `minIntervalMs: 120_000`. The 15 s cadence (settings interval, ≥15 s) for `composites` stays only in the Composites and Overview views. (The optional 30 s TTL is not adopted.)

### AM-6 (review finding 6, NIT): `useResourceSorting` extraction

The extraction keeps the returned property name `getSortedData` (the hook still returns `{ sortConfig, handleSort, getSortedData, … }` exactly as today) and keeps the existing special keys (`age`, `restarts`, `cpu`, `memory`, `replicas`, `status`) in their current order before the new numeric branch. No Crossplane column may use `dataKey: 'status'` or `dataKey: 'replicas'`.
