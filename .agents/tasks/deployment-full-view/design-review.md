# Design Review: Deployment Full View (revision 3)

Reviewer: design-review step (fresh context). Scope: `design.md` rev 3, checked against the current source. No builds or tests were run.

## Verdict: CHANGES_REQUESTED (0 HIGH, 2 MEDIUM, 9 NIT)

Rev 3 is solid. Navigation, the aggregated IPC shape, per-section RBAC handling, the security merge rules, the timeline/diff contract and the util/test split are all concrete. Most of them check out against the code. Two medium gaps remain. One is a cross-cluster race in the data hook that contradicts the design's own "data never leaks across clusters" claim. The other is a functional regression in the Logs action for multi-container pods. Both are small fixes.

## Findings

### 1. MEDIUM: cross-cluster race on the same-key remount path (§2.2, §4)

The design says: "Because `key={activeView}` remounts per deployment, a `cluster/ns/name` change only happens with the same key on a cluster switch. It resets state to `loading` (or the cache hit) and refetches."

I verified that path exists. `Dashboard` isn't keyed by cluster (App.tsx ~1762). Per-cluster tab restore (App.tsx ~645–650) can land on the same `deployment-detail/<ns>/<name>` id in the new cluster, so the `DeploymentFullView` instance survives with a new `clusterName`.

The race comes from the §4 coalescing rule: "if a fetch is requested while one is in flight, `pendingRef = true`… exactly one follow-up". With that rule, the refetch for cluster B doesn't issue a new request id while cluster A's request is in flight. A's response still carries the latest id and `mountedRef` is true, so it gets applied, rendering cluster A's deployment under cluster B. It also lands in the SWR cache, under whichever key the implementation reads at apply time. That contradicts the §2.2 edge case "data never leaks across clusters".

**Fix (both parts):**

1. Remove the path entirely. In `DashboardContent`, use `key={`${clusterName}|${activeView}`}`, and change the §4 cleanup paragraph to: "the hook's `clusterName/namespace/name` never change for a mounted instance; a change is treated as a programming error (dev `console.error`)."
2. Defence in depth: each fetch captures `const reqKey = `${cluster}|${ns}|${name}``. The response is written to the cache under `reqKey`, never under the current key. It is applied to state only when `id === requestIdRef.current && reqKey === currentKeyRef.current && mountedRef.current`. The reset effect increments `requestIdRef` and clears `pendingRef`.

Add a `live-refresh-decision`-style pure test, or a note in the hook test plan, that covers "stale response for a previous key is cached under its own key and not applied".

### 2. MEDIUM: Logs action loses container selection for multi-container pods (§6.1 "Logs", §6.6 DeploymentPodsTable / PodDistribution)

The design calls `onOpenLogs({ name, namespace }, firstMainContainerName)`. `App.handleOpenLogs` (App.tsx 843–852) builds the log tab's `allContainers` from `pod.spec?.containers` and `pod.spec?.initContainers`, falling back to `[containerName]`. With only `{ name, namespace }`, the log viewer offers just one container. On a page whose whole point is sidecar and init visibility, you'd have no way to switch to the sidecar's logs. The Pods view passes the full pod, so this is a regression compared with it.

**Fix:** build the argument from the pod summary:

```ts
const toLogTarget = (p: DeploymentPodSummary) => ({
  name: p.name, namespace: p.namespace,
  spec: {
    containers: p.containers.filter(c => c.kind !== 'init').map(c => ({ name: c.name })),
    initContainers: p.containers.filter(c => c.kind === 'init').map(c => ({ name: c.name })),
  },
});
onOpenLogs(toLogTarget(pod), firstMainContainerName);
```

Type the prop as `onOpenLogs?: (pod: { name: string; namespace: string; spec: { containers: { name: string }[]; initContainers: { name: string }[] } }, containerName: string) => void`. Define `firstMainContainerName` as the first `kind === 'main'` entry of `pod.containers`, falling back to `template.spec.containers[0].name`.

### 3. NIT: `filterHpa` call site doesn't match its signature (§3.3)

`filterHpa(list, deploymentName)` takes two required parameters, but the HPA snippet uses `.then(filterHpa)`. TypeScript rejects that ("target signature provides too few arguments"). If it were coerced, `deploymentName` would be `undefined` and every HPA would be filtered out.

**Fix:** `.then(list => filterHpa(list, name))`.

### 4. NIT: §4 effect and `decideLiveRefresh` are described twice (§4, §9)

§9 says "The effect in §4 delegates to this function", but the §4 snippet inlines the logic with refs.

**Fix:** replace the §4 body with:

```ts
const { action, next } = decideLiveRefresh(stateRef.current, liveResourceVersion, detailsRef.current?.deployment.metadata?.resourceVersion);
stateRef.current = next;
if (action === 'debounce') scheduleDebouncedRefetch(1500);
```

Keep the inline version only as commentary.

