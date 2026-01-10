# Performance Refactor Tasks

## Priority 1: Critical UI Responsiveness (Immediate Impact)

### Task 1.1: Implement Optimistic View Switching
**Problem:** UI waits for data loading before switching views, causing visible lag.

**Solution:**
- Remove `setLoading(true)` from blocking the view transition
- Switch view immediately in UI
- Show cached/stale data instantly if available
- Load fresh data in background
- Use skeleton loaders for empty states only

**Files to modify:**
- `src/components/Dashboard.tsx` - Refactor `loadResources()` to be non-blocking
- `src/App.tsx` - Ensure `setResourceView()` is instant

**Implementation:**
```typescript
// Before: Blocking
const loadResources = async () => {
  setLoading(true); // BLOCKS UI
  await fetchData();
  setLoading(false);
}

// After: Non-blocking
const loadResources = async () => {
  // Don't set loading if we have cached data
  if (cachedData[activeView]?.length === 0) {
    setLoading(true);
  }
  await fetchData();
  setLoading(false);
}
```

---

### Task 1.2: Add Resource Cache Layer
**Problem:** Every view switch refetches all data from Kubernetes API, even if data was just loaded.

**Solution:**
- Implement a cache Map in Dashboard state: `resourceCache: Map<string, {data: any[], timestamp: number}>`
- Cache data for 30 seconds (configurable)
- On view switch, check cache first
- Load from cache instantly, then refresh in background if stale

**Files to modify:**
- `src/components/Dashboard.tsx` - Add caching logic

**Implementation:**
```typescript
const [resourceCache, setResourceCache] = useState<Map<string, {data: any[], timestamp: number}>>(new Map());
const CACHE_TTL = 30000; // 30 seconds

const getCachedData = (key: string) => {
  const cached = resourceCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
};

const setCachedData = (key: string, data: any[]) => {
  setResourceCache(prev => new Map(prev).set(key, {
    data,
    timestamp: Date.now()
  }));
};
```

---

### Task 1.3: Lazy Load Data Per View
**Problem:** Dashboard loads data for ALL views on mount, even inactive ones.

**Solution:**
- Only load data for the currently active view
- Use `useEffect` with `activeView` dependency
- Clear data for views that haven't been accessed in 5 minutes

**Files to modify:**
- `src/components/Dashboard.tsx` - Refactor data loading logic

---

## Priority 2: Watcher Optimization (Reduces Background Load)

### Task 2.1: Conditional Watcher Activation
**Problem:** Watchers run continuously even when views are inactive, consuming resources.

**Solution:**
- Only start watchers when their corresponding view is active
- Stop watchers when switching away from a view
- Implement watcher lifecycle management

**Files to modify:**
- `src/components/Dashboard.tsx` - Add conditional watcher logic

**Implementation:**
```typescript
useEffect(() => {
  // Only watch pods if we're on pods or overview view
  if (activeView === 'pods' || activeView === 'overview') {
    window.k8s.watchPods(clusterName, selectedNamespaces);
    const cleanup = window.k8s.onPodChange(handler);
    return () => {
      cleanup();
      window.k8s.stopWatchPods();
    };
  }
}, [activeView, clusterName, selectedNamespaces]);
```

---

### Task 2.2: Debounce Watcher Updates More Aggressively
**Problem:** 650ms batch window still causes frequent re-renders on large clusters.

**Solution:**
- Increase batch window to 1000ms for non-critical views
- Keep 650ms for overview/pods (user-facing)
- Add adaptive batching based on update frequency

**Files to modify:**
- `src/components/Dashboard.tsx` - Adjust batch timeouts

---

## Priority 3: Component Optimization (Reduces Re-renders)

### Task 3.1: Split Dashboard into Smaller Components
**Problem:** Dashboard.tsx is 1000+ lines and re-renders entirely on any state change.

**Solution:**
- Extract view-specific logic into separate components
- Use React.memo for expensive child components
- Implement proper prop memoization with useCallback

**Files to create:**
- `src/components/dashboard/DashboardContainer.tsx` - Smart container
- `src/components/dashboard/DashboardContent.tsx` - Presentational component

---

### Task 3.2: Memoize Filtered and Sorted Data
**Problem:** Data filtering/sorting happens on every render, even when data hasn't changed.

**Solution:**
- Wrap all filter/sort operations in useMemo
- Only recompute when dependencies change

**Files to modify:**
- `src/components/Dashboard.tsx` - Add useMemo to `getSortedData()`
- All view components - Memoize filtered results

**Implementation:**
```typescript
const sortedPods = useMemo(() => {
  return getSortedData(pods);
}, [pods, sortConfig]);

const filteredPods = useMemo(() => {
  if (!searchQuery) return sortedPods;
  return sortedPods.filter(pod => 
    pod.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
}, [sortedPods, searchQuery]);
```

