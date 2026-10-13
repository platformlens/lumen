# Plan: AI model / tool-call settings do not persist

Status of the reported issue: **needs verification during implementation.** The app cannot be launched here, so the root cause below comes from tracing the code. The coder must confirm the fix by tracing the runtime path (see "Runtime trace to confirm") and must not claim it was verified by running the app.

## Root cause (traced, high confidence)

### 1. Tool calling mode is rejected by the IPC allowlist (the main bug)

`electron/main.ts` (~line 2489) defines `SETTINGS_ALLOWLIST` for the generic `settings:get` / `settings:set` handlers (both wrapped in `safeHandle` from `electron/ipc/validation.ts`, which returns a rejected promise on zod failure). The list is:

`refreshInterval, defaultNamespace, showSystemNamespaces, enableNotifications, maxLogLines, editorFontSize, editorWordWrap, terminalFontSize, kubeconfigPath, enableLocalTerminal, enableAiHistory, zoomFactor, fontFamily, tableFontSize, sidebarFontSize, pinnedFontSize, headingSize, dateFormat, aiTraceAnalytics`

The renderer uses keys that are not in that list:

| Key | Used by | Effect |
|---|---|---|
| `aiToolMode` | `Settings.tsx` (get on mount ~L158, set ~L783) | **The reported "tool call" bug** |
| `aiTrustedCommands` | `Settings.tsx` (~L161, L810, L829) | Clearing or removing trusted prefixes silently fails. Also the value is `string[]`, which the `settings:set` value union rejects. |
| `localModelEndpoint`, `localUseLmStudioNative`, `localLmStudioApiToken` | `Settings.tsx` (~L146-154, L707-709) | The Local API "Save" button does nothing, and nothing loads on mount. |
| `theme` | `Settings.tsx` (~L143, L925), `App.tsx` (~L302) | The theme is never remembered. |
| `notificationsMuted` | `App.tsx` (~L172, L263) | Same failure. |
| `geminiServiceTier` | `App.tsx` (~L521, L528) | Same failure. |

Behavior the user sees:

- Change "Tool calling mode". `setAiToolMode(mode)` updates local React state, so the dropdown looks right.
- `await window.k8s.settings.set('aiToolMode', mode)` rejects with `IPC validation failed: settings:set ...`. The handler is async with no try/catch, so the rejection is unhandled. `showSavedFeedback()` is never reached, so there is no "Saved" flash.
- Nothing is written to electron-store.
- On the next Settings mount, `settings.get('aiToolMode')` also rejects. It is swallowed by `.catch(() => {})`, so the state stays at the `'off'` default and the choice is forgotten.
- `electron/main.ts` ~L1286 reads `store.get('settings_aiToolMode') || 'off'` on each AI request, so tool calling is always off.
- This also matches "no save button / doesn't seem to auto save": the intended auto-save fails silently.

### 2. Model selection: the write path works, but UX and consistency gaps remain

The path is `handleModelChange` -> `window.k8s.saveModelSelection` -> `ipcMain safeHandle('settings:saveModelSelection')` -> `store.set('k8ptain_provider'|'k8ptain_model')`. It is read back via `getProviderSync` / `getModelSync`. The preload bridge and IPC are present, and App.tsx updates its `aiProvider` / `aiModel` through the `aiModelChanged` window event. So persistence should work for clicking a model card. The user-visible problems are:

- **No feedback:** `handleModelChange` (Settings.tsx ~L352) fires `saveModelSelection` without `await`, without `.catch`, and without any "Saved" indicator. With no save button and no confirmation it "doesn't seem to auto save".
- **Provider toggle persists a mismatched pair:** the toggle calls `handleModelChange(selectedModel, provider)` (~L411). Switching Google -> Bedrock saves provider `bedrock` with the old Gemini model id, and no model card is highlighted. The AI panel then streams with an invalid provider/model combination, and reopening Settings shows no selection. The user experiences this as "my model setting was forgotten".
- **Failures are silent:** a rejected save leaves the UI showing a selection that was never stored.

