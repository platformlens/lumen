# Implementation Plan — Lumen: YAML draft loss, terminal cluster context, multiple terminals

Work directly in `/Users/MohammedRashid.Matin/Development/lumen` (no worktree). Do NOT commit. The checkout already has unrelated uncommitted changes (`package.json`, `src/components/Dashboard.tsx`, `KarpenterView.tsx`, `NodesView.tsx`, `src/utils/node-architecture.ts`) — do not touch or revert them.

## Baseline (measured during planning)

- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → 23 files / 133 tests pass. Vitest only picks up `**/*.test.ts` (no jsdom, no React Testing Library), so tests must target pure `.ts` modules.
- `npx vite build` → succeeds (~20 s).
- `npm run lint` → ALREADY FAILS repo-wide (1626 problems). Verification is therefore "no new lint problems in touched files". Per-file baseline problem counts (`npx eslint <file> -f unix | grep -c ':[0-9]*:[0-9]*:'`):
  `electron/terminal.ts` 4 · `electron/preload.ts` 60 · `electron/main.ts` 18 · `src/App.tsx` 18 · `YamlEditor.tsx` 2 · `TerminalComponent.tsx` 12 · `LogViewer.tsx` 1 · `src/vite-env.d.ts` 116. New files must lint clean.
- `node-pty` is built for Electron, so never import `electron/terminal.ts` from a vitest test; put testable logic in separate pure modules.

## Root causes found in the code

### Issue 1 — YAML edits lost on tab switch (confirmed by code reading; still verify at runtime)
- `src/components/features/logs/LogViewer.tsx` (~line 504) renders a single `<YamlEditor>` for the active tab only, with no `key` and no `onContentChange`. Edits live only in `YamlEditor`'s local `useState`.
  - YAML tab A → YAML tab B: same component instance; `initialYaml` changes, the reset effect in `YamlEditor.tsx` overwrites the content with B's server YAML and sets `isDirty=false`. A's edits are gone because they were never stored anywhere.
  - YAML tab → log/terminal tab → back: the editor unmounts, local state is destroyed, and the remount starts from the server `yamlContent`.
  - Pop-out (`handlePopOutTab` in `App.tsx`) copies the tab without the edits, so those are lost too.
- Editor view (`App.tsx` ~1659–1695): `onContentChange` overwrites `tab.yamlContent` (the base) with the draft. Content survives, but on remount `isDirty` is false: the dirty dot disappears, Save is disabled, and Review diffs the draft against itself.
- Also in `YamlEditor.tsx`:
  - The Cmd+S command registered in `onMount` captures the first-render `handleSave` (stale closure: `isDirty` is false there, so Cmd+S never saves).
  - The reset effect returns early when only `hideSystemFields` changes, so "Hide System Fields" never re-strips.
  - Programmatic `editor.setValue` can fire `onChange` and mark the editor dirty spuriously.
- YAML tab ids `yaml-${kind}-${ns}-${name}` are not cluster-scoped, but `panelTabs` is global across clusters. Opening the same-named resource on cluster B reuses cluster A's tab, and that tab's `onSaveYaml` closure saves to cluster A.
- No watcher or background refetch writes `yamlContent`. Only the post-save refresh in `onSaveYaml` and the initial open do. The new guard below covers future refetches anyway.

### Issue 2 — Terminal cluster context
- `TerminalService.createTerminal` (`electron/terminal.ts`) spawns a login shell with `sanitizedEnv()` (KUBECONFIG passthrough only). The shell's `kubectl` therefore hits whatever `current-context` is in the user's global kubeconfig. The app never changes that file: `K8sService` calls `kc.setCurrentContext` in memory only. A terminal opened while viewing cluster B can silently run against cluster A.
- The tab label is a hard-coded `'Terminal'` with no context.
- `handleCordonDrain` (App.tsx ~852) prefixes `kubectl config use-context ${selectedCluster} &&`. This is the only place that mutates the user's global current-context.

