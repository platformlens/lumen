# Changelog

All notable changes to **Lumen** are documented here.

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
