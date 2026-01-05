import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import fixPath from 'fix-path';
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { K8sService } from './k8s'
import { TerminalService } from './terminal'
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { streamText } from 'ai';
import dotenv from 'dotenv'

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

const k8sService = new K8sService()
const terminalService = new TerminalService()

function registerIpcHandlers() {
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
        const apiKey = await getApiKey();
        if (!apiKey) {
          event.sender.send('ai:explainResourceStream:error', 'GEMINI_API_KEY not configured.');
          return;
        }
        const google = createGoogleGenerativeAI({ apiKey });
        aiModel = google(model);
      } else if (provider === 'bedrock') {
        const awsCreds = await getAwsCreds();

        let bedrockConfig: any = {
          region: awsCreds.region || 'us-east-1',
        };

        if (awsCreds.accessKeyId && awsCreds.secretAccessKey) {
          bedrockConfig.accessKeyId = awsCreds.accessKeyId;
          bedrockConfig.secretAccessKey = awsCreds.secretAccessKey;
          if (awsCreds.sessionToken) {
            bedrockConfig.sessionToken = awsCreds.sessionToken;
          }
        } else {
          // Use managed credentials via chain
          bedrockConfig.credentialProvider = fromNodeProviderChain();
        }

        const bedrock = createAmazonBedrock(bedrockConfig);
        aiModel = bedrock(model);
      } else {
        event.sender.send('ai:explainResourceStream:error', `Unknown provider: ${provider}`);
        return;
      }

      const { getPromptForResource } = await import('./prompts');
      const basePrompt = getPromptForResource(resource);

      const prompt = `
        ${basePrompt}
        
        Resource JSON:
        ${JSON.stringify(resource, null, 2)}
      `;

      const result = streamText({
        model: aiModel,
        prompt: prompt,
      });

      let fullResponse = '';
      for await (const textPart of result.textStream) {
        fullResponse += textPart;
        event.sender.send('ai:explainResourceStream:chunk', textPart);
      }

      // Save to History
      try {
        const { default: Store } = await import('electron-store');
        const store = new Store();
        const history: any[] = (store.get('aiHistory') as any[]) || [];

        const historyItem = {
          id: Math.random().toString(36).substr(2, 9),
          timestamp: Date.now(),
          prompt: `Explain ${resource.kind || resource.type} ${resource.metadata?.name || resource.name}`,
          response: fullResponse,
          resourceName: resource.metadata?.name || resource.name,
          resourceType: resource.kind || resource.type,
          model: model,
          provider: provider
        };

        history.unshift(historyItem);
        if (history.length > 50) history.splice(50);
        store.set('aiHistory', history);
      } catch (saveErr) {
        console.error("Failed to save AI history:", saveErr);
      }

      event.sender.send('ai:explainResourceStream:done');

    } catch (error: any) {
      console.error('AI Error:', error);
      event.sender.send('ai:explainResourceStream:error', error.message || 'Unknown error');
    }
  })

  ipcMain.handle('ai:checkAwsAuth', async () => {
    try {
      const savedCreds = await getAwsCreds();
      let client;

      if (savedCreds.accessKeyId && savedCreds.secretAccessKey) {
        // Using saved creds
        client = new BedrockClient({
          region: savedCreds.region || 'us-east-1',
          credentials: {
            accessKeyId: savedCreds.accessKeyId,
            secretAccessKey: savedCreds.secretAccessKey,
            sessionToken: savedCreds.sessionToken
          }
        });
      } else {
        // Try managed (environment/SSO)
        client = new BedrockClient({ region: savedCreds.region || 'us-east-1' });
      }

      // Lightweight check
      const command = new ListFoundationModelsCommand({ byOutputModality: 'TEXT' });
      await client.send(command);

      return {
        isManaged: !savedCreds.accessKeyId, // If we succeeded without explicit saved ID
        isAuthenticated: true
      };
    } catch (err: any) {
      console.error('AWS Auth Check Failed:', err);
      // Determine if it was a credential issue or something else
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
        const apiKey = await getApiKey();
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
        const savedCreds = await getAwsCreds();
        let client;

        if (savedCreds.accessKeyId && savedCreds.secretAccessKey) {
          client = new BedrockClient({
            region: savedCreds.region || 'us-east-1',
            credentials: {
              accessKeyId: savedCreds.accessKeyId,
              secretAccessKey: savedCreds.secretAccessKey,
              sessionToken: savedCreds.sessionToken
            }
          });
        } else {
          client = new BedrockClient({ region: savedCreds.region || 'us-east-1' });
        }

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
    k8sService.startPodWatch(contextName, namespaces, (type, pod) => {
      // Send to all windows or just the sender?
      // win?.webContents.send('k8s:podChange', type, pod);
      event.sender.send('k8s:podChange', type, pod);
    });
  })

  ipcMain.on('k8s:stopWatchPods', () => {
    k8sService.stopPodWatch();
  })

  ipcMain.on('k8s:watchDeployments', (event, contextName, namespaces) => {
    k8sService.startDeploymentWatch(contextName, namespaces, (type, deployment) => {
      event.sender.send('k8s:deploymentChange', type, deployment);
    });
  })

  ipcMain.on('k8s:stopWatchDeployments', () => {
    k8sService.stopDeploymentWatch();
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
  // Note: ElectronStore import is usually dynamic in ESM or requires explicit setup.
  // Since we are in main process with TS, let's try direct usage if import works, 
  // otherwise we might need dynamic import inside handlers or top-level await if supported.
  // Actually, standard import should work if 'electron-store' supports ESM.

  // Handlers
  ipcMain.handle('settings:saveApiKey', async (_, apiKey) => {
    const { default: Store } = await import('electron-store');
    const store = new Store();
    store.set('geminiApiKey', apiKey);
    return true;
  });

  ipcMain.handle('settings:getApiKey', async () => {
    const { default: Store } = await import('electron-store');
    const store = new Store();
    return (store.get('geminiApiKey') as string) || '';
  });

  ipcMain.handle('settings:saveAwsCreds', async (_, creds) => {
    const { default: Store } = await import('electron-store');
    const store = new Store();
    store.set('awsCreds', creds);
    return true;
  });

  ipcMain.handle('settings:getAwsCreds', async () => {
    const { default: Store } = await import('electron-store');
    const store = new Store();
    return (store.get('awsCreds') as any) || {};
  });

  // --- AI History ---
  ipcMain.handle('ai:getHistory', async () => {
    const { default: Store } = await import('electron-store');
    const store = new Store();
    return (store.get('aiHistory') as any[]) || [];
  });

  ipcMain.handle('ai:saveHistoryItem', async (_, item) => {
    const { default: Store } = await import('electron-store');
    const store = new Store();
    const history: any[] = (store.get('aiHistory') as any[]) || [];
    // Enforce limit of 50
    history.unshift(item);
    if (history.length > 50) {
      history.splice(50);
    }
    store.set('aiHistory', history);
    return true;
  });

  ipcMain.handle('ai:deleteHistoryItem', async (_, id) => {
    const { default: Store } = await import('electron-store');
    const store = new Store();
    let history: any[] = (store.get('aiHistory') as any[]) || [];
    history = history.filter(h => h.id !== id);
    store.set('aiHistory', history);
    return true;
  });

  ipcMain.handle('ai:clearHistory', async () => {
    const { default: Store } = await import('electron-store');
    const store = new Store();
    store.set('aiHistory', []);
    return true;
  });
}

// ... helper for AI
async function getApiKey(): Promise<string> {
  const { default: Store } = await import('electron-store');
  const store = new Store();
  const key = store.get('geminiApiKey') as string;
  return key || process.env.GEMINI_API_KEY || '';
}

async function getAwsCreds(): Promise<any> {
  const { default: Store } = await import('electron-store');
  const store = new Store();
  return (store.get('awsCreds') as any) || {};
}

registerIpcHandlers()

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
      app.dock.setIcon(iconPath);
    } catch (e) {
      console.error('Failed to set dock icon:', e);
    }
  }
  createWindow();
})