### 3. Not a cause: AI panel consumption

- Tool mode is read from the store in the main process per request (`main.ts` ~L1286), so the AI panel needs no extra state once persistence works.
- Provider and model reach the panel through `App.tsx` state, initialised from the sync IPC reads and updated by the `aiModelChanged` event (~L813-822). That is correct.

## Design decisions

- **Auto-save on change (preferred), no Save button.** The tool-call select, the model cards and the provider toggle already apply immediately. The fix makes that persistence actually succeed, and adds visible "Saved" confirmation plus error display.
- **Extend the allowlist plus per-key value validation, rather than adding new IPC channels.** All failing keys already use the `settings:get` / `settings:set` generic pattern (`settings_` prefix, which matches the keys main.ts already reads). This is the smallest change and follows the project's electron-store rules.
- **Validate `aiToolMode` strictly** as `'off' | 'read' | 'read-write'`. It gates command execution on the user's cluster, so a free-form string must not be stored. `aiTrustedCommands` becomes a bounded `string[]`.
- **Keep the allowlist for everything else.** Do not open `settings:set` to arbitrary keys. That would undo the security hardening from commit ce8353d.
- Out of scope: the `Section`, `SettingRow` and `Toggle` components defined inside `Settings` (they remount on every render), and any refactors. Note it only.

## Implementation steps

### Step 1: Main process, `electron/main.ts` (inside `registerIpcHandlers`, the `SETTINGS_ALLOWLIST` block ~L2489-2514)

The working tree already has many unrelated uncommitted edits in `main.ts`. Edit only this block and do not revert anything else.

1. Add to `SETTINGS_ALLOWLIST`: `'aiToolMode'`, `'aiTrustedCommands'`, `'localModelEndpoint'`, `'localUseLmStudioNative'`, `'localLmStudioApiToken'`, `'theme'`, `'notificationsMuted'`, `'geminiServiceTier'`.
2. Widen the `settings:set` value schema so a string array is allowed: `z.union([z.string().max(1024), z.number(), z.boolean(), z.array(z.string().max(256)).max(200)])`.
3. In the `settings:set` handler, add key-specific validation before `store.set`:
   - `aiToolMode` must be one of `'off' | 'read' | 'read-write'`, else throw `new Error('Invalid aiToolMode')`.
   - `aiTrustedCommands` must be an array. Reject non-arrays and strings.
   - `theme` must be one of `'blue' | 'charcoal' | 'red'`. `geminiServiceTier` must be `'flex' | 'standard'`.
   - Keep the existing `aiTraceAnalytics` and `enableLocalTerminal` side effects unchanged.
4. Do not change `settings:get`. It already returns `store.get(\`settings_${key}\`) ?? null`. The renderer already falls back to defaults when it gets `null`.
5. Optional: add `aiToolMode` (`?? 'off'`) to `settings:getAll` only if that is convenient. Not required, because Settings reads it through `settings.get`.
6. Check that `settings:get` / `settings:set` are used only through these handlers. `grep "settings_" electron` should show the same keys read in `main.ts` (~L979, L981, L1070, L1186, L1286-1287, L1365, L1811-1814), so the written keys match the read keys.

### Step 2: Renderer, `src/components/features/settings/Settings.tsx`

1. Add an AI-section state:
   - `aiSaveState: 'idle' | 'saved' | 'error'`
   - `aiSaveError: string | null`
