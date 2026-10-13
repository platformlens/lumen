# Design Review: Crossplane UI (design.md, Draft v3)

Verdict: CHANGES_REQUESTED (0 HIGH, 2 MEDIUM, 4 NIT)

Draft v3 resolves all 8 findings from round 2. I re-checked the fixes against the source:
- `toCrossplaneRef` plus the schemas split into `crossplane-ipc-schemas.ts`
- two-phase `getPackages` with `providerApiGroups`
- the `pages(n)` formula in NFR-1 and AC 14
- the drawer sequence guard
- the generic health rule
- the A3 labels
- the typed `col<R>()` helper

The overall answers to the step's questions are:
- Licence: sound and recorded (B.1). Crossview is Apache-2.0, Lumen is BSD-3-Clause. Attribution headers go on three named files, and the licence ships in `public/licenses/` (Vite copies it into `dist/`, which electron-builder packages).
- Concept coverage: complete for v1 and v2. The design covers namespaced XRs, claims hidden or de-emphasised, read-only Operations/Cron/Watch, packages with revisions, runtime configs and MRAPs, XRDs, Compositions and CompositionRevisions, MRs with active/inactive MRD kinds, EnvironmentConfigs, legacy and protection Usages, conditions and events.
- Detection: concrete (`/apis` → group check → core group resources → Deployment label fallback), with a sequence guard.
- MR discovery: efficient and lazy. It is per (group, version) from `ProviderRevision.status.objectRefs`, never downloads CRD bodies, and caches per context with TTLs, an LRU and in-flight dedupe.
- Lumen patterns: followed (electron module, `safeHandle` + zod, preload bridge, `GenericResourceView`/`useResourceSorting`, `@xyflow/react`, pure utils, theme, strict TS, <500 lines, virtualisation).
- Read-only scope and uncommitted user changes: both respected.

Two MEDIUM gaps remain, both in the drawer and Needs-attention path:
- Package revisions and CompositionRevisions have no category, yet they feed Needs attention and the health rules.
- The per-category drawer sections, and how name-only references become navigable refs, are not specified at all.

## Findings

### 1. MEDIUM: Revisions (and other core-group kinds) have no category, but the health rules, Needs attention and the drawer depend on one (B.6 rule 4, B.4.1 item 4, B.9 "Drawer data flow", B.10)

Problem:
- `deriveHealth(category: CrossplaneCategory | 'generic', …)` selects rules by category. Rule 4 has a "revisions" rule (`RevisionHealthy` + `RuntimeHealthy`, else `Healthy`, and `desiredState: Inactive` → `none`), but `CROSSPLANE_CATEGORIES` has no revision value. The function therefore can't be asked for the revision rule. `'generic'` would give the wrong answer, because revisions have no `Synced`/`Ready`, so every condition becomes required, including `RuntimeActive`.
- B.4.1 lists "revisions" as a Needs-attention source, and AC 4 says clicking a row opens that object's drawer. But `PackageRevisionSummary` has no `apiVersion`, `kind`, `key`, `uid`, `healthOrder` or `category`. `CrossplaneRowBase.category` is required and typed `CrossplaneCategory`, so no valid Needs-attention row can be built for a revision. B.6 itself says CompositionRevisions "have no row category". The output row type of `collectNeedsAttention` is never defined.
- `classifyCrossplaneObject(...) ?? refHint.category ?? 'managed'`: a ProviderRevision, FunctionRevision, ConfigurationRevision, CompositionRevision, MRD, ImageConfig or Lock reaching the drawer (via a Needs-attention row, a Warning-event click, or a future link) is classified `managed`. It then gets Synced/Ready health and MR sections, which is wrong. ProviderRevision Warning events are among the most common Crossplane warnings.

Fix:
1. Extend the category list. The zod `refSchema` enum follows automatically, because it imports the constant.
   ```ts
   export const CROSSPLANE_CATEGORIES = ['provider', 'function', 'configuration', 'packageRevision', 'providerConfig',
     'runtimeConfig', 'activationPolicy', 'xrd', 'composition', 'compositionRevision', 'environmentConfig',
     'composite', 'claim', 'usage', 'operation', 'managed'] as const;
   ```
