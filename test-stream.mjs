import { streamText, tool, jsonSchema } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Read the API key from the Electron store config file
let apiKey;
try {
  const configPath = join(homedir(), 'Library/Application Support/lumen/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  apiKey = config.geminiApiKey;
} catch (e) {
  console.log('Could not read config:', e.message);
  process.exit(1);
}

if (!apiKey) {
  console.log('No Gemini API key found');
  process.exit(1);
}

const google = createGoogleGenerativeAI({ apiKey });
const model = google('gemini-2.0-flash');

const kubectlTool = tool({
  description: 'Execute a kubectl command against the Kubernetes cluster',
  parameters: jsonSchema({
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The full kubectl command to execute'
      }
    },
    required: ['command'],
  }),
  execute: async ({ command }) => {
    console.log('\n>>> TOOL EXECUTED:', command);
    return 'NAME                    READY   STATUS    RESTARTS   AGE\nnginx-abc123-xyz       1/1     Running   0          5d';
  }
});

console.log('Starting streamText with tools...');
console.log('Tool keys:', Object.keys({ kubectl: kubectlTool }));

const result = streamText({
  model,
  messages: [{ role: 'user', content: 'Use the kubectl tool to get pods in the default namespace' }],
  system: 'You are a Kubernetes assistant. You have access to a kubectl tool. Use it to answer questions.',
  tools: { kubectl: kubectlTool },
  maxSteps: 5,
});

let fullText = '';
for await (const part of result.fullStream) {
  if (part.type === 'text-delta') {
    process.stdout.write(part.textDelta || '');
    fullText += part.textDelta || '';
  } else if (part.type === 'tool-call') {
    console.log('\n>>> TOOL CALL:', part.toolName, JSON.stringify(part.args));
  } else if (part.type === 'tool-result') {
    console.log('\n>>> TOOL RESULT:', typeof part.result === 'string' ? part.result.slice(0, 100) : JSON.stringify(part.result).slice(0, 100));
  } else {
    console.log('\n>>> STREAM PART:', part.type);
  }
}

console.log('\n\nDone. Full text length:', fullText.length);
