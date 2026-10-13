# Nodes table restored with nested page and row scrolling

The change restores a concrete viewport for the Nodes `TableVirtuoso` while retaining architecture statistics and constrained-window page scrolling. Dashboard becomes a shrinkable page-scroll owner, the Nodes root no longer clips overflow, and the table flex region keeps a 400px floor. Recorded Electron measurements confirm a 400px table in both stats states with independent page and row scrolling. **Watch for: none; the computed-style and interaction evidence covers the regression’s critical layout paths.**

**Verdict**: APPROVED

## High-level view

The height chain is definite from the application viewport through Dashboard’s `h-full` layout into the Nodes root. Although the table region uses `flex-1 min-h-[400px]` rather than `h-[400px]`, flex layout assigns it a concrete used height from that definite parent; its immediate `h-full` shell and Virtuoso’s `height: 100%` therefore resolve correctly.

Expanded stats overflow the non-clipping Nodes root into Dashboard’s `flex-1 min-h-0 overflow-y-auto` content area. This preserves page-level reachability while Virtuoso retains its own row scrolling.

The fix only changes containing layout classes around the existing table. Sorting, resizing, selection, row activation, sticky headers, overscan, virtualization, and the ARM/non-ARM/unknown chart remain on their existing paths and are covered by recorded runtime checks.

<details>
<summary>Issues (0)</summary>

No blocking findings.

</details>

<details>
<summary>Details</summary>

## Definite flex sizing reaches TableVirtuoso

```text
Dashboard: h-full flex flex-col
  content scroller: flex-1 min-h-0 overflow-y-auto
    Nodes root: h-full flex flex-col
      table region: flex-1 min-h-[400px]
        table shell: h-full
          TableVirtuoso: height: 100%
```

The Nodes root provides the definite flex-container height. Its table child receives a concrete post-flexing main size, while `min-h-[400px]` prevents expanded fixed-size siblings from collapsing it below 400px. The runtime note verifies the shell and Virtuoso root at 400px with stats collapsed, stats expanded, and under the constrained viewport, directly resolving the percentage-height concern.

## Dashboard overflow carries expanded stats to the table

Without Nodes-level clipping, expanded charts and the table floor contribute overflow to Dashboard’s scroller. The recorded expanded state raises `scrollHeight` from 794px to 1362px; under the constrained viewport, the scroller retains an 856px range and brings the complete table into view. Virtuoso then scrolls independently to `scrollTop=1000` without moving the outer scroller, with its sticky header remaining at offset zero.

## Existing Nodes interactions remain attached to virtualization

The `TableVirtuoso` callbacks and configuration are unchanged. Runtime checks confirm changed row order after sorting, drag resizing with restored width state, persistent selection and bulk actions, row activation, and only 13 of 138 rows mounted before and after scrolling.

## Architecture distribution remains isolated from layout repair

Runtime inspection found the ARM, non-ARM, unknown-family totals and per-architecture chart content after expansion. The regression fix does not alter architecture classification or chart rendering.

## Recorded verification covers the acceptance boundary

The coder recorded passing type-check and build results, plus live Electron/CDP checks for both stats states, constrained page scrolling, nested row scrolling, sticky positioning, interactions, and virtualization. Repository-wide lint remains blocked by documented pre-existing debt. Review added no suite run; the scoped fix adds no dependencies, tests, or commit.

</details>

<details>
<summary>File map</summary>

- `src/components/Dashboard.tsx` — allows the Dashboard content scroller to shrink inside its fixed-height flex parent.
- `src/components/dashboard/views/NodesView.tsx` — removes Nodes-level clipping and preserves the virtualized table’s non-zero region.

Full scoped diff: `git diff -- src/components/Dashboard.tsx src/components/dashboard/views/NodesView.tsx`.

</details>
