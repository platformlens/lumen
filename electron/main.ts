import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import fixPath from 'fix-path';
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { K8sService } from './k8s'
import { TerminalService } from './terminal'
import { AwsService } from './aws'
import { ContextEngine } from './context-engine/context-engine'
import { ContextEngineConfig } from './context-engine/types'
import { ChatSessionManager } from './context-engine/chat-session'
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { streamText } from 'ai';
import dotenv from 'dotenv'
import Store from 'electron-store'

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

dotenv.config()


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

let win: BrowserWindow | null
let store: Store;

// Initialize store synchronously
store = new Store();

const k8sService = new K8sService()
const terminalService = new TerminalService()
const awsService = new AwsService()

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
const chatSessionManager = new ChatSessionManager(store);

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

  ipcMain.handle('aws:checkAuth', async (_, region) => {
    const creds = store.get('awsCreds');
    return awsService.checkAuth(region, creds);
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

  ipcMain.handle('k8s:getPodMetrics', async (_, contextName, namespaces) => {
    console.log('IPC: k8s:getPodMetrics called with', contextName, namespaces);
    const metricsMap = await k8sService.getPodMetrics(contextName, namespaces);
    // Convert Map to object for IPC serialization
    return Object.fromEntries(metricsMap);
  })

  ipcMain.handle('k8s:getPod', (_, contextName, namespace, name) => {
    return k8sService.getPod(contextName, namespace, name);
  })

  ipcMain.handle('k8s:getReplicaSets', (_, contextName, namespaces) => {
    return k8sService.getReplicaSets(contextName, namespaces);
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

  ipcMain.handle('k8s:getEvent', async (_event, _contextName, _namespace, _name) => {
    // There is no single event fetch usually, but consistency
    return null;
  });

  ipcMain.handle('k8s:getNodes', async (_event, contextName) => {
    try {
      return await k8sService.getNodes(contextName);
    } catch (error: any) {
      console.error('Error in k8s:getNodes:', error);
      throw error;
    }
  });

  ipcMain.handle('k8s:getNode', async (_event, contextName, name) => {
    try {
      return await k8sService.getNode(contextName, name);
    } catch (error: any) {
      console.error('Error in k8s:getNode:', error);
      throw error;
    }
  });

  ipcMain.handle('k8s:getCRDs', (_, contextName) => {
    return k8sService.getCRDs(contextName);
  })

  ipcMain.handle('k8s:getCRD', async (_event, contextName, name) => {
    try {
      return await k8sService.getCRD(contextName, name);
    } catch (error: any) {
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

  ipcMain.on('ai:explainResourceStream', async (event, resource, options) => {
    try {
      const { provider = 'google', model = 'gemini-1.5-flash' } = options || {};
      let aiModel;

      if (provider === 'google') {
        const apiKey = getApiKey();
        if (!apiKey) {
          event.sender.send('ai:explainResourceStream:error', 'GEMINI_API_KEY not configured.');
          return;
        }
        const google = createGoogleGenerativeAI({ apiKey });
        aiModel = google(model);
      } else if (provider === 'bedrock') {
        const bedrockConfig = getBedrockConfig();
        const bedrock = createAmazonBedrock(bedrockConfig);
        aiModel = bedrock(model);
      } else {
        event.sender.send('ai:explainResourceStream:error', `Unknown provider: ${provider}`);
        return;
      }

      const { getPromptForResource } = await import('./prompts');
      const basePrompt = getPromptForResource(resource);

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
        ${relatedContext}
        
        Resource JSON:
        ${JSON.stringify(resource, null, 2)}
      `;

      const result = streamText({
        model: aiModel,
        prompt: prompt,
        onError: ({ error }: { error: unknown }) => {
          console.error('[AI] streamText onError:', error);
          const { message: errMsg, isAccessDenied } = extractAiErrorInfo(error);
          event.sender.send('ai:explainResourceStream:error', errMsg);
          if (isAccessDenied) {
            event.sender.send('ai:bedrockAccessDenied', errMsg);
          }
        },
      });

      let fullResponse = '';
      try {
        for await (const textPart of result.textStream) {
          fullResponse += textPart;
          event.sender.send('ai:explainResourceStream:chunk', textPart);
        }
      } catch (streamError: any) {
        console.error('[AI] Stream iteration error:', streamError);
        const { message: errMsg, isAccessDenied } = extractAiErrorInfo(streamError);
        event.sender.send('ai:explainResourceStream:error', errMsg);
        if (isAccessDenied) {
          event.sender.send('ai:bedrockAccessDenied', errMsg);
        }
        return;
      }

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

    } catch (error: any) {
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
      let aiModel;

      if (provider === 'google') {
        const apiKey = getApiKey();
        if (!apiKey) {
          event.sender.send('ai:customPromptStream:error', 'GEMINI_API_KEY not configured.');
          activeCustomPromptAbort = null;
          return;
        }
        const google = createGoogleGenerativeAI({ apiKey });
        aiModel = google(model);
      } else if (provider === 'bedrock') {
        const bedrockConfig = getBedrockConfig();
        const bedrock = createAmazonBedrock(bedrockConfig);
        aiModel = bedrock(model);
      } else {
        event.sender.send('ai:customPromptStream:error', `Unknown provider: ${provider}`);
        activeCustomPromptAbort = null;
        return;
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

      // Build enhanced system prompt with context injection
      let enhancedSystemPrompt = systemPrompt || '';

      if (clusterContext) {
        enhancedSystemPrompt += `\n\n--- LIVE CLUSTER STATE ---\nThe following is a compressed snapshot of the user's current Kubernetes cluster state. Use this to answer cluster-specific questions.\n${clusterContext}\n--- END CLUSTER STATE ---`;
      } else {
        enhancedSystemPrompt += '\n\nNote: No live cluster context is currently available. Answer based on general Kubernetes knowledge.';
      }

      // Handle /kubectl mode
      if (isKubectlMode) {
        const activeCluster = clusterName || 'unknown';
        const activeNamespace = namespace || 'default';
        const { buildKubectlPrompt } = await import('./prompts');
        enhancedSystemPrompt += buildKubectlPrompt(activeCluster, activeNamespace);
      }

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

      // Use messages array if provided (for conversation history), otherwise use simple prompt
      let result;
      if (messages && messages.length > 0) {
        // Multi-turn conversation with history
        result = streamText({
          model: aiModel,
          messages: messages,
          system: enhancedSystemPrompt,
          abortSignal,
          onError: handleStreamError,
        });
      } else {
        // Single prompt (backward compatibility)
        const finalPrompt = enhancedSystemPrompt ? `${enhancedSystemPrompt}\n\n${actualQuery}` : actualQuery;
        result = streamText({
          model: aiModel,
          prompt: finalPrompt,
          abortSignal,
          onError: handleStreamError,
        });
      }

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

      let fullResponse = '';
      try {
        for await (const textPart of result.textStream) {
          // Check if aborted
          if (abortSignal.aborted) {
            console.log('[AI] Stream aborted');
            activeCustomPromptAbort = null;
            return;
          }
          fullResponse += textPart;
          event.sender.send('ai:customPromptStream:chunk', textPart);
        }
      } catch (streamError: any) {
        if (streamError.name === 'AbortError' || abortSignal.aborted) {
          console.log('[AI] Stream was aborted');
          activeCustomPromptAbort = null;
          return;
        }
        console.error('[AI] Stream iteration error:', streamError);
        const { message: errMsg, isAccessDenied } = extractAiErrorInfo(streamError);
        event.sender.send('ai:customPromptStream:error', errMsg);
        if (isAccessDenied) {
          event.sender.send('ai:bedrockAccessDenied', errMsg);
        }
        activeCustomPromptAbort = null;
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

      event.sender.send('ai:customPromptStream:done');
      activeCustomPromptAbort = null;

    } catch (error: any) {
      // Don't send error if it was aborted
      if (error.name === 'AbortError' || abortSignal.aborted) {
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
            const creds = await config.credentialProvider();
            return { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken };
          }
          : {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
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
    } catch (err: any) {
      console.error('AWS Auth Check Failed:', err);
      return {
        isManaged: false,
        isAuthenticated: false,
        error: err.message
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
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => ({
            id: m.name.replace('models/', ''),
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
              const creds = await config.credentialProvider();
              return { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken };
            }
            : {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
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
    }
    return [];
  })


  ipcMain.handle('k8s:deletePod', (_, contextName, namespace, name) => {
    return k8sService.deletePod(contextName, namespace, name);
  })

  ipcMain.on('k8s:watchPods', (event, contextName, namespaces) => {
    // We use ipcMain.on for start watch as it's not a single promise return 
    // but starts a process that emits events back.
    // Stop existing watcher FIRST to prevent stale events from re-populating the store
    k8sService.stopPodWatch();
    // Only clear the store if the namespace scope actually changed
    const newScope = Array.isArray(namespaces) ? namespaces.sort().join(',') : '';
    if (newScope !== lastPodWatchScope) {
      contextEngine.clearKind('Pod');
      lastPodWatchScope = newScope;
    }
    // Increment generation so any lingering callbacks from the old watcher are ignored
    const gen = ++podWatchGeneration;
    k8sService.startPodWatch(contextName, namespaces, (type, pod) => {
      // Ignore events from a stale watcher generation
      if (gen !== podWatchGeneration) return;
      // Feed raw resource data to ContextEngine
      try {
        const rawPod = { metadata: pod.metadata, status: pod.rawStatus, spec: pod.spec };
        contextEngine.handleResourceEvent('Pod', type as 'ADDED' | 'MODIFIED' | 'DELETED', rawPod);
      } catch (err) {
        console.error('[ContextEngine] Error processing pod event:', err);
      }
      event.sender.send('k8s:podChange', type, pod);
    });
  })

  ipcMain.on('k8s:stopWatchPods', () => {
    k8sService.stopPodWatch();
  })

  ipcMain.on('k8s:watchDeployments', (event, contextName, namespaces) => {
    // Stop existing watcher FIRST to prevent stale events from re-populating the store
    k8sService.stopDeploymentWatch();
    // Only clear the store if the namespace scope actually changed
    const newScope = Array.isArray(namespaces) ? namespaces.sort().join(',') : '';
    if (newScope !== lastDeploymentWatchScope) {
      contextEngine.clearKind('Deployment');
      lastDeploymentWatchScope = newScope;
    }
    const gen = ++deploymentWatchGeneration;
    k8sService.startDeploymentWatch(contextName, namespaces, (type, deployment) => {
      if (gen !== deploymentWatchGeneration) return;
      // Feed raw resource data to ContextEngine
      try {
        const rawDep = { metadata: deployment.metadata, status: deployment.status, spec: deployment.spec };
        contextEngine.handleResourceEvent('Deployment', type as 'ADDED' | 'MODIFIED' | 'DELETED', rawDep);
      } catch (err) {
        console.error('[ContextEngine] Error processing deployment event:', err);
      }
      event.sender.send('k8s:deploymentChange', type, deployment);
    });
  })

  ipcMain.on('k8s:stopWatchDeployments', () => {
    k8sService.stopDeploymentWatch();
  })

  ipcMain.on('k8s:watchNodes', (event, contextName) => {
    // Stop existing watcher FIRST to prevent stale events from re-populating the store
    k8sService.stopNodeWatch();
    contextEngine.clearKind('Node');
    const gen = ++nodeWatchGeneration;
    k8sService.startNodeWatch(contextName, (type, node) => {
      if (gen !== nodeWatchGeneration) return;
      // Feed raw resource data to ContextEngine
      try {
        const rawNode = { metadata: node.metadata, status: node.statusObj, spec: node.spec };
        contextEngine.handleResourceEvent('Node', type as 'ADDED' | 'MODIFIED' | 'DELETED', rawNode);
      } catch (err) {
        console.error('[ContextEngine] Error processing node event:', err);
      }
      event.sender.send('k8s:nodeChange', type, node);
    });
  })

  ipcMain.on('k8s:stopWatchNodes', () => {
    k8sService.stopNodeWatch();
  })

  ipcMain.on('k8s:watchGenericResource', (event, contextName, resourceType, apiPath) => {
    k8sService.startGenericWatch(contextName, resourceType, apiPath, (type, resource) => {
      event.sender.send('k8s:genericResourceChange', resourceType, type, resource);
    });
  })

  ipcMain.on('k8s:stopWatchGenericResource', (_, resourceType) => {
    k8sService.stopGenericWatch(resourceType);
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
    return (store.get('awsCreds') as any) || {};
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
    return chatSessionManager.loadSession(id);
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

  function readNotifications(): any[] {
    const data = store.get(NOTIFICATIONS_KEY);
    return Array.isArray(data) ? data : [];
  }

  function saveNotifications(notifications: any[]): void {
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
    if (notification.anomalyId && notifications.some((n: any) => n.anomalyId === notification.anomalyId)) {
      return notifications;
    }
    notifications.unshift({ ...notification, id: notification.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, createdAt: Date.now(), read: false });
    saveNotifications(notifications);
    return notifications;
  });

  ipcMain.handle('notifications:markRead', async (_, id) => {
    const notifications = readNotifications();
    const notif = notifications.find((n: any) => n.id === id);
    if (notif) notif.read = true;
    saveNotifications(notifications);
    return notifications;
  });

  ipcMain.handle('notifications:markAllRead', async () => {
    const notifications = readNotifications();
    notifications.forEach((n: any) => { n.read = true; });
    saveNotifications(notifications);
    return notifications;
  });

  ipcMain.handle('notifications:delete', async (_, id) => {
    const notifications = readNotifications().filter((n: any) => n.id !== id);
    saveNotifications(notifications);
    return notifications;
  });

  ipcMain.handle('notifications:clear', async () => {
    store.set(NOTIFICATIONS_KEY, []);
    return [];
  });

  ipcMain.handle('notifications:getUnreadCount', async () => {
    return readNotifications().filter((n: any) => !n.read).length;
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

  ipcMain.handle('settings:set', async (_, key: string, value: any) => {
    store.set(`settings_${key}`, value);
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
    };
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
}

// Helper functions for AI

function extractAiErrorInfo(error: any): { message: string; isAccessDenied: boolean } {
  // Try to get a clean message from various error shapes
  let message = 'Unknown error';

  // The AI SDK puts the response body as a JSON string
  if (error.responseBody) {
    try {
      const parsed = JSON.parse(error.responseBody);
      message = parsed.message || error.responseBody;
    } catch {
      message = error.responseBody;
    }
  } else if (error.data?.message) {
    message = error.data.message;
  } else if (error.message) {
    message = error.message;
  }

  const isAccessDenied = error.statusCode === 403
    || message.includes('Model access is denied')
    || message.includes('aws-marketplace');

  return { message, isAccessDenied };
}

function getApiKey(): string {
  const key = store.get('geminiApiKey') as string;
  return key || process.env.GEMINI_API_KEY || '';
}

function getAwsCreds(): any {
  return (store.get('awsCreds') as any) || {};
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
function getBedrockConfig(): any {
  const savedCreds = getAwsCreds();
  const grantedCreds = awsService.getGrantedCredentials();

  const config: any = {
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
    // Priority 2: Provider chain (reads credential_process, ~/.aws/credentials, SSO, env vars).
    // This is the same approach AwsService.getFreshCredentialProvider() uses.
    // A fresh provider is created each time to avoid stale cached credentials.
    config.credentialProvider = async () => {
      const provider = fromNodeProviderChain({
        ...(getEffectiveProfile() ? { profile: getEffectiveProfile() } : {}),
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
  if (win) {
    win.webContents.send('aws:credentialsChanged', data);
  }
});

// Forward anomaly events from ContextEngine to renderer
contextEngine.on('anomaly', (anomaly) => {
  if (win) {
    win.webContents.send('context:anomaly', anomaly);
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 576,
    icon: path.join(process.env.APP_ROOT, 'resources', 'icon.png'),
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
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  awsService.stopCredentialFileWatcher();
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
  if (process.platform === 'darwin') {
    try {
      const iconPath = path.join(process.env.APP_ROOT, 'resources', 'icon.png');
      app.dock?.setIcon(iconPath);
    } catch (e) {
      console.error('Failed to set dock icon:', e);
    }
  }
  createWindow();
})