### Issue 3 — Single terminal
- The backend already keys PTYs by id (`Map<string, IPty>`), and the zod-validated channels `terminal:create|write|resize|dispose` carry the id. `TerminalComponent` already uses a unique backend id.
- The limit is in the renderer. `handleOpenTerminal`, the Cmd+` handler and the StatusBar toggle all use the fixed tab id `'local-terminal'`, and there is no "new terminal" action.
- Other defects found:
  - `terminalService.disposeAll()` is never called (PTYs leak on quit or window close).
  - `onExit` unconditionally deletes the map entry for `id`, so a re-created PTY with the same id can be dropped from the map.
  - Every `TerminalComponent` registers its own `ipcRenderer.on('terminal:data')` listener and filters in the renderer. This is N listeners, and Node prints a MaxListeners warning after 10.
  - `LogViewer` never passes `isVisible`, so switching tabs does not refit or focus.
  - Create failures throw inside `safeOn`, so the renderer shows a blank terminal.
  - Backend ids derived from long exec tab ids can exceed the 128-char limit.
- Hidden terminal tabs are already kept mounted (`display:none`) in `LogViewer`. Keep that so scrollback is preserved.

## Decisions

1. **Issue 1 approach: lift per-tab drafts into App with a ref Map and key the editor by tab id.**
   - `App` owns `yamlDraftsRef: Map<tabId, string>` (no re-render per keystroke) plus `dirtyYamlTabIds: ReadonlySet<string>` state, which changes only when a tab flips between clean and dirty.
   - `<YamlEditor key={tab.id}>` mounts with `initialDraft` and reports `onDraftChange(draft | undefined)`.
   - Rationale: survives every unmount path (log/terminal tab switch, panel close, pop-out to editor view, cluster switch) at the cost of one Monaco instance.
   - Rejected: keeping all YAML editors mounted (N Monaco instances, and it still loses edits on pop-out) and Monaco `path` models (the wrapper disposes models on unmount unless `keepCurrentModel`, and models are not shared across the two render sites).
   - Monaco undo history is not preserved across remounts. This is accepted and should be noted in the report.
2. **Issue 2 interpretation:** each terminal is bound to the kube context that was selected when it was opened.
   - The context is shown in the tab subtitle, in an active-tab toolbar badge (yellow when it differs from the currently selected cluster), and in a dim banner line printed at session start.
   - The shell targets that context through a per-terminal override kubeconfig file. It contains only `current-context: <ctx>` and is prepended to `KUBECONFIG` (`<override>:<existing KUBECONFIG or ~/.kube/config>`). kubectl takes `current-context` from the first file that sets it, so the global file is never mutated, and `kubectl config use-context` inside that shell writes to the override file only.
   - Existing terminals keep their context when the user switches clusters. New terminals use the newly selected cluster. With no cluster selected, no override is applied (current behaviour).
   - The same context badge is applied to YAML tabs (the `onSaveYaml` closure already targets the cluster the tab was opened on). This covers the alternative reading of the user's sentence: "show the cluster where the change is being made" in the bottom panel.
   - Known limitation to report: tools that write *new* entries to the first `KUBECONFIG` file (e.g. `aws eks update-kubeconfig` run inside a Lumen terminal) would write to the temp override file. The orchestrator should mention this alternative reading and limitation to the user.
3. **Cordon/drain:** drop the `kubectl config use-context … &&` prefix and open the drain terminal bound to `selectedCluster` via the override mechanism. This is a user-visible behaviour change (the global current-context is no longer switched as a side effect) and must be called out in the final report.
4. **Toggle semantics:**
   - Cmd+` and the StatusBar "Terminal" button close the panel if a terminal tab is active. Otherwise they focus the most recent local terminal bound to the current `selectedCluster`, creating one if none exists.
   - The new "+" toolbar button and Cmd+Shift+` (`e.code === 'Backquote' && e.shiftKey`) always create a new terminal.
5. **IPC scheme for issue 3:** keep the existing shared channels with the PTY id as the first argument. main → renderer messages go only to the owning `webContents`. Preload demultiplexes with ONE `ipcRenderer.on` per channel and a `Map<id, Set<callback>>`, exposing `onData(id, cb)` / `onExit(id, cb)`, so a component only ever receives its own session's events.
   - Rejected: per-id dynamic channel names (`terminal:data:<id>`). That needs dynamic channel strings in preload and N listeners, and it gives no isolation benefit because the id is already validated main-side.
6. **Unsaved-close guard:** closing a dirty YAML tab opens the existing `ConfirmModal` (variant `warning`, "Discard changes"). Rationale: closing is the remaining way to silently lose edits.

## IPC channel table (after the change)

| Direction | Channel | Args (zod, main.ts) | Notes |
|---|---|---|---|
| R→M send | `terminal:create` | `[id ≤128, cols int 1–1000, rows int 1–500]` `.rest(z.string().min(1).max(512).optional())` → optional `context` | Context must have no control chars (`/[\x00-\x1f\x7f]/`) and must satisfy `k8sService.hasContext(context)`. Otherwise reply with an error (below). |
| R→M send | `terminal:createExec` | unchanged | wrap in try/catch like create |
| R→M send | `terminal:write` / `terminal:resize` / `terminal:dispose` | unchanged | |
| M→R | `terminal:data` | `(id, data)` | sent only to the PTY owner's `webContents` |
| M→R | `terminal:exit` | `(id, exitCode)` | create failures send `terminal:data` (red error text) and then `terminal:exit(id, -1)`, so the existing "Restart Session" overlay appears |
| Preload API | `window.k8s.terminal.create(id, cols, rows, context?)`, `createExec(...)`, `write`, `resize`, `dispose`, `onData(id, cb) → unsubscribe`, `onExit(id, cb) → unsubscribe` | | typed in `src/vite-env.d.ts` |

Limits and cleanup:
- `MAX_TERMINALS = 32` concurrent PTYs (create throws when exceeded and the id is new).
- PTYs are disposed on `before-quit`, on `window-all-closed`, and when the owning `webContents` emits `destroyed`.
- Override kubeconfig files live in a lazily created `fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-kube-'))` dir (0700) with file mode 0600. A file is removed when its PTY exits or is disposed. `disposeAll` removes the dir.

