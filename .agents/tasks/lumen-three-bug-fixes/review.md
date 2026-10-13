# Per-tab YAML drafts, context-bound terminals, and multi-terminal bottom panel

This change fixes three bottom-panel bugs. Unsaved YAML edits now live in an App-level draft map keyed by tab id, and each `YamlEditor` is keyed by tab id and rehydrates from that map. Switching tabs, detouring through a log or terminal tab, popping out, or a server refresh no longer loses edits. Each local terminal is bound to the kube context selected when it was opened, through a per-PTY override kubeconfig that is prepended to `KUBECONFIG`, and the context is shown in the tab subtitle, a toolbar badge and a banner line. Terminals become independent closable tabs with a "+" action and Cmd+Shift+`. The preload bridge demultiplexes PTY events by id, and the main process now cleans up PTYs on window close and quit. The coder ran `tsc`, `vitest` (26 files / 155 tests), `vite build` and lint, with no new problems in touched files, and checked the override mechanism against real kubectl. Runtime behaviour in the Electron app still needs a manual check.

Watch for: inline `onDraftChange` closures defeat `YamlEditor`'s `React.memo`, so the editor re-renders on every log chunk (confirmed). A popped-out YAML tab can be re-opened in the bottom panel under the same id, and the two editors then share one draft slot (confirmed). The shell rc can override `KUBECONFIG` and silently undo the binding while the badge still shows the bound context (confirmed limitation, already disclosed by the coder). PTYs leak on renderer reload or crash, and the new 32-session cap turns that into a user-visible failure (likely).

**Verdict**: APPROVED

## High-level view

YAML drafts move out of the editor's local state into `yamlDraftsRef` in `App.tsx`, with a `dirtyYamlTabIds` Set that changes only on clean↔dirty transitions. Both render sites, the bottom-panel `LogViewer` and the full editor view, mount `<YamlEditor key={tab.id} initialDraft={getYamlDraft(id)}>`. Every unmount path therefore restores the draft, and pop-out works because the tab id is preserved. External content updates go through the controlled `value` prop: `@monaco-editor/react` 4.7.0 applies these with `executeEdits` while its `preventTriggerChangeEvent` flag is set, so they do not fire `onChange`. An effect skips updates while the editor is dirty and not saving. Closing a dirty tab opens a "Discard unsaved changes?" `ConfirmModal`. YAML tab ids are now cluster-scoped, which also fixes the old bug where a tab could save to the wrong cluster.

Terminal context binding is done entirely in the main process. `terminal:create` accepts an optional context, which is validated three ways: by zod, by a control-character check, and by `k8sService.hasContext`. `TerminalService` then writes a 0600 file containing only `current-context` into a 0700 mkdtemp dir and sets `KUBECONFIG=<override>:<existing chain or ~/.kube/config>`. This matches how `K8sService` loads config (`loadFromDefault`), so the context set the app can see is the same set the shell can see. The global kubeconfig is never written. Cordon/drain drops `kubectl config use-context` and adds a shell-quoted `--context` flag instead. This changes user-visible behaviour, and the coder's report discloses it. The binding is fragile against shell rc files that export `KUBECONFIG`.

Multiple terminals work through unique `local-terminal-<n>` tab ids and unique `term-<uuid>` backend ids. Preload keeps a single `ipcRenderer.on` per channel and fans out to a `Map<id, Set<cb>>`, which replaces the old N-listener filter-in-renderer pattern. The main process sends only to the owning `webContents`. Hidden terminal tabs stay mounted (`display:none`) inside an always-mounted `BottomPanel`, so xterm scrollback survives tab switches and panel toggles. Cleanup happens on tab close (unmount → `dispose`), on `webContents` `destroyed`, and on `before-quit` / `window-all-closed`. A page reload or renderer crash triggers none of these.

<details>
<summary>Issues (5)</summary>

1. **YamlEditor memo defeated by inline closures** — `LogViewer.tsx` (~L529) and the editor view in `App.tsx` (~L1735) pass a fresh `onDraftChange` arrow each render, so the active YAML editor re-renders on every `onPodLogChunk` batch. Pass a stable callback (e.g. `onDraftChange` taking `(tabId, draft)` plus a `tabId` prop, or memoize per tab id).
2. **Duplicate YAML tab id after pop-out + reopen** — `handleOpenYaml` checks only `panelTabs` for an existing id (`App.tsx` ~L1182), so re-opening a popped-out resource creates a second tab with the same id. The two editors can be mounted at once and share one draft slot, and closing either one closes both and discards the shared draft. Also check `editorTabsByClusterRef` and focus the existing editor tab.
3. **Shell rc can silently undo the context binding** — when `.zshrc`/`.zprofile` exports `KUBECONFIG`, the login shell drops the override while the badge and banner still claim the bound context. The coder's report already discloses this. Consider re-exporting the override in the banner command, or verifying `kubectl config current-context` at start and warning on mismatch.
4. **PTY leak on renderer reload/crash now hits the 32-session cap** — `TerminalService` disposes only on `destroyed`, `before-quit` and `window-all-closed`. After a reload (same `webContents`) the old PTYs keep running and count toward `MAX_TERMINALS`. Also call `disposeForSender` on main-frame `did-start-navigation` and on `render-process-gone`.
5. **Session ownership recorded but not enforced** — `PtySession.ownerId` is stored, but `terminal:write`/`resize`/`dispose` act on any id without checking `event.sender.id`. Low risk with a single window. Enforce the check now that the data exists.

</details>

<details>
<summary>Details</summary>

### Draft lifecycle across both YAML render sites

The traced paths below all go through `App.handleYamlDraftChange` and `getYamlDraft`.

```
YamlEditor(key=A).handleEditorChange
   └─ computeDraft(value, displayedBase) ─► onDraftChange(draft|undefined)
         └─ App.handleYamlDraftChange(A, draft)
               ├─ yamlDraftsRef.set/delete(A)
               └─ dirtyYamlTabIds (functional update, returns prev if unchanged)