2. Give `deriveHealth` explicit rules for the new categories:
   - `packageRevision` uses the revision rule from B.6 rule 4, including Inactive → `none`.
   - `compositionRevision` uses the generic rule.
3. Make revision summaries real rows:
   ```ts
   export interface RevisionRow extends CrossplaneRowBase {
     packageName: string; revision: number; desiredState: 'Active' | 'Inactive'; image: string;
   }
   ```
   `PackageRow.revisions` becomes `RevisionRow[]`, replacing `PackageRevisionSummary`.
4. Define `export type NeedsAttentionRow = CrossplaneRowBase` as the return type of `collectNeedsAttention`. Every source already provides a `CrossplaneRowBase` after step 3.
5. Fix the classifier:
   - `classifyCrossplaneObject` maps `pkg.crossplane.io` `*Revision` kinds to `packageRevision`, and `CompositionRevision` to `compositionRevision`.
   - For any other kind in a core Crossplane group that is not a known category (MRD, ImageConfig, Lock, …), it returns `null`.
   - The drawer fallback becomes `?? refHint.category ?? null`. A `null` category renders only the generic sections (banner via `deriveHealth('generic')`, conditions, events, YAML) and never `managed`. Use `managed` only when the group is not a core Crossplane group.
6. Add tests:
   - `deriveHealth('packageRevision', …)`: v2, v1, Inactive
   - `classifyCrossplaneObject`: ProviderRevision → `packageRevision`, MRD → `null`
   - a Needs-attention row from an unhealthy revision parses through `toCrossplaneRef` and `refRequestSchema`

### 2. MEDIUM: Per-category drawer sections and reference navigation are unspecified (FR-8, AC 11, AC 24, B.9 `CrossplaneDetailSections.tsx`)

Problem: FR-8 promises "category-specific sections with clickable references that navigate within the drawer", and AC 24 tests their parity. But the only specification is the file-plan line "Per-category sections. (~400)" and the extras list in "Drawer data flow".

For 14+ categories, nothing says which fields each section shows or which references are clickable. Nothing says how name-only references become a `CrossplaneObjectRef` with an `apiVersion`, which `refSchema` requires. Examples of name-only references:
- MR `spec.providerConfigRef{name, kind?}`: the group is the provider's ProviderConfig group (e.g. `aws.upbound.io` or `aws.m.upbound.io`). It cannot be derived from the MR's own group, such as `ec2.aws.upbound.io`.
- XR `compositionRef` / `compositionRevisionRef`
- package `runtimeConfigRef`
- Composition `pipeline[].functionRef`
- Composition `compositeTypeRef`, which should navigate to the XRD named `<plural>.<group>`
- CronOperation `runningOperationRefs`
- Usage `spec.of` / `spec.by`, which may use `resourceSelector` instead of `resourceRef`

An implementer would either guess or emit refs that fail `.strict()` validation at runtime. It is also unspecified whether Secret references (`writeConnectionSecretToRef`, ProviderConfig `credentials.secretRef`) render as links. They must not, because of NFR-4.

Fix: add a B.9 sub-section "Drawer sections per category" with a table like this, and have `CrossplaneDetailSections` follow it exactly. A pure helper `resolveDrawerRefs(category, object, ctx: { detection, packages?, definitions? }): DrawerLink[]` in `crossplane-utils` builds every link, and is unit-tested.

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

Rule for every row: a ref whose kind is `Secret` in core `v1`, or that `toCrossplaneRef` + `refSchema.safeParse` would reject, renders as plain `font-mono` text, never as a link.

### 3. NIT: How `scanManaged` gets its kind list, and how `force` interacts with in-flight dedupe, is implicit (B.5 "MR scan and items", cache table)

B.5 says the scan "covers all active kinds", but never says that it awaits `getManagedKinds(ctx)`. It also doesn't say whether `scanManaged(force)` forces the index, or whether a forced call joins or replaces an in-flight promise for the same key. The Managed Refresh button forces `getManagedKinds`, `scanManaged` and `getManagedItems` together, so the ordering matters: the scan could use the old index while a new one builds.