---

# Implementation Plan

- [ ] 1. Add pure helper modules and their unit tests.
      Files and functions:
      - `electron/terminal-kubeconfig.ts` (no node-pty or electron imports):
        - `buildContextKubeconfig(context: string): string` returns `yaml.dump({ apiVersion: 'v1', kind: 'Config', preferences: {}, 'current-context': context })` (js-yaml handles quoting of ARNs and `user@cluster` names).
        - `buildKubeconfigEnv(overrideFile: string, existing: string | undefined, homedir: string, delimiter: string): string` returns `[overrideFile, ...(existing ? existing.split(delimiter).filter(Boolean) : [path.join(homedir, '.kube', 'config')])].join(delimiter)`.
        - `isValidTerminalContext(ctx: unknown): ctx is string` checks non-empty, ≤512 chars, and no control chars.
      - `src/utils/yaml-draft-utils.ts`:
        - `buildYamlTabId(cluster: string, kind: string, namespace: string | undefined, name: string)` returns `yaml-${cluster}-${kind}-${namespace || 'global'}-${name}`.
        - `computeDraft(editorValue: string, displayedBase: string): string | undefined` returns `undefined` when equal.
      - `src/utils/terminal-tab-utils.ts` (type-only import of `PanelTab`):
        - `createLocalTerminalTab(n: number, context: string | null): PanelTab` returns id `local-terminal-${n}`, title `Terminal ${n}`, subtitle `context ?? 'default context'`, `clusterContext: context ?? undefined`.
        - `findReusableLocalTerminal(tabs: PanelTab[], context: string | null): PanelTab | undefined` returns the last tab with `type === 'terminal'`, id starting with `local-terminal-`, and `clusterContext === (context ?? undefined)`.
      - Tests:
        - `electron/terminal-kubeconfig.test.ts`: dump → `yaml.load` round-trip for `arn:aws:eks:us-east-1:123456789012:cluster/prod`, `admin@kind-dev`, a name with spaces/quotes; env chain with/without existing `KUBECONFIG` and with multiple entries; control-char rejection.
        - `src/utils/yaml-draft-utils.test.ts`.
        - `src/utils/terminal-tab-utils.test.ts`: reuse picks the same-context tab and ignores exec, drain and other-context tabs.
      Step 2 adds `clusterContext` to `PanelTab`. Add the field in this step so the util compiles: add `clusterContext?: string` to `PanelTab` in `src/components/features/logs/LogViewer.tsx`.
      Verify: `npx vitest run electron/terminal-kubeconfig.test.ts src/utils/yaml-draft-utils.test.ts src/utils/terminal-tab-utils.test.ts` passes. `npx tsc --noEmit` exits 0.

