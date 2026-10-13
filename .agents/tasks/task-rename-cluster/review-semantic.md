# Rename kube context and live kubeconfig refresh

Adds a right-click "Rename" item to the existing Pin menu in SecondarySidebar. It renames the context on disk like `kubectl config rename-context`, then migrates pins, watchers, terminals and renderer state. A main-process polling watcher plus a self-refreshing K8sService fix the "new context needs a full app reload" bug.

Watch for: exec tabs are not retargeted (confirmed); .lumen.bak holds a credential copy beside the kubeconfig (confirmed); YAML comments are dropped on rewrite (confirmed).

**Verdict**: APPROVED

## High-level view

Rename is staged as temp files next to each kubeconfig, re-verified against the original content, backed up, then swapped in atomically. It rolls back on failure and its own write updates the stored hash silently, so no second refresh fires.

Live refresh uses stat polling by path, so atomic-rename replacement is handled. A content hash gates reloads, parse errors keep the previous config, and watchers are stopped only if the active context disappears.

<details>
<summary>Issues (6)</summary>

1. **Exec tabs** — `kubectl exec --context old` sessions are not retargeted; document or reopen.
2. **Backup and comments** — `.lumen.bak` retains credentials and YAML comments are lost; document.
3. **Crossplane state** — per-context state under the old name is orphaned; invalidate on rename.
4. **Unpin dialog and dead helper** — `clusterToUnpin` not remapped; `replaceInList` unused.
5. **No durable tests** — add kept tests for rename, watcher and path resolution.
6. **Missing custom path** — a non-existent custom kubeconfig path is not watched until re-saved.

</details>

<details><summary>File map</summary>

electron/kubeconfig-files.ts, kubeconfig-watcher.ts, k8s.ts, main.ts, terminal.ts, preload.ts; src/hooks/useClusterContexts.ts, types/cluster-context.ts, utils/cluster-rename-utils.ts, components/shared/RenameClusterModal.tsx, SecondarySidebar.tsx, App.tsx. Full diff: `git diff` plus untracked files.

</details>