---

### Task 3.3: Implement Virtual Scrolling for All Large Lists
**Problem:** Some views don't use VirtualizedTable, causing DOM bloat.

**Solution:**
- Ensure ALL resource lists use VirtualizedTable
- Audit all views for non-virtualized lists

**Files to audit:**
- `src/components/dashboard/views/*.tsx` - Check all view components

---

## Priority 4: State Management Refactor (Long-term)

### Task 4.1: Move to Context-Based State Management
**Problem:** Props drilling through multiple levels causes unnecessary re-renders.

**Solution:**
- Create DashboardContext for shared state
- Separate concerns: ClusterContext, ResourceContext, UIContext
- Use context selectors to prevent unnecessary re-renders

**Files to create:**
- `src/contexts/DashboardContext.tsx`
- `src/contexts/ClusterContext.tsx`
- `src/contexts/ResourceContext.tsx`

---

### Task 4.2: Implement State Normalization
**Problem:** Resource state is stored as arrays, causing O(N) lookups and updates.

**Solution:**
- Store resources in Maps keyed by namespace/name
- Convert to arrays only for rendering
- Reduces watcher update complexity from O(N*M) to O(M)

**Files to modify:**
- `src/components/Dashboard.tsx` - Refactor all resource state

**Implementation:**
```typescript
// Before: Array (O(N) updates)
const [pods, setPods] = useState<Pod[]>([]);

// After: Map (O(1) updates)
const [podsMap, setPodsMap] = useState<Map<string, Pod>>(new Map());
const pods = useMemo(() => Array.from(podsMap.values()), [podsMap]);
```

---

## Priority 5: Loading States & UX (User Perception)

### Task 5.1: Add Skeleton Loaders for All Views
**Problem:** Blank screens during loading make app feel slow.

**Solution:**
- Show skeleton loaders immediately on view switch
- Keep previous data visible with opacity overlay during refresh
- Add "Refreshing..." indicator for background updates

**Files to modify:**
- All view components - Add SkeletonLoader usage

---

### Task 5.2: Implement Progressive Loading
**Problem:** Users wait for ALL data before seeing anything.

**Solution:**
- Load critical data first (counts, summaries)
- Stream in detailed data progressively
- Show partial results immediately

---

### Task 5.3: Add Loading Progress Indicators
**Problem:** No feedback during long-running operations.

**Solution:**
- Add progress bar in top bar during data loading
- Show "Loading X resources..." status
- Implement cancellable loading operations

---

## Priority 6: Network & API Optimization

### Task 6.1: Implement Request Batching
**Problem:** Multiple sequential API calls on view switch.

**Solution:**
- Batch related API calls into single requests where possible
- Use Promise.all() for parallel loading
- Implement request queue with priority

**Files to modify:**
- `electron/k8s.ts` - Add batch request handlers

---

### Task 6.2: Add Request Cancellation
**Problem:** Switching views quickly causes race conditions with stale data.

**Solution:**
- Implement AbortController for all fetch operations
- Cancel in-flight requests when view changes
- Track request IDs to ignore stale responses

---

## Testing & Validation

### Task 7.1: Performance Benchmarking
- Measure time-to-interactive for each view
- Track re-render counts with React DevTools Profiler
- Monitor memory usage over time
- Test with clusters of varying sizes (10, 100, 1000+ pods)

### Task 7.2: Add Performance Monitoring
- Implement performance.mark() for key operations
- Log slow operations (>100ms) to console in dev mode
- Add performance metrics to status bar

---

## Implementation Order

**Week 1: Quick Wins (Tasks 1.1, 1.2, 3.2)**
- Optimistic view switching
- Basic caching
- Memoization

**Week 2: Watcher Optimization (Tasks 2.1, 2.2)**
- Conditional watchers
- Improved batching

**Week 3: Component Refactor (Tasks 3.1, 3.3)**
- Split Dashboard
- Ensure virtualization

**Week 4: State Management (Tasks 4.1, 4.2)**
- Context migration
- State normalization

**Week 5: Polish (Tasks 5.x, 6.x)**
- Loading states
- Network optimization

---

## Success Metrics

- View switch latency: < 50ms (currently ~500ms+)
- Time to first render: < 100ms (currently ~1000ms+)
- Re-render count per view switch: < 3 (currently 10+)
- Memory usage: Stable over 1 hour (currently grows)
- Watcher update processing: < 50ms per batch (currently ~200ms)

---

## Notes

- Follow performance.md guidelines for all changes
- Use React DevTools Profiler to validate improvements
- Test on large clusters (1000+ pods) before considering complete
- Maintain backward compatibility with existing features
- Document performance characteristics in code comments
