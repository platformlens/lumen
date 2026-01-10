# Code Quality & Best Practices

## Electron Best Practices

### Process Separation
- **Keep main and renderer processes strictly separated**
- **Never import Node.js modules directly in renderer** - use IPC instead
- **All Kubernetes operations belong in main process** (`electron/k8s.ts`)
- **All AWS operations belong in main process** (`electron/aws.ts`)
- **Renderer only handles UI logic and state management**

### IPC Communication
- **Use contextBridge in preload.ts** to expose safe APIs to renderer
- **Type-safe IPC** - define clear interfaces for all IPC methods
- **Never expose entire Node.js APIs** to renderer (security risk)
- **Use event emitters** for streaming data (logs, watchers)
- **Handle IPC errors gracefully** with try-catch and error messages

```typescript
// Good: Type-safe IPC in preload.ts
contextBridge.exposeInMainWorld('k8s', {
  getPods: (cluster: string, namespaces: string[]) => 
    ipcRenderer.invoke('k8s:getPods', cluster, namespaces),
  onPodChange: (callback: (type: string, pod: any) => void) => {
    ipcRenderer.on('k8s:podChange', (_, type, pod) => callback(type, pod));
    return () => ipcRenderer.removeAllListeners('k8s:podChange');
  }
});

// Bad: Exposing raw Node.js modules
contextBridge.exposeInMainWorld('fs', require('fs')); // Security risk!
```

### Security
- **Enable contextIsolation** (already enabled in this project)
- **Disable nodeIntegration in renderer** (already disabled)
- **Validate all IPC inputs** in main process
- **Sanitize user input** before passing to shell commands
- **Use allowlist for external URLs** if opening links

## Separation of Concerns

### Business Logic Layer
Business logic should live in the main process and utility files, NOT in UI components.

**Main Process (`electron/`):**
- Kubernetes API calls and data transformation
- AWS SDK operations
- File system operations
- Terminal/PTY management
- AI prompt execution and streaming

**Utilities (`src/utils/`):**
- Data formatting and transformation
- Status calculations and health checks
- Resource relationship building
- YAML parsing and validation
- Pure functions with no side effects

**Components (`src/components/`):**
- UI rendering and layout
- User interaction handling
- Local UI state (modals, drawers, tabs)
- Calling utility functions for data transformation
- Triggering IPC calls via `window.k8s.*`

```typescript
// Good: Business logic in utility
// src/utils/resource-utils.ts
export function getPodStatus(pod: any): 'Running' | 'Pending' | 'Failed' {
  const phase = pod.status?.phase;
  const conditions = pod.status?.conditions || [];
  // Complex logic here
  return phase;
}

// src/components/PodsView.tsx
const status = getPodStatus(pod); // UI just calls utility

// Bad: Business logic in component
const PodRow = ({ pod }) => {
  // Complex status calculation directly in component
  const phase = pod.status?.phase;
  const conditions = pod.status?.conditions || [];
  let status = phase;
  if (conditions.some(c => c.type === 'Ready' && c.status === 'False')) {
    status = 'NotReady';
  }
  // ... more logic
};
```

### Component Responsibilities

**Smart Components (Container Components):**
- Manage state and data fetching
- Handle IPC communication
- Pass data and callbacks to presentational components
- Examples: `Dashboard.tsx`, `App.tsx`

**Presentational Components (Dumb Components):**
- Receive data via props
- Render UI based on props
- Emit events via callbacks
- No direct IPC calls or business logic
- Examples: `ResourceTable.tsx`, `StatusBadge.tsx`, `TimeAgo.tsx`

```typescript
// Good: Presentational component
interface PodTableProps {
  pods: Pod[];
  onPodClick: (pod: Pod) => void;
  onDeletePod: (pod: Pod) => void;
}

export const PodTable: React.FC<PodTableProps> = ({ pods, onPodClick, onDeletePod }) => {
  return (
    <table>
      {pods.map(pod => (
        <tr key={pod.name} onClick={() => onPodClick(pod)}>
          <td>{pod.name}</td>
          <button onClick={() => onDeletePod(pod)}>Delete</button>
        </tr>
      ))}
    </table>
  );
};

// Bad: Component doing too much
export const PodTable = () => {
  const [pods, setPods] = useState([]);
  
  useEffect(() => {
    window.k8s.getPods().then(setPods); // IPC call in presentational component
  }, []);
  
  const handleDelete = async (pod) => {
    await window.k8s.deletePod(pod.name); // Business logic in component
    setPods(prev => prev.filter(p => p.name !== pod.name));
  };
  
  return <table>...</table>;
};
```

## TypeScript Best Practices

### Type Safety
- **Use strict mode** (already enabled)
- **Avoid `any` type** - use `unknown` or proper types
- **Define interfaces** for complex objects
- **Use type guards** for runtime type checking
- **Leverage TypeScript inference** - don't over-annotate

```typescript
// Good: Proper typing
interface Pod {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  status: {
    phase: 'Running' | 'Pending' | 'Failed' | 'Succeeded';
    conditions?: Array<{ type: string; status: string }>;
  };
}

function isPodRunning(pod: Pod): boolean {
  return pod.status.phase === 'Running';
}

// Bad: Using any
function isPodRunning(pod: any): boolean {
  return pod.status?.phase === 'Running'; // No type safety
}
```

