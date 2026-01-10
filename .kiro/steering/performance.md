# Performance Guidelines

## Core Performance Principles

Lumen handles large-scale Kubernetes clusters with thousands of resources. Performance is critical for maintaining a responsive UI and efficient resource usage.

## Rendering Optimization

### Virtualization
- **Always use virtualization** for lists with >100 items
- Use `react-virtualized` for tables and lists (see `VirtualizedTable.tsx`)
- Only render visible rows to prevent DOM bloat
- Example: Pod lists, event logs, large resource tables

### Batched Updates
- **Debounce watcher events** to prevent excessive re-renders
- Current standard: 650ms batch window for Kubernetes watchers
- Accumulate updates in a Map, then apply in a single setState
- See `Dashboard.tsx` watcher implementation for reference

```typescript
// Good: Batched updates
const pendingUpdates = new Map();
const processBatch = () => {
  setPods(prev => {
    const podMap = new Map(prev.map(p => [`${p.namespace}/${p.name}`, p]));
    pendingUpdates.forEach(({type, pod}) => {
      if (type === 'MODIFIED') podMap.set(key, pod);
    });
    return Array.from(podMap.values());
  });
};
setTimeout(processBatch, 650);

// Bad: Immediate updates
onPodChange((type, pod) => {
  setPods(prev => [...prev, pod]); // Re-renders on every event!
});
```

### React Optimization
- **Memoize expensive computations** with `useMemo`
- **Memoize callbacks** with `useCallback` when passing to child components
- **Use React.memo** for components that receive stable props
- **Avoid inline object/array creation** in render (causes unnecessary re-renders)

```typescript
// Good
const sortedPods = useMemo(() => 
  pods.sort((a, b) => a.name.localeCompare(b.name)), 
  [pods]
);

// Bad
const sortedPods = pods.sort((a, b) => a.name.localeCompare(b.name)); // Sorts on every render
```

### Lazy Loading
- **Fetch resource details on-demand** (drawer opens, not on list load)
- **Load heavy data only when needed** (topology, logs, metrics)
- **Use loading states** to show progress without blocking UI

## Data Management

### State Optimization
- **Keep state minimal** - derive computed values instead of storing them
- **Normalize data structures** - use Maps for O(1) lookups instead of arrays
- **Clear stale data** when switching clusters/namespaces
- **Avoid deep nesting** in state objects

```typescript
// Good: Map for O(1) updates
const podMap = new Map(pods.map(p => [`${p.namespace}/${p.name}`, p]));
podMap.set(key, updatedPod); // O(1)

// Bad: Array for O(N) updates
const index = pods.findIndex(p => p.name === name); // O(N)
pods[index] = updatedPod;
```

### Memory Management
- **Clean up watchers** when components unmount
- **Stop log streams** when tabs close
- **Limit log buffer size** (current: 1000 lines per stream)
- **Cancel AI streams** when switching contexts

```typescript
useEffect(() => {
  const cleanup = window.k8s.onPodChange(handler);
  return () => {
    cleanup(); // Always clean up!
    window.k8s.stopWatchPods();
  };
}, [dependencies]);
```

## IPC Performance

### Main Process Optimization
- **Batch IPC calls** when possible (e.g., fetch multiple resources in one call)
- **Stream large data** instead of sending all at once (logs, AI responses)
- **Use async/await** properly to avoid blocking the main thread
- **Cache expensive operations** (cluster metadata, CRD definitions)

### Renderer Process Optimization
- **Minimize IPC round-trips** - fetch what you need in one call
- **Don't poll** - use watchers and event emitters instead
- **Debounce user input** before making IPC calls (search, filters)

## Kubernetes Client Optimization

### Watcher Strategy
- **Use informers/watchers** instead of polling for real-time data
- **Watch only selected namespaces** (not all namespaces unless needed)
- **Stop watchers** when views are inactive
- **Handle reconnection** gracefully on network issues

### Query Optimization
- **Use label selectors** to filter at the API level
- **Request only needed fields** when possible
- **Limit result sets** for large clusters
- **Cache cluster-scoped resources** (nodes, storage classes, CRDs)

## UI Performance

### Animation Performance
- **Use CSS transforms** (translate, scale) instead of position changes
- **Prefer opacity** over visibility for smooth fades
- **Use `will-change`** sparingly for animations
- **Framer Motion** handles most optimizations, but avoid animating large lists

### Image and Asset Optimization
- **Use SVG icons** (Lucide React) instead of image files
- **Lazy load images** if displaying pod/container images
- **Optimize bundle size** - code split if needed

## Monitoring Performance

### Development Tools
- **React DevTools Profiler** - identify slow components
- **Chrome DevTools Performance** - analyze render cycles
- **Electron DevTools** - monitor IPC overhead
- **Memory profiler** - detect memory leaks

### Performance Metrics to Track
- **Time to first render** of resource lists
- **Watcher event processing time** (should be <100ms per batch)
- **Memory usage** with large clusters (target: <500MB for 1000 pods)
- **UI responsiveness** (60fps for animations, <100ms for interactions)

## Anti-Patterns to Avoid

❌ **Don't** fetch all resources on mount if not immediately needed  
❌ **Don't** store derived state (compute it with useMemo instead)  
❌ **Don't** create new objects/arrays in render without memoization  
❌ **Don't** use array methods in tight loops (use Maps/Sets)  
❌ **Don't** forget to clean up subscriptions and watchers  
❌ **Don't** block the main thread with synchronous operations  
❌ **Don't** re-render entire lists when one item changes  

## Performance Checklist

Before committing code that handles large datasets:

- [ ] Are lists virtualized if they can exceed 100 items?
- [ ] Are watcher updates batched and debounced?
- [ ] Are expensive computations memoized?
- [ ] Are event listeners and watchers cleaned up?
- [ ] Is state normalized for efficient updates?
- [ ] Are IPC calls minimized and batched?
- [ ] Does the UI remain responsive under load?
- [ ] Is memory usage reasonable after extended use?