2. Add a `persistAiSetting` helper that takes an async save function. It sets the state to `'saved'` and clears it after about 2 seconds on success. On failure it sets `'error'` plus a short message and logs `console.error`. It must never leave an unhandled rejection. Do not reuse the global `isSaved` flag for the model or tool-call controls. That flag also flips the Google "Save Key" and Local "Save" buttons to "Saved".
3. **Model and provider (`handleModelChange`, ~L352):**
   - Make it `async`, `await window.k8s.saveModelSelection(provider, modelId)`, then dispatch `aiModelChanged` only after the save succeeds. On error, show the error and revert `selectedModel` / `selectedProvider` to the previous values.
   - Fix the provider toggle (~L411): do not call `handleModelChange(selectedModel, provider)` with the old provider's model. When switching provider, pick the model for the new provider. If that provider's loaded list (`googleModels` / `bedrockModels` / `localModels`) is non-empty, use its first entry. If it is empty, keep the current model, which is the old behaviour. Then persist through the same helper, so the stored pair is always `provider + model that belongs to it` where possible.
   - Leave the model cards' `onClick` calling `handleModelChange(model.id, '<provider>')`.
4. **Tool mode (~L781-786):** wrap the `settings.set('aiToolMode', mode)` in `persistAiSetting`. If it fails, revert `aiToolMode` to the previous value and show the error.
5. **Trusted commands (~L809-831):** use `persistAiSetting` for "Clear all" and the per-chip "x" button, and revert on failure.
6. **Feedback UI in `renderAISection`:** add a small status line (a "Saved" indicator with a `Check` icon, `text-green-400 text-xs`, and an error card using `bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400`). Place it in the "AI Provider Configuration" and "Tool Calling (Agentic)" section headers. There is no ToastNotification in Settings, so use this inline indicator and keep the glassmorphism style from the theme rules. Add a note in the Tool Calling card, such as "Changes are saved automatically".
7. **Mount-time load (~L158):** keep the existing `settings.get('aiToolMode')` and `aiTrustedCommands` loads. With the allowlist fixed they now resolve. Replace the empty `.catch(() => { })` on the AI-related loads with `console.error` so a future allowlist regression is visible.
8. Avoid `any`. The existing global typing is `set: (key: string, value: any) => Promise<void>` in `src/vite-env.d.ts`. Do not widen it further; leave it as is.

### Step 3: Typings and preload

No new IPC channels, so no new preload methods. `electron/preload.ts` `settings.get` / `settings.set` already forward to `settings:get` / `settings:set`. Verify that and make no change unless needed. Optionally align `src/vite-env.d.ts` `settings.set` to return `Promise<boolean>`, matching `electron/electron-env.d.ts`. Only do this if tsc stays clean.

## Full path after the fix

Tool mode:

1. UI `<select onChange>` in `Settings.tsx`
2. `window.k8s.settings.set('aiToolMode', mode)`
3. preload `settings.set` -> `ipcRenderer.invoke('settings:set', key, value)`
4. `ipcMain` `safeHandle('settings:set')` passes allowlist and value validation
5. `store.set('settings_aiToolMode', mode)`, returns `true`
6. UI shows "Saved"

On Settings mount:

1. `window.k8s.settings.get('aiToolMode')`
2. `settings:get` -> `store.get('settings_aiToolMode') ?? null`
3. `setAiToolMode(saved)`

At AI use:

1. The `ai:streamPrompt`-style handler reads `store.get('settings_aiToolMode')` per request (`main.ts` ~L1286)
2. `buildKubectlTools(...)` and `buildToolSystemPrompt(toolMode)` apply it

Model and provider:

1. Click a model card, or the provider toggle
2. `handleModelChange`
3. `window.k8s.saveModelSelection(provider, model)`
4. `settings:saveModelSelection` -> `store.set('k8ptain_provider'|'k8ptain_model')`
5. On success, dispatch the `aiModelChanged` event
6. `App.tsx` `setAiProvider` / `setAiModel`, passed as props to `AIPanel`

On Settings mount and app start:

1. `getProviderSync` / `getModelSync` -> `store.get('k8ptain_*')`
2. Initial state of both `Settings.tsx` and `App.tsx`

## Runtime trace to confirm (coder must do this, since the app cannot be launched)

