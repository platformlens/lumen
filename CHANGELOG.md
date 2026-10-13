# Changelog

All notable changes to **Lumen** are documented here.

## [0.0.9] — 2026-10-13
### Highlights
- **Background resource cache** — deployments, pods, secrets, configmaps, services and Helm releases load once per cluster and stay live; tab and namespace switches no longer reload or restart watches
- **Crossplane section** — read-only sidebar group (shown only when Crossplane is detected) with Overview, Packages, Definitions, Composites and Managed views, a detail drawer and a Claim → XR → MR graph
- **Deployment Full View** — 12-section full-page deployment view with revision diff and security posture, opened from the drawer
- **Rename cluster contexts** — right-click a cluster → Rename; kubeconfig, pins, tabs, watchers and terminals follow
- **Live kubeconfig refresh** — contexts added to the kubeconfig appear without restarting Lumen
- **Multiple context-bound terminals** — independent terminal tabs, each bound to the cluster context it was opened with
### Resource Cache
- Main-process LIST+WATCH streams per cluster with 650 ms coalesced batches into a normalized store
- Cluster-wide watches with client-side namespace filtering; automatic per-namespace fallback on 403
- Status banners for reconnecting, error and forbidden states while keeping rows visible
- Resync on window focus and system wake
- Helm releases derived from the secrets stream; release blobs never reach the renderer
- Removed legacy per-event watch IPC and the old pod worker hook
### Nodes
- New architecture distribution donut (ARM / non-ARM / unknown) that follows the search filter
- Fixed the Nodes table being hidden or clipped with Stats expanded or in short windows
### Bottom Panel & Terminals
- Unsaved YAML edits persist per tab across tab switches, pop-out and refreshes; discard confirmation on close
- YAML tab ids are cluster-scoped (fixes saving to the wrong cluster)
- Terminals bound to their opening context via a per-terminal override kubeconfig; context shown in tab subtitle, badge and banner
- Multiple terminal tabs with a "+" action and Cmd+Shift+`
- Cordon/drain use an explicit `--context` instead of switching the global context
- PTYs are cleaned up on window close and quit
### Fixes
- Preload event subscriptions now remove only their own listeners
- Multi-namespace selection and stale generic watcher leaks fixed
- Custom kubeconfig path in Settings is now honored
### Dependencies
- Electron 42.x (`fix:pty` targets 42.2.0)
- Added crossview Apache-2.0 license notice
See [release notes](./release-notes/v0.0.9.md) for prose detail.
---
## [0.0.8] — 2026-04-29

### Highlights

- **Agentic AI debugging** — the AI assistant can now execute kubectl commands against your cluster to gather real data for debugging, with human-in-the-loop approval
- **AWS settings split** — AWS credentials and Granted integration moved to a dedicated settings section
- **Status bar cluster switcher** — click the cluster name in the bottom bar to quickly switch clusters
- **Status bar AWS profile indicator** — see and switch your active AWS profile from the bottom bar
- **Node metrics from metrics-server** — NodesView now shows real CPU/memory usage instead of pod request estimates
- **Notification mute** — mute anomaly toast notifications to reduce noise on high-churn clusters

### Agentic AI (Tool Calling)

- AI assistant can execute kubectl commands (get, describe, logs, events, etc.) to debug issues
- Human-in-the-loop approval — every tool call shows an Allow / Allow & Trust / Deny prompt
- Trusted command prefixes auto-approve future calls (e.g. trusting "kubectl get" approves all get commands)
- Trusted commands visible and manageable in Settings → AI Models → Tool Calling
- Safety: dangerous commands (delete namespace, exec, port-forward) are always blocked
- Read-only and read-write modes configurable in settings
- Works with Bedrock (Claude), Google Gemini, and local LLMs (LM Studio, Ollama)

### Settings & UI

- AWS credentials split out of AI settings into a dedicated AWS section with Granted detection
- New "AWS" nav item in settings sidebar
- Status bar: clickable cluster name opens a quick-switch popup
- Status bar: AWS profile indicator with quick-switch popup, Granted-aware
- Notification mute button in status bar — hides anomaly toasts, clears existing ones on mute
- App logo fixed for production builds (Vite asset import) and macOS dock (rounded-corner alpha mask)
- Node delete no longer crashes the UI (optional chaining fix)

### Node Monitoring

- NodesView CPU/Memory columns now show real usage from metrics-server (refreshed every 30s)
- Removed broken pod-request-based utilization that always showed 0%
- Column headers updated from "CPU Requests" / "Memory Requests" to "CPU Usage" / "Memory Usage"
- Added `getNodeMetrics` IPC endpoint for metrics-server data

### Dependencies

- Updated `@ai-sdk/amazon-bedrock` to 4.0.96, `@ai-sdk/google` to 3.0.64
- Added `@ai-sdk/openai-compatible` for local LLM tool calling support
- Added `zod` as direct dependency

---

## [0.0.7] — 2026-04-27

### Highlights

- **Revamped AI assistance**
- **Account login support** — sign in and registration for synced preferences and org-ready workflows
- **Local LLM support** — OpenAI-compatible endpoints for private, on-device inference

See [release notes](./release-notes/v0.0.7.md) for prose detail.

---

## Earlier releases

See [release-notes/README.md](./release-notes/README.md) for dated notes (v0.0.2 and earlier alphas).