- [ ] 2. Issue 1, part A: rewrite `YamlEditor` draft and dirty handling.
      Files: `src/components/features/yaml-editor/YamlEditor.tsx`
      - Props become `{ initialYaml: string; initialDraft?: string; onSave; onDraftChange?: (draft: string | undefined) => void; contextLabel?: string }`. Remove `onContentChange`; its only caller is updated in step 3.
      - State: `yaml = initialDraft ?? initialYaml`, `isDirty = initialDraft !== undefined && initialDraft !== initialYaml`. Mirror both in `isDirtyRef` and `isSavingRef`.
      - `displayedBase = hideSystemFields ? stripManagedFields(initialYaml) : initialYaml` (useMemo).
      - Replace the reset effect: on `[initialYaml, hideSystemFields]`, if `isDirtyRef.current && !isSavingRef.current`, do nothing (preserve the draft; DiffModal already reads the new `initialYaml` as the original). Otherwise `setYaml(displayedBase)` and `setIsDirty(false)`.
      - Remove BOTH `editor.setValue(...)` calls (in `handleEditorDidMount` and in the effect). External updates flow only through the controlled `value={yaml}` prop. `@monaco-editor/react` applies those with `executeEdits` while suppressing `onChange`. Drop `lastSyncedYamlRef`.
      - `handleEditorChange`: `setYaml(v)`, then `const draft = computeDraft(v, displayedBase)`, then `setIsDirty(draft !== undefined)`, then `onDraftChange?.(draft)`. Undoing back to the original clears dirty.
      - Cmd+S: keep `handleSaveRef.current = handleSave` updated each render, and have `addCommand` call `handleSaveRef.current()`.
      - `handleSave`: set `isSavingRef.current = true` before `await onSave(yaml)`. On success set `isDirty=false`, call `onDraftChange?.(undefined)` and `setIsReviewing(false)`. Reset `isSavingRef` in `finally`.
      - Render `contextLabel` next to "YAML Editor" in the toolbar: `text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded-md font-mono`, `Server` icon from lucide-react, `title="Changes will be applied to context <ctx>"`.
      `YamlEditorWindow.tsx` (unused) keeps compiling because it uses only `initialYaml`/`onSave`.
      Verify: `npx tsc --noEmit` exits 0, except for errors at the `onContentChange` call site in App.tsx, which is fixed in step 3. Run steps 2 and 3 back-to-back so tsc is green after step 3. `npx eslint src/components/features/yaml-editor/YamlEditor.tsx` shows ≤2 problems.