1. Confirm `aiToolMode` is in `SETTINGS_ALLOWLIST` and passes the `settings:set` tuple schema (string value).
2. Confirm `aiTrustedCommands` (`string[]`) passes the value schema, and that the invalid cases (a wrong `aiToolMode` string, a non-array `aiTrustedCommands`) are rejected.
3. Confirm that the key string in `Settings.tsx` ('aiToolMode') maps to `settings_aiToolMode`, the exact key read at `main.ts` ~L1286. Do the same for the `local*` keys against `main.ts` ~L979-981, L1070, L1365, L1811-1814.
4. Confirm `handleModelChange` and the toggle cannot leave the stored provider/model pair mismatched when the new provider's model list is loaded.
5. In the final summary, say explicitly which of these were checked by reading code and that the app was not run.
6. If feasible, add a tiny vitest test for any pure helper you extract (for example the `aiToolMode` validator). Do not build test infrastructure around `registerIpcHandlers`. No test is required.

## Verification

- `npx tsc --noEmit` from the repo root. The baseline is clean (checked: no output), so it must stay clean.
- `npm run lint`, which is `eslint . --ext ts,tsx --max-warnings 0`. If it is noisy for pre-existing reasons, lint only the touched files: `npx eslint electron/main.ts src/components/features/settings/Settings.tsx --ext ts,tsx` and confirm no new warnings appear on the lines you changed.
- Do not start `npm run dev`. An installed Lumen.app may hold the single-instance lock, and the run is long-lived.
- `git diff` should touch only the `SETTINGS_ALLOWLIST` block in `electron/main.ts`, `Settings.tsx`, and optionally `src/vite-env.d.ts`.

## Risks and notes

- `main.ts` and `preload.ts` already carry large unrelated uncommitted changes. Make narrow edits and do not format or revert them.
- Adding `theme`, `notificationsMuted`, `geminiServiceTier` and the `local*` keys fixes the same silent-reject bug for other settings. This is in scope because it is the same root cause and a one-line allowlist change per key.
- `aiTrustedCommands` controls auto-approval of kubectl commands. Blocked commands are still enforced in `electron/ai-tools.ts`. The validation added here only limits size and type, so do not weaken the guards in `ai-tools.ts`.

---
## Implementation record (coder, iteration 1)
Note: `.agents/tasks/review.json` existed but belonged to a previous task (cluster rename, APPROVED), so this was treated as the first iteration.

Changed:
- `electron/main.ts` (SETTINGS_ALLOWLIST block only): added `aiToolMode, aiTrustedCommands, localModelEndpoint, localUseLmStudioNative, localLmStudioApiToken, theme, notificationsMuted, geminiServiceTier` to the allowlist; `settings:set` value schema now also accepts `string[]` (max 200 items x 256 chars); added validation for `aiToolMode` (off|read|read-write), `aiTrustedCommands` (array), `theme` (blue|charcoal|red), `geminiServiceTier` (flex|standard). `settings:get` unchanged.
- `src/components/features/settings/Settings.tsx`: `persistAiSetting` helper plus inline "Saved" indicator and red error card; `handleModelChange` now awaits the save, reverts on failure and only dispatches `aiModelChanged` after success; new `handleProviderChange` picks the first model of the new provider's loaded list (otherwise keeps the current model); tool mode and trusted-commands changes go through the helper and revert on failure; "Changes are saved automatically." note; mount-time loads of `aiToolMode` / `aiTrustedCommands` log errors instead of swallowing them.
- `preload.ts`, `vite-env.d.ts`: no change needed (`settings.get/set` already forward to `settings:get/set`).

