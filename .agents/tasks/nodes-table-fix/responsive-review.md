# Responsive Nodes table with dual scroll ownership

The Nodes page now lets its virtualized table consume available window height while enforcing a 400px minimum. The Dashboard remains the outer page-scroll owner when expanded statistics exceed a short window, while TableVirtuoso continues to own row scrolling inside the concrete table viewport. The implementation uses CSS flex reflow and adds no observer, listener, dependency, or render-time measurement. The ARM/non-ARM/unknown aggregation and architecture chart are unchanged by the sizing adjustment.

Watch for: no blocking concerns found. Production Electron checks confirm immediate table-height changes across two window heights, expanded and collapsed statistics, outer-page reachability, and independent virtualized row scrolling.

**Verdict**: APPROVED

## High-level view

The sizing chain runs from the Dashboard flex scrollport through the `h-full` Nodes root, `flex-1 min-h-[400px]` table region, and immediate `h-full` container to TableVirtuoso’s `height: 100%`. The minimum is on the flex item that supplies the percentage-height containing block, preserving a visible table in constrained windows while allowing growth in larger windows.

Removing root clipping lets expanded statistics and the minimum-height table contribute to Dashboard overflow. `min-h-0 overflow-y-auto` keeps page movement at the Dashboard boundary, while Virtuoso retains row scrolling, sticky headers, and virtualization.

The production renderer evidence records the same mounted collapsed table changing from 1246.14px to 400px and the expanded table changing from 587.85px to 400px without navigation, refresh, or a stats toggle. CSS-driven resizing introduces no listener cleanup or React render-thrashing path.

<details>
<summary>Issues (0)</summary>

No actionable concerns.

</details>

<details>
<summary>Details</summary>

## Definite table height and constrained-window overflow

The Dashboard content area is a shrinking flex child with `min-h-0`; the Nodes root has `h-full`; and the table flex item provides a concrete height to its `h-full` child and TableVirtuoso. This avoids an indefinite percentage-height containing block and avoids the previous mismatch where a zero-minimum wrapper could shrink while only its descendant requested 400px.

At constrained height with statistics expanded, the evidence records a 564px Dashboard client height, 1346px scroll height, and successful outer scrolling until the complete 400px table is visible. Virtuoso then independently accepted `scrollTop = 180`, retained `overflow-y: auto`, and kept its sticky header at zero offset relative to its own scroller. Rendering 28 rows against 7217px of virtual content confirms virtualization remains active; sorting, column resizing, selection, and row opening also passed in the same renderer.

## Resize lifecycle and architecture isolation

No ResizeObserver, `window.resize` listener, measurement state, or effect was added. Existing memoized aggregation, callbacks, Virtuoso configuration, sorting, and row rendering remain outside the resize path.

The layout adjustment does not touch `getNodeArchitecture`, architecture maps and family counters, pie data, family colors, or unknown handling. Runtime verification retained `ARM 76` and `Non-ARM 62`, correctly omitted zero-count Unknown, and kept the chart visible through resize and table interaction checks.

## Verification basis

The supplied evidence records a zero-error strict TypeScript run and successful production build/package. Live checks use the production Electron renderer against a real cluster, resize the same mounted Nodes page through CDP device metrics, and cover both statistics states, two effective heights, outer and inner scrolling, sticky positioning, virtualization, and existing table interactions. The requested build and TypeScript suites were not re-run during review.

</details>

<details>
<summary>File map</summary>

- `src/components/Dashboard.tsx` — lets the Dashboard scrollport shrink within its flex parent while retaining page-level vertical scrolling.
- `src/components/dashboard/views/NodesView.tsx` — removes root clipping and gives the table flex region responsive height with a concrete 400px minimum.
- `.agents/tasks/nodes-table-fix/responsive-verification.md` — records TypeScript, build, and live Electron layout evidence.

Full diff: `git diff -- src/components/Dashboard.tsx src/components/dashboard/views/NodesView.tsx`

</details>