remount (tab switch / log detour / pop-out / cluster switch back)
   └─ <YamlEditor key=A initialDraft={getYamlDraft(A)}>
         useState(initialDraft ?? initialYaml), isDirty = draft !== initialYaml
```

Switching from A to B swaps the editor by key, and B starts from its own draft or from server YAML. Switching back to A restores A's draft with Save and Review enabled. A log-tab detour goes through the same mount path. Pop-out (`handlePopOutTab`) copies the tab under the same id into `editorTabsByClusterRef`, and the editor view reads the same map. Closing and reopening the panel never unmounts `LogViewer`. On a save, `handleSave` sets `isSavingRef` and `setIsDirty(false)` updates `isDirtyRef` synchronously, so the server YAML from the updater is applied whichever way React orders the render. A changed `initialYaml` while the editor is dirty and not saving is skipped by the effect. `DiffModal` then diffs against the new base, which surfaces upstream drift instead of hiding it.

The two render sites expose a gap. `handleOpenYaml` decides whether a tab exists by looking only at `panelTabs`. Take a resource popped out into the editor view and then re-opened from the dashboard: the bottom panel gets a second tab with the identical cluster-scoped id. Returning to the editor view with the panel open mounts two `YamlEditor`s for one draft key. Each one reports into the same slot and neither rehydrates until it remounts, so the last keystroke wins. `closeTabNow` then removes both copies at once, because it filters both `panelTabs` and the editor bucket by id, and discards the draft. Duplicate ids already existed before this change, but the shared draft slot is new (confirmed by code path).

Both `YamlEditor` call sites pass an inline `onDraftChange` arrow. `LogViewer` re-renders on every `onPodLogChunk` batch (`App.tsx` ~L730 maps `panelTabs`). Before this change, `YamlEditor`'s props (`initialYaml`, the tab's stable `onSaveYaml`) kept `React.memo` effective. Now the active editor re-renders on every log chunk. Monaco skips the edit because `value` is unchanged, but this contradicts the performance rule to memoize callbacks passed to memoized children (confirmed).

### Override-kubeconfig binding and its trust boundary

The renderer passes `tab.clusterContext`, captured once at tab creation, to `terminal.create`. Preload omits the arg when it is undefined, so the zod `.rest(...optional())` stays absent. Main rejects a context that is malformed, contains control characters, or is unknown to the loaded kubeconfig. It reports the error as red text followed by `terminal:exit(-1)`, so the renderer shows the Restart overlay instead of a blank pane.

The binding only holds for as long as the login shell keeps the inherited `KUBECONFIG`. An rc file that assigns `KUBECONFIG` replaces the chain. Kubectl then resolves the user's global `current-context`, while the tab subtitle, toolbar badge and `kube context: <ctx>` banner still name the bound context. The UI can therefore claim one target while commands hit another, which runs against the user's request to show "the context of the cluster where the change is being made". The coder made drain safe by adding a shell-quoted `--context` (the quoting `'\''` is correct). Ad-hoc commands typed in a local terminal have no such protection. The coder has disclosed this, so it is not blocking, but a startup check would turn it from silent into visible.

Restarting a session reuses the tab's original `clusterContext`, and a cluster switch leaves existing tabs untouched. The toolbar badge goes yellow on a mismatch, including on the clusters view, where `currentCluster` is null.

### PTY session registry, routing and cleanup

```
renderer TerminalComponent(term-<uuid>)
   ├─ onData(id, cb) ─┐
   ├─ onExit(id, cb) ─┤  preload: one ipcRenderer.on per channel
   │                  └─ Map<id, Set<cb>>  (lazy, unsubscribe deletes empty sets)
   └─ create/write/resize/dispose(id) ──► main (zod) ──► TerminalService.sessions
                                                         Map<id, {pty, ownerId, kubeconfigFile}>
   main ──► sender.send('terminal:data', id, data)   (owning webContents only)
