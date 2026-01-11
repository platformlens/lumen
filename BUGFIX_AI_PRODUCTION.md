# AI Sidebar Production Build Fix

## Problem

The AI sidebar and AWS Bedrock models were not working in production builds, while working fine in development mode. The error showed:
```
models/gemini-1.5-flash is not found for API version v1beta
```
Even when AWS Bedrock Claude was selected in the UI.

## Root Causes

### Issue 1: Dynamic Imports in Production
Dynamic imports of `electron-store` throughout the main process code were being bundled incorrectly by Vite/Rollup in production builds.

### Issue 2: Storage Mismatch
The Settings component was saving AI provider/model to electron-store via IPC, but App.tsx was reading from localStorage, causing a complete disconnect between what was saved and what was used.

## Files Changed

- `electron/main.ts` - Fixed dynamic imports
- `src/App.tsx` - Fixed storage mismatch

## Changes Made

### 1. Fixed electron-store Usage (electron/main.ts)

#### Added Static Import
```typescript
import Store from 'electron-store'
```

#### Initialized Store Globally
```typescript
let store: Store;
store = new Store();
```

#### Replaced All Dynamic Imports
Replaced ~20+ instances of:
```typescript
const { default: Store } = await import('electron-store');
const store = new Store();
```

With direct usage of the global `store` variable:
```typescript
store.get('key')
store.set('key', value)
```

#### Fixed Helper Functions
Changed from async with dynamic imports:
```typescript
async function getApiKey(): Promise<string> {
  const { default: Store } = await import('electron-store');
  const store = new Store();
  return store.get('geminiApiKey') || '';
}
```

To synchronous with global store:
```typescript
function getApiKey(): string {
  return store.get('geminiApiKey') || '';
}
```

### 2. Fixed Storage Mismatch (src/App.tsx)

Changed from reading localStorage:
```typescript
const model = localStorage.getItem('k8ptain_model') || 'gemini-1.5-flash';
const provider = localStorage.getItem('k8ptain_provider') || 'google';
```

To using the state variables that are synced with electron-store:
```typescript
const model = aiModel;
const provider = aiProvider;
```

The state is properly initialized on app start using sync IPC:
```typescript
const [aiProvider, setAiProvider] = useState<'google' | 'bedrock'>(() => {
    return window.k8s.getProviderSync();
});
const [aiModel, setAiModel] = useState<string>(() => {
    return window.k8s.getModelSync();
});
```

And updated when settings change via custom event listener:
```typescript
window.addEventListener("aiModelChanged", handleAIModelChange);
```

## Affected IPC Handlers

- All AWS handlers (`aws:getEksCluster`, `aws:getVpcDetails`, etc.)
- All settings handlers (`settings:saveApiKey`, `settings:getApiKey`, etc.)
- AI handlers (`ai:explainResourceStream`, `ai:listModels`, `ai:checkAwsAuth`)
- History handlers (`ai:getHistory`, `ai:saveHistoryItem`, etc.)
- Pinned clusters handlers
- Sync handlers (`settings:getModelSync`, `settings:getProviderSync`)

## Why This Fixes the Issue

1. **Static imports work reliably in production builds** - Vite/Rollup can properly bundle and resolve them
2. **Single store instance** - Avoids potential race conditions and ensures consistent state
3. **Synchronous access** - No async overhead or potential timing issues
4. **Proper bundling** - electron-store is now included correctly in the production bundle
5. **Consistent storage** - Both Settings and App.tsx now use the same storage mechanism (electron-store via IPC)
6. **State synchronization** - The AI provider/model state is properly initialized and updated

## Testing

To verify the fix:

1. Build the production app: `npm run build`
2. Open the built app from `release/` directory
3. Go to Settings and configure AI provider (Google Gemini or AWS Bedrock)
4. Select a model from the list
5. Go back to Dashboard and select a Kubernetes resource
6. Click "Explain with AI"
7. Verify the AI sidebar opens and streams the response using the correct provider/model
8. Check the console logs show: `[AI] Using provider: bedrock model: <your-model>`
9. Verify AWS Bedrock models are listed correctly in Settings

## Additional Notes

- This is a common issue with Electron apps using dynamic imports in production
- The fix follows Electron best practices of initializing dependencies at startup
- localStorage should not be used for settings that need to persist across app restarts in Electron apps
- electron-store provides proper cross-platform persistent storage
- No functional changes to the API - all IPC handlers work the same way
- Performance may actually improve slightly due to avoiding repeated dynamic imports
