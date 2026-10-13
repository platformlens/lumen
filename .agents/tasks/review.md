# Persist AI tool-call, model and provider settings via allowlisted IPC with inline auto-save feedback

The reported bug had two causes. The main one: `settings:set` / `settings:get` reject any key outside `SETTINGS_ALLOWLIST`, and `aiToolMode`, `aiTrustedCommands`, the `local*` model keys, `theme`, `notificationsMuted` and `geminiServiceTier` were not on it. Those writes rejected silently, so the choice was never stored and never reloaded. The change allowlists those keys with per-key value validation in `electron/main.ts`. In `Settings.tsx` it awaits every AI save, shows an inline "Saved" or error state, and reverts the UI on failure. The provider toggle now picks a model from the new provider's loaded list instead of re-saving the old provider's model.

Watch for: (1) switching to a provider whose model list is not loaded still stores a provider/model mismatch while showing "Saved" (confirmed, non-blocking). (2) `aiTrustedCommands` is now writable from the renderer with arbitrary prefixes (likely, low). (3) Two quick successive saves can revert to a stale value if the first one fails (possible).

**Verdict**: APPROVED

## High-level view

Tool mode now persists end to end through the existing `settings:set` / `settings:get` channels. The written key `settings_aiToolMode` matches the per-request read in the AI handler, so the AI panel uses the stored value rather than renderer state. No new channels or preload methods, and no renderer store access.

Model and provider storage already worked (`settings:saveModelSelection`, seeded on mount via `getProviderSync` / `getModelSync`). The change awaits the save, dispatches `aiModelChanged` (consumed by `App.tsx` into the AI panel props) only after the write succeeds, and reverts the selection on failure.

Verification evidence exists in the commits and plan, run against the committed tree in a clean worktree after the first attempt misplaced its main.ts hunks: one pre-existing unrelated tsc error (KarpenterView, also at bfaa988) and 20 pre-existing eslint errors, none on changed lines. The app was not run; the trace is by code reading only.

<details>
<summary>Issues (3)</summary>

1. **Provider/model mismatch on unloaded list** (confirmed, non-blocking) — `handleProviderChange` falls back to `selectedModel` when the new provider's list is empty, so e.g. Local with LM Studio not running stores `provider=local` with a Gemini model id and shows "Saved". Consider disabling the toggle until the list loads, or showing a "select a model" hint.
2. **Renderer can write arbitrary `aiTrustedCommands`** (likely, low) — the UI only removes entries, but the IPC now accepts any `string[]` (up to 200 x 256 chars). Entries bypass per-command approval (blocked commands are still enforced in `ai-tools.ts`). Consider validating that the new array is a subset of the stored one, since additions go through `ai:respondToolApproval` in main.
3. **Overlapping saves can restore stale value** (possible) — `handleModelChange` and the tool-mode/trusted handlers capture `prev` from the render closure. If save A fails after the user already issued save B, A's revert overwrites B's UI state. A sequence counter would avoid it.

</details>

<details>
<summary>Details</summary>

### Provider switch with an unloaded model list

`handleProviderChange` takes `models[0].id` only when that provider's list is non-empty, otherwise it persists the new provider with the previous provider's model id. Lists load lazily (Google needs a stored key, Bedrock needs auth, Local needs a reachable endpoint), so the fallback is reachable in normal use. The result is a "Saved" flash for a pair the AI request will reject, and on reopening Settings no model card is highlighted, which reads to the user as the setting being forgotten. This is the plan's stated fallback and the same value the old code stored, so it is not a regression, and the primary bug is fixed. It is still the one remaining way for the model setting to look like it was lost.

### Trusted-command prefixes now writable over IPC

Before this change `settings:set('aiTrustedCommands', ...)` always rejected, so the main process was the only writer (via tool approval). The value validator now accepts a bounded string array and the key check only asserts `Array.isArray`. A compromised or buggy renderer could therefore pre-approve prefixes such as `kubectl delete`. The write is bounded and `ai-tools.ts` blocklists still apply, and the renderer already controls approval clicks, so exposure is low. A subset-of-existing check in the handler would limit the channel to the removals the UI actually performs.

### Shared save-state across AI controls

`aiSaveState` / `aiSaveError` are shared by the provider section and the Tool Calling section, so a failed tool-mode save shows its error card in both places. The text is generic and safe. Minor UX only.

### Not tested

No tests were added for the validators or handlers. The settings:set key validation (`aiToolMode`, `theme`, `geminiServiceTier`, array type) is inline in `registerIpcHandlers`, so it is not unit-testable without refactoring; the plan declined that. The behavior is verified by code reading only.

</details>

<details>
<summary>File map</summary>

- `electron/main.ts` — eight keys added to `SETTINGS_ALLOWLIST`, string[] accepted by the value schema, per-key validation for `aiToolMode`, `aiTrustedCommands`, `theme`, `geminiServiceTier`.
- `src/components/features/settings/Settings.tsx` — `persistAiSetting` helper, awaited and reverting model/provider/tool-mode/trusted-command saves, `handleProviderChange`, inline Saved/error UI, load errors logged.
- `.agents/tasks/ai-settings-plan.md` — plan and verification record (docs only).

Full diff: `git diff bfaa988 HEAD -- electron/main.ts src/components/features/settings/Settings.tsx`

</details>
