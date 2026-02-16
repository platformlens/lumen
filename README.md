# Lumen (K8ptain)

![Lumen Screenshot](./screenshots/screenshot_ai_2.png)

Lumen is a modern, high-performance Kubernetes management tool built with Electron, React, and TypeScript. It offers a sleek, intuitive interface for monitoring and managing your Kubernetes clusters with a focus on developer experience and visual clarity.

## Features

- **Real-time Monitoring**: Live updates for Pods, Nodes, Deployments, and other resources.
- **Multi-Cluster Support**: seamless switching between different Kubernetes contexts.
- **Resource Management**: Detailed views and management for:
  - Workloads (Pods, Deployments, DaemonSets, StatefulSets, Jobs, CronJobs)
  - Network (Services, Ingress)
  - Config (ConfigMaps, Secrets)
  - Access Control (Roles, RoleBindings)
- **Log Viewer**: Integrated real-time log streaming for pods.
- **Port Forwarding**: Easy-to-use port forwarding interface.
- **Interactive Terminal**: Built-in shell for direct cluster interaction.
- **Modern UI**: Dark-mode first design with Tailwind CSS and glassmorphism aesthetics.

## Tech Stack

- **Core**: [Electron](https://www.electronjs.org/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/), [Framer Motion](https://www.framer.com/motion/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) (inferred) or React Context / Hooks
- **Kubernetes Client**: [@kubernetes/client-node](https://github.com/kubernetes-client/javascript)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/) (usually comes with Node.js)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ai-experiment
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

### Development

Start the application in development mode with hot-reloading:

```bash
npm run dev
```

This will start the Vite dev server and launch the Electron application.

### Building for Production

To create a production build for your platform (macOS):

```bash
npm run build
```

The output artifacts will be available in the `release` or `dist-electron` directory (depending on configuration).

## Project Structure

- `electron/`: Main process and preload scripts.
- `src/`: Renderer process (React application).
  - `components/`: UI components.
  - `App.tsx`: Main entry point.
- `vite.config.ts`: Vite configuration for both main and renderer processes.
- `electron-builder.json5`: Configuration for packaging the application.

## Troubleshooting

### Code Signing (macOS)

**Important Note for Forks and Contributors:**
Official builds of Lumen are code-signed and notarized using our specific Apple Developer credentials. If you fork this project or build it locally, you will **not** have access to these credentials.
- Your local builds will be **unsigned** by default.
- If you wish to distribute a forked version, you must provide your own Apple Developer credentials and sign the application yourself. Use the detailed instructions in `package.json` and `electron-builder.json5` as a guide, but you will need your own `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, and `APPLE_ID_PASSWORD` secrets.

If you encounter issues with code signing during the build process, ensure you have the correct Apple Developer certificates installed. For local development, you may modify `package.json` or `electron-builder.json5` to skip signing if strictly necessary, but signed builds are required for distribution.

### Port Forwarding

Port forwarding relies on the local `kubectl` binary or the internal Kubernetes client. Ensure your kubeconfig is correctly set up at `~/.kube/config`.

## Contributors

We welcome contributions from the community! If you'd like to contribute, please check out our issues page.

## Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for all, regardless of gender, sexual orientation, disability, ethnicity, religion, or similar personal characteristic.

Please be kind and respectful in all interactions. Harassment, hate speech, and offensive behavior will not be tolerated.