Fix: add these rules.
- `scanManaged` always calls `getManagedKinds(ctx, { force: false })`. That joins any in-flight build, forced or not.
- `force` on `scanManaged` bypasses only the scan-summary cache.
- In general, `force` skips the cached value but joins any in-flight promise for the same cache key. It never starts a second concurrent fetch for that key.

### 4. NIT: Small conflicts and unspecified UI behaviour

- AC 4 says "every object with health `unhealthy` appears in Needs attention", but the scan's `unhealthy` list is capped at 200 (B.5). Reword AC 4 to say MRs are limited to the first 200 by `healthOrder`. Also show a muted footer "+N more unhealthy managed resources" linking to Managed → All unhealthy (the scan summary's `byHealth` gives N).
- B.4.1 doesn't say what clicking a Warning event does. Specify it: if `toCrossplaneRef(involvedObject)` parses, open the drawer with `handleResourceClick(ref, 'crossplane')`; otherwise the event is not clickable.
- B.4 "Column conventions" shows `healthColumn`'s renderer as JSX (`<CrossplaneHealthBadge …/>`), but the helper file is `.ts` and uses `createElement`. Change the bullet to the `createElement(CrossplaneHealthBadge, { health: row.health, reason: row.healthReason })` form.
- AC 22's count-column list omits Running (`runningCount`), Count (`watchingResources`) and Deps (`depsInstalled`), all of which are numeric per B.4. Add them.

### 5. NIT: The Definitions view pulls full composite snapshots just for instance counts (B.11 view/query table)

Definitions queries `composites`, which LISTs every XR and every claim kind (paged, full bodies) once per 15 s TTL at the settings interval (default 30 s). On a platform with 50 XRDs that offer claims, that is about 100 LISTs every 30 s while a view only shows counts. The cost is bounded, but it is the heaviest steady-state load in the feature apart from the scan.

Fix:
- In the Definitions view, call `composites` with `minIntervalMs: 120_000`. Instance counts can be two minutes stale.
- Keep the 15 s cadence only in the Composites and Overview views.
- Optionally add a `composites` TTL of 30 s when there are more than 20 XR+claim sections.

### 6. NIT: Wording drift in B.9 for `useResourceSorting`

The hook returns `getSortedData` as an alias of its inner `sortedData` (`GenericResourceView.tsx:240` calls `internalSorting.getSortedData`). The plan is correct, but the extraction must keep the returned property name `getSortedData` and the existing special keys (`age`, `restarts`, `cpu`, `memory`, `replicas`, `status`) in their current order before the new numeric branch. Also, no Crossplane column may use `dataKey: 'status'` or `'replicas'`, because those keys take the special branches. State both in the file-plan row.

## Verified assumptions

- KiroGraph is initialised (`.kirograph/` exists). Lookups here were directed file reads.
- Licence status is unchanged since round 2, which verified the crossview SHA, its Apache-2.0 `LICENSE` and the missing `NOTICE`. Packaging: `electron-builder.json5` `files` includes `dist`, `vite.config.ts` doesn't override `publicDir`, and `public/` has no `licenses/` directory yet, so adding it is additive.
- `.eslintrc.cjs` sets `react-refresh/only-export-components: ['warn', { allowConstantExport: true }]`, and lint runs with `--max-warnings 0`. A function export like `col()` from a `.tsx` file would still warn, so the `.ts` choice for `crossplane-columns.ts` is justified.
- `IColumn` (`VirtualizedTable.tsx:102–111`) has `cellRenderer?: (cellData: any, rowData: any)`. The `col<R>()` helper's return is assignable, and the import path `../../../shared/VirtualizedTable` from `views/crossplane/` is correct.
- `GenericResourceView`:
  - uses `TableVirtuoso` and `useResourceSorting().getSortedData`
  - its search matches `item.metadata?.name || item.name` and the namespace equivalent
  - its namespace filter keeps rows without a namespace
  - its container is `h-full min-h-[400px]`
- `useResourceSorting.ts` has no uncommitted changes. Its special keys and default `toString().toLowerCase()` comparison are as the design describes.
- `Dashboard.tsx`:
  - `handleResourceClick` is at line 986, with `setDrawerTab('details')` at 990 and the include-list at 994
  - the delete guard is at 1467 and the `ErrorBoundary` `resetKey` at 1488
  - `onOpenYaml(selectedResource)` is at line 1414