- [ ] 3. Issue 1, part B: wire drafts through App and LogViewer, add dirty indicators, cluster-scope YAML tab ids, add the unsaved-close guard.
      Files: `src/App.tsx`, `src/components/features/logs/LogViewer.tsx`, `src/components/features/sidebar/SecondarySidebar.tsx`
      - App.tsx:
        - Add `yamlDraftsRef = useRef(new Map<string, string>())` and `const [dirtyYamlTabIds, setDirtyYamlTabIds] = useState<ReadonlySet<string>>(() => new Set())`.
        - Add `handleYamlDraftChange = useCallback((tabId, draft) => …)`: set or delete in the ref, and update the Set via a functional update that returns `prev` unchanged when membership doesn't change.
        - Add `getYamlDraft = useCallback((id) => yamlDraftsRef.current.get(id), [])`.
      - `handleOpenYaml`:
        - Compute `tabId` ONCE with `buildYamlTabId(selectedCluster, resolvedKind, namespace, name)` and use it in both `onSaveYaml` closures and in the existence check.
        - Add `clusterContext: selectedCluster` to the new tab.
        - In both `updater`s set `{ ...t, yamlContent: latestYaml }`. The editor clears the draft itself via `onDraftChange(undefined)`.
      - Editor view (~1659):
        - Render `<YamlEditor key={tab.id} initialYaml={tab.yamlContent ?? ''} initialDraft={getYamlDraft(tab.id)} onDraftChange={(d) => handleYamlDraftChange(tab.id, d)} contextLabel={tab.clusterContext} …>`.
        - Delete the `onContentChange` block that overwrote `yamlContent`.
        - In the local-file `saveHandler`, after a successful save, write `yamlContent: content` (plus the existing filePath/title update for untitled files) into `editorTabsByClusterRef` and call `bumpEditorTabs()`.
      - Close handling:
        - Rename the current `handleCloseLogTab` body to `closeTabNow(id)` and also `yamlDraftsRef.current.delete(id)` + `handleYamlDraftChange(id, undefined)` there.
        - New `handleCloseLogTab(id)`: if `dirtyYamlTabIds.has(id)`, `setPendingCloseTabId(id)`; otherwise `closeTabNow(id)`.
        - Render a second `<ConfirmModal>` (title "Discard unsaved changes?", message naming the tab title, confirmText "Discard", variant "warning") that calls `closeTabNow(pendingCloseTabId)`.
        - Keep using `handleCloseLogTab` for both LogViewer `onCloseTab` and SecondarySidebar `onCloseYamlTab`.
      - Pass to `SecondarySidebar`: `yamlTabs={editorTabs.map(t => ({ ...t, isDirty: dirtyYamlTabIds.has(t.id) }))}` (useMemo).
      - LogViewer.tsx:
        - New props: `getYamlDraft: (id: string) => string | undefined`, `onYamlDraftChange: (id: string, draft: string | undefined) => void`, `dirtyTabIds: ReadonlySet<string>`.
        - YAML block: `<YamlEditor key={activeTab.id} initialYaml={activeTab.yamlContent} initialDraft={getYamlDraft(activeTab.id)} onSave={activeTab.onSaveYaml} onDraftChange={(d) => onYamlDraftChange(activeTab.id, d)} contextLabel={activeTab.clusterContext} />`.
        - Tab strip: a yellow dot (`w-2 h-2 rounded-full bg-yellow-500`, `title="Unsaved changes"`) for dirty tabs.
      - SecondarySidebar.tsx: add optional `isDirty?: boolean` to the `yamlTabs` item type and render the same yellow dot.
      - Pop-out needs no extra code: the tab id is unchanged, so the draft map entry follows it. Verify by trace.
      Verify:
      - `npx tsc --noEmit` exits 0.
      - `npx vitest run` passes.
      - Per-file eslint counts do not exceed the baseline.
      - Code-path trace written into the step report: edit A → switch to B → back to A; edit A → switch to log tab → back; edit → pop-out; edit → close panel → reopen; save → server refresh replaces the content and clears dirty; cluster switch with an open YAML tab.

