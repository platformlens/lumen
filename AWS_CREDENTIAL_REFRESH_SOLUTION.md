# AWS Credential Refresh Solution

## Problem
When switching AWS accounts or profiles (e.g., via `aws sso login` or changing `AWS_PROFILE`), the application continued using cached credentials from the previous account. This caused 401 errors and prevented access to resources in the new account.

## Root Cause
The AWS SDK's `fromNodeProviderChain()` credential provider caches credentials at the Node.js process level. This cache cannot be cleared programmatically - it persists for the lifetime of the process.

Even though we implemented:
- Application-level client caching with `clearClientCache()`
- Fresh credential provider instances
- Smart KubeConfig reloading

The AWS SDK's internal credential cache remained active, causing it to reuse old credentials.

## Solution Implemented

### 1. App Restart Functionality
Added a new IPC method to restart the Electron application, which is the only reliable way to clear AWS SDK's credential cache.

**Files Modified:**
- `electron/main.ts`: Added `app:restart` IPC handler
- `electron/preload.ts`: Exposed `window.k8s.app.restart()` method
- `src/vite-env.d.ts`: Added TypeScript type definition

**Implementation:**
```typescript
// electron/main.ts
ipcMain.handle('app:restart', async () => {
  console.log('[main] Restarting application');
  app.relaunch();
  app.quit();
});
```

### 2. Enhanced User Feedback
Updated the AWS view to provide clear guidance when credential issues occur.

**Files Modified:**
- `src/components/dashboard/views/AwsView.tsx`

**Features:**
- Improved unauthenticated state UI with:
  - Clear explanation of possible causes
  - "Retry" button to attempt re-authentication
  - "Restart App" button for credential refresh
  - Informational note about AWS SDK credential caching
  
- Enhanced error state with:
  - Detection of authentication-related errors
  - Contextual "Restart App" button when auth errors occur
  - Helpful explanation about credential caching

### 3. Documentation Updates
Added warning comments in `electron/aws.ts` to document the credential caching limitation:

```typescript
/**
 * Clear all cached clients to force credential refresh
 * Call this when switching AWS accounts/profiles
 * 
 * NOTE: This only clears our application-level cache. The AWS SDK's
 * credential provider chain caches credentials at the Node.js process level,
 * which cannot be cleared without restarting the application.
 * 
 * If you've switched AWS accounts/profiles, you may need to restart the app
 * to pick up the new credentials.
 */
```

## User Workflow

### When Switching AWS Accounts:

1. **Switch AWS profile/account** (e.g., `aws sso login --profile new-account`)
2. **Navigate to AWS view** in the application
3. If credentials don't refresh automatically:
   - Click "Retry" to attempt re-authentication
   - If that fails, click "Restart App" to clear all caches
4. Application restarts and picks up new credentials

## Technical Details

### Why Restart is Necessary
- AWS SDK credential providers use internal caching mechanisms
- These caches are tied to the Node.js process
- No public API exists to clear these caches
- Only process termination clears the credential cache

### Alternative Approaches Considered
1. **Manual credential input**: Would require UI for entering access keys (poor UX)
2. **Credential file monitoring**: Wouldn't help with SSO credential caching
3. **Multiple credential providers**: Still subject to same caching issues
4. **Process forking**: Too complex and resource-intensive

### Smart Reload Still Active
The smart KubeConfig reload logic remains in place and is still beneficial:
- Reloads config when switching clusters
- Reloads config every 10 minutes
- Helps with EKS token expiration
- Works well for single-account scenarios

## Testing Recommendations

1. Test switching between AWS accounts with SSO
2. Test switching AWS_PROFILE environment variable
3. Verify restart functionality works correctly
4. Ensure UI messages are clear and helpful
5. Test that retry button works for transient errors

## Future Improvements

1. **Auto-detect credential changes**: Monitor AWS config files for changes
2. **Proactive restart prompt**: Detect when credentials might be stale
3. **Credential validation**: Check credentials before making API calls
4. **Better error messages**: Parse AWS SDK errors for more specific guidance

## Related Files

- `electron/main.ts` - IPC handlers
- `electron/preload.ts` - IPC method exposure
- `electron/aws.ts` - AWS service with credential caching
- `electron/k8s.ts` - Smart KubeConfig reload logic
- `src/components/dashboard/views/AwsView.tsx` - AWS view UI
- `src/vite-env.d.ts` - TypeScript definitions
