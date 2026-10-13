# Node architecture distribution and constrained-height scrolling

The Nodes stats now classify each filtered node by normalized Kubernetes architecture metadata and add a fourth distribution chart alongside capacity, zones, and instance types. Detailed labels remain visible while ARM, non-ARM, and unknown totals are derived in the existing memoized stats pass. The layout now lets expanded stats and a 400px table region contribute to Dashboard’s vertical scroll range while `TableVirtuoso` remains the row scroller. **Watch for:** runtime behavior at a genuinely constrained Electron window height was not manually exercised (**confirmed, non-blocking**); the static overflow chain and unchanged virtualization wiring support the intended fix.

**Verdict**: APPROVED

## High-level view

The stable `kubernetes.io/arch` label wins, an empty or absent stable label falls back to `beta.kubernetes.io/arch`, values are normalized, and absent metadata becomes `unknown`. ARM-prefixed values form the ARM family; other known values form non-ARM, with literal/missing `unknown` kept separate.

The architecture donut uses the existing chart derivation, Recharts primitives, glass styling, and tooltip/legend patterns. Family names and totals keep the result understandable without relying only on slice color, while raw labels remain visible in the legend and tooltip.

Dashboard remains the page-level scroller, while Nodes no longer clips itself to a fixed-height box. The table keeps a 400px minimum and its existing virtualization, sorting, resizing, selection, callback, and sticky-header behavior.

<details>
<summary>Issues (1)</summary>

1. **Constrained-height runtime smoke test** — Live Electron resizing was not exercised (**confirmed, non-blocking**); follow up by opening stats in a short window and confirming page scrolling reaches the full table while Virtuoso row scrolling and the sticky header still work.

</details>

<details><summary>Details</summary>

## Stable-label precedence and family accounting

The Nodes memo calls `getNodeArchitecture` once per filtered node and updates the detailed map plus exactly one family counter in the same iteration. Detailed counts and family totals therefore each sum to `sortedNodes.length`, and search/filter changes update the new chart from the same represented set as the existing statistics.

Tests cover stable-label precedence, beta and empty-label fallback, case/whitespace normalization, `arm64`, `arm`, another ARM-prefixed value, `amd64`, another non-ARM architecture, missing metadata, and representative totals. No second node traversal or new untyped data path was introduced.

## Architecture chart integration and labels

The fourth chart matches the capacity donut’s translucent bordered panel, fixed chart height, dark tooltip, and Recharts legend. Orange, blue, and gray distinguish the families, while adjacent named totals and raw architecture legend entries ensure meaning is not encoded by color alone. The responsive grid avoids compressing all four charts into narrow columns and produces a two-by-two layout at `xl` widths.

## Dashboard scroll ownership and Virtuoso containment

```text
Dashboard flex column
└── content: min-h-0 + overflow-y-auto         ← page scroll
    └── NodesView: min-h-full, no clipping
        ├── summary and expanded charts
        └── table region: flex-1 + min-h-[400px]
            └── TableVirtuoso: height 100%      ← row scroll/virtualization
```

Removing `h-full overflow-hidden` lets expanded stats contribute to Dashboard’s scroll height. Putting the minimum on the table flex region prevents collapse without changing Virtuoso’s fixed header, overscan, row renderer, width measurement, sorting, selection, or resize callbacks.

## Verification coverage and remaining manual check

The focused architecture suite passed all 12 tests, strict TypeScript completed without diagnostics, and the production build/package completed successfully. The recorded repository lint run remains red from pre-existing findings; targeted lint found no issues in the new utility files and only unchanged findings in the touched large components.

**Not tested:** a live Electron window was not manually resized to reproduce the constrained-height case (**confirmed, non-blocking**). Static inspection supports the fix, but the smoke test in the Issues list remains the best final validation of nested page/table scrolling.

</details>

<details>
<summary>File map</summary>

- `src/utils/node-architecture.ts` — normalizes node architecture labels and classifies families.
- `src/utils/node-architecture.test.ts` — covers precedence, normalization, classification, unknown handling, and totals.
- `src/components/dashboard/views/NodesView.tsx` — aggregates architecture data, renders the fourth chart, and grows around a minimum-height virtualized table.
- `src/components/Dashboard.tsx` — allows the Dashboard content scroller to shrink inside its flex column.

Full diff: `git diff main -- src/components/Dashboard.tsx src/components/dashboard/views/NodesView.tsx src/utils/node-architecture.ts src/utils/node-architecture.test.ts` (the two new utility files are untracked and should be read directly until staged).

</details>