- [ ] 4. Issue 2/3, main process: multi-PTY hardening, per-terminal context, cleanup.
      Files: `electron/terminal.ts`, `electron/k8s.ts`, `electron/main.ts`
      - terminal.ts:
        - Replace `Map<string, IPty>` with `Map<string, { pty: IPty; ownerId: number; kubeconfigFile?: string }>`.
        - Extract a private `attach(sender, id, ptyProcess, kubeconfigFile?)` used by both create paths. It does the `onData`/`onExit` wiring, and `onExit` deletes the entry and removes the file ONLY if `this.ptyProcesses.get(id)?.pty === ptyProcess` (fixes the replace race).
        - Track senders in a `Set<number>`. On the first PTY for a sender, register `sender.once('destroyed', () => this.disposeForSender(senderId))`.
        - Enforce `MAX_TERMINALS = 32` for new ids.
        - `createTerminal(sender, id, cols, rows, context?: string)`: when `context` is set, validate with `isValidTerminalContext`, then lazily create the temp dir via `fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-kube-'))`. Write `buildContextKubeconfig(context)` to `term-${crypto.randomUUID()}.yaml` with `{ mode: 0o600 }`. Set `env.KUBECONFIG = buildKubeconfigEnv(file, process.env.KUBECONFIG, os.homedir(), path.delimiter)` and `env.LUMEN_KUBE_CONTEXT = context` on a copy of `sanitizedEnv()`.
        - `dispose`, `disposeForSender` and `disposeAll` kill PTYs and remove their files. `disposeAll` also does `fs.rmSync(dir, { recursive: true, force: true })`.
        - Remove the dead `registerHandlers`/empty try-catch debug blocks only if touched lines require it. Otherwise leave them.
      - k8s.ts: add `hasContext(name: string): boolean { return this.kc.getContexts().some(c => c.name === name); }` (no logging).
      - main.ts:
        - `terminal:create` schema becomes `z.tuple([id, cols, rows]).rest(z.string().min(1).max(512).optional())` (same pattern as `createExec`).
        - Handler: if a context is provided and `!k8sService.hasContext(context)`, report an error. Otherwise call `terminalService.createTerminal(event.sender, id, cols, rows, context)`.
        - Wrap both create handlers in try/catch. On error, if `!event.sender.isDestroyed()`, send `terminal:data` (`\x1b[31m<message>\x1b[0m\r\n`) and then `terminal:exit(id, -1)`.
        - Call `terminalService.disposeAll()` in the existing `app.on('before-quit')` and `app.on('window-all-closed')` handlers.
      Verify:
      - `npx tsc --noEmit` exits 0.
      - `npx vitest run` passes.
      - `npx vite build` succeeds (bundles `dist-electron/main.js`).
      - eslint counts for `electron/terminal.ts` (≤4), `electron/main.ts` (≤18) and `electron/k8s.ts` (record its baseline first) do not increase.

- [ ] 5. Issue 2/3, preload and types: id-scoped subscriptions and the typed API.
      Files: `electron/preload.ts`, `src/vite-env.d.ts`
      - preload:
        - Module-level `const terminalDataSubs = new Map<string, Set<(data: string) => void>>()` and `terminalExitSubs` (same shape for exit callbacks).
        - Exactly one `ipcRenderer.on('terminal:data', (_e, id: string, data: string) => terminalDataSubs.get(id)?.forEach(cb => cb(data)))`, registered lazily on the first subscription. Same for exit.
        - `onData(id, cb)` / `onExit(id, cb)` add to the Set and return an unsubscribe that removes the callback and deletes empty Sets.
        - `create(id, cols, rows, context?)` sends `context` only when defined, so the zod rest arg stays optional.
      - vite-env.d.ts: update the `terminal` block to `create(id, cols, rows, context?: string): void`, add the currently-missing `createExec(id, cols, rows, context, namespace, podName, containerName?): void`, and use `onData(id: string, cb: (data: string) => void): () => void` and `onExit(id: string, cb: (exitCode: number) => void): () => void`.
      Verify: `npx tsc --noEmit` exits 0 (TerminalComponent will error until step 6, so do steps 5 and 6 back-to-back). eslint count for `electron/preload.ts` ≤60.