```

Cleanup is tied to `webContents` destruction and app lifecycle. A renderer reload (Cmd+R) or a `render-process-gone` event leaves the old sessions running under the same `webContents` id. Their output is dropped harmlessly, because preload has no subscribers for those ids, but they still count toward `MAX_TERMINALS = 32`. After a few reloads with several terminals open, new terminals fail with "Too many open terminals" until the app is quit. The coder notes the reload leak as pre-existing, but the cap is new and makes it visible (likely).

`PtySession.ownerId` is used only for `disposeForSender`. `write`, `resize` and `dispose` trust any id from any sender. With a single window this does not matter today. The ownership data is already there, so enforcing it is a one-line check per handler.

### Bundled unrelated changes

The working tree also contains modifications to `package.json`, `Dashboard.tsx`, `KarpenterView.tsx`, `NodesView.tsx` and the new `src/utils/node-architecture.ts`. The plan records these as pre-existing work from another task that this change did not touch. They are out of scope for this review and should not ship in the same commit unintentionally. No git commits were created: `HEAD` is still `bfaa988`, matching `origin/feature/security-improvements`.

</details>

<details>
<summary>File map</summary>

- `electron/terminal.ts`: session registry `{pty, ownerId, kubeconfigFile}`, override kubeconfig writer, 32-session cap, per-sender/global dispose, replace-safe `onExit`.
- `electron/terminal-kubeconfig.ts` (+ test): pure override-file / `KUBECONFIG` chain builders, context validator.
- `electron/main.ts`: `terminal:create` optional validated context, create-error reporting, `disposeAll` on quit/window-all-closed.
- `electron/k8s.ts`: `hasContext`.
- `electron/preload.ts`: id-scoped `onData`/`onExit` demultiplexer; optional context on `create`.
- `electron/electron-env.d.ts`, `src/vite-env.d.ts`: typed terminal API incl. `createExec`.
- `src/components/features/terminal/TerminalComponent.tsx`: typed API, UUID backend id, context banner, scoped subscriptions, timer cleanup.
- `src/components/features/yaml-editor/YamlEditor.tsx`: draft/dirty model, refetch guard, Cmd+S ref, context badge.
- `src/components/features/logs/LogViewer.tsx`: `clusterContext` on `PanelTab`, keyed editor with drafts, context badge, "+" button, `isVisible` to terminals.
- `src/components/features/logs/PanelTabStrip.tsx` (new): extracted tab strip with dirty dot.
- `src/components/features/sidebar/SecondarySidebar.tsx`: dirty dot.
- `src/App.tsx`: draft store, discard modal, cluster-scoped YAML ids, `openTerminal`, shortcuts, context on all tab types, drain change.
- `src/utils/yaml-draft-utils.ts`, `src/utils/terminal-tab-utils.ts` (+ tests): pure helpers.

Full diff: `git diff` in `/Users/MohammedRashid.Matin/Development/lumen` (working tree vs `HEAD`).

</details>