- `App.handleOpenYaml` (line 1095): an unmapped `type` with `apiVersion` and `kind` takes the custom-resource path, and `namespace: ''` is treated as cluster-scoped. Crossplane rows therefore open YAML correctly.
- `App.tsx`:
  - `handleClusterSelect` is at line 764
  - the cert-manager and Karpenter checks are at lines 807–821, inside the same `try`
  - `setSelectedCluster(null)` is at line 1676
  - `hasKarpenter` and `hasCertManager` are passed to `SecondarySidebar`

  The detection placement and sequence guard are feasible.
- `SecondarySidebar`: `STANDARD_MENU` is built in the component (line 273), has `helm` and `access` groups, and the cert-manager block uses `splice(1, 0, …)` (line 345).
- `DashboardContent`:
  - the `ResourceType` union is at line 21
  - `onResourceClick`, `onNavigate` and `selectedNamespaces` are props
  - Karpenter is routed by `activeView === 'karpenter'`
- `DashboardHeader.getViewTitle` has `titleMap` with the capitalise fallback (line 76).
- `mutation-policy.ts`: MUTATE and DESTRUCTIVE patterns are all `^k8s:…`, so `crossplane:*` channels classify as READ.
- `safeHandle<T extends z.ZodType>` is in `electron/ipc/`. `sanitizeK8sErrorMessage` (`k8s.ts:58`) is not exported yet. `loadFromDefault()` is at `k8s.ts:170`. `k8s:forceCredentialRefresh` is at `main.ts:600`.
- Package versions: zod 3.25.76, `@kubernetes/client-node` ^1.4.0, `@xyflow/react` ^12.10.0, `react-virtuoso` ^4.18.4, vitest ^4.0.18, electron ^42.1.0. `vitest.config.ts` includes `**/*.test.ts`.
- `src/lib/with-timeout.ts` exists. `src/types/` holds `pod-worker.ts` and `deployment-details.ts`, so shared types have precedent.
- File sizes:
  - `preload.ts` 521, `main.ts` 3320, `k8s.ts` 4061, `Dashboard.tsx` 1589, `App.tsx` 1969, `SecondarySidebar.tsx` 774 and `DashboardContent.tsx` 1009 are all on the AC 19 list
  - `DrawerDetailsRenderer.tsx` (348) and `view-labels.ts` (83) stay under 500 after additive edits
- Uncommitted user changes: `git status` shows modifications to `k8s.ts`, `main.ts`, `preload.ts`, both `.d.ts` files, `App.tsx`, `Dashboard.tsx`, `SecondarySidebar.tsx`, `view-labels.ts`, `KarpenterView.tsx` and others. The design limits itself to additive `str_replace` edits with a re-read before each edit. It does not touch `KarpenterView.tsx`, `NodesView.tsx`, `LogViewer.tsx`, `terminal.ts` or the untracked user files.

## Unverified or wrong assumptions

- Wrong: rule 4 defines a "revisions" health rule, but no category value can select it, and revision Needs-attention rows have no valid shape (finding 1).
- Wrong: the drawer fallback `?? 'managed'` misclassifies non-MR core Crossplane kinds such as revisions, MRDs and Locks (finding 1).
- Wrong: AC 4's "every unhealthy object" conflicts with the 200-item MR unhealthy cap (finding 4).
- Unverified: the Crossplane `apis/` facts in A13 (conditions, scopes, ops kinds). I did not re-fetch upstream this round. Discovery-driven versions and defensive summarisers limit the impact if any have changed.
- Unverified: the generated XR `spec.crossplane.*` schema. The design reads both layouts, which is a safe hedge.
- Unverified: MRD names follow `<plural>.<group>` (A2). The documented degradation is safe.
- Unverified: v2 ProviderRevision `status.objectRefs` lists CRDs/MRDs for every provider family. The `crdMetadata` fallback covers empty `objectRefs`.
- Unverified: the exact line numbers in `App.tsx` and `Dashboard.tsx` may shift, because those files carry uncommitted, actively changing edits. The design already requires a re-read before each edit.
