# Technology Stack

## Core Technologies

- **Runtime**: Electron 30.x with Node.js
- **Frontend Framework**: React 18.x with TypeScript 5.x
- **Build Tool**: Vite 5.x with vite-plugin-electron
- **Packaging**: electron-builder 24.x

## Key Libraries & Frameworks

### UI & Styling
- **Tailwind CSS**: Utility-first CSS framework with typography plugin
- **Framer Motion**: Animation library for smooth transitions
- **Lucide React**: Icon library
- **Monaco Editor**: Code editor for YAML editing
- **XTerm.js**: Terminal emulator with fit addon

### Kubernetes & Cloud
- **@kubernetes/client-node**: Official Kubernetes JavaScript client
- **AWS SDK**: EC2, EKS, STS, Bedrock clients for AWS integration
- **node-pty**: PTY bindings for terminal functionality

### AI Integration
- **ai SDK**: Vercel AI SDK for streaming responses
- **@ai-sdk/google**: Google Gemini integration
- **@ai-sdk/amazon-bedrock**: AWS Bedrock integration

### Data Visualization
- **Recharts**: Charting library for metrics
- **@xyflow/react**: Flow diagrams for topology visualization
- **react-virtualized**: Efficient rendering of large lists

### State & Data
- **React Hooks & Context**: Primary state management
- **electron-store**: Persistent storage for settings
- **js-yaml**: YAML parsing and serialization

## Common Commands

### Development
```bash
npm run dev              # Start development server with hot reload
npm run lint             # Run ESLint checks
npm run preview          # Preview production build
```

### Building
```bash
npm run build            # Full production build (TypeScript → Vite → electron-builder)
npm run rebuild          # Rebuild native modules (node-pty) for Electron
npm run fix:pty          # Fix node-pty bindings for Electron runtime
```

### Installation
```bash
npm install              # Install dependencies
npm run postinstall      # Auto-runs: install app deps + fix node-pty
```

## Build Configuration

- **TypeScript**: Strict mode enabled, ES2020 target, bundler module resolution
- **Vite**: Separate configs for main process (electron/main.ts) and renderer (src/)
- **Electron Builder**: Configured for macOS DMG (arm64), Windows NSIS, Linux AppImage
- **Code Signing**: Supports macOS notarization (requires Apple Developer credentials)

## Native Dependencies

- **node-pty**: Requires rebuilding for Electron runtime (handled by postinstall script)
- **External modules**: bufferutil, utf-8-validate marked as external in Vite config

## Development Notes

- Main process code lives in `electron/` directory
- Renderer process (React app) lives in `src/` directory
- IPC communication via preload script (`electron/preload.ts`)
- Custom title bar with draggable region for native window feel
