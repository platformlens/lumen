# Read-only Crossplane section for Lumen (review pass 2)

This change adds a Crossplane sidebar group, shown only when Crossplane is detected. It has five sub-views (Overview, Packages, Definitions, Composites, Managed) and a Crossplane drawer with a health banner, per-category sections, reference links and a Claim → XR → MR graph. All Kubernetes access goes through the main-process `CrossplaneService`, exposed via ten zod-strict `safeHandle` channels. This pass reviews the fixes for the five pass-1 findings: the namespaced MR → Composite link, the direct-list in-flight map, two attribution headers, kubeconfig-change invalidation, and the cap/throttle tests. Every fix is present and tested. The delta adds no new concerns. Verification was re-run independently: `npx tsc --noEmit` exit 0, `npx vitest run` 61 files / 625 tests passed, `npx eslint --max-warnings 0` on the 49 new Crossplane files plus `useResourceSorting{,.test}.ts` gives 0 problems, and `npm run lint` reports 1532 problems (baseline 1608). `npx vite build` succeeds and `dist/licenses/crossview-LICENSE.txt` is 11343 bytes. The largest new file is 420 lines.

Watch for: nothing blocking. Manual ACs 1–25 need live Crossplane v1.20/v2 clusters and remain unverified.

**Verdict**: APPROVED

## High-level view

The MR drawer's Composite link now takes the MR's `metadata.namespace`, so v2 namespaced XRs resolve. `getObject` still strips the namespace when discovery reports the XR kind as cluster-scoped. The new test checks both the namespaced fixture (`team-a`) and the cluster-scoped one (empty namespace).

`getManagedItems` now keeps a per-context `directLists` map. Forced and non-forced callers join an in-flight direct LIST, and the entry is removed when it settles. That completes AM-3's "never a second concurrent fetch for the same key" rule. The order is: fresh row cache, then a pending scan kind, then an in-flight direct list, then a new LIST.

`electron/crossplane-snapshots.ts` and `electron/crossplane-tree.ts` now carry the crossview Apache-2.0 header. In `main.ts`, `crossplaneService.invalidateKubeConfigs()` was added at the top of the user's own uncommitted `onKubeconfigChanged` listener. It was inserted with nothing removed or reformatted.

Scope hygiene still holds. No commits were made, and the only stashes on the branch predate this work. Diffs to the protected files (KarpenterView, NodesView, LogViewer, terminal.ts, TerminalComponent, YamlEditor, package.json) contain no Crossplane content. Their modification times predate the feature's edits. terminal.ts at 14:33 belongs to the concurrent rename-cluster workflow, as noted in pass 1.

<details>
<summary>Issues (0)</summary>

No open action items. The pass-1 findings (one MEDIUM, four NITs) are resolved.

</details>

<details>
<summary>Details</summary>

### Test coverage

There are three new service tests. One checks overlapping plain and forced `getManagedItems` calls (one LIST; a later forced call lists again). One fills 50 000 cached rows and confirms `rowsCached: false` while counts are kept. One checks the 250 ms progress throttle with an injected clock. A drawer-refs case covers the namespaced Composite link.

Not tested: renderer components (there is no DOM test setup, which is expected), and manual ACs 1–25 against live clusters.

</details>

<details>
<summary>File map</summary>

Changed this pass:

- `src/utils/crossplane-drawer-refs.ts`: Composite link inherits the MR namespace
- `src/utils/crossplane-drawer-refs.test.ts`: namespaced Composite link test
- `electron/crossplane.ts`: `directLists` in-flight map for direct per-kind lists
- `electron/crossplane.test.ts`: dedupe, row-cap and progress-throttle tests
- `electron/crossplane-snapshots.ts`, `electron/crossplane-tree.ts`: attribution headers
- `electron/main.ts`: `invalidateKubeConfigs()` in the kubeconfig-change listener (additive)

For the full feature map, see the pass-1 file map. Full diff: `git diff` plus the untracked files from `git status --short`.

</details>