### Null Safety
- **Use optional chaining** (`?.`) for potentially undefined values
- **Use nullish coalescing** (`??`) for default values
- **Check for null/undefined** before accessing nested properties
- **Provide sensible defaults** in function parameters

```typescript
// Good
const podName = pod?.metadata?.name ?? 'unknown';
const replicas = deployment.spec?.replicas ?? 0;

// Bad
const podName = pod.metadata.name || 'unknown'; // Crashes if pod.metadata is undefined
```

## Code Organization

### File Structure
- **One component per file** (except small, tightly coupled helpers)
- **Group related components** in subdirectories
- **Keep files under 500 lines** - split if larger
- **Co-locate related utilities** with components if only used there

### Naming Conventions
- **Components**: PascalCase (`PodDetails.tsx`)
- **Utilities**: kebab-case (`resource-utils.ts`)
- **Hooks**: camelCase with `use` prefix (`usePortForwarding.ts`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_LOG_LINES`)
- **Interfaces**: PascalCase with descriptive names (`PodDetailsProps`)

### Import Organization
```typescript
// 1. External dependencies
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

// 2. Internal components
import { StatusBadge } from '../shared/StatusBadge';
import { TimeAgo } from '../shared/TimeAgo';

// 3. Utilities and helpers
import { getPodStatus } from '../../utils/resource-utils';

// 4. Types (if separate file)
import type { Pod, PodStatus } from '../../types';
```

## React Best Practices

### Component Design
- **Keep components focused** - single responsibility principle
- **Prefer composition over inheritance**
- **Use custom hooks** to extract reusable logic
- **Avoid prop drilling** - use context for deeply nested props
- **Keep render methods pure** - no side effects

### State Management
- **Lift state up** to the nearest common ancestor
- **Keep state minimal** - derive values instead of storing
- **Use local state** for UI-only concerns (modal open/closed)
- **Use refs** for values that don't trigger re-renders
- **Batch state updates** when updating multiple values

```typescript
// Good: Minimal state
const [pods, setPods] = useState<Pod[]>([]);
const runningPods = useMemo(() => 
  pods.filter(p => p.status.phase === 'Running'), 
  [pods]
);

// Bad: Redundant state
const [pods, setPods] = useState<Pod[]>([]);
const [runningPods, setRunningPods] = useState<Pod[]>([]); // Derived value stored!
```

### Effect Management
- **Clean up effects** - return cleanup function
- **Specify dependencies** correctly - don't omit or use empty array incorrectly
- **Avoid effect chains** - combine related effects
- **Use effect only for side effects** - not for derived state

## Error Handling

### Graceful Degradation
- **Always handle errors** in async operations
- **Show user-friendly error messages** (not stack traces)
- **Provide retry mechanisms** for transient failures
- **Log errors** for debugging but don't expose sensitive info

```typescript
// Good: Proper error handling
const handleDeletePod = async (pod: Pod) => {
  try {
    await window.k8s.deletePod(clusterName, pod.namespace, pod.name);
    showToast(`Pod ${pod.name} deleted successfully`, 'success');
  } catch (error) {
    console.error('Failed to delete pod:', error);
    showToast(`Failed to delete pod: ${error.message}`, 'error');
  }
};

// Bad: No error handling
const handleDeletePod = async (pod: Pod) => {
  await window.k8s.deletePod(clusterName, pod.namespace, pod.name); // Crashes on error
  showToast('Pod deleted', 'success');
};
```

### Error Boundaries
- **Wrap major sections** in ErrorBoundary components
- **Provide fallback UI** for crashed components
- **Log errors** to help with debugging
- **Allow recovery** when possible

## Testing Considerations

While tests aren't currently implemented, code should be written to be testable:

- **Pure functions** are easy to test (utilities)
- **Dependency injection** makes mocking easier
- **Small, focused functions** are easier to test
- **Avoid tight coupling** to Electron APIs in business logic

## Code Review Checklist

Before submitting code:

- [ ] Business logic is in main process or utilities, not UI components
- [ ] Components are focused and have single responsibility
- [ ] IPC calls are type-safe and error-handled
- [ ] No `any` types (use proper types or `unknown`)
- [ ] Effects have cleanup functions
- [ ] State is minimal and normalized
- [ ] Expensive computations are memoized
- [ ] User-facing errors have friendly messages
- [ ] Code follows naming conventions
- [ ] Imports are organized
- [ ] No console.logs in production code (use proper logging)
- [ ] TypeScript strict mode passes with no errors

## Anti-Patterns to Avoid

❌ **Don't** put business logic in UI components  
❌ **Don't** import Node.js modules in renderer process  
❌ **Don't** use `any` type without good reason  
❌ **Don't** forget to clean up effects and listeners  
❌ **Don't** store derived state (compute it instead)  
❌ **Don't** make IPC calls in presentational components  
❌ **Don't** expose raw Node.js APIs to renderer  
❌ **Don't** ignore TypeScript errors (fix them properly)  
❌ **Don't** create god components (split them up)  
❌ **Don't** use inline functions as props without memoization  