### 5. NIT: `eventsForRevision` token boundary misses quoted names (§5.1)

`(^|\s)name(\s|$)` won't match messages that quote or punctuate the RS name, such as `"web-6d4f"` or `web-6d4f,`.

**Fix:** use `(^|[\s"'(])${escaped}($|[\s"',.:)])`. Add a test with a quoted name, and keep the `web-6d4f9` negative case.

### 6. NIT: `classifyK8sError` 401 rules diverge from `is401Error` (§3.3)

`K8sService.is401Error` (k8s.ts 252–257) also treats a message containing `401` or `Unauthorized` as a 401. `classifyK8sError` only reads numeric codes. A message-only 401 in phase 2 or 3 (some exec-plugin failures) would become a section `error`, and `withAuthRetry` would never retry.

**Fix:** classify as `'unauthorized'` when `code === 401 || statusCode === 401 || response?.statusCode === 401 || /\b401\b|Unauthorized/.test(message)`.

### 7. NIT: pod metrics can never report `forbidden` (§3.3 Pod metrics)

`getPodMetrics` (k8s.ts 870–959) catches every error and returns an empty Map. A 403 on `metrics.k8s.io` therefore shows as "metrics-server unavailable".

**Fix:** change the UI text to "Metrics unavailable (metrics-server missing or no permission)". Don't change `getPodMetrics`.

### 8. NIT: worst-case IPC latency isn't stated (§3.3, §8)

The page renders only after the single aggregate call resolves. The design doesn't say whether chained `settle` timeouts are per call or per chain, and the worst case adds up to roughly 20 + 15 (RS) + 15 (pods) + max(15 events / 15 metrics / 20 nodes) ≈ 70 s of skeleton.

**Fix:** state that each `settle` timeout covers only its own API call, and document the ~70 s bound in §8. Optionally lower the per-section default to 10 s.

### 9. NIT: scope of "Raw JSON" in SchedulingConstraints (§6.6)

Clarify that the collapsible `<pre>` serializes only the scheduling fields: `nodeSelector`, `affinity`, `tolerations`, `topologySpreadConstraints`, `priorityClassName`, `schedulerName`, `runtimeClassName`, `terminationGracePeriodSeconds`. It must never serialize the whole `template.spec`, which would show unmasked env literals and bypass §5.5.

### 10. NIT: the DeploymentsView action column renders even without a handler (§2.2)

**Fix:** only append the `actions` column when `onOpenFullView` is defined, i.e. `...(onOpenFullView ? [actionsCol] : [])` inside the memo.

### 11. NIT: `DrawerRevision.creationTimestamp` type (§6.4)

`getDeploymentRevisions` (k8s.ts 1431–1443) returns client-node `Date` objects, and structured clone keeps them as `Date` over IPC. Declare `creationTimestamp: string | Date` and pass `String(...)`/`toISOString()` into `RevisionYamlInput.createdAt`. Today's YAML output dumps the `Date` as an ISO timestamp, so to keep "byte-identical" true, use `new Date(x).toISOString()` only if that matches the fixture. Otherwise pass the value through unchanged.

## Verified assumptions