Runtime path (verified by reading code; the app was NOT run):
- Tool mode: `<select onChange>` -> `handleToolModeChange` -> `window.k8s.settings.set('aiToolMode', mode)` -> preload `ipcRenderer.invoke('settings:set', key, value)` -> `safeHandle('settings:set')` (allowlist + value check) -> `store.set('settings_aiToolMode', mode)` -> `true` -> "Saved". Mount: `settings.get('aiToolMode')` -> `store.get('settings_aiToolMode') ?? null` -> `setAiToolMode`. AI use: `main.ts` ~L1286 reads `store.get('settings_aiToolMode')` per request; key matches exactly.
- Model/provider: card click or `handleProviderChange` -> `handleModelChange` -> `window.k8s.saveModelSelection` -> preload -> `settings:saveModelSelection` -> `store.set('k8ptain_provider'|'k8ptain_model')`; success -> `aiModelChanged` -> `App.tsx` `setAiProvider/setAiModel` -> AIPanel props. Mount: `getProviderSync/getModelSync` -> `store.get('k8ptain_*')`.
- Key names checked against main.ts reads: `settings_localModelEndpoint`, `settings_localUseLmStudioNative`, `settings_localLmStudioApiToken`, `settings_aiTrustedCommands`, `settings_aiToolMode` all match the `settings_${key}` write path.

Verification run from repo root:
- `npx tsc --noEmit`: no output (clean).
- `npm run lint` NOT run in full (the repo has many pre-existing `no-explicit-any` errors in main.ts). Ran `npx eslint electron/main.ts src/components/features/settings/Settings.tsx --ext ts,tsx`: 20 errors, all pre-existing (`no-explicit-any` etc.). None are on changed lines; Settings.tsx's two are the `config: any` / `status: any` context-engine loads at L178/L185.
- `npm run dev` not run, as instructed.

Commit scope: `electron/main.ts` has many unrelated uncommitted edits; only the four SETTINGS_ALLOWLIST/settings:set hunks were staged and committed.

Not addressed (out of scope / noted): the Local API Save button's `await settings.set(...)` calls still have no try/catch; `isSaved` still flips all Save buttons together; `localLmStudioApiToken` is stored in plain electron-store (existing design).

---
## Implementation record (coder, iteration 2: review fixes)
Review findings addressed (review.json / review.md):
- BLOCKING 1 (corrupted main.ts commit): fixed in commit cad3a2b. The allowlist entries, `AI_TOOL_MODES`/`APP_THEMES`/`GEMINI_SERVICE_TIERS` consts and key validation were moved out of `ai:startSession` / `ai:getCurrentSession` and into the `SETTINGS_ALLOWLIST` block and the top of the `settings:set` handler. The fixed blob was built from the HEAD blob and staged with `git update-index`, so the unrelated uncommitted edits in the working-tree `main.ts` were not touched. `git diff HEAD~2 HEAD -- electron/main.ts` now shows only the allowlist/consts/schema/validation hunks.
- BLOCKING 2 (verification on the wrong tree): re-ran against the committed tree in a clean `git worktree` of cad3a2b (node_modules symlinked):
  - `npx tsc --noEmit`: 1 error, `src/components/dashboard/views/KarpenterView.tsx:451` (recharts formatter typing). It is pre-existing: the same single error appears at bfaa988 (before this task). No errors in `electron/main.ts` or `Settings.tsx`. Earlier "clean" was the dirty working tree, where that file has uncommitted edits.
  - `npx eslint electron/main.ts src/components/features/settings/Settings.tsx --ext ts,tsx`: 20 errors, all pre-existing `no-explicit-any` etc. Same count as before. Full `npm run lint` skipped as noisy.
  - Worktree removed afterwards. App not run (`npm run dev` not run).
- Non-blocking, deliberately not changed (any change alters behavior or is out of scope):
  - Provider switch with an unloaded model list keeps the current model (the plan's stated fallback). Alternative would be to block the switch or clear the model, which changes the UI.
  - Local API Save `settings.set` has no try/catch and `isSaved` is shared across Save buttons (pre-existing, out of scope).
  - Overlapping rapid saves could revert to a stale value on failure (possible, unlikely).
