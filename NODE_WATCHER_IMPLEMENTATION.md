# Node Watcher Implementation

## Summary
Added performant real-time node watching to the Nodes view with batched updates and improved time display for resources under 48 hours.

## Changes Made

### 1. Node Watcher Backend (`electron/k8s.ts`)

Added two new methods following the same pattern as pod and deployment watchers:

**`startNodeWatch(contextName, onEvent)`**
- Watches `/api/v1/nodes` endpoint
- Transforms node objects to match the format expected by the UI
- Handles ADDED, MODIFIED, and DELETED events
- Includes proper error handling and abort support

**`stopNodeWatch()`**
- Cleanly stops the node watcher
- Removes from active watchers map

### 2. IPC Handlers (`electron/main.ts`)

Added IPC handlers for node watching:
- `k8s:watchNodes` - Starts watching nodes
- `k8s:stopWatchNodes` - Stops watching nodes
- Sends `k8s:nodeChange` events to renderer

### 3. Preload Bridge (`electron/preload.ts`)

Exposed node watcher methods to renderer:
- `watchNodes(contextName)` - Start watching
- `stopWatchNodes()` - Stop watching
- `onNodeChange(callback)` - Listen for changes with cleanup function

### 4. Type Definitions

Updated both type definition files:
- `src/vite-env.d.ts` - Renderer process types
- `electron/electron-env.d.ts` - Main process types

Added:
```typescript
watchNodes: (contextName: string) => void;
stopWatchNodes: () => void;
onNodeChange: (callback: (type: string, node: any) => void) => () => void;
```

### 5. Dashboard Integration (`src/components/Dashboard.tsx`)

Added performant node watcher with batching:

**Performance Optimizations:**
- Only watches when `activeView === 'nodes'`
- Batches updates every 650ms to prevent excessive re-renders
- Uses `Map` for O(1) lookups and updates
- Uses `startTransition` to mark updates as non-urgent
- Properly cleans up on unmount or view change

**Implementation Pattern:**
```typescript
useEffect(() => {
    let nodeCleanup: (() => void) | undefined;
    let nodeBatchTimeout: ReturnType<typeof setTimeout> | null = null;
    const pendingNodeUpdates = new Map<string, { type: string; node: any }>();
    const needsNodes = activeView === 'nodes';

    if (needsNodes) {
        window.k8s.watchNodes(clusterName);

        const processNodeBatch = () => {
            // Batch processing logic
            startTransition(() => {
                setNodes(prev => {
                    const nodeMap = new Map(prev.map(n => [n.name, n]));
                    // Apply updates
                    return Array.from(nodeMap.values());
                });
            });
        };

        nodeCleanup = window.k8s.onNodeChange((type, node) => {
            pendingNodeUpdates.set(node.name, { type, node });
            if (!nodeBatchTimeout) {
                nodeBatchTimeout = setTimeout(processNodeBatch, 650);
            }
        });
    }

    return () => {
        if (nodeCleanup) nodeCleanup();
        if (nodeBatchTimeout) clearTimeout(nodeBatchTimeout);
        if (needsNodes) window.k8s.stopWatchNodes();
    };
}, [clusterName, activeView]);
```

### 6. Improved Time Display (`src/components/shared/TimeAgo.tsx`)

Enhanced the TimeAgo component to show more granular time for resources under 48 hours:

**Before:**
- 0-59s: "Xs"
- 1-59m: "Xm"
- 1h+: "Xh"
- 48h+: Date

**After:**
- 0-59s: "Xs"
- 1-59m: "Xm"
- 1-23h: "Xh"
- 24-48h: "XdYh" (e.g., "1d3h")
- 48h+: Date

This provides better visibility for recently created resources while still showing dates for older ones.

## Performance Characteristics

### Batching Strategy
- **650ms batch window**: Accumulates multiple node changes before updating state
- **Map-based updates**: O(1) lookups and updates instead of O(N) array operations
- **Deduplication**: Multiple updates to the same node within the batch window are collapsed

### Memory Efficiency
- Watcher only active when viewing nodes
- Automatic cleanup on view change
- No memory leaks from event listeners

### UI Responsiveness
- Uses React's `startTransition` to mark updates as non-urgent
- Prevents blocking user interactions during batch processing
- Smooth animations maintained even during rapid updates

## Testing Recommendations

1. **Basic Functionality**
   - Navigate to Nodes view
   - Verify nodes appear and update in real-time
   - Check that node status changes are reflected immediately

2. **Performance Testing**
   - Test with clusters having 50+ nodes
   - Verify UI remains responsive during updates
   - Check memory usage doesn't grow over time

3. **Edge Cases**
   - Switch between views rapidly
   - Test with cluster connection issues
   - Verify cleanup when switching clusters

4. **Time Display**
   - Create a new node and verify time shows "Xs", "Xm", "Xh"
   - Wait 24+ hours and verify "XdYh" format
   - Wait 48+ hours and verify date format

## Related Files

- `electron/k8s.ts` - Node watcher implementation
- `electron/main.ts` - IPC handlers
- `electron/preload.ts` - IPC bridge
- `src/components/Dashboard.tsx` - Watcher integration
- `src/components/shared/TimeAgo.tsx` - Improved time display
- `src/vite-env.d.ts` - Renderer type definitions
- `electron/electron-env.d.ts` - Main process type definitions

## Consistency with Existing Patterns

This implementation follows the exact same pattern as the existing pod and deployment watchers:
- Same batching strategy (650ms)
- Same Map-based update logic
- Same cleanup patterns
- Same use of `startTransition`
- Same conditional watching based on active view

This ensures consistency across the codebase and makes the implementation easy to understand and maintain.
