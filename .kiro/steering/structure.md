# Project Structure

## Root Directory Layout

```
├── electron/           # Electron main process code
├── src/               # React renderer process (UI)
├── build/             # Build assets (icons, entitlements)
├── dist/              # Vite build output (renderer)
├── dist-electron/     # Electron build output (main process)
├── release/           # electron-builder output (installers)
├── public/            # Static assets
├── scripts/           # Build scripts (notarization)
└── release-notes/     # Version release notes
```

## Electron Process Architecture

### Main Process (`electron/`)
- **main.ts**: Application entry point, window management, IPC handlers
- **preload.ts**: Bridge between main and renderer processes (exposes `window.k8s` API)
- **k8s.ts**: Kubernetes client operations and watchers
- **aws.ts**: AWS SDK integrations (EC2, EKS)
- **terminal.ts**: Terminal/PTY management
- **prompts.ts**: AI prompt templates and streaming logic

### Renderer Process (`src/`)
React application with the following structure:

#### Core Application Files
- **main.tsx**: React entry point
- **App.tsx**: Root component with layout, state management, and routing
- **App.css**: Global styles

#### Component Organization (`src/components/`)

**Dashboard Components** (`dashboard/`)
- **Dashboard.tsx**: Main dashboard orchestrator with resource loading and state
- **ConnectionErrorCard.tsx**: Cluster connection error UI
- **DrawerDetailsRenderer.tsx**: Resource detail drawer content router
- **EventsTable.tsx**: Kubernetes events table
- **NamespaceSelector.tsx**: Namespace filter dropdown
- **OverviewCharts.tsx**: Dashboard metrics visualizations

**Dashboard Views** (`dashboard/views/`)
- **OverviewView.tsx**: Cluster overview with charts
- **PodsView.tsx**: Pod list and management
- **DeploymentsView.tsx**: Deployment list and management
- **NodesView.tsx**: Node list and metrics
- **GenericResourceView.tsx**: Reusable view for various resource types
- **AwsView.tsx**: AWS-specific resources (EC2, EKS)
- **CertManagerView.tsx**: Cert-manager resources

**Feature Components** (`features/`)
- `ai/AIPanel.tsx`: AI assistant panel with streaming responses
- `logs/LogViewer.tsx`: Multi-tab log viewer with container selection
- `terminal/TerminalComponent.tsx`: Integrated terminal with XTerm.js
- `yaml-editor/YamlEditor.tsx`: Monaco-based YAML editor
- `yaml-editor/DiffModal.tsx`: YAML diff viewer
- `sidebar/Sidebar.tsx`: Main navigation sidebar
- `sidebar/SecondarySidebar.tsx`: Context-aware secondary navigation
- `sidebar/ClusterList.tsx`: Cluster selection list
- `settings/Settings.tsx`: Application settings panel
- `layout/StatusBar.tsx`: Bottom status bar
- `layout/BottomPanel.tsx`: Resizable bottom panel container

**Resource Detail Components** (`resources/details/`)
Specialized detail views for each resource type:
- DeploymentDetails, PodDetails, NodeDetails, ServiceDetails
- DaemonSetDetails, StatefulSetDetails, ReplicaSetDetails
- JobDetails, CronJobDetails, HpaDetails
- SecretDetails, ServiceAccountDetails, NamespaceDetails
- RoleDetails, RoleBindingDetails, ClusterRoleBindingDetails
- CrdDetails, NodePoolDetails, PodDisruptionBudgetDetails
- PriorityClassDetails, ContainerResources

**Resource Visualizers** (`resources/visualizers/`)
- **ResourceTopology.tsx**: Flow-based resource relationship graph
- **TopologyNode.tsx**: Custom nodes for topology view
- **PodVisualizer.tsx**: Visual pod representation

**Shared Components** (`shared/`)
Reusable UI components:
- **ResourceTable.tsx**: Generic resource table with actions
- **VirtualizedTable.tsx**: Performance-optimized table for large datasets
- **Drawer.tsx**: Slide-out detail panel
- **StatusBadge.tsx**: Status indicator badges
- **TimeAgo.tsx**: Relative time display
- **ToastNotification.tsx**: Toast notifications
- **ConfirmModal.tsx**: Confirmation dialogs
- **ScaleModal.tsx**: Resource scaling dialog
- **PortForwardModal.tsx**: Port forwarding setup
- **PortActions.tsx**: Port forwarding action buttons
- **SkeletonLoader.tsx**: Loading state placeholders
- **GlassButton.tsx**: Glassmorphism styled button
- **ToggleGroup.tsx**: Toggle button group
- **Tooltip.tsx**: Tooltip component
- **ErrorBoundary.tsx**: React error boundary

#### Utilities (`src/utils/`)
- **cluster-utils.ts**: Cluster detection and helpers (EKS, etc.)
- **resource-utils.ts**: Resource formatting and status helpers
- **topologyBuilder.ts**: Resource relationship graph builder
- **yaml-utils.ts**: YAML parsing and validation

#### Hooks (`src/hooks/`)
- **usePortForwarding.ts**: Port forwarding state management
- **useResourceSorting.ts**: Table sorting logic

## Key Architectural Patterns

### State Management
- **Hoisted State**: Main state in App.tsx, passed down via props
- **Local State**: Component-specific state with useState
- **Persistent State**: electron-store for user preferences
- **Real-time Updates**: Kubernetes watchers with batched updates (650ms debounce)

### IPC Communication
- Main → Renderer: Event emitters (`onPodChange`, `onPodLogChunk`)
- Renderer → Main: Async calls via `window.k8s.*` API
- Preload script exposes type-safe API surface

### Performance Optimizations
- **Virtualized Lists**: react-virtualized for large resource lists
- **Batched Updates**: Debounced watcher events to reduce re-renders
- **Lazy Loading**: Resource details fetched on-demand
- **Memoization**: Strategic use of React.memo and useMemo

### UI Patterns
- **Glassmorphism**: Backdrop blur with transparency for modern aesthetic
- **Drawer Pattern**: Slide-out panels for resource details
- **Tab System**: Multi-tab bottom panel for logs, terminal, YAML editor
- **Toast Notifications**: Non-blocking feedback for user actions
- **Modal Dialogs**: Confirmation and input modals

## File Naming Conventions

- **Components**: PascalCase (e.g., `Dashboard.tsx`, `PodDetails.tsx`)
- **Utilities**: kebab-case (e.g., `cluster-utils.ts`, `yaml-utils.ts`)
- **Hooks**: camelCase with `use` prefix (e.g., `usePortForwarding.ts`)
- **Types**: Inline TypeScript interfaces, no separate type files
- **Styles**: Component-scoped with Tailwind classes, global styles in `App.css`

## Configuration Files

- **package.json**: Dependencies, scripts, Electron main entry
- **tsconfig.json**: TypeScript compiler options (strict mode)
- **vite.config.ts**: Vite build configuration for Electron
- **electron-builder.json5**: Packaging and distribution config
- **tailwind.config.cjs**: Tailwind CSS configuration
- **.eslintrc.cjs**: ESLint rules for TypeScript and React
