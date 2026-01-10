# Dashboard Component Split Plan

## Current State Analysis

**Dashboard.tsx:** ~1700 lines with multiple responsibilities:
1. State management (30+ state variables)
2. Data fetching and caching
3. Watcher lifecycle management
4. Resource detail drawer
5. Modals (scale, etc.)
6. View rendering (20+ different views)
7. Top bar with search/filters
8. Event handlers

## Split Strategy

### Phase 1: Extract Logical Components (This Session)

#### 1. DashboardHeader Component
**Responsibility:** Top bar with search, namespace selector, view toggle
**Props:**
- `clusterName: string`
- `activeView: string`
- `resourceCount: number`
- `searchQuery: string`
- `onSearchChange: (query: string) => void`
- `namespaces: string[]`
- `selectedNamespaces: string[]`
- `onNamespaceChange: (ns: string[]) => void`
- `podViewMode?: 'list' | 'visual'`
- `onPodViewModeChange?: (mode: 'list' | 'visual') => void`

**Benefits:**
- Isolated re-renders when search/filters change
- Reusable header component
- ~150 lines extracted

#### 2. DashboardContent Component
**Responsibility:** View rendering logic (all the conditional view rendering)
**Props:**
- `activeView: string`
- All resource data arrays
- `loading: boolean`
- `searchQuery: string`
- `sortConfig: SortConfig | null`
- `onSort: (key: string) => void`
- `onResourceClick: (resource: any, type: string) => void`
- Event handlers

**Benefits:**
- Isolated re-renders when view changes
- Cleaner separation of concerns
- ~800 lines extracted

#### 3. useDashboardState Hook
**Responsibility:** State management and data fetching
**Returns:**
- All state variables
- All setter functions
- `loadResources` function
- Cache helpers

**Benefits:**
- Reusable state logic
- Easier to test
- Cleaner component code
- ~400 lines extracted

#### 4. useDashboardWatchers Hook
**Responsibility:** Watcher lifecycle management
**Parameters:**
- `clusterName: string`
- `activeView: string`
- `selectedNamespaces: string[]`
- State setters

**Benefits:**
- Isolated watcher logic
- Easier to debug
- ~200 lines extracted

#### 5. ResourceDrawer Component
**Responsibility:** Detail drawer with tabs
**Props:**
- `isOpen: boolean`
- `onClose: () => void`
- `resource: any`
- `detailedResource: any`
- `activeTab: 'details' | 'topology'`
- `onTabChange: (tab: string) => void`
- Event handlers

**Benefits:**
- Isolated drawer re-renders
- Reusable drawer component
- ~150 lines extracted

### Phase 2: Further Optimization (Future)

#### 6. DashboardModals Component
**Responsibility:** All modals (scale, delete confirmations, etc.)
**Benefits:**
- Isolated modal state
- Cleaner main component

#### 7. Context-Based State (Optional)
**Responsibility:** Shared state via context
**Benefits:**
- Eliminates prop drilling
- More flexible state access

## Implementation Order

### Step 1: Create Custom Hooks (Low Risk)
1. Create `src/hooks/useDashboardState.ts`
2. Create `src/hooks/useDashboardWatchers.ts`
3. Extract state and watcher logic
4. Test that Dashboard still works

### Step 2: Extract Header (Low Risk)
1. Create `src/components/dashboard/DashboardHeader.tsx`
2. Move header JSX and logic
3. Wrap in React.memo
4. Test search and filters

### Step 3: Extract Content (Medium Risk)
1. Create `src/components/dashboard/DashboardContent.tsx`
2. Move all view rendering logic
3. Wrap in React.memo
4. Test all views render correctly

### Step 4: Extract Drawer (Low Risk)
1. Create `src/components/dashboard/ResourceDrawer.tsx`
2. Move drawer JSX and logic
3. Wrap in React.memo
4. Test drawer interactions

### Step 5: Refactor Main Dashboard (Low Risk)
1. Update Dashboard.tsx to use new components
2. Remove extracted code
3. Verify all functionality works
4. Run diagnostics

## File Structure After Split

```
src/
├── components/
│   ├── Dashboard.tsx (300-400 lines - orchestrator)
│   └── dashboard/
│       ├── DashboardHeader.tsx (150 lines)
│       ├── DashboardContent.tsx (800 lines)
│       ├── ResourceDrawer.tsx (150 lines)
│       └── views/ (existing)
├── hooks/
│   ├── useDashboardState.ts (400 lines)
│   ├── useDashboardWatchers.ts (200 lines)
│   └── usePortForwarding.ts (existing)
```

## Expected Benefits

### Performance
- **Reduced re-render scope**: Header changes don't re-render content
- **Better memoization**: Each component can be memoized independently
- **Faster development**: Smaller files load faster in editor

### Maintainability
- **Easier to understand**: Each file has single responsibility
- **Easier to test**: Isolated logic can be unit tested
- **Easier to modify**: Changes are localized

### Code Quality
- **Better separation of concerns**: Logic vs presentation
- **Reusable components**: Header/drawer can be reused
- **Cleaner code**: Less nesting, clearer structure

## Risk Assessment

### Low Risk
- Custom hooks (pure logic extraction)
- Header component (isolated UI)
- Drawer component (isolated UI)

### Medium Risk
- Content component (large, many dependencies)

### Mitigation
- Test each step thoroughly
- Keep git commits small and focused
- Easy to rollback if issues arise
- Maintain exact same functionality

## Testing Checklist

After each step:
- [ ] All views render correctly
- [ ] Search and filters work
- [ ] Namespace selector works
- [ ] Watchers start/stop correctly
- [ ] Drawer opens/closes correctly
- [ ] Resource details load
- [ ] Modals work
- [ ] No TypeScript errors
- [ ] No console errors
- [ ] Performance is same or better

## Success Criteria

- Dashboard.tsx reduced from 1700 to ~400 lines
- All functionality preserved
- No performance regression
- Cleaner, more maintainable code
- Easier to add new features

## Timeline

- Step 1 (Hooks): 2-3 hours
- Step 2 (Header): 1 hour
- Step 3 (Content): 2-3 hours
- Step 4 (Drawer): 1 hour
- Step 5 (Refactor): 1-2 hours
- Testing: 1-2 hours

**Total: 8-12 hours** (as estimated)

---

**Status:** Planning Complete, Ready to Implement  
**Next:** Start with Step 1 - Create Custom Hooks