- **Tab and routing pattern.** `App.handleViewChange` (App.tsx 463–478) sets `resourceView` and appends a per-cluster tab, deduped by id (`viewTabsByClusterRef`). `ViewTabBar` gets `onSelectTab={handleViewChange}`, and `DashboardContent` routes on prefixes such as `helm-release-detail/` and `helm-chart-detail/` (DashboardContent.tsx 962–1001) with `onBack` → `onNavigate`.
- **Navigation callback.** `Dashboard` gets `onNavigate={handleViewChange}` and passes it to `DashboardContent` (Dashboard.tsx 1389). `handleViewChange` is a plain function re-created every render, so the latest-ref approach is justified.
- **Hook placement.** `podStatusStats` `useMemo` sits at DashboardContent.tsx ~184, and every route is a sequential `if (...) return` after it, so the top-level hook placement is valid.
- **Live data.** The deployment watcher items carry `metadata` (including `resourceVersion`), `name` and `namespace` (resource-transform-worker.ts 87–101; main.ts 1996–2004). `depMapRef` is cleared on cluster, namespace or epoch re-fire (useDashboardWatchers.ts 52–92), which matches the re-seed reasoning.
- **Drawer.** The drawer header has the Scale button with `bg-blue-600/20 text-blue-400 border border-blue-600/30` (Dashboard.tsx 1425–1435). `handleResourceClick` supports every `FullViewResourceType` (pod, node, replicaset, service, ingress, networkpolicy, hpa, pdb, pvc, configmap, serviceaccount) and fetches details by name and namespace.
- **Unknown view ids.** For an unknown view id, Dashboard's load and poll effects are no-ops: `getResourceCount` defaults to 0, the generic watcher has no config, and pod-metrics polling is gated to `pods`.
- **Edit YAML.** `App.handleOpenYaml` reads `resource.metadata || resource` plus `type` and re-fetches through `getResourceYaml`, and `RESOURCE_TYPE_MAP.deployment` exists. Stripping `last-applied-configuration` in main is therefore safe.
- **Column API.** `GenericResourceView` keys `<th>`/`<td>` by `dataKey` and supports `compact`, `cellRenderer(cellData, rowData)` and `sortable`. Row clicks go through `onRowClickRef`. DeploymentsView's columns `useMemo` currently has `[]` deps.
- **ToggleGroup.** It has a hard-coded `layoutId="toggle-bg"` and no `disabled`/`title`, so the §6.5 change is warranted.
- **RevisionDiffModal.** It has a local `Revision` and `revisionToYaml` with key order `revision, name, createdAt, replicas, template{labels, annotations, spec}, selector` and the js-yaml options `indent 2, lineWidth 120, noRefs, skipInvalid, sortKeys false`. Its DiffEditor options match §6.4. The `Revision {x}` prefixing confirms the rev 3 label fix is needed.
- **ScaleModal.** It seeds `useState(currentReplicas)` once, and on error it catches without closing, so the modal stays open.
- **ConfirmModal.** It has `variant: 'danger' | 'warning' | 'info'`. It closes only when `onConfirm` resolves, and a thrown error keeps it open. The design's "swallow so the modal closes" behaviour is consistent with that.
- **restart/scale.** `restartDeployment` and `scaleDeployment` throw on failure. Both are guarded by `enforceMutationPolicy`, and `classify()` defaults unknown channels to `READ` (mutation-policy.ts 34–47).
- **safeHandle.** It validates a tuple for multi-arg invokes (`rawArgs.length > 1` → array) and rejects with `IPC validation failed: …`, with an audit log entry.
- **withTimeout.** It rejects with `"<label> timed out after Nms"`, so the `"timed out"` classification works. It doesn't cancel, as the design acknowledges.
- **ApiException.** In client-node 1.4 it has `code: number`. `AutoscalingV2Api`, `PolicyV1Api` and `NetworkingV1Api` are already imported in k8s.ts.
- **getPodMetrics.** Its Map is keyed `${namespace}/${podName}` (k8s.ts 953), and it returns empty on failure.
- **Auth retry.** `withAuthRetry` re-runs the closure after `setContextWithSmartReload`, so creating clients inside the closure picks up refreshed credentials.
- **Existing revisions.** `getDeploymentRevisions` filters by owner name, not uid. The uid change is an improvement.
- **Main/src imports.** Main already imports from `../src/utils/ai-thinking` and `../src/lib/with-timeout`, and `src/types/pod-worker.ts` is a shared-types precedent. tsconfig includes both `src` and `electron`.
- **Shared components.** `ErrorBoundary` supports `name` and `resetKey`. `ResourceTopology` takes `{ clusterName, resource }`. `topologyBuilder` checks `kind === 'Deployment'`, which justifies the `kind` default.
- **Status helper.** `getDeploymentStatus` reads `status.conditions`, `status.updatedReplicas` and `spec.replicas`, so it works on the raw `details.deployment`.
- **Sorting.** `useResourceSorting` has `age`, `restarts`, `cpu`, `memory` and `status` comparators keyed by those exact field names.
- **Test setup.** vitest only includes `**/*.test.ts`. fast-check, zod and `@monaco-editor/react` are already dependencies.
- **PSS mapping (§5.3).** Spot-checked against the PSS spec: restricted requires `runAsNonRoot` and `allowPrivilegeEscalation=false`, drops ALL with only NET_BIND_SERVICE addable, requires seccomp RuntimeDefault or Localhost, and limits volume types. Baseline governs privileged, host namespaces, hostPath, hostPorts, the AppArmor/SELinux/procMount/sysctl allowlists and caps beyond the default set. The pod-over-container merge order is correct.
- **No secret values.** The aggregator never calls Secret APIs, the SA summary omits `secrets`, Secret refs aren't clickable and env literals are masked.

## Unverified or wrong assumptions

- **Wrong:** "a `cluster/ns/name` change only happens with the same key on a cluster switch… resets and refetches" is presented as safe. It isn't safe with the coalescing rule (Finding 1).
- **Wrong:** opening logs with `{ name, namespace }` is assumed to be enough. `handleOpenLogs` derives the container list from `pod.spec` (Finding 2).
- **Wrong:** `.then(filterHpa)` doesn't type-check against `filterHpa(list, deploymentName)` (Finding 3).
- **Partially wrong (harmless):** §2 says `getViewLabel` understands prefixed ids. It handles `helm-chart-detail/` and `crd/`, but not `helm-release-detail/`, which falls through to the raw id. The new branch is still needed, as the design specifies.
- **Unverified:** sticky `SectionNav` behaviour inside the `p-6` scroller. Already recorded as assumption 13 with a fallback.
- **Unverified:** file-size estimates. Already recorded as assumption 14 with split targets.