- [ ] 6. Issue 2/3, TerminalComponent: typed API, scoped events, context banner, visibility.
      Files: `src/components/features/terminal/TerminalComponent.tsx`
      - Add the prop `clusterContext?: string`.
      - Use `backendId = \`term-${crypto.randomUUID()}\`` (independent of tab-id length).
      - Replace all `(window.k8s as any).terminal` with the typed `window.k8s.terminal`.
      - Subscribe with `onData(backendId, data => term.write(data))` and `onExit(backendId, code => …)`.
      - Create with `create(backendId, term.cols, term.rows, clusterContext)`. Before creating a local (non-exec) terminal with a context, `term.writeln('\x1b[90mkube context: <ctx>\x1b[0m')`.
      - Keep the existing effect lifecycle (`[id, sessionId]`). Restart re-uses the same `clusterContext`.
      - The visibility effect already refits, focuses and resizes when `isVisible` turns true. Keep it.
      Verify: `npx tsc --noEmit` exits 0. eslint count for the file is ≤12 (it should drop because the `any` casts are gone).

- [ ] 7. Issue 2/3, App and LogViewer: multiple terminal tabs, context labels, new-terminal action, drain context.
      Files: `src/App.tsx`, `src/components/features/logs/LogViewer.tsx` (and the new `src/components/features/logs/PanelTabStrip.tsx`)
      - App.tsx:
        - `terminalCounterRef = useRef(0)`.
        - Replace `handleOpenTerminal` with `openTerminal = useCallback(({ forceNew = false } = {}) => …)`. Unless `forceNew`, reuse `findReusableLocalTerminal(panelTabs, selectedCluster)`. Otherwise increment the counter, append `createLocalTerminalTab(n, selectedCluster)`, and activate it and open the panel.
        - Cmd+` handler (~625): if the panel is open and the active tab's type is `'terminal'`, close the panel; else `openTerminal()`. Add `if (e.code === 'Backquote' && e.shiftKey) { e.preventDefault(); openTerminal({ forceNew: true }); return; }` before it.
        - StatusBar `onTogglePanel`: call `openTerminal()` in place of `handleOpenTerminal`.
        - `handleExec`: add `clusterContext: selectedCluster`.
        - `handleOpenLogs`: add `clusterContext: selectedCluster` (display only).
        - `handleCordonDrain`: remove the `kubectl config use-context` prefix, add `clusterContext: selectedCluster ?? undefined`, and set the subtitle to `` `cordon & drain · ${selectedCluster}` ``.
        - Pass `onNewTerminal={() => openTerminal({ forceNew: true })}` and `currentCluster={selectedCluster}` to LogViewer.
      - LogViewer.tsx:
        - Extract the tab header strip (the `tabs.map` block) into a presentational `PanelTabStrip.tsx` (props: `tabs`, `activeTabId`, `dirtyTabIds`, `onSwitchTab`, `onCloseTab`). This keeps LogViewer under ~500 lines.
        - Each tab sets `title={tab.clusterContext ? \`Context: ${tab.clusterContext}\` : undefined}`.
        - Toolbar: add a context badge for the active tab when `activeTab.clusterContext` is set. Normal style: `text-xs text-gray-400 bg-white/5 px-2 py-1 rounded-md font-mono` with a `Server` icon. When `activeTab.clusterContext !== currentCluster`, use `bg-yellow-500/10 text-yellow-400 border border-yellow-500/20` with a title explaining the mismatch.
        - Add a `Plus` button (`p-1.5 hover:bg-white/10 text-gray-400 hover:text-white rounded transition-colors`, `title="New Terminal (⌘⇧\`)"`, `aria-label="New terminal"`) that calls `onNewTerminal`.
        - Terminal render loop: `<TerminalComponent id={tab.id} isVisible={activeTabId === tab.id} execContext={tab.execContext} initialCommand={tab.initialCommand} clusterContext={tab.clusterContext} />`.
        - Update the empty-state copy to mention the "+" button.
      Verify:
      - `npx tsc --noEmit` exits 0.
      - `npx vitest run` passes.
      - `npx vite build` succeeds.
      - Per-file eslint counts are within the baseline. `PanelTabStrip.tsx` has 0 problems.

- [ ] 8. Final verification and runtime checks.
      - Run `npx tsc --noEmit`, `npx vitest run` and `npx vite build`. Run `npm run lint` and compare the total against the 1626 baseline (it must not increase). Record the per-file counts.
      - If possible, launch `npm run dev`. Quit any installed Lumen.app first; see the dev-troubleshooting steering. Smoke-test:
        - two YAML tabs keep their edits across switches and log-tab detours;
        - three terminals keep their scrollback, close independently, and `ps` shows the PTY gone after close;
        - `kubectl config current-context` in a terminal prints the bound context while `~/.kube/config` stays unchanged (`git diff`-style comparison of `kubectl config current-context` outside Lumen before and after);
        - quitting the app leaves no `lumen-kube-*` dir in `$TMPDIR`.
      - If the app cannot be driven interactively, write explicit code-path traces for each issue in the report instead and mark the runtime behaviour as "needs manual verification".
      - Delete any temp files created during verification.

## Verification section (code-path traces the implementer must write into the report)

- **Issue 1:**
  - Typing in tab A calls `YamlEditor.handleEditorChange`, then `computeDraft`, then `onDraftChange`, then `App.handleYamlDraftChange`, which writes `yamlDraftsRef[A]` and adds A to `dirtyYamlTabIds` (dot shown).
  - Switching to B unmounts `YamlEditor key=A` and mounts `key=B` with `initialDraft=getYamlDraft(B)`.
  - Switching back mounts `key=A` with `initialDraft=yamlDraftsRef[A]`, so `isDirty` is true and Save/Review are enabled.
  - Saving calls `onSaveYaml`, then the updater sets the new `yamlContent`; the editor effect sees `isSavingRef` and applies the server YAML, and `onDraftChange(undefined)` clears the map and the dot.
  - A changed `initialYaml` while dirty and not saving leaves the content untouched.
- **Issue 2:**
  - `openTerminal` → `createLocalTerminalTab(n, selectedCluster)` → `TerminalComponent clusterContext` → preload `create(..., ctx)` → zod → `hasContext` → `createTerminal` → override file + `KUBECONFIG=<override>:<base>` → shell `kubectl` resolves `current-context` from the override.
  - A cluster switch leaves existing tabs' `clusterContext` unchanged, and the badge turns yellow.
- **Issue 3:**
  - Each tab has a unique `local-terminal-n` and a unique `term-<uuid>` backend id.
  - The preload Map routes `terminal:data(id)` only to that id's callbacks.
  - Hidden tabs remain mounted (`display:none`), so xterm and scrollback are preserved.
  - Closing a tab unmounts `TerminalComponent`; cleanup calls `terminal.dispose(id)` and the PTY is killed and its file removed.
  - Quitting or closing the window calls `disposeAll()`, and a destroyed `webContents` triggers `disposeForSender`.

## Items to surface in the final report
- Issue 2 interpretation and the alternative reading (context shown on YAML tabs as well).
- The cordon/drain change: the global context is no longer switched.
- The `KUBECONFIG` first-file write caveat.
- Monaco undo history is not preserved across tab remounts.
- An out-of-scope latent bug that was observed and not changed: `createExecTerminal` runs `validateK8sName(context)`, which rejects EKS ARN contexts containing `:` and `@`-style context names, so pod exec fails on those contexts.
