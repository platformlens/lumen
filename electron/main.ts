import { app, BrowserWindow, ipcMain, shell, dialog, utilityProcess } from 'electron'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import fixPath from 'fix-path';
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { K8sService } from './k8s'
import { TerminalService } from './terminal'
import { AwsService } from './aws'
import { ContextEngine } from './context-engine/context-engine'
import { ContextEngineConfig } from './context-engine/types'
import { ChatSessionManager } from './context-engine/chat-session'
import { createGoogleGenerativeAI, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI } from '@ai-sdk/openai';
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { APICallError } from '@ai-sdk/provider';
import { streamText, stepCountIs, type ModelMessage, type LanguageModelUsage } from 'ai';
import { buildKubectlTools, buildToolSystemPrompt, type ToolMode } from './ai-tools';
import { startActiveObservation } from '@langfuse/tracing';
import {
  isLangfuseTracingEnabled,
  setLangfuseTraceAnalyticsPreferenceReader,
  shutdownLangfuseOtel,
  syncLangfuseOtelWithStore,
} from './langfuse-otel';
import { getLangfuseClient, mapAiUsageToLangfuse, resolveLumenChatSystemBase } from './langfuse-lumen';
import { withTimeout } from '../src/lib/with-timeout';
import {
  bedrockMessagesWithOptionalCache,
  getOrCreateGeminiExplicitCachedContentName,
  isAnthropicBedrockModel,
} from './ai-prompt-cache';
import { AI_THINK_CLOSE, AI_THINK_OPEN } from '../src/utils/ai-thinking';
import { geminiThinkingConfigForModel } from '../src/utils/gemini-thinking-config';
import dotenv from 'dotenv'

function serializeAiUsageForRenderer(u: LanguageModelUsage | undefined) {
  if (!u) return undefined;
  const reasoning =
    u.reasoningTokens ?? u.outputTokenDetails?.reasoningTokens;
  const cached =
    u.cachedInputTokens ?? u.inputTokenDetails?.cacheReadTokens;
  return {
    ...(u.inputTokens != null ? { inputTokens: u.inputTokens } : {}),
    ...(u.outputTokens != null ? { outputTokens: u.outputTokens } : {}),
    ...(u.totalTokens != null ? { totalTokens: u.totalTokens } : {}),
    ...(reasoning != null ? { reasoningTokens: reasoning } : {}),
    ...(cached != null ? { cachedInputTokens: cached } : {}),
  };
}
import Store from 'electron-store'
import { Worker } from 'worker_threads'
import { WatcherBatchBuffer } from './watcher-batch-buffer'
import type { TransformRequest, TransformResponse } from './resource-transform-worker'
import type { AuditLogWorkerRequest, AuditLogWorkerResponse } from './audit-log-worker'
import type { LightweightPod, WorkerOutbound } from '../src/types/pod-worker'
import { artifactHubFetchMain } from './artifacthub-fetch'
import { getHelmCatalogForIpc } from './helm-catalog-main'

// Fix PATH for MacOS to find aws/kubectl etc
fixPath();

// Manually ensure common paths are present (fix-path sometimes misses these in certain shell setups)
if (process.platform === 'darwin') {
  const commonPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];

  const currentPath = process.env.PATH || '';
  const newPath = commonPaths.reduce((path, p) => {
    if (!path.includes(p)) {
      return `${path}:${p}`;
    }
    return path;
  }, currentPath);

  process.env.PATH = newPath;
}

dotenv.config();

/** Custom URL scheme for Supabase OAuth PKCE redirect (also add to Auth → URL Configuration in Supabase). */
const OAUTH_CALLBACK_PROTOCOL = 'io.platformlens.lumen'

function registerOAuthDeepLinkProtocol(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(OAUTH_CALLBACK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(OAUTH_CALLBACK_PROTOCOL)
    }
  } catch (e) {
    console.error('[main] setAsDefaultProtocolClient failed:', e)
  }
}

let win: BrowserWindow | null = null
let pendingOAuthDeepLink: string | null = null

function queueOAuthDeepLink(url: string): void {
  if (!url.startsWith(`${OAUTH_CALLBACK_PROTOCOL}:`)) return
  pendingOAuthDeepLink = url
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    flushPendingOAuthDeepLink()
  }
}

function flushPendingOAuthDeepLink(): void {
  if (!pendingOAuthDeepLink || !win || win.isDestroyed()) return
  win.webContents.send('auth:oauth-callback', pendingOAuthDeepLink)
  pendingOAuthDeepLink = null
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

registerOAuthDeepLinkProtocol()

app.on('second-instance', (_event, argv) => {
  const url = argv.find(
    (a): a is string => typeof a === 'string' && a.startsWith(`${OAUTH_CALLBACK_PROTOCOL}:`),
  )
  if (url) queueOAuthDeepLink(url)
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

if (process.platform === 'darwin') {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (url.startsWith(`${OAUTH_CALLBACK_PROTOCOL}:`)) {
      queueOAuthDeepLink(url)
    }
  })
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

/** App/window/dock icon: `public/` in dev, Vite `dist/` in packaged builds. */
const APP_LOGO_PNG = path.join(process.env.VITE_PUBLIC, 'logo-new.png')

const store = new Store();

setLangfuseTraceAnalyticsPreferenceReader(() => {
  const v = store.get('settings_aiTraceAnalytics') as boolean | undefined;
  return v !== false;
});
syncLangfuseOtelWithStore();

const k8sService = new K8sService()
const terminalService = new TerminalService()
const awsService = new AwsService()
awsService.sendToAuditLogWorker = sendToAuditLogWorker;

// Initialize Context Engine with config from store or defaults
const contextEngineConfig: ContextEngineConfig = (store.get('contextEngineConfig') as ContextEngineConfig) || {
  tokenBudget: 2000,
  summariesEnabled: true,
  anomalyDetectionEnabled: true,
};
const contextEngine = new ContextEngine(contextEngineConfig);
// Generation counters to prevent stale watcher callbacks from feeding the store.
// When a watcher restarts, the generation increments. Callbacks from old generations are ignored.
let podWatchGeneration = 0;
let deploymentWatchGeneration = 0;
let nodeWatchGeneration = 0;
// Track last-watched namespace scope per kind to avoid unnecessary clearKind calls
let lastPodWatchScope = '';
let lastDeploymentWatchScope = '';
let podBatchBuffer: WatcherBatchBuffer | null = null;
let deploymentBatchBuffer: WatcherBatchBuffer | null = null;
let nodeBatchBuffer: WatcherBatchBuffer | null = null;
let helmBatchBuffer: WatcherBatchBuffer | null = null;
let helmWatchGeneration = 0;
// Per-resource-type batch buffers for generic watcher resources that have worker transforms
const genericBatchBuffers = new Map<string, WatcherBatchBuffer>();
const genericWatchGenerations = new Map<string, number>();
// Map generic watch keys to worker resourceType values
const WATCH_KEY_TO_WORKER_TYPE: Record<string, string> = {
  replicasets: 'replicaset',
  secrets: 'secret',
  persistentvolumes: 'persistentvolume',
  persistentvolumeclaims: 'persistentvolumeclaim',
};
const chatSessionManager = new ChatSessionManager(store);

// Spawn resource transform worker once at startup
const workerPath = path.join(__dirname, 'resource-transform-worker.js');
let transformWorker: Worker | null = null;
const pendingTransforms = new Map<string, (response: TransformResponse) => void>();
let transformRequestId = 0;

// Spawn audit-log worker (lazily on first request)
const auditLogWorkerPath = path.join(__dirname, 'audit-log-worker.js');
let auditLogWorker: Worker | null = null;
const pendingAuditLogRequests = new Map<string, (response: AuditLogWorkerResponse) => void>();

function getOrCreateWorker(): Worker {
  if (!transformWorker) {
    transformWorker = new Worker(workerPath);
    transformWorker.on('message', (response: TransformResponse) => {
      const resolve = pendingTransforms.get(response.id);
      if (resolve) {
        pendingTransforms.delete(response.id);
        resolve(response);
      }
    });
    transformWorker.on('error', (err) => {
      console.error('[Worker] Transform worker error:', err);
      transformWorker = null;
    });
    transformWorker.on('exit', (code) => {
      if (code !== 0) console.error('[Worker] Transform worker exited with code', code);
      transformWorker = null;
    });
  }
  return transformWorker;
}

function sendToWorker(request: TransformRequest): Promise<TransformResponse> {
  return new Promise((resolve) => {
    pendingTransforms.set(request.id, resolve);
    getOrCreateWorker().postMessage(request);
  });
}

function getOrCreateAuditLogWorker(): Worker {
  if (!auditLogWorker) {
    auditLogWorker = new Worker(auditLogWorkerPath);
    auditLogWorker.on('message', (response: AuditLogWorkerResponse) => {
      const resolve = pendingAuditLogRequests.get(response.id);
      if (resolve) {
        pendingAuditLogRequests.delete(response.id);
        resolve(response);
      }
    });
    auditLogWorker.on('error', (err) => {
      console.error('[Worker] Audit log worker error:', err);
      auditLogWorker = null;
    });
    auditLogWorker.on('exit', (code) => {
      if (code !== 0) console.error('[Worker] Audit log worker exited with code', code);
      auditLogWorker = null;
    });
  }
  return auditLogWorker;
}

function sendToAuditLogWorker(request: AuditLogWorkerRequest): Promise<AuditLogWorkerResponse> {
  return new Promise((resolve) => {
    pendingAuditLogRequests.set(request.id, resolve);
    getOrCreateAuditLogWorker().postMessage(request);
  });
}

// --- Pod Worker (utilityProcess) ---
const podWorkerPath = path.join(__dirname, 'k8s-pod-worker.js');
let podWorker: Electron.UtilityProcess | null = null;
const pendingChunkRequests = new Map<string, (pods: LightweightPod[]) => void>();
// Track UID → {name, namespace} so context engine deletes work (pod worker only sends UID for deletes)
const podUidMap = new Map<string, { name: string; namespace: string }>();

function spawnPodWorker(): Electron.UtilityProcess {
  const worker = utilityProcess.fork(podWorkerPath);

  worker.on('message', (msg: WorkerOutbound) => {
    switch (msg.type) {
      case 'pod-delta-batch':
        if (win && !win.isDestroyed()) win.webContents.send('k8s-pod-delta-batch', msg.deltas);
        // Forward deltas to context engine so AI summaries stay in sync
        for (const delta of msg.deltas) {
          try {
            if (delta.action === 'delete' && delta.uid) {
              const info = podUidMap.get(delta.uid);
              if (info) {
                contextEngine.handleResourceEvent('Pod', 'DELETED', {
                  metadata: { uid: delta.uid, name: info.name, namespace: info.namespace },
                });
                podUidMap.delete(delta.uid);
              }
            } else if (delta.pod) {
              const p = delta.pod;
              podUidMap.set(p.uid, { name: p.name, namespace: p.namespace });
              // Build a minimal raw-pod-shaped object for the context engine extractor
              const pseudoRaw = {
                metadata: { uid: p.uid, name: p.name, namespace: p.namespace, creationTimestamp: p.age },
                status: {
                  phase: p.status === 'Terminating' ? 'Running' : p.status,
                  containerStatuses: p.containers.filter(c => c.name !== '').map(c => ({
                    name: c.name,
                    ready: c.ready,
                    restartCount: c.restartCount,
                    state: c.state === 'running' ? { running: {} }
                      : c.state === 'waiting' ? { waiting: { reason: 'Waiting' } }
                      : { terminated: { reason: 'Terminated' } },
                  })),
                  conditions: [],
                },
                spec: { containers: [] },
              };
              const eventType = delta.action === 'add' ? 'ADDED' : 'MODIFIED';
              contextEngine.handleResourceEvent('Pod', eventType, pseudoRaw);
            }
          } catch (err) {
            console.error('[ContextEngine] Error processing pod worker delta:', err);
          }
        }
        break;
      case 'informer-synced':
        if (win && !win.isDestroyed()) win.webContents.send('k8s-pod-informer-synced', { count: msg.count });
        break;
      case 'informer-error':
        if (win && !win.isDestroyed()) win.webContents.send('k8s-pod-informer-error', {
          error: msg.error,
          recoverable: msg.recoverable,
        });
        break;
      case 'pods-chunk-reply': {
        const resolve = pendingChunkRequests.get(msg.requestId);
        if (resolve) {
          pendingChunkRequests.delete(msg.requestId);
          resolve(msg.payload);
        }
        break;
      }
      case 'informer-stopped':
        contextEngine.clearKind('Pod');
        podUidMap.clear();
        break;
    }
  });

  worker.on('exit', (code) => {
    console.error(`[pod-worker] exited with code ${code}`);
    podWorker = null;
    if (code !== 0) {
      setTimeout(() => { podWorker = spawnPodWorker(); }, 2000);
    }
  });

  return worker;
}

function ensurePodWorker(): Electron.UtilityProcess {
  if (!podWorker) podWorker = spawnPodWorker();
  return podWorker;
}

app.on('before-quit', () => {
  void shutdownLangfuseOtel().catch(() => {});
  // Stop all K8s watchers to prevent reconnection loops during shutdown
  k8sService.stopAllWatchers();

  // Clean up batch buffers
  if (podBatchBuffer) { podBatchBuffer.destroy(); podBatchBuffer = null; }
  if (deploymentBatchBuffer) { deploymentBatchBuffer.destroy(); deploymentBatchBuffer = null; }
  if (nodeBatchBuffer) { nodeBatchBuffer.destroy(); nodeBatchBuffer = null; }
  if (helmBatchBuffer) { helmBatchBuffer.destroy(); helmBatchBuffer = null; }
  for (const [, buffer] of genericBatchBuffers) {
    buffer.destroy();
  }
  genericBatchBuffers.clear();

  if (podWorker) {
    podWorker.kill();
    podWorker = null;
  }
  pendingChunkRequests.clear();
});


function registerIpcHandlers() {
  // --- AWS Handlers ---
  ipcMain.handle('aws:getEksCluster', async (_, region, clusterName) => {
    const creds = store.get('awsCreds');
    return awsService.getEksCluster(region, clusterName, creds);
  });

  ipcMain.handle('aws:getVpcDetails', async (_, region, vpcId) => {
    const creds = store.get('awsCreds');
    return awsService.getVpcDetails(region, vpcId, creds);
  });

  ipcMain.handle('aws:getSubnets', async (_, region, vpcId) => {
    const creds = store.get('awsCreds');
    return awsService.getSubnets(region, vpcId, creds);
  });

  ipcMain.handle('aws:getInstanceDetails', async (_, region, instanceId) => {
    const creds = store.get('awsCreds');
    return awsService.getInstanceDetails(region, instanceId, creds);
  });

  ipcMain.handle('aws:getEc2Instances', async (_, region, vpcId, clusterName) => {
    const creds = store.get('awsCreds');
    return awsService.getEc2Instances(region, vpcId, clusterName, creds);
  });

  ipcMain.handle('aws:getPodIdentities', async (_, region, clusterName) => {
    const creds = store.get('awsCreds');
    return awsService.getPodIdentities(region, clusterName, creds);
  });

  ipcMain.handle('aws:lookupCloudTrailEvents', async (_, params) => {
    const creds = store.get('awsCreds');
    return awsService.lookupCloudTrailEvents(params, creds);
  });

  ipcMain.handle('aws:queryAuditLogs', async (_, params) => {
    try {
      const creds = store.get('awsCreds');
      return await awsService.queryAuditLogs(params, creds);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error querying audit logs';
      console.error('[main] aws:queryAuditLogs error:', message);
      return { error: message };
    }
  });

  ipcMain.handle('aws:checkAuth', async (_, region) => {
    const savedCreds = store.get('awsCreds') as AwsCreds | undefined;

    // If manual creds are saved, use them directly
    if (savedCreds && savedCreds.accessKeyId && savedCreds.secretAccessKey) {
      return awsService.checkAuth(region, savedCreds);
    }

    // Otherwise, read fresh credentials from disk to avoid stale cached providers.
    // This mirrors what getFreshCallerIdentity does and avoids the SDK's internal
    // credential caching that causes ExpiredToken errors after profile switches.
    const effectiveProfile = getEffectiveProfile();
    const fileCreds = await awsService.readCredentialsFile(effectiveProfile);
    if (fileCreds && fileCreds.accessKeyId && fileCreds.secretAccessKey) {
      return awsService.checkAuth(region, fileCreds);
    }

    // Fall back to provider chain (no explicit creds → uses getFreshCredentialProvider)
    return awsService.checkAuth(region, null);
  });

  ipcMain.handle('aws:clearCache', async () => {
    console.log('[main] Clearing AWS client cache');
    awsService.clearClientCache();
    return true;
  });

  ipcMain.handle('aws:listProfiles', async () => {
    return awsService.listProfiles();
  });

  ipcMain.handle('aws:getProfile', async () => {
    return (store.get('awsProfile') as string) || 'default';
  });

  ipcMain.handle('aws:setProfile', async (_, profile: string) => {
    console.log(`[main] Setting AWS profile to: ${profile}`);
    store.set('awsProfile', profile);
    awsService.setProfile(profile === 'default' ? undefined : profile);
    // Return the new identity using a fresh client (no cache)
    const result = await awsService.getFreshCallerIdentity();
    return { success: true, identity: result.identity || null, account: result.account || null };
  });

  ipcMain.handle('aws:getGrantedCredentials', async () => {
    return awsService.getGrantedCredentials();
  });

  ipcMain.handle('aws:isGrantedActive', async () => {
    return awsService.isGrantedActive();
  });

  ipcMain.handle('aws:isGrantedConfigured', async () => {
    return awsService.isGrantedConfigured();
  });

  ipcMain.handle('aws:getCallerIdentity', async (_, region?: string) => {
    // Always use a fresh client to get the latest identity
    return awsService.getFreshCallerIdentity(region || 'us-east-1');
  });

  // --- App Handlers ---
  ipcMain.handle('app:restart', async () => {
    console.log('[main] Restarting application');
    app.relaunch();
    app.quit();
  });

  ipcMain.handle('k8s:forceCredentialRefresh', () => {
    console.log('IPC: k8s:forceCredentialRefresh called');
    k8sService.forceCredentialRefresh();
    return true;
  });

  ipcMain.handle('k8s:getClusters', () => {
    console.log('IPC: k8s:getClusters called');
    return k8sService.getClusters();
  })
  // ... (keeping existing handlers implicit by not replacing them, wait, I need to allowMultiple or be careful)
  // I will just replace the `ai:explainResource` block separately or just insert the helpers.
  // The tool says "Use this tool ONLY when you are making a SINGLE CONTIGUOUS block of edits".
  // So I cannot update the AI handler AND add helpers in one go if they are far apart.
  // Helpers are at line ~32. AI handler is at line ~183.
  // I will add helpers here.
  ipcMain.handle('k8s:getNamespaces', (_, contextName) => {
    console.log('IPC: k8s:getNamespaces called with', contextName);
    return k8sService.getNamespaces(contextName);
  })

  ipcMain.handle('k8s:getNamespacesDetails', (_, contextName) => {
    console.log('IPC: k8s:getNamespacesDetails called with', contextName);
    return k8sService.getNamespacesDetails(contextName);
  })

  ipcMain.handle('k8s:getDeployments', (_, contextName, namespaces) => {
    console.log('IPC: k8s:getDeployments called with', contextName, namespaces);
    return k8sService.getDeployments(contextName, namespaces);
  })

  ipcMain.handle('k8s:getDeployment', (_, contextName, namespace, name) => {
    console.log('IPC: k8s:getDeployment called with', contextName, namespace, name);
    return k8sService.getDeployment(contextName, namespace, name);
  })



  ipcMain.handle('k8s:getPods', (_, contextName, namespaces) => {
    console.log('IPC: k8s:getPods called with', contextName, namespaces);
    return k8sService.getPods(contextName, namespaces);
  })

  ipcMain.handle('k8s:getPodsForNode', (_, contextName, nodeName) => {
    return k8sService.getPodsForNode(contextName, nodeName);
  })

  ipcMain.handle('k8s:getPodsLite', async (_, contextName, namespaces) => {
    console.log('IPC: k8s:getPodsLite called with', contextName, namespaces);
    const result = await k8sService.getPodsLite(contextName, namespaces);
    // Seed the pod watcher's resourceVersion so it starts from the LIST point
    if (result.resourceVersion) {
      k8sService.seedWatchResourceVersion('pods', result.resourceVersion);
    }
    return result;
  })

  ipcMain.handle('k8s:getPodMetrics', async (_, contextName, namespaces) => {
    console.log('IPC: k8s:getPodMetrics called with', contextName, namespaces);
    const metricsMap = await k8sService.getPodMetrics(contextName, namespaces);
    // Convert Map to object for IPC serialization
    return Object.fromEntries(metricsMap);
  })

  ipcMain.handle('k8s:getNodeMetrics', async (_, contextName) => {
    return k8sService.getNodeMetrics(contextName);
  })

  ipcMain.handle('k8s:getPod', (_, contextName, namespace, name) => {
    return k8sService.getPod(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getReplicaSets', (_, contextName, namespaces) => {
    return k8sService.getReplicaSets(contextName, namespaces);
  })

  ipcMain.handle('k8s:getDeploymentRevisions', (_, contextName, namespace, deploymentName) => {
    return k8sService.getDeploymentRevisions(contextName, namespace, deploymentName);
  })

  ipcMain.handle('k8s:getReplicaSet', (_, contextName, namespace, name) => {
    return k8sService.getReplicaSet(contextName, namespace, name);
  })

  ipcMain.handle('k8s:scaleDeployment', (_, contextName, namespace, name, replicas) => {
    return k8sService.scaleDeployment(contextName, namespace, name, replicas);
  })


  ipcMain.handle('k8s:getServices', (_, contextName, namespaces) => {
    return k8sService.getServices(contextName, namespaces);
  })

  ipcMain.handle('k8s:getService', (_, contextName, namespace, name) => {
    return k8sService.getService(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getClusterRoleBindings', (_, contextName) => {
    return k8sService.getClusterRoleBindings(contextName);
  })

  ipcMain.handle('k8s:getClusterRoles', (_, contextName) => {
    return k8sService.getClusterRoles(contextName);
  })

  ipcMain.handle('k8s:getClusterRole', (_, contextName, name) => {
    return k8sService.getClusterRole(contextName, name);
  })

  ipcMain.handle('k8s:getRoles', (_, contextName, namespaces) => {
    return k8sService.getRoles(contextName, namespaces);
  })

  ipcMain.handle('k8s:getRole', (_, contextName, namespace, name) => {
    return k8sService.getRole(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getRoleBindings', (_, contextName, namespaces) => {
    return k8sService.getRoleBindings(contextName, namespaces);
  })

  ipcMain.handle('k8s:getServiceAccounts', (_, contextName, namespaces) => {
    return k8sService.getServiceAccounts(contextName, namespaces);
  })

  ipcMain.handle('k8s:getServiceAccount', (_, contextName, namespace, name) => {
    return k8sService.getServiceAccount(contextName, namespace, name);
  })

  ipcMain.handle('k8s:restartDeployment', (_, contextName, namespace, name) => {
    return k8sService.restartDeployment(contextName, namespace, name);
  })

  ipcMain.handle('k8s:restartDaemonSet', (_, contextName, namespace, name) => {
    return k8sService.restartDaemonSet(contextName, namespace, name);
  })

  ipcMain.handle('k8s:restartStatefulSet', (_, contextName, namespace, name) => {
    return k8sService.restartStatefulSet(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getRoleBinding', (_, contextName, namespace, name) => {
    return k8sService.getRoleBinding(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getClusterRoleBinding', (_, contextName, name) => {
    return k8sService.getClusterRoleBinding(contextName, name);
  })

  ipcMain.handle('k8s:getEvents', (_, contextName, namespaces, fieldSelector) => {
    return k8sService.getEvents(contextName, namespaces, fieldSelector);
  })

  ipcMain.handle('k8s:getEvent', async () => {
    // There is no single event fetch usually, but consistency
    return null;
  });

  ipcMain.handle('k8s:getNodes', async (_event, contextName) => {
    try {
      return await k8sService.getNodes(contextName);
    } catch (error: unknown) {
      console.error('Error in k8s:getNodes:', error);
      throw error;
    }
  });

  ipcMain.handle('k8s:getNode', async (_event, contextName, name) => {
    try {
      return await k8sService.getNode(contextName, name);
    } catch (error: unknown) {
      console.error('Error in k8s:getNode:', error);
      throw error;
    }
  });

  ipcMain.handle('k8s:deleteNode', async (_event, contextName, name) => {
    return k8sService.deleteNode(contextName, name);
  });

  ipcMain.handle('k8s:cordonNode', async (_event, contextName, name) => {
    return k8sService.cordonNode(contextName, name);
  });

  ipcMain.handle('k8s:uncordonNode', async (_event, contextName, name) => {
    return k8sService.uncordonNode(contextName, name);
  });

  ipcMain.handle('k8s:drainNode', async (_event, contextName, name) => {
    return k8sService.drainNode(contextName, name);
  });

  ipcMain.handle('k8s:getCRDs', (_, contextName) => {
    return k8sService.getCRDs(contextName);
  })

  ipcMain.handle('k8s:getCRD', async (_event, contextName, name) => {
    try {
      return await k8sService.getCRD(contextName, name);
    } catch (error: unknown) {
      console.error('Error in k8s:getCRD:', error);
      throw error;
    }
  });

  ipcMain.handle('k8s:getCustomObjects', (_, contextName, group, version, plural) => {
    return k8sService.getCustomObjects(contextName, group, version, plural);
  })

  ipcMain.handle('k8s:listCustomObjects', (_, contextName, group, version, plural, namespace) => {
    return k8sService.listCustomObjects(contextName, group, version, plural, namespace);
  })



  ipcMain.handle('k8s:startPortForward', (_, contextName, namespace, serviceName, servicePort, localPort, resourceType) => {
    return k8sService.startPortForward(contextName, namespace, serviceName, servicePort, localPort, resourceType);
  })

  ipcMain.handle('k8s:stopPortForward', (_, id) => {
    return k8sService.stopPortForward(id);
  })

  ipcMain.handle('k8s:stopAllPortForwards', () => {
    return k8sService.stopAllPortForwards();
  })

  ipcMain.handle('k8s:getActivePortForwards', () => {
    return k8sService.getActivePortForwards();
  })

  ipcMain.handle('shell:openExternal', (_, url) => {
    return shell.openExternal(url);
  })

  ipcMain.handle('k8s:decodeCertificate', (_, certData) => {
    return k8sService.decodeCertificate(certData);
  })

  /**
   * Consume streamText fullStream so reasoning-delta parts reach the renderer.
   * Wraps reasoning in the same markers parsed by parseAssistantThinking in the UI.
   * Also handles tool-call and tool-result parts for agentic mode.
   */
  function buildGoogleProviderOptionsForStream(opts: {
    model: string;
    cachedContent?: string | null;
    serviceTier: 'flex' | 'standard';
  }): { google: GoogleGenerativeAIProviderOptions } | undefined {
    const google: GoogleGenerativeAIProviderOptions = {};
    if (opts.cachedContent) {
      google.cachedContent = opts.cachedContent;
    }
    if (opts.serviceTier === 'flex') {
      google.serviceTier = 'flex';
    }
    const thinkingConfig = geminiThinkingConfigForModel(opts.model);
    if (thinkingConfig) {
      google.thinkingConfig = thinkingConfig;
    }
    if (Object.keys(google).length === 0) return undefined;
    return { google };
  }

  async function accumulateStreamWithReasoning(
    result: { fullStream: AsyncIterable<{ type: string; text?: string; delta?: string; [key: string]: any }> },
    sendChunk: (s: string) => void,
    isAborted?: () => boolean
  ): Promise<string> {
    let full = '';
    let reasoningOpen = false;

    const partText = (part: { text?: string; delta?: string }): string => {
      if (typeof part.text === 'string' && part.text.length > 0) return part.text;
      if (typeof part.delta === 'string' && part.delta.length > 0) return part.delta;
      return '';
    };

    for await (const part of result.fullStream) {
      if (isAborted?.()) break;

      switch (part.type) {
        case 'reasoning-start':
          if (!reasoningOpen) {
            sendChunk(AI_THINK_OPEN);
            full += AI_THINK_OPEN;
            reasoningOpen = true;
          }
          break;
        case 'reasoning-delta': {
          const t = partText(part);
          if (!t) break;
          if (!reasoningOpen) {
            sendChunk(AI_THINK_OPEN);
            full += AI_THINK_OPEN;
            reasoningOpen = true;
          }
          sendChunk(t);
          full += t;
          break;
        }
        case 'reasoning-end':
          if (reasoningOpen) {
            sendChunk(AI_THINK_CLOSE);
            full += AI_THINK_CLOSE;
            reasoningOpen = false;
          }
          break;
        case 'tool-call': {
          if (reasoningOpen) {
            sendChunk(AI_THINK_CLOSE);
            full += AI_THINK_CLOSE;
            reasoningOpen = false;
          }
          const toolName = (part as any).toolName || 'unknown';
          const args = (part as any).args || (part as any).input || {};
          console.log(`[AI Tools] Tool call: ${toolName}`, JSON.stringify(args), 'part keys:', Object.keys(part));
          const command = typeof args === 'object' ? (args.command || JSON.stringify(args)) : String(args);
          const marker =
            `\n\n🔧 **Running:** \`${command}\`\n\n` +
            `*Starting tool execution…*\n`;
          sendChunk(marker);
          full += marker;
          break;
        }
        case 'tool-result': {
          const toolResult = (part as any).result || (part as any).output || '';
          console.log(`[AI Tools] Tool result (${typeof toolResult === 'string' ? toolResult.length : 'object'} chars)`);
          const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
          const outputMarker = `\n<details><summary>📋 Output (click to expand)</summary>\n\n\`\`\`\n${resultStr}\n\`\`\`\n</details>\n\n`;
          sendChunk(outputMarker);
          full += outputMarker;
          const continuationHint = '*Model is processing the tool output…*\n\n';
          sendChunk(continuationHint);
          full += continuationHint;
          break;
        }
        case 'text-delta': {
          const t = partText(part);
          if (!t) break;
          if (reasoningOpen) {
            sendChunk(AI_THINK_CLOSE);
            full += AI_THINK_CLOSE;
            reasoningOpen = false;
          }
          sendChunk(t);
          full += t;
          break;
        }
        case 'finish-step': {
          const p = part as { finishReason?: string; rawFinishReason?: string };
          console.log(
            `[AI Stream] finish-step: finishReason=${String(p.finishReason)} raw=${String(p.rawFinishReason ?? '')}`
          );
          break;
        }
        case 'finish': {
          const p = part as { finishReason?: string; rawFinishReason?: string };
          console.log(
            `[AI Stream] finish: finishReason=${String(p.finishReason)} raw=${String(p.rawFinishReason ?? '')}`
          );
          break;
        }
        case 'abort': {
          console.log('[AI Stream] abort', (part as { reason?: string }).reason ?? '');
          break;
        }
        default:
          // Log all part types for debugging multi-step tool calling
          const partData: Record<string, unknown> = {};
          if ((part as any).finishReason) partData.finishReason = (part as any).finishReason;
          if ((part as any).isContinued) partData.isContinued = (part as any).isContinued;
          console.log(`[AI Stream] Part: ${part.type}`, JSON.stringify(partData));
          break;
      }
    }

    if (reasoningOpen) {
      sendChunk(AI_THINK_CLOSE);
      full += AI_THINK_CLOSE;
    }

    return full;
  }

  let activeExplainAbort: AbortController | null = null;

  ipcMain.on('ai:cancelExplainResourceStream', () => {
    if (activeExplainAbort) {
      console.log('[AI] Canceling active explain resource stream');
      activeExplainAbort.abort();
      activeExplainAbort = null;
    }
  });

  ipcMain.on('ai:explainResourceStream', async (event, resource, options) => {
    try {
      if (activeExplainAbort) {
        console.log('[AI] Canceling previous explain stream');
        activeExplainAbort.abort();
        activeExplainAbort = null;
      }
      activeExplainAbort = new AbortController();
      const explainAbortSignal = activeExplainAbort.signal;

      const { provider = 'google', model = 'gemini-1.5-flash', clusterName } = options || {};
      const localEndpoint =
        (store.get('settings_localModelEndpoint') as string) || 'http://localhost:1234/v1';
      const useLmStudioNative =
        provider === 'local' && store.get('settings_localUseLmStudioNative') === true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let aiModel: any = null;

      if (!useLmStudioNative) {
        if (provider === 'google') {
          const apiKey = getApiKey();
          if (!apiKey) {
            event.sender.send('ai:explainResourceStream:error', 'GEMINI_API_KEY not configured.');
            activeExplainAbort = null;
            return;
          }
          const google = createGoogleGenerativeAI({ apiKey });
          aiModel = google(model);
        } else if (provider === 'bedrock') {
          const bedrockConfig = getBedrockConfig();
          const bedrock = createAmazonBedrock(bedrockConfig);
          aiModel = bedrock(model);
        } else if (provider === 'local') {
          const localProvider = createOpenAI({ baseURL: localEndpoint, apiKey: 'not-needed' });
          aiModel = localProvider.chat(model);
        } else {
          event.sender.send('ai:explainResourceStream:error', `Unknown provider: ${provider}`);
          activeExplainAbort = null;
          return;
        }
      }

      const { getPromptForResource } = await import('./prompts');
      const basePrompt = getPromptForResource(resource);

      // Fetch recent events for this resource (describe-style context)
      let eventsContext = '';
      try {
        const resourceName = resource?.metadata?.name || resource?.name;
        const resourceNamespace = resource?.metadata?.namespace || resource?.namespace;
        const resourceKind = resource?.kind || resource?.type;
        if (clusterName && resourceName) {
          const fieldSelector = resourceKind
            ? `involvedObject.name=${resourceName},involvedObject.kind=${resourceKind}`
            : `involvedObject.name=${resourceName}`;
          const namespaces = resourceNamespace ? [resourceNamespace] : ['all'];
          const events = await k8sService.getEvents(clusterName, namespaces, fieldSelector);
          if (events.length > 0) {
            // Take the 10 most recent events, compress to one line each
            const recentEvents = events.slice(0, 10).map(
              (e: { type: string; reason: string; message: string; count: number; lastTimestamp: string }) =>
                `${e.type} | ${e.reason} | ${e.message} (x${e.count || 1}, ${e.lastTimestamp})`
            );
            eventsContext = `\n\n--- RECENT EVENTS (kubectl describe) ---\n${recentEvents.join('\n')}\n--- END EVENTS ---`;
          }
        }
      } catch (evtErr) {
        console.error('[AI] Error fetching events for explain:', evtErr);
      }

      // Build related context from ContextStore for resources in the same namespace
      let relatedContext = '';
      try {
        const resourceNamespace = resource?.metadata?.namespace || resource?.namespace;
        const resourceKind = resource?.kind || resource?.type;
        if (resourceNamespace && contextEngine.getStatus().resourceCount > 0) {
          const contextStore = contextEngine.getStore();
          const relatedResources = contextStore.getByFilter(
            r => r.namespace === resourceNamespace && !(r.kind === resourceKind && r.name === (resource?.metadata?.name || resource?.name))
          );
          if (relatedResources.length > 0) {
            const injector = new (await import('./context-engine/context-injector')).ContextInjector(contextStore, 500);
            const lines = relatedResources.slice(0, 20).map(r => injector.compressResource(r));
            relatedContext = `\n\n--- RELATED RESOURCES IN NAMESPACE "${resourceNamespace}" ---\n${lines.join('\n')}\n--- END RELATED RESOURCES ---`;
          }
        }
      } catch (ctxErr) {
        console.error('[AI] Error building related context for explain:', ctxErr);
      }

      const prompt = `
        ${basePrompt}
        ${eventsContext}
        ${relatedContext}
        
        Resource JSON:
        ${JSON.stringify(stripResourceForAI(resource), null, 2)}
      `;

      let fullResponse = '';
      try {
        if (useLmStudioNative) {
          const token = (store.get('settings_localLmStudioApiToken') as string) || undefined;
          const { streamLmStudioChat } = await import('./lm-studio-native');
          fullResponse = await streamLmStudioChat({
            openAiCompatBaseUrl: localEndpoint,
            apiToken: token,
            model,
            input: prompt,
            signal: explainAbortSignal,
            onChunk: (chunk) => event.sender.send('ai:explainResourceStream:chunk', chunk),
          });
        } else {
          const explainGoogleOpts =
            provider === 'google'
              ? buildGoogleProviderOptionsForStream({
                  model,
                  cachedContent: undefined,
                  serviceTier: 'standard',
                })
              : undefined;
          const result = streamText({
            model: aiModel!,
            prompt: prompt,
            maxOutputTokens: 1024,
            ...(explainGoogleOpts ? { providerOptions: explainGoogleOpts } : {}),
            abortSignal: explainAbortSignal,
            onError: ({ error }: { error: unknown }) => {
              if (explainAbortSignal.aborted) return;
              console.error('[AI] streamText onError:', error);
              const { message: errMsg, isAccessDenied } = extractAiErrorInfo(error);
              event.sender.send('ai:explainResourceStream:error', errMsg);
              if (isAccessDenied) {
                event.sender.send('ai:bedrockAccessDenied', errMsg);
              }
            },
          });
          fullResponse = await accumulateStreamWithReasoning(
            result,
            (chunk) => event.sender.send('ai:explainResourceStream:chunk', chunk),
            () => explainAbortSignal.aborted
          );
        }
      } catch (streamError: unknown) {
        if (
          explainAbortSignal.aborted ||
          (streamError instanceof Error && streamError.name === 'AbortError')
        ) {
          console.log('[AI] Explain stream was aborted');
          activeExplainAbort = null;
          return;
        }
        console.error('[AI] Stream iteration error:', streamError);
        const { message: errMsg, isAccessDenied } = extractAiErrorInfo(streamError);
        event.sender.send('ai:explainResourceStream:error', errMsg);
        if (isAccessDenied) {
          event.sender.send('ai:bedrockAccessDenied', errMsg);
        }
        activeExplainAbort = null;
        return;
      }

      activeExplainAbort = null;
      // Save to ChatSessionManager
      try {
        const resourceName = resource.metadata?.name || resource.name;
        const resourceType = resource.kind || resource.type;
        const resourceNamespace = resource.metadata?.namespace || resource.namespace;

        chatSessionManager.startSession(
          { name: resourceName, type: resourceType, namespace: resourceNamespace },
          model,
          provider
        );
        chatSessionManager.addMessage('user', `Explain ${resourceType} ${resourceName}`);
        chatSessionManager.addMessage('assistant', fullResponse);
        chatSessionManager.saveCurrentSession();
      } catch (saveErr) {
        console.error("Failed to save AI history:", saveErr);
      }

      event.sender.send('ai:explainResourceStream:done');

    } catch (error: unknown) {
      activeExplainAbort = null;
      console.error('AI Error:', error);
      const { message: errMsg, isAccessDenied } = extractAiErrorInfo(error);
      event.sender.send('ai:explainResourceStream:error', errMsg);
      if (isAccessDenied) {
        event.sender.send('ai:bedrockAccessDenied', errMsg);
      }
    }
  })

  // Track active AI streams for cancellation
  let activeCustomPromptAbort: AbortController | null = null;

  // Cancel custom prompt stream
  ipcMain.on('ai:cancelCustomPromptStream', () => {
    if (activeCustomPromptAbort) {
      console.log('[AI] Canceling active custom prompt stream');
      activeCustomPromptAbort.abort();
      activeCustomPromptAbort = null;
    }
  });

  // Tool approval response from renderer
  ipcMain.on('ai:toolApprovalResponse', (_, toolCallId: string, approved: boolean, trust: boolean) => {
    console.log(`[AI Tools] Approval response: ${toolCallId} approved=${approved} trust=${trust}`);
    const resolver = (activeCustomPromptAbort as any)?.__resolveToolApproval;
    if (resolver) {
      const command = resolver(toolCallId, approved, trust);
      // If user chose to trust this command pattern, save it
      if (trust && approved && command) {
        // Extract the verb prefix (e.g. "kubectl get", "kubectl describe")
        const parts = command.trim().split(/\s+/);
        const prefix = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : command;
        const existing = (store.get('settings_aiTrustedCommands') as string[]) || [];
        if (!existing.includes(prefix)) {
          const updated = [...existing, prefix];
          store.set('settings_aiTrustedCommands', updated);
          console.log(`[AI Tools] Trusted command added: "${prefix}"`);
        }
      }
    }
  });

  // Custom prompt streaming (for log analysis, etc.) - supports conversation history
  // Now context-aware: injects cluster state from ContextEngine and handles /kubectl prefix
  ipcMain.on('ai:customPromptStream', async (event, customPrompt, options) => {
    // Cancel any existing stream first
    if (activeCustomPromptAbort) {
      console.log('[AI] Canceling previous stream before starting new one');
      activeCustomPromptAbort.abort();
      activeCustomPromptAbort = null;
    }

    // Create new abort controller for this stream
    activeCustomPromptAbort = new AbortController();
    const abortSignal = activeCustomPromptAbort.signal;

    try {
      const { provider = 'google', model = 'gemini-1.5-flash', systemPrompt, messages, clusterName, namespace } = options || {};
      const localEndpoint =
        (store.get('settings_localModelEndpoint') as string) || 'http://localhost:1234/v1';
      const useLmStudioNative =
        provider === 'local' && store.get('settings_localUseLmStudioNative') === true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let aiModel: any = null;
      let geminiApiKey: string | undefined;

      if (!useLmStudioNative) {
        if (provider === 'google') {
          const apiKey = getApiKey();
          if (!apiKey) {
            event.sender.send('ai:customPromptStream:error', 'GEMINI_API_KEY not configured.');
            activeCustomPromptAbort = null;
            return;
          }
          geminiApiKey = apiKey;
          const google = createGoogleGenerativeAI({ apiKey });
          aiModel = google(model);
        } else if (provider === 'bedrock') {
          const bedrockConfig = getBedrockConfig();
          const bedrock = createAmazonBedrock(bedrockConfig);
          aiModel = bedrock(model);
        } else if (provider === 'local') {
          const localProvider = createOpenAI({ baseURL: localEndpoint, apiKey: 'not-needed' });
          aiModel = localProvider.chat(model);
        } else {
          event.sender.send('ai:customPromptStream:error', `Unknown provider: ${provider}`);
          activeCustomPromptAbort = null;
          return;
        }
      }

      // --- Context injection ---
      // Determine the user's actual message text (last user message or customPrompt)
      const userMessage = customPrompt || '';
      const isKubectlMode = userMessage.trimStart().startsWith('/kubectl');
      const actualQuery = isKubectlMode ? userMessage.replace(/^\/kubectl\s*/i, '').trim() : userMessage;

      // Build cluster context from ContextEngine
      let clusterContext = '';
      try {
        if (contextEngine.getStatus().resourceCount > 0) {
          clusterContext = contextEngine.buildChatContext(actualQuery);
        }
      } catch (ctxErr) {
        console.error('[AI] Error building cluster context:', ctxErr);
      }

      // Build enhanced system prompt (Langfuse text prompt `chat-system-prompt`, label production, when configured)
      const { baseSystem, promptRef } = await resolveLumenChatSystemBase(
        {
          resourceContext: options?.resourceContext,
          resourceName: options?.resourceName,
          resourceType: options?.resourceType,
        },
        systemPrompt || ''
      );
      let enhancedSystemPrompt = baseSystem;

      if (clusterContext) {
        enhancedSystemPrompt += `\n\n--- LIVE CLUSTER STATE ---\nThe following is a compressed snapshot of the user's current Kubernetes cluster state. Use this to answer cluster-specific questions.\n${clusterContext}\n--- END CLUSTER STATE ---`;
      } else {
        enhancedSystemPrompt += '\n\nNote: No live cluster context is currently available. Answer based on general Kubernetes knowledge.';
      }

      // --- Tool calling (agentic mode) ---
      const toolMode = (store.get('settings_aiToolMode') as ToolMode) || 'off';
      const trustedCommands = (store.get('settings_aiTrustedCommands') as string[]) || [];
      console.log(`[AI Tools] Tool mode: ${toolMode}, cluster: ${clusterName || 'none'}, trusted: ${trustedCommands.length}`);
      const toolResult = buildKubectlTools(clusterName || undefined, toolMode, trustedCommands, win, {
        onAgentHint: (markdownChunk) => {
          if (abortSignal.aborted) return;
          event.sender.send('ai:customPromptStream:chunk', markdownChunk);
        },
      });
      const kubectlTools = toolResult?.tools;
      // Store the resolver so the IPC handler can reach it
      if (toolResult) {
        (activeCustomPromptAbort as any).__resolveToolApproval = toolResult.resolvePendingApproval;
      }
      if (toolMode !== 'off') {
        enhancedSystemPrompt += buildToolSystemPrompt(toolMode);
        console.log('[AI Tools] Tools enabled, mode:', toolMode);
      } else {
        console.log('[AI Tools] Tool calling is OFF');
      }

      /** Max model rounds for agentic kubectl (tool call + follow-up text), Google Gemini and other providers. */
      const KUBECTL_AGENT_MAX_STEPS = 10;

      // Handle /kubectl mode
      if (isKubectlMode) {
        const activeCluster = clusterName || 'unknown';
        const activeNamespace = namespace || 'default';
        const { buildKubectlPrompt } = await import('./prompts');
        enhancedSystemPrompt += buildKubectlPrompt(activeCluster, activeNamespace);
      }

      let geminiCachedContentName: string | null = null;
      // Skip Gemini caching when tools are enabled — tool definitions need to be passed directly
      if (provider === 'google' && geminiApiKey && !kubectlTools) {
        geminiCachedContentName = await getOrCreateGeminiExplicitCachedContentName(
          geminiApiKey,
          model,
          enhancedSystemPrompt,
          abortSignal
        );
      }
      const geminiServiceTier: 'flex' | 'standard' =
        options?.geminiServiceTier === 'flex' ? 'flex' : 'standard';
      const hasGeminiCache = geminiCachedContentName != null;
      const googleStreamProviderOptions =
        provider === 'google'
          ? buildGoogleProviderOptionsForStream({
              model,
              cachedContent: hasGeminiCache ? geminiCachedContentName : undefined,
              serviceTier: geminiServiceTier,
            })
          : undefined;

      // Shared error handler for streamText onError callback
      const handleStreamError = ({ error }: { error: unknown }) => {
        if (abortSignal.aborted) return;
        console.error('[AI] streamText onError:', error);
        const { message: errMsg, isAccessDenied } = extractAiErrorInfo(error);
        event.sender.send('ai:customPromptStream:error', errMsg);
        if (isAccessDenied) {
          event.sender.send('ai:bedrockAccessDenied', errMsg);
        }
      };

      // Track message in ChatSessionManager
      if (!chatSessionManager.getCurrentSession()) {
        // Build resourceContext from individual fields if not provided as object
        const resourceCtx = options.resourceContext || (options.resourceName ? { name: options.resourceName, type: options.resourceType || 'Unknown' } : undefined);
        chatSessionManager.startSession(
          resourceCtx,
          model,
          provider
        );
      }
      chatSessionManager.addMessage('user', userMessage);

      const runModelStream = async (): Promise<{ fullResponse: string; usage?: LanguageModelUsage }> => {
        if (useLmStudioNative) {
          const token = (store.get('settings_localLmStudioApiToken') as string) || undefined;
          const {
            streamLmStudioChat,
            buildLmStudioConversationInput,
            buildLmStudioSingleTurnInput,
          } = await import('./lm-studio-native');
          const input =
            messages && messages.length > 0
              ? buildLmStudioConversationInput(
                  enhancedSystemPrompt,
                  messages as Array<{ role: string; content: string }>
                )
              : buildLmStudioSingleTurnInput(enhancedSystemPrompt, actualQuery);
          const fullResponse = await streamLmStudioChat({
            openAiCompatBaseUrl: localEndpoint,
            apiToken: token,
            model,
            input,
            signal: abortSignal,
            onChunk: (chunk) => event.sender.send('ai:customPromptStream:chunk', chunk),
          });
          return { fullResponse };
        }
        let result: ReturnType<typeof streamText>;

        // When tools are enabled, always use messages format (required for multi-step tool calling)
        // Filter out messages with empty content — Bedrock/Anthropic rejects them with HTTP 400.
        // Empty content can occur when an assistant response was only thinking (no visible text)
        // or when a stream was cancelled before producing output.
        const rawMessages = (messages && messages.length > 0)
          ? messages.filter((m: { role: string; content: string }) => m.content && m.content.trim().length > 0)
          : [];
        const effectiveMessages = rawMessages.length > 0
          ? rawMessages
          : [{ role: 'user' as const, content: actualQuery }];
        const useMessagesFormat = rawMessages.length > 0 || !!kubectlTools;

        console.log(`[AI Tools] streamText config: useMessages=${useMessagesFormat}, hasTools=${!!kubectlTools}, provider=${provider}, model=${model}, maxSteps=${kubectlTools ? KUBECTL_AGENT_MAX_STEPS : 1}`);

        if (useMessagesFormat) {
          if (provider === 'bedrock' && isAnthropicBedrockModel(model)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result = streamText({
              model: aiModel,
              messages: bedrockMessagesWithOptionalCache(enhancedSystemPrompt, effectiveMessages as ModelMessage[]),
              abortSignal,
              onError: handleStreamError,
              tools: kubectlTools as any,
              ...(kubectlTools ? { toolChoice: 'auto' as const } : {}),
              stopWhen: kubectlTools ? stepCountIs(KUBECTL_AGENT_MAX_STEPS) : stepCountIs(1),
            });
          } else if (provider === 'google') {
            // Gemini: same agentic loop as Bedrock (messages + kubectl tool + multi-step).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result = streamText({
              model: aiModel,
              messages: effectiveMessages as ModelMessage[],
              ...(googleStreamProviderOptions ? { providerOptions: googleStreamProviderOptions } : {}),
              ...(!hasGeminiCache ? { system: enhancedSystemPrompt } : {}),
              abortSignal,
              onError: handleStreamError,
              tools: kubectlTools as any,
              ...(kubectlTools ? { toolChoice: 'auto' as const } : {}),
              stopWhen: kubectlTools ? stepCountIs(KUBECTL_AGENT_MAX_STEPS) : stepCountIs(1),
            });
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result = streamText({
              model: aiModel,
              messages: effectiveMessages as ModelMessage[],
              system: enhancedSystemPrompt,
              abortSignal,
              onError: handleStreamError,
              tools: kubectlTools as any,
              ...(kubectlTools ? { toolChoice: 'auto' as const } : {}),
              stopWhen: kubectlTools ? stepCountIs(KUBECTL_AGENT_MAX_STEPS) : stepCountIs(1),
            });
          }
        } else if (provider === 'google') {
          const promptForGemini = hasGeminiCache
            ? actualQuery
            : enhancedSystemPrompt
              ? `${enhancedSystemPrompt}\n\n${actualQuery}`
              : actualQuery;
          result = streamText({
            model: aiModel,
            prompt: promptForGemini,
            ...(googleStreamProviderOptions ? { providerOptions: googleStreamProviderOptions } : {}),
            abortSignal,
            onError: handleStreamError,
          });
        } else {
          const finalPrompt = enhancedSystemPrompt ? `${enhancedSystemPrompt}\n\n${actualQuery}` : actualQuery;
          result = streamText({
            model: aiModel,
            prompt: finalPrompt,
            abortSignal,
            onError: handleStreamError,
          });
        }
        const fullResponse = await accumulateStreamWithReasoning(
          result,
          (chunk) => event.sender.send('ai:customPromptStream:chunk', chunk),
          () => abortSignal.aborted
        );
        try {
          const [finishReason, steps] = await Promise.all([
            withTimeout(result.finishReason, 8_000, 'finishReason'),
            withTimeout(result.steps, 8_000, 'steps'),
          ]);
          const stepList = steps as Array<{
            finishReason?: string;
            text?: string;
            toolCalls?: unknown[];
          }>;
          const last = stepList.length > 0 ? stepList[stepList.length - 1] : undefined;
          console.log(
            `[AI] streamText completed: aggregateFinish=${String(finishReason)} steps=${stepList.length}` +
              (last
                ? ` lastStepFinish=${String(last.finishReason)} textChars=${last.text?.length ?? 0} toolCalls=${last.toolCalls?.length ?? 0}`
                : '')
          );
        } catch (metaErr) {
          console.warn('[AI] streamText finish metadata unavailable', metaErr);
        }
        let usage: LanguageModelUsage | undefined;
        try {
          usage = await withTimeout(
            result.usage,
            15_000,
            'ai usage'
          ) as LanguageModelUsage;
        } catch {
          usage = undefined;
        }
        return { fullResponse, usage };
      };

      const finishStreamError = (streamError: unknown): 'abort' | 'fail' => {
        if ((streamError instanceof Error && streamError.name === 'AbortError') || abortSignal.aborted) {
          console.log('[AI] Stream was aborted');
          activeCustomPromptAbort = null;
          return 'abort';
        }
        console.error('[AI] Stream iteration error:', streamError);
        const { message: errMsg, isAccessDenied } = extractAiErrorInfo(streamError);
        event.sender.send('ai:customPromptStream:error', errMsg);
        if (isAccessDenied) {
          event.sender.send('ai:bedrockAccessDenied', errMsg);
        }
        activeCustomPromptAbort = null;
        return 'fail';
      };

      let fullResponse = '';
      let customPromptStreamFailed = false;
      let lastStreamUsage: LanguageModelUsage | undefined;

      if (isLangfuseTracingEnabled()) {
        const sessionId = chatSessionManager.getCurrentSession()?.id;
        await startActiveObservation(
          'lumen-custom-prompt',
          async (generation) => {
            generation.update({
              model: String(model),
              input: { message: userMessage.slice(0, 8000) },
              metadata: {
                isKubectlMode: String(isKubectlMode),
                sessionId: sessionId ?? '',
                provider: String(provider),
                hasClusterContext: String(Boolean(clusterContext)),
              },
              prompt: promptRef
                ? { name: promptRef.name, version: promptRef.version, isFallback: promptRef.isFallback }
                : undefined,
            });
            try {
              const { fullResponse: fr, usage } = await runModelStream();
              fullResponse = fr;
              lastStreamUsage = usage;
              if (abortSignal.aborted) {
                console.log('[AI] Stream aborted');
                activeCustomPromptAbort = null;
                return;
              }
              generation.update({
                output: fullResponse.slice(0, 50000),
                usageDetails: mapAiUsageToLangfuse(usage),
              });
            } catch (streamError: unknown) {
              if ((streamError instanceof Error && streamError.name === 'AbortError') || abortSignal.aborted) {
                console.log('[AI] Stream was aborted');
                activeCustomPromptAbort = null;
                return;
              }
              console.error('[AI] Stream iteration error:', streamError);
              generation.update({
                level: 'ERROR',
                statusMessage: streamError instanceof Error ? streamError.message : String(streamError),
              });
              if (finishStreamError(streamError) === 'fail') {
                customPromptStreamFailed = true;
              }
            }
          },
          { asType: 'generation' }
        );
        void getLangfuseClient()?.flush().catch(() => {});
      } else {
        try {
          const { fullResponse: fr, usage } = await runModelStream();
          fullResponse = fr;
          lastStreamUsage = usage;
          if (abortSignal.aborted) {
            console.log('[AI] Stream aborted');
            activeCustomPromptAbort = null;
            return;
          }
        } catch (streamError: unknown) {
          if (finishStreamError(streamError) === 'fail') {
            customPromptStreamFailed = true;
          }
          return;
        }
      }

      if (customPromptStreamFailed) {
        return;
      }

      if (abortSignal.aborted) {
        return;
      }

      // Save assistant response to ChatSessionManager
      chatSessionManager.addMessage('assistant', fullResponse);

      // Persist session via ChatSessionManager
      const shouldSaveHistory = options.saveToHistory === true;
      if (shouldSaveHistory) {
        try {
          chatSessionManager.saveCurrentSession();
        } catch (saveErr) {
          console.error("Failed to save chat session:", saveErr);
        }
      }

      event.sender.send(
        'ai:customPromptStream:done',
        serializeAiUsageForRenderer(lastStreamUsage)
      );
      activeCustomPromptAbort = null;

    } catch (error: unknown) {
      // Don't send error if it was aborted
      if (error instanceof Error && error.name === 'AbortError' || abortSignal.aborted) {
        console.log('[AI] Stream was aborted');
        activeCustomPromptAbort = null;
        return;
      }
      console.error('AI Error:', error);
      const { message: errMsg, isAccessDenied } = extractAiErrorInfo(error);
      event.sender.send('ai:customPromptStream:error', errMsg);
      if (isAccessDenied) {
        event.sender.send('ai:bedrockAccessDenied', errMsg);
      }
      activeCustomPromptAbort = null;
    }
  });

  ipcMain.handle('ai:checkAwsAuth', async () => {
    try {
      const grantedCreds = awsService.getGrantedCredentials();
      const savedCreds = getAwsCreds();
      const config = getBedrockConfig();

      const client = new BedrockClient({
        region: config.region,
        credentials: config.credentialProvider
          ? async () => {
            const creds = await config.credentialProvider!();
            return { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken };
          }
          : {
            accessKeyId: config.accessKeyId!,
            secretAccessKey: config.secretAccessKey!,
            sessionToken: config.sessionToken,
          },
      });

      // Lightweight check
      const command = new ListFoundationModelsCommand({ byOutputModality: 'TEXT' });
      await client.send(command);

      return {
        isManaged: !!grantedCreds || !savedCreds.accessKeyId,
        isAuthenticated: true,
        isGranted: !!grantedCreds
      };
    } catch (err: unknown) {
      console.error('AWS Auth Check Failed:', err);
      return {
        isManaged: false,
        isAuthenticated: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  })




  ipcMain.handle('ai:listModels', async (_, provider: string) => {
    if (provider === 'google') {
      try {
        const apiKey = getApiKey();
        if (!apiKey) return [];

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) {
          console.error('Failed to list Gemini models:', await response.text());
          return [];
        }

        const data = await response.json();
        const models = (data.models || [])
          .filter((m: Record<string, unknown>) => (m.supportedGenerationMethods as string[] | undefined)?.includes('generateContent'))
          .map((m: Record<string, unknown>) => ({
            id: (m.name as string).replace('models/', ''),
            name: m.displayName
          }));

        return models;
      } catch (err) {
        console.error('Error listing Gemini models:', err);
        return [];
      }
    } else if (provider === 'bedrock') {
      try {
        const config = getBedrockConfig();
        const client = new BedrockClient({
          region: config.region,
          credentials: config.credentialProvider
            ? async () => {
              const creds = await config.credentialProvider!();
              return { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken };
            }
            : {
              accessKeyId: config.accessKeyId!,
              secretAccessKey: config.secretAccessKey!,
              sessionToken: config.sessionToken,
            },
        });

        const [foundationRes, profilesRes] = await Promise.all([
          client.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' })),
          client.send(new ListInferenceProfilesCommand({}))
        ]);

        // Helper to normalize and prettify names
        const cleanModelName = (name: string) => {
          let cleaned = name
            .replace(/^us\.anthropic\./, '')
            .replace(/^eu\.anthropic\./, '')
            .replace(/^apac\.anthropic\./, '')
            .replace(/^anthropic\./, '')
            .replace(/^US Anthropic\s+/i, '')
            .replace(/^Global Anthropic\s+/i, '');

          // Replace hyphens with spaces
          cleaned = cleaned.replace(/-/g, ' ');

          // Capitalize known terms
          cleaned = cleaned
            .replace(/\bclaude\b/i, 'Claude')
            .replace(/\bsonnet\b/i, 'Sonnet')
            .replace(/\bhaiku\b/i, 'Haiku')
            .replace(/\bopus\b/i, 'Opus')
            .replace(/\binstant\b/i, 'Instant');

          return cleaned.trim();
        };

        const allModels = [];
        const seenCoreIds = new Set<string>();

        // 1. Process System Profiles (Prioritize US)
        const profiles = (profilesRes.inferenceProfileSummaries || [])
          .filter(p => p.type === 'SYSTEM_DEFINED' && (p.inferenceProfileName?.includes('Anthropic') || p.description?.includes('Anthropic')));

        // Sort: US first, then others
        profiles.sort((a, b) => {
          const aName = a.inferenceProfileName || '';
          const bName = b.inferenceProfileName || '';
          const aUS = aName.startsWith('us.') || aName.startsWith('US');
          const bUS = bName.startsWith('us.') || bName.startsWith('US');
          if (aUS && !bUS) return -1;
          if (!aUS && bUS) return 1;
          return 0;
        });

        for (const p of profiles) {
          const rawName = p.inferenceProfileName || '';
          const id = p.inferenceProfileId;
          if (!id) continue;

          const name = cleanModelName(rawName);
          const prettyName = name.replace(/(\d+)\s+(\d+)/, '$1.$2');

          if (!seenCoreIds.has(prettyName)) {
            seenCoreIds.add(prettyName);
            allModels.push({
              id: id,
              name: prettyName,
              provider: 'Anthropic'
            });
          }
        }

        // 2. Process Foundation Models (Backfill)
        const foundation = (foundationRes.modelSummaries || [])
          .filter(m => m.providerName === 'Anthropic');

        for (const m of foundation) {
          const rawName = m.modelName || m.modelId || '';
          const id = m.modelId;
          const name = cleanModelName(rawName);
          const prettyName = name.replace(/(\d+)\s+(\d+)/, '$1.$2');

          if (!seenCoreIds.has(prettyName)) {
            seenCoreIds.add(prettyName);
            allModels.push({
              id: id,
              name: prettyName,
              provider: 'Anthropic'
            });
          }
        }

        return allModels;
      } catch (err) {
        console.error('Error listing Bedrock models:', err);
        return [];
      }
    } else if (provider === 'local') {
      try {
        const localEndpoint = (store.get('settings_localModelEndpoint') as string) || 'http://localhost:1234/v1';
        const useNative = store.get('settings_localUseLmStudioNative') === true;
        if (useNative) {
          const token = (store.get('settings_localLmStudioApiToken') as string) || undefined;
          const { listLmStudioModels } = await import('./lm-studio-native');
          const models = await listLmStudioModels(localEndpoint, token);
          return models.map((m) => ({ ...m, provider: 'Local' }));
        }
        const url = localEndpoint.endsWith('/') ? `${localEndpoint}models` : `${localEndpoint}/models`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        return (data.data || []).map((m: any) => ({
          id: m.id,
          name: m.id,
          provider: 'Local'
        }));
      } catch (err) {
        console.error('Error listing local models:', err);
        return [];
      }
    }
    return [];
  })


  ipcMain.handle('k8s:deletePod', (_, contextName, namespace, name) => {
    return k8sService.deletePod(contextName, namespace, name);
  })

  ipcMain.on('k8s:watchPods', (event, contextName, namespaces) => {
    k8sService.stopPodWatch();
    if (podBatchBuffer) { podBatchBuffer.destroy(); podBatchBuffer = null; }
    const newScope = Array.isArray(namespaces) ? namespaces.sort().join(',') : '';
    if (newScope !== lastPodWatchScope) {
      contextEngine.clearKind('Pod');
      lastPodWatchScope = newScope;
    }
    const gen = ++podWatchGeneration;

    podBatchBuffer = new WatcherBatchBuffer({
      flushIntervalMs: 500,
      onFlush: async (events) => {
        if (gen !== podWatchGeneration) return;
        try {
          const request: TransformRequest = {
            id: `pod-${++transformRequestId}`,
            resourceType: 'pod',
            events,
          };
          const response = await sendToWorker(request);
          if (response.error) console.warn('[Worker] Pod transform warning:', response.error);
          if (response.events.length > 0 && gen === podWatchGeneration) {
            event.sender.send('k8s:podBatchChange', response.events.map(e => ({ type: e.type, pod: e.resource })));
          }
        } catch (err) {
          console.error('[Worker] Pod batch transform error:', err);
        }
      },
    });

    k8sService.startPodWatch(contextName, namespaces, (type, rawPod) => {
      if (gen !== podWatchGeneration) return;
      try {
        contextEngine.handleResourceEvent('Pod', type as 'ADDED' | 'MODIFIED' | 'DELETED', rawPod);
      } catch (err) {
        console.error('[ContextEngine] Error processing pod event:', err);
      }
      // Backward compatibility: send individual transformed events
      const containerStatuses = rawPod.status?.containerStatuses || [];
      const initContainerStatuses = rawPod.status?.initContainerStatuses || [];
      const allStatuses = [...initContainerStatuses, ...containerStatuses];
      const phase = rawPod.metadata?.deletionTimestamp ? 'Terminating' : (rawPod.status?.phase || 'Unknown');
      const transformedPod = {
        name: rawPod.metadata?.name,
        namespace: rawPod.metadata?.namespace,
        status: phase,
        restarts: containerStatuses.reduce((acc: number, c: Record<string, unknown>) => acc + ((c?.restartCount as number) || 0), 0),
        age: rawPod.metadata?.creationTimestamp,
        containers: allStatuses.map((c: Record<string, unknown>) => ({
          name: c?.name,
          state: (c?.state as Record<string, unknown>)?.running ? 'running' : ((c?.state as Record<string, unknown>)?.waiting ? 'waiting' : 'terminated'),
          ready: c?.ready,
          image: c?.image,
          restartCount: c?.restartCount
        })),
        metadata: rawPod.metadata,
        spec: rawPod.spec,
        node: rawPod.spec?.nodeName,
        rawStatus: rawPod.status,
      };
      event.sender.send('k8s:podChange', type, transformedPod);
      // Push RAW event to batch buffer (worker will transform)
      podBatchBuffer?.push({ type: type as 'ADDED' | 'MODIFIED' | 'DELETED', resource: rawPod });
    });
  })

  ipcMain.on('k8s:stopWatchPods', () => {
    k8sService.stopPodWatch();
    if (podBatchBuffer) { podBatchBuffer.destroy(); podBatchBuffer = null; }
  })

  ipcMain.on('k8s:watchDeployments', (event, contextName, namespaces) => {
    k8sService.stopDeploymentWatch();
    if (deploymentBatchBuffer) { deploymentBatchBuffer.destroy(); deploymentBatchBuffer = null; }
    const newScope = Array.isArray(namespaces) ? namespaces.sort().join(',') : '';
    if (newScope !== lastDeploymentWatchScope) {
      contextEngine.clearKind('Deployment');
      lastDeploymentWatchScope = newScope;
    }
    const gen = ++deploymentWatchGeneration;

    deploymentBatchBuffer = new WatcherBatchBuffer({
      flushIntervalMs: 150,
      onFlush: async (events) => {
        if (gen !== deploymentWatchGeneration) return;
        try {
          const request: TransformRequest = {
            id: `dep-${++transformRequestId}`,
            resourceType: 'deployment',
            events,
          };
          const response = await sendToWorker(request);
          if (response.error) console.warn('[Worker] Deployment transform warning:', response.error);
          if (response.events.length > 0 && gen === deploymentWatchGeneration) {
            event.sender.send('k8s:deploymentBatchChange', response.events.map(e => ({ type: e.type, deployment: e.resource })));
          }
        } catch (err) {
          console.error('[Worker] Deployment batch transform error:', err);
        }
      },
    });

    k8sService.startDeploymentWatch(contextName, namespaces, (type, rawDep) => {
      if (gen !== deploymentWatchGeneration) return;
      try {
        contextEngine.handleResourceEvent('Deployment', type as 'ADDED' | 'MODIFIED' | 'DELETED', rawDep);
      } catch (err) {
        console.error('[ContextEngine] Error processing deployment event:', err);
      }
      // Backward compatibility: send individual transformed events
      const transformedDep = {
        name: rawDep.metadata?.name,
        namespace: rawDep.metadata?.namespace,
        replicas: rawDep.spec?.replicas,
        availableReplicas: rawDep.status?.availableReplicas,
        status: rawDep.status,
        metadata: rawDep.metadata,
        spec: rawDep.spec
      };
      event.sender.send('k8s:deploymentChange', type, transformedDep);
      // Push RAW event to batch buffer (worker will transform)
      deploymentBatchBuffer?.push({ type: type as 'ADDED' | 'MODIFIED' | 'DELETED', resource: rawDep });
    });
  })

  ipcMain.on('k8s:stopWatchDeployments', () => {
    k8sService.stopDeploymentWatch();
    if (deploymentBatchBuffer) { deploymentBatchBuffer.destroy(); deploymentBatchBuffer = null; }
  })

  ipcMain.on('k8s:watchNodes', (event, contextName) => {
    // Stop existing watcher FIRST to prevent stale events from re-populating the store
    k8sService.stopNodeWatch();
    if (nodeBatchBuffer) { nodeBatchBuffer.destroy(); nodeBatchBuffer = null; }
    contextEngine.clearKind('Node');
    const gen = ++nodeWatchGeneration;

    nodeBatchBuffer = new WatcherBatchBuffer({
      flushIntervalMs: 150,
      onFlush: async (events) => {
        if (gen !== nodeWatchGeneration) return;
        try {
          const request: TransformRequest = {
            id: `node-${++transformRequestId}`,
            resourceType: 'node',
            events,
          };
          const response = await sendToWorker(request);
          if (response.error) console.warn('[Worker] Node transform warning:', response.error);
          if (response.events.length > 0 && gen === nodeWatchGeneration) {
            event.sender.send('k8s:nodeBatchChange', response.events.map(e => ({ type: e.type, node: e.resource })));
          }
        } catch (err) {
          console.error('[Worker] Node batch transform error:', err);
        }
      },
    });

    k8sService.startNodeWatch(contextName, (type, node) => {
      if (gen !== nodeWatchGeneration) return;
      // Feed raw resource data to ContextEngine
      try {
        const rawNode = { metadata: node.metadata, status: node.statusObj, spec: node.spec };
        contextEngine.handleResourceEvent('Node', type as 'ADDED' | 'MODIFIED' | 'DELETED', rawNode);
      } catch (err) {
        console.error('[ContextEngine] Error processing node event:', err);
      }
      // Backward compatibility: send individual events
      event.sender.send('k8s:nodeChange', type, node);
      // Push to batch buffer for worker transform
      nodeBatchBuffer?.push({ type: type as 'ADDED' | 'MODIFIED' | 'DELETED', resource: { metadata: node.metadata, status: node.statusObj, spec: node.spec } });
    });
  })

  ipcMain.on('k8s:stopWatchNodes', () => {
    k8sService.stopNodeWatch();
    if (nodeBatchBuffer) { nodeBatchBuffer.destroy(); nodeBatchBuffer = null; }
  })

  ipcMain.on('k8s:watchGenericResource', (event, contextName, resourceType, apiPath) => {
    // Clean up any existing batch buffer for this resource type
    const existingBuffer = genericBatchBuffers.get(resourceType);
    if (existingBuffer) { existingBuffer.destroy(); genericBatchBuffers.delete(resourceType); }

    const workerType = WATCH_KEY_TO_WORKER_TYPE[resourceType];

    if (workerType) {
      // Resource types with worker transforms get batch buffering + off-thread transformation
      const gen = (genericWatchGenerations.get(resourceType) ?? 0) + 1;
      genericWatchGenerations.set(resourceType, gen);

      const batchBuffer = new WatcherBatchBuffer({
        flushIntervalMs: 150,
        onFlush: async (events) => {
          if (genericWatchGenerations.get(resourceType) !== gen) return;
          try {
            const request: TransformRequest = {
              id: `generic-${resourceType}-${++transformRequestId}`,
              resourceType: workerType as TransformRequest['resourceType'],
              events,
            };
            const response = await sendToWorker(request);
            if (response.error) console.warn(`[Worker] ${resourceType} transform warning:`, response.error);
            if (response.events.length > 0 && genericWatchGenerations.get(resourceType) === gen) {
              event.sender.send('k8s:genericResourceBatchChange', resourceType, response.events.map(e => ({ type: e.type, resource: e.resource })));
            }
          } catch (err) {
            console.error(`[Worker] ${resourceType} batch transform error:`, err);
          }
        },
      });
      genericBatchBuffers.set(resourceType, batchBuffer);

      k8sService.startGenericWatch(contextName, resourceType, apiPath, (type, resource) => {
        if (genericWatchGenerations.get(resourceType) !== gen) return;
        // Still send individual raw events for backward compatibility
        event.sender.send('k8s:genericResourceChange', resourceType, type, resource);
        // Push raw event to batch buffer for worker transform
        batchBuffer.push({ type: type as 'ADDED' | 'MODIFIED' | 'DELETED', resource });
      });
    } else {
      // All other resource types: pass through raw (existing behavior)
      k8sService.startGenericWatch(contextName, resourceType, apiPath, (type, resource) => {
        event.sender.send('k8s:genericResourceChange', resourceType, type, resource);
      });
    }
  })

  ipcMain.on('k8s:stopWatchGenericResource', (_, resourceType) => {
    k8sService.stopGenericWatch(resourceType);
    const buffer = genericBatchBuffers.get(resourceType);
    if (buffer) { buffer.destroy(); genericBatchBuffers.delete(resourceType); }
  })

  ipcMain.on('k8s:streamPodLogs', (event, contextName, namespace, name, containerName) => {
    const streamId = `${namespace}-${name}-${containerName}`;
    console.log(`IPC: streaming logs for ${streamId}`);
    k8sService.streamPodLogs(contextName, namespace, name, containerName, (data) => {
      event.sender.send('k8s:podLogChunk', streamId, data);
    }).catch(err => {
      console.error("Error starting log stream:", err);
      event.sender.send('k8s:podLogError', streamId, err.message);
    });
  })

  ipcMain.handle('k8s:stopStreamPodLogs', (_, namespace, name, containerName) => {
    const streamId = `${namespace}-${name}-${containerName}`;
    return k8sService.stopStreamPodLogs(streamId);
  })
  ipcMain.handle('k8s:getDaemonSets', (_, contextName, namespaces) => {
    return k8sService.getDaemonSets(contextName, namespaces);
  })

  ipcMain.handle('k8s:getDaemonSet', (_, contextName, namespace, name) => {
    return k8sService.getDaemonSet(contextName, namespace, name);
  })

  ipcMain.handle('k8s:deleteDaemonSet', (_, contextName, namespace, name) => {
    return k8sService.deleteDaemonSet(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getStatefulSets', (_, contextName, namespaces) => {
    return k8sService.getStatefulSets(contextName, namespaces);
  })

  ipcMain.handle('k8s:getStatefulSet', (_, contextName, namespace, name) => {
    return k8sService.getStatefulSet(contextName, namespace, name);
  })

  ipcMain.handle('k8s:deleteStatefulSet', (_, contextName, namespace, name) => {
    return k8sService.deleteStatefulSet(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getJobs', (_, contextName, namespaces) => {
    return k8sService.getJobs(contextName, namespaces);
  })

  ipcMain.handle('k8s:getJob', (_, contextName, namespace, name) => {
    return k8sService.getJob(contextName, namespace, name);
  })

  ipcMain.handle('k8s:deleteJob', (_, contextName, namespace, name) => {
    return k8sService.deleteJob(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getCronJobs', (_, contextName, namespaces) => {
    return k8sService.getCronJobs(contextName, namespaces);
  })

  ipcMain.handle('k8s:getCronJob', (_, contextName, namespace, name) => {
    return k8sService.getCronJob(contextName, namespace, name);
  })

  ipcMain.handle('k8s:triggerCronJob', (_, contextName, namespace, name) => {
    return k8sService.triggerCronJob(contextName, namespace, name);
  })

  ipcMain.handle('k8s:deleteCronJob', (_, contextName, namespace, name) => {
    return k8sService.deleteCronJob(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getDeploymentYaml', (_, contextName, namespace, name) => {
    return k8sService.getDeploymentYaml(contextName, namespace, name);
  })

  ipcMain.handle('k8s:updateDeploymentYaml', (_, contextName, namespace, name, yaml) => {
    return k8sService.updateDeploymentYaml(contextName, namespace, name, yaml);
  })

  // --- Pod Worker IPC ---
  ipcMain.handle('start-pod-informer', async (_event, context: string, namespaces: string[]) => {
    const worker = ensurePodWorker();
    worker.postMessage({ type: 'start-informer', context, namespaces });
  });

  ipcMain.handle('stop-pod-informer', async () => {
    podWorker?.postMessage({ type: 'stop-informer' });
  });

  ipcMain.handle('get-pods-chunk', async (_event, { offset, limit }: { offset: number; limit: number }) => {
    const worker = ensurePodWorker();
    const requestId = crypto.randomUUID();
    return new Promise<LightweightPod[]>((resolve) => {
      pendingChunkRequests.set(requestId, resolve);
      worker.postMessage({ type: 'get-pods-chunk', requestId, offset, limit });
      setTimeout(() => {
        if (pendingChunkRequests.has(requestId)) {
          pendingChunkRequests.delete(requestId);
          resolve([]);
        }
      }, 10_000);
    });
  });

  // --- Terminal ---
  ipcMain.on('terminal:create', (event, id, cols, rows) => {
    terminalService.createTerminal(event.sender, id, cols, rows);
  })

  ipcMain.on('terminal:createExec', (event, id, cols, rows, context, namespace, podName, containerName) => {
    terminalService.createExecTerminal(event.sender, id, cols, rows, context, namespace, podName, containerName);
  })

  ipcMain.on('terminal:write', (_, id, data) => {
    terminalService.write(id, data);
  })

  ipcMain.on('terminal:resize', (_, id, cols, rows) => {
    terminalService.resize(id, cols, rows);
  })

  ipcMain.on('terminal:dispose', (_, id) => {
    terminalService.dispose(id);
  })

  // --- Network ---
  ipcMain.handle('k8s:getEndpointSlices', (_, contextName, namespaces) => { return k8sService.getEndpointSlices(contextName, namespaces); });
  ipcMain.handle('k8s:getEndpointSlice', (_, contextName, namespace, name) => { return k8sService.getEndpointSlice(contextName, namespace, name); });
  ipcMain.handle('k8s:deleteEndpointSlice', (_, contextName, namespace, name) => { return k8sService.deleteEndpointSlice(contextName, namespace, name); });

  ipcMain.handle('k8s:getEndpoints', (_, contextName, namespaces) => { return k8sService.getEndpoints(contextName, namespaces); });
  ipcMain.handle('k8s:getEndpoint', (_, contextName, namespace, name) => { return k8sService.getEndpoint(contextName, namespace, name); });
  ipcMain.handle('k8s:deleteEndpoint', (_, contextName, namespace, name) => { return k8sService.deleteEndpoint(contextName, namespace, name); });

  ipcMain.handle('k8s:getIngresses', (_, contextName, namespaces) => { return k8sService.getIngresses(contextName, namespaces); });
  ipcMain.handle('k8s:getIngress', (_, contextName, namespace, name) => { return k8sService.getIngress(contextName, namespace, name); });
  ipcMain.handle('k8s:deleteIngress', (_, contextName, namespace, name) => { return k8sService.deleteIngress(contextName, namespace, name); });

  ipcMain.handle('k8s:getIngressClasses', (_, contextName) => { return k8sService.getIngressClasses(contextName); });
  ipcMain.handle('k8s:getIngressClass', (_, contextName, name) => { return k8sService.getIngressClass(contextName, name); });
  ipcMain.handle('k8s:deleteIngressClass', (_, contextName, name) => { return k8sService.deleteIngressClass(contextName, name); });

  ipcMain.handle('k8s:getNetworkPolicies', (_, contextName, namespaces) => { return k8sService.getNetworkPolicies(contextName, namespaces); });
  ipcMain.handle('k8s:getNetworkPolicy', (_, contextName, namespace, name) => { return k8sService.getNetworkPolicy(contextName, namespace, name); });
  ipcMain.handle('k8s:deleteNetworkPolicy', (_, contextName, namespace, name) => { return k8sService.deleteNetworkPolicy(contextName, namespace, name); });

  // --- Storage ---
  ipcMain.handle('k8s:getPersistentVolumeClaims', (_, contextName, namespaces) => { return k8sService.getPersistentVolumeClaims(contextName, namespaces); });
  ipcMain.handle('k8s:getPersistentVolumeClaim', (_, contextName, namespace, name) => { return k8sService.getPersistentVolumeClaim(contextName, namespace, name); });
  ipcMain.handle('k8s:deletePersistentVolumeClaim', (_, contextName, namespace, name) => { return k8sService.deletePersistentVolumeClaim(contextName, namespace, name); });

  ipcMain.handle('k8s:getPersistentVolumes', (_, contextName) => { return k8sService.getPersistentVolumes(contextName); });
  ipcMain.handle('k8s:getPersistentVolume', (_, contextName, name) => { return k8sService.getPersistentVolume(contextName, name); });
  ipcMain.handle('k8s:deletePersistentVolume', (_, contextName, name) => { return k8sService.deletePersistentVolume(contextName, name); });

  ipcMain.handle('k8s:getStorageClasses', (_, contextName) => { return k8sService.getStorageClasses(contextName); });
  ipcMain.handle('k8s:getStorageClass', (_, contextName, name) => { return k8sService.getStorageClass(contextName, name); });
  ipcMain.handle('k8s:deleteStorageClass', (_, contextName, name) => { return k8sService.deleteStorageClass(contextName, name); });

  // --- Config ---
  ipcMain.handle('k8s:getConfigMaps', (_, contextName, namespaces) => { return k8sService.getConfigMaps(contextName, namespaces); });
  ipcMain.handle('k8s:getConfigMap', (_, contextName, namespace, name) => { return k8sService.getConfigMap(contextName, namespace, name); });

  ipcMain.handle('k8s:getSecrets', (_, contextName, namespaces) => { return k8sService.getSecrets(contextName, namespaces); });
  ipcMain.handle('k8s:getSecret', (_, contextName, namespace, name) => { return k8sService.getSecret(contextName, namespace, name); });

  ipcMain.handle('k8s:getHorizontalPodAutoscalers', (_, contextName, namespaces) => { return k8sService.getHorizontalPodAutoscalers(contextName, namespaces); });
  ipcMain.handle('k8s:getHorizontalPodAutoscaler', (_, contextName, namespace, name) => { return k8sService.getHorizontalPodAutoscaler(contextName, namespace, name); });

  ipcMain.handle('k8s:getPodDisruptionBudgets', (_, contextName, namespaces) => { return k8sService.getPodDisruptionBudgets(contextName, namespaces); });
  ipcMain.handle('k8s:getPodDisruptionBudget', (_, contextName, namespace, name) => { return k8sService.getPodDisruptionBudget(contextName, namespace, name); });
  ipcMain.handle('k8s:getPdbYaml', (_, contextName, namespace, name) => { return k8sService.getPdbYaml(contextName, namespace, name); });
  ipcMain.handle('k8s:updatePdbYaml', (_, contextName, namespace, name, yamlContent) => { return k8sService.updatePdbYaml(contextName, namespace, name, yamlContent); });

  // Generic resource YAML operations
  ipcMain.handle('k8s:getResourceYaml', (_, contextName, apiVersion, kind, name, namespace) => { return k8sService.getResourceYaml(contextName, apiVersion, kind, name, namespace); });
  ipcMain.handle('k8s:updateResourceYaml', (_, contextName, apiVersion, kind, name, yamlContent, namespace) => { return k8sService.updateResourceYaml(contextName, apiVersion, kind, name, yamlContent, namespace); });
  ipcMain.handle('k8s:deleteResource', (_, contextName, apiVersion, kind, name, namespace) => { return k8sService.deleteResource(contextName, apiVersion, kind, name, namespace); });

  ipcMain.handle('k8s:getMutatingWebhookConfigurations', (_, contextName) => { return k8sService.getMutatingWebhookConfigurations(contextName); });
  ipcMain.handle('k8s:getMutatingWebhookConfiguration', (_, contextName, name) => { return k8sService.getMutatingWebhookConfiguration(contextName, name); });

  ipcMain.handle('k8s:getValidatingWebhookConfigurations', (_, contextName) => { return k8sService.getValidatingWebhookConfigurations(contextName); });
  ipcMain.handle('k8s:getValidatingWebhookConfiguration', (_, contextName, name) => { return k8sService.getValidatingWebhookConfiguration(contextName, name); });

  ipcMain.handle('k8s:getPriorityClasses', (_, contextName) => { return k8sService.getPriorityClasses(contextName); });
  ipcMain.handle('k8s:getPriorityClass', (_, contextName, name) => { return k8sService.getPriorityClass(contextName, name); });

  ipcMain.handle('k8s:getRuntimeClasses', (_, contextName) => { return k8sService.getRuntimeClasses(contextName); });
  ipcMain.handle('k8s:getRuntimeClass', (_, contextName, name) => { return k8sService.getRuntimeClass(contextName, name); });

  // --- Settings / Config ---
  // Using electron-store for persistence

  // --- Context Engine IPC Handlers ---
  ipcMain.handle('context:getStatus', async () => {
    return contextEngine.getStatus();
  });

  ipcMain.handle('context:getSummary', async (_, resourceType: string, namespace?: string) => {
    return contextEngine.getSummary(resourceType, namespace);
  });

  ipcMain.handle('context:getAnomalies', async () => {
    return contextEngine.getAnomalies();
  });

  ipcMain.handle('context:clusterSwitch', async () => {
    contextEngine.onClusterSwitch();
    lastPodWatchScope = '';
    lastDeploymentWatchScope = '';
    // Clear cached resourceVersions so watchers start fresh on the new cluster
    k8sService.clearWatchResourceVersions();
    return true;
  });

  ipcMain.handle('settings:getContextConfig', async () => {
    return (store.get('contextEngineConfig') as ContextEngineConfig) || {
      tokenBudget: 2000,
      summariesEnabled: true,
      anomalyDetectionEnabled: true,
    };
  });

  ipcMain.handle('settings:setContextConfig', async (_, config: Partial<ContextEngineConfig>) => {
    const current = (store.get('contextEngineConfig') as ContextEngineConfig) || {
      tokenBudget: 2000,
      summariesEnabled: true,
      anomalyDetectionEnabled: true,
    };
    const updated = { ...current, ...config };
    store.set('contextEngineConfig', updated);
    contextEngine.updateConfig(config);
    return true;
  });

  // Handlers
  ipcMain.handle('settings:saveApiKey', async (_, apiKey) => {
    store.set('geminiApiKey', apiKey);
    return true;
  });

  ipcMain.handle('settings:getApiKey', async () => {
    return (store.get('geminiApiKey') as string) || '';
  });

  ipcMain.handle('settings:saveAwsCreds', async (_, creds) => {
    store.set('awsCreds', creds);
    return true;
  });

  ipcMain.handle('settings:getAwsCreds', async () => {
    return (store.get('awsCreds') as Record<string, string>) || {};
  });

  // --- Auth Session Persistence ---
  ipcMain.handle('auth:saveSession', async (_, session: string | object) => {
    store.set('supabase_session', session);
    return true;
  });

  ipcMain.handle('auth:getSession', async () => {
    return store.get('supabase_session') ?? null;
  });

  ipcMain.handle('auth:clearSession', async () => {
    store.delete('supabase_session');
    return true;
  });

  // --- AI History (using ChatSessionManager) ---
  let legacyMigrated = false;

  ipcMain.handle('ai:getHistory', async () => {
    if (!legacyMigrated) {
      chatSessionManager.migrateLegacyHistory();
      legacyMigrated = true;
    }
    return chatSessionManager.getHistory();
  });

  ipcMain.handle('ai:saveHistoryItem', async (_, item) => {
    // For backward compatibility: if item looks like a legacy format, start a session and save
    if (item && item.prompt) {
      chatSessionManager.startSession(
        item.resourceName ? { name: item.resourceName, type: item.resourceType || 'Unknown' } : undefined,
        item.model || '',
        item.provider || ''
      );
      chatSessionManager.addMessage('user', item.prompt);
      if (item.response) {
        chatSessionManager.addMessage('assistant', item.response);
      }
      chatSessionManager.saveCurrentSession();
    }
    return true;
  });

  ipcMain.handle('ai:deleteHistoryItem', async (_, id) => {
    chatSessionManager.deleteSession(id);
    return true;
  });

  ipcMain.handle('ai:clearHistory', async () => {
    chatSessionManager.clearHistory();
    return true;
  });

  ipcMain.handle('ai:startSession', async (_, context, model, provider) => {
    chatSessionManager.saveCurrentSession(); // save previous if any
    return chatSessionManager.startSession(context || undefined, model || '', provider || '');
  });

  ipcMain.handle('ai:loadSession', async (_, id) => {
    // Activate this session in the main process so IPC chat turns append here instead of starting a new session.
    return chatSessionManager.resumeSession(id);
  });

  ipcMain.handle('ai:saveCurrentSession', async () => {
    chatSessionManager.saveCurrentSession();
    return true;
  });

  ipcMain.handle('ai:getCurrentSession', async () => {
    return chatSessionManager.getCurrentSession();
  });

  // --- Notifications (persisted via electron-store) ---
  const NOTIFICATIONS_KEY = 'anomalyNotifications';
  const MAX_NOTIFICATIONS = 100;

  interface StoredNotification {
    id: string;
    anomalyId?: string;
    createdAt: number;
    read: boolean;
    [key: string]: unknown;
  }

  function readNotifications(): StoredNotification[] {
    const data = store.get(NOTIFICATIONS_KEY);
    return Array.isArray(data) ? data : [];
  }

  function saveNotifications(notifications: StoredNotification[]): void {
    // Keep only the most recent MAX_NOTIFICATIONS
    if (notifications.length > MAX_NOTIFICATIONS) {
      notifications = notifications.slice(0, MAX_NOTIFICATIONS);
    }
    store.set(NOTIFICATIONS_KEY, notifications);
  }

  ipcMain.handle('notifications:getAll', async () => {
    return readNotifications();
  });

  ipcMain.handle('notifications:add', async (_, notification) => {
    const notifications = readNotifications();
    // Deduplicate by anomaly id
    if (notification.anomalyId && notifications.some((n) => n.anomalyId === notification.anomalyId)) {
      return notifications;
    }
    notifications.unshift({ ...notification, id: notification.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, createdAt: Date.now(), read: false });
    saveNotifications(notifications);
    return notifications;
  });

  ipcMain.handle('notifications:markRead', async (_, id) => {
    const notifications = readNotifications();
    const notif = notifications.find((n) => n.id === id);
    if (notif) notif.read = true;
    saveNotifications(notifications);
    return notifications;
  });

  ipcMain.handle('notifications:markAllRead', async () => {
    const notifications = readNotifications();
    notifications.forEach((n) => { n.read = true; });
    saveNotifications(notifications);
    return notifications;
  });

  ipcMain.handle('notifications:delete', async (_, id) => {
    const notifications = readNotifications().filter((n) => n.id !== id);
    saveNotifications(notifications);
    return notifications;
  });

  ipcMain.handle('notifications:clear', async () => {
    store.set(NOTIFICATIONS_KEY, []);
    return [];
  });

  ipcMain.handle('notifications:getUnreadCount', async () => {
    return readNotifications().filter((n) => !n.read).length;
  });

  // --- Pinned Clusters ---

  ipcMain.handle('k8s:getPinnedClusters', async () => {
    return (store.get('pinnedClusters') as string[]) || [];
  });

  ipcMain.handle('k8s:addPinnedCluster', async (_, clusterName) => {
    const pinned = (store.get('pinnedClusters') as string[]) || [];
    if (!pinned.includes(clusterName)) {
      pinned.push(clusterName);
      store.set('pinnedClusters', pinned);
    }
    return pinned; // Return updated list
  });

  ipcMain.handle('k8s:removePinnedCluster', async (_, clusterName) => {
    let pinned = (store.get('pinnedClusters') as string[]) || [];
    pinned = pinned.filter(c => c !== clusterName);
    store.set('pinnedClusters', pinned);
    return pinned; // Return updated list
  });

  // Sync handlers for cold start
  ipcMain.on('settings:getModelSync', (event) => {
    event.returnValue = store.get('k8ptain_model') || 'gemini-1.5-flash';
  });

  ipcMain.on('settings:getProviderSync', (event) => {
    event.returnValue = store.get('k8ptain_provider') || 'google';
  });

  ipcMain.handle('settings:saveModelSelection', (_event, provider, model) => {
    store.set('k8ptain_provider', provider);
    store.set('k8ptain_model', model);
    return true;
  });

  // --- General Settings ---
  ipcMain.handle('settings:get', async (_, key: string) => {
    return store.get(`settings_${key}`) ?? null;
  });

  ipcMain.handle('settings:set', async (_, key: string, value: string | number | boolean) => {
    store.set(`settings_${key}`, value);
    if (key === 'aiTraceAnalytics') {
      syncLangfuseOtelWithStore();
    }
    return true;
  });

  ipcMain.handle('settings:getAll', async () => {
    return {
      refreshInterval: (store.get('settings_refreshInterval') as number) ?? 30,
      defaultNamespace: (store.get('settings_defaultNamespace') as string) ?? 'all',
      showSystemNamespaces: (store.get('settings_showSystemNamespaces') as boolean) ?? false,
      enableNotifications: (store.get('settings_enableNotifications') as boolean) ?? true,
      maxLogLines: (store.get('settings_maxLogLines') as number) ?? 1000,
      editorFontSize: (store.get('settings_editorFontSize') as number) ?? 14,
      editorWordWrap: (store.get('settings_editorWordWrap') as boolean) ?? true,
      terminalFontSize: (store.get('settings_terminalFontSize') as number) ?? 13,
      fontFamily: (store.get('settings_fontFamily') as string) ?? 'System Default',
      tableFontSize: (store.get('settings_tableFontSize') as number) ?? 12,
      sidebarFontSize: (store.get('settings_sidebarFontSize') as number) ?? 13,
      pinnedFontSize: (store.get('settings_pinnedFontSize') as number) ?? 12,
      headingSize: (store.get('settings_headingSize') as number) ?? 19,
      dateFormat: (store.get('settings_dateFormat') as string) ?? 'uk',
      zoomFactor: (store.get('settings_zoomFactor') as number) ?? 100,
    };
  });

  ipcMain.handle('settings:setZoomFactor', async (_, factor: number) => {
    store.set('settings_zoomFactor', factor);
    if (win) {
      win.webContents.setZoomFactor(factor / 100);
    }
    return true;
  });

  ipcMain.handle('settings:getKubeconfigPath', async () => {
    const customPath = store.get('settings_kubeconfigPath') as string;
    if (customPath) return customPath;
    return path.join(os.homedir(), '.kube', 'config');
  });

  ipcMain.handle('settings:setKubeconfigPath', async (_, kubeconfigPath: string) => {
    store.set('settings_kubeconfigPath', kubeconfigPath);
    return true;
  });

  // --- Onboarding ---
  ipcMain.handle('onboarding:getLastSeenVersion', async () => {
    return (store.get('onboardingLastSeenVersion') as string) || null;
  });

  ipcMain.handle('onboarding:setLastSeenVersion', async (_, version: string) => {
    store.set('onboardingLastSeenVersion', version);
    return true;
  });

  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion();
  });

  // --- What's New ---
  ipcMain.handle('whatsNew:getLastSeenVersion', async () => {
    return (store.get('whatsNewLastSeenVersion') as string) || null;
  });

  ipcMain.handle('whatsNew:setLastSeenVersion', async (_, version: string) => {
    store.set('whatsNewLastSeenVersion', version);
    return true;
  });

  ipcMain.handle('app:isPackaged', () => {
    return app.isPackaged;
  });

  // --- File Dialog ---
  ipcMain.handle('dialog:openYamlFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open YAML File',
      filters: [
        { name: 'YAML Files', extensions: ['yaml', 'yml'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const fs = await import('fs/promises');
    const content = await fs.readFile(filePath, 'utf-8');
    return { filePath, content };
  });

  ipcMain.handle('dialog:saveYamlFile', async (_, filePath: string | null, content: string) => {
    let targetPath = filePath;
    if (!targetPath) {
      const result = await dialog.showSaveDialog({
        title: 'Save YAML File',
        filters: [
          { name: 'YAML Files', extensions: ['yaml', 'yml'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        defaultPath: 'manifest.yaml',
      });
      if (result.canceled || !result.filePath) return null;
      targetPath = result.filePath;
    }
    const fs = await import('fs/promises');
    await fs.writeFile(targetPath, content, 'utf-8');
    return targetPath;
  });

  // --- Helm release management ---
  ipcMain.handle('helm:getReleases', async (_, contextName: string, namespaces: string[]) => {
    return k8sService.getHelmReleases(contextName, namespaces);
  });

  ipcMain.handle('helm:getRelease', async (_, contextName: string, namespace: string, name: string) => {
    return k8sService.getHelmRelease(contextName, namespace, name);
  });

  ipcMain.handle('helm:getReleaseHistory', async (_, contextName: string, namespace: string, name: string) => {
    return k8sService.getHelmReleaseHistory(contextName, namespace, name);
  });

  ipcMain.handle('helm:uninstallRelease', async (_, contextName: string, namespace: string, name: string) => {
    return k8sService.uninstallHelmRelease(contextName, namespace, name);
  });

  ipcMain.handle('helm:rollbackRelease', async (_, contextName: string, namespace: string, name: string, revision: number) => {
    return k8sService.rollbackHelmRelease(contextName, namespace, name, revision);
  });

  ipcMain.handle('helm:listRepos', async () => {
    return k8sService.listHelmRepos();
  });

  ipcMain.handle('helm:updateRepos', async () => {
    return k8sService.updateHelmRepos();
  });

  ipcMain.handle('helm:addRepo', async (_, name: string, url: string) => {
    return k8sService.addHelmRepo(name, url);
  });

  /** Artifact Hub HTTP from main process (avoids renderer CORS when loaded from file://). */
  ipcMain.handle('artifacthub:fetch', async (_evt, pathAndQuery: string, options?: { accept?: string }) => {
    try {
      return await artifactHubFetchMain(String(pathAndQuery), options);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[artifacthub] fetch failed', msg);
      throw new Error(msg || 'Artifact Hub request failed');
    }
  });

  ipcMain.handle('helm:getCatalog', async (_evt, opts?: { force?: boolean }) =>
    getHelmCatalogForIpc(store, opts)
  );

  // --- Helm release watcher (real-time) ---
  ipcMain.on('k8s:watchHelmReleases', (event, contextName, namespaces) => {
    console.log('[HelmWatcher:main] Starting watch for context:', contextName, 'namespaces:', namespaces);
    k8sService.stopHelmReleaseWatch();
    if (helmBatchBuffer) { helmBatchBuffer.destroy(); helmBatchBuffer = null; }
    const gen = ++helmWatchGeneration;

    helmBatchBuffer = new WatcherBatchBuffer({
      flushIntervalMs: 150,
      onFlush: async (events) => {
        if (gen !== helmWatchGeneration) return;
        try {
          const request: TransformRequest = {
            id: `helmrelease-${++transformRequestId}`,
            resourceType: 'helmrelease',
            events,
          };
          const response = await sendToWorker(request);
          if (response.error) console.warn('[HelmWatcher:main] Transform warning:', response.error);
          if (response.events.length > 0 && gen === helmWatchGeneration) {
            event.sender.send('k8s:helmReleaseBatchChange', response.events);
          }
        } catch (err) {
          console.error('[HelmWatcher:main] Batch transform error:', err);
        }
      },
    });

    k8sService.startHelmReleaseWatch(contextName, namespaces, (type, rawSecret) => {
      if (gen !== helmWatchGeneration) return;
      helmBatchBuffer?.push({ type: type as 'ADDED' | 'MODIFIED' | 'DELETED', resource: rawSecret });
    });
  });

  ipcMain.on('k8s:stopWatchHelmReleases', () => {
    console.log('[HelmWatcher:main] Stopping watch');
    k8sService.stopHelmReleaseWatch();
    if (helmBatchBuffer) { helmBatchBuffer.destroy(); helmBatchBuffer = null; }
  });
}

// Helper functions for AI

/**
 * Strip noisy/verbose fields from a K8s resource before sending to the LLM.
 * Removes managedFields, last-applied-configuration, and other metadata bloat
 * that wastes tokens without adding analytical value.
 */
function stripResourceForAI(resource: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(resource));
  const meta = clone.metadata;
  if (meta) {
    delete meta.managedFields;
    delete meta.generation;
    delete meta.uid;
    delete meta.resourceVersion;
    delete meta.selfLink;
    delete meta.creationTimestamp;
    if (meta.annotations) {
      delete meta.annotations['kubectl.kubernetes.io/last-applied-configuration'];
      delete meta.annotations['deployment.kubernetes.io/revision'];
      // Remove empty annotations object
      if (Object.keys(meta.annotations).length === 0) delete meta.annotations;
    }
  }
  // Strip status.conditions[].lastTransitionTime and lastHeartbeatTime noise
  if (clone.status?.conditions && Array.isArray(clone.status.conditions)) {
    clone.status.conditions = clone.status.conditions.map((c: Record<string, unknown>) => {
      const { lastHeartbeatTime, ...rest } = c;
      return rest;
    });
  }
  return clone;
}

function formatAiProviderResponseBodySnippet(body: string | undefined): string {
  if (!body || typeof body !== 'string') return '';
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as {
      message?: string;
      error?: { message?: string; status?: string; code?: number };
    };
    const nested = parsed.error;
    if (nested?.message) {
      const st = nested.status ? ` [${nested.status}]` : '';
      return `${nested.message.trim()}${st}`;
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    /* not JSON */
  }
  return trimmed.length > 800 ? `${trimmed.slice(0, 800)}…` : trimmed;
}

function httpStatusLabel(code: number): string {
  switch (code) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 429:
      return 'Too Many Requests';
    case 502:
      return 'Bad Gateway';
    case 503:
      return 'Service Unavailable';
    case 504:
      return 'Gateway Timeout';
    default:
      return '';
  }
}

function appendPartsFromApiCall(parts: string[], e: APICallError): void {
  const sc = e.statusCode;
  if (sc != null) {
    const label = httpStatusLabel(sc);
    parts.push(label ? `HTTP ${sc} (${label})` : `HTTP ${sc}`);
  } else if (e.message) {
    parts.push(e.message);
  }
  const bodyLine = formatAiProviderResponseBodySnippet(e.responseBody);
  if (bodyLine && !parts.some((p) => p.includes(bodyLine.slice(0, 60)))) {
    parts.push(bodyLine);
  } else if (e.message?.trim()) {
    const m = e.message.trim();
    if (!parts.some((p) => p.includes(m.slice(0, Math.min(48, m.length))))) {
      parts.push(m);
    }
  }
  if (sc != null && sc >= 500 && e.url?.includes('googleapis.com')) {
    parts.push(
      'Google Generative Language API returned a server error. This is usually temporary; retry in a moment or check Google AI Studio status.'
    );
  }
}

function extractAiErrorInfo(error: unknown): { message: string; isAccessDenied: boolean } {
  const parts: string[] = [];
  let cursor: unknown = error;
  const seen = new Set<object>();

  for (let depth = 0; depth < 10 && cursor != null; depth++) {
    if (typeof cursor === 'object' && cursor !== null) {
      if (seen.has(cursor as object)) break;
      seen.add(cursor as object);
    }

    if (APICallError.isInstance(cursor)) {
      appendPartsFromApiCall(parts, cursor);
    } else if (cursor instanceof Error && cursor.message?.trim()) {
      const msg = cursor.message.trim();
      if (!parts.some((p) => p.includes(msg.slice(0, 40)))) {
        parts.push(msg);
      }
    } else if (typeof cursor === 'string' && cursor.trim()) {
      parts.push(cursor.trim());
    }

    cursor =
      cursor instanceof Error && cursor.cause !== undefined ? cursor.cause : undefined;
  }

  if (parts.length === 0 && error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (typeof err.responseBody === 'string') {
      const snippet = formatAiProviderResponseBodySnippet(err.responseBody);
      if (snippet) parts.push(snippet);
    }
    if ((err.data as Record<string, unknown>)?.message) {
      parts.push(String((err.data as Record<string, unknown>).message));
    }
    const sc = err.statusCode as number | undefined;
    if (sc != null) {
      const label = httpStatusLabel(sc);
      parts.unshift(label ? `HTTP ${sc} (${label})` : `HTTP ${sc}`);
    } else if (error instanceof Error && error.message) {
      parts.push(error.message);
    }
  }

  const message =
    parts
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p, i, arr) => arr.findIndex((x) => x === p) === i)
      .join(' ') || 'Unknown error';

  const isAccessDenied =
    message.includes('HTTP 403') ||
    message.includes('PERMISSION_DENIED') ||
    (error as Record<string, unknown>)?.statusCode === 403 ||
    message.includes('Model access is denied') ||
    message.includes('aws-marketplace');

  return { message, isAccessDenied };
}

function getApiKey(): string {
  const key = store.get('geminiApiKey') as string;
  return key || process.env.GEMINI_API_KEY || '';
}

interface AwsCreds {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
}

function getAwsCreds(): AwsCreds {
  return (store.get('awsCreds') as AwsCreds) || {};
}

/**
 * Build a Bedrock-compatible config object.
 * Uses the same credential resolution as AwsService:
 *   1. Saved manual credentials from Settings
 *   2. fromNodeProviderChain (reads ~/.aws/credentials, credential_process, SSO, etc.)
 *      This picks up Granted file-based creds automatically since Granted writes to [default].
 *
 * Note: We intentionally skip process.env Granted creds here because they become stale
 * after launch. The provider chain reads fresh creds from disk on every call.
 */
interface BedrockConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  credentialProvider?: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>;
}

function getBedrockConfig(): BedrockConfig {
  const savedCreds = getAwsCreds();
  const grantedCreds = awsService.getGrantedCredentials();

  const config: BedrockConfig = {
    region: grantedCreds?.region || savedCreds.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
  };

  // Priority 1: Saved manual credentials from Settings UI
  if (savedCreds.accessKeyId && savedCreds.secretAccessKey) {
    config.accessKeyId = savedCreds.accessKeyId;
    config.secretAccessKey = savedCreds.secretAccessKey;
    if (savedCreds.sessionToken) {
      config.sessionToken = savedCreds.sessionToken;
    }
  } else {
    // Priority 2: Read credentials directly from ~/.aws/credentials file first.
    // This bypasses fromNodeProviderChain's internal caching which can serve stale/expired
    // credentials after a Granted profile switch. Only fall back to the provider chain
    // if no file-based credentials are found (e.g., using SSO or credential_process).
    config.credentialProvider = async () => {
      const effectiveProfile = getEffectiveProfile();

      // Try file-based credentials first (always fresh from disk)
      const fileCreds = await awsService.readCredentialsFile(effectiveProfile);
      if (fileCreds && fileCreds.accessKeyId && fileCreds.secretAccessKey) {
        return {
          accessKeyId: fileCreds.accessKeyId,
          secretAccessKey: fileCreds.secretAccessKey,
          sessionToken: fileCreds.sessionToken,
        };
      }

      // Fall back to provider chain (credential_process, SSO, etc.)
      const provider = fromNodeProviderChain({
        ...(effectiveProfile ? { profile: effectiveProfile } : {}),
        clientConfig: { region: config.region },
      });
      const creds = await provider();
      return {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      };
    };
  }

  return config;
}

function getEffectiveProfile(): string | undefined {
  const profile = (store.get('awsProfile') as string) || undefined;
  return profile && profile !== 'default' ? profile : undefined;
}

registerIpcHandlers()

// Initialize AWS profile from stored settings
const savedProfile = (store.get('awsProfile') as string) || 'default';
if (savedProfile && savedProfile !== 'default') {
  awsService.setProfile(savedProfile);
}

// Start watching credential files for Granted profile switches
awsService.startCredentialFileWatcher();

// Forward credential change events to the renderer
awsService.on('credentialsChanged', (data: { identity: string; account: string; profile?: string }) => {
  console.log('[main] AWS credentials changed, notifying renderer:', data.identity);
  // Persist the detected profile so it stays in sync
  if (data.profile) {
    store.set('awsProfile', data.profile);
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send('aws:credentialsChanged', data);
  }
});

// Forward anomaly events from ContextEngine to renderer
contextEngine.on('anomaly', (anomaly) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('context:anomaly', anomaly);
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 576,
    icon: APP_LOGO_PNG,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    if (win) {
      win.webContents.send('main-process-message', (new Date).toLocaleString())
      // Apply saved zoom factor
      const savedZoom = (store.get('settings_zoomFactor') as number) ?? 100;
      if (savedZoom !== 100) {
        win.webContents.setZoomFactor(savedZoom / 100);
      }
      flushPendingOAuthDeepLink();
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // Notify renderer when the window regains focus so it can check watcher health.
  // macOS throttles background processes, which can silently kill watch connections.
  win.on('focus', () => {
    console.log('[main] Window focused — notifying renderer');
    win?.webContents.send('app:windowFocused');
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  awsService.stopCredentialFileWatcher();
  // Stop all watchers — no renderer to receive events
  k8sService.stopAllWatchers();
  if (helmBatchBuffer) { helmBatchBuffer.destroy(); helmBatchBuffer = null; }
  if (podBatchBuffer) { podBatchBuffer.destroy(); podBatchBuffer = null; }
  if (deploymentBatchBuffer) { deploymentBatchBuffer.destroy(); deploymentBatchBuffer = null; }
  if (nodeBatchBuffer) { nodeBatchBuffer.destroy(); nodeBatchBuffer = null; }
  for (const [, buffer] of genericBatchBuffers) {
    buffer.destroy();
  }
  genericBatchBuffers.clear();
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  if (process.platform === 'win32' || process.platform === 'linux') {
    const startupDeepLink = process.argv.find(
      (a): a is string => typeof a === 'string' && a.startsWith(`${OAUTH_CALLBACK_PROTOCOL}:`),
    )
    if (startupDeepLink) queueOAuthDeepLink(startupDeepLink)
  }
  if (process.platform === 'darwin') {
    try {
      app.dock?.setIcon(APP_LOGO_PNG);
    } catch (e) {
      console.error('Failed to set dock icon:', e);
    }
  }
  createWindow();
})
