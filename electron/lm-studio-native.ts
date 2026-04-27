/**
 * LM Studio native REST API: POST /api/v1/chat with stream: true (SSE).
 * @see https://lmstudio.ai/docs/developer/rest/streaming-events
 */

import { AI_THINK_CLOSE, AI_THINK_OPEN } from '../src/utils/ai-thinking';

export function normalizeLmStudioRestBase(openAiCompatBaseUrl: string): string {
  const u = openAiCompatBaseUrl.trim().replace(/\/+$/, '');
  if (u.endsWith('/v1')) return u.slice(0, -3);
  return u;
}

export function buildLmStudioConversationInput(
  system: string,
  messages: Array<{ role: string; content: string }>
): string {
  const parts: string[] = [];
  if (system.trim()) parts.push(`[System]\n${system.trim()}`);
  for (const m of messages) {
    const label =
      m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : m.role;
    parts.push(`[${label}]\n${m.content}`);
  }
  return parts.join('\n\n');
}

export function buildLmStudioSingleTurnInput(system: string, user: string): string {
  if (system.trim()) return `[System]\n${system.trim()}\n\n[User]\n${user}`;
  return user;
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let eventName = '';
  const dataParts: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataParts.push(line.slice(5).trimStart());
  }
  const data = dataParts.join('\n');
  if (!data) return null;
  return { event: eventName, data };
}

async function consumeLmStudioSse(
  body: ReadableStream<Uint8Array>,
  onChunk: (s: string) => void,
  signal: AbortSignal | undefined
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let reasoningOpen = false;

  const closeReasoning = () => {
    if (reasoningOpen) {
      onChunk(AI_THINK_CLOSE);
      full += AI_THINK_CLOSE;
      reasoningOpen = false;
    }
  };

  const routeEvent = (eventName: string, rawData: string) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return;
    }
    const dataType = typeof parsed.type === 'string' ? parsed.type : '';
    const ev = eventName || dataType;

    if (ev === 'reasoning.start' || dataType === 'reasoning.start') {
      if (!reasoningOpen) {
        onChunk(AI_THINK_OPEN);
        full += AI_THINK_OPEN;
        reasoningOpen = true;
      }
      return;
    }

    if (ev === 'reasoning.delta' || dataType === 'reasoning.delta') {
      const c = typeof parsed.content === 'string' ? parsed.content : '';
      if (!c) return;
      if (!reasoningOpen) {
        onChunk(AI_THINK_OPEN);
        full += AI_THINK_OPEN;
        reasoningOpen = true;
      }
      onChunk(c);
      full += c;
      return;
    }

    if (ev === 'reasoning.end' || dataType === 'reasoning.end') {
      closeReasoning();
      return;
    }

    if (ev === 'message.delta' || dataType === 'message.delta') {
      const c = typeof parsed.content === 'string' ? parsed.content : '';
      if (!c) return;
      closeReasoning();
      onChunk(c);
      full += c;
      return;
    }

    if (ev === 'error' || dataType === 'error') {
      const errObj = parsed.error as { message?: string } | undefined;
      throw new Error(errObj?.message || 'LM Studio reported an error during streaming');
    }
  };

  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const m = buffer.match(/\r?\n\r?\n/);
        if (!m || m.index === undefined) break;
        const idx = m.index;
        const sepLen = m[0].length;
        const rawBlock = buffer.slice(0, idx);
        buffer = buffer.slice(idx + sepLen);
        const parsed = parseSseBlock(rawBlock);
        if (parsed) routeEvent(parsed.event, parsed.data);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (reasoningOpen) {
    onChunk(AI_THINK_CLOSE);
    full += AI_THINK_CLOSE;
  }

  return full;
}

export async function listLmStudioModels(
  openAiCompatBaseUrl: string,
  apiToken?: string
): Promise<Array<{ id: string; name: string }>> {
  const base = normalizeLmStudioRestBase(openAiCompatBaseUrl);
  const headers: Record<string, string> = {};
  if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
  const res = await fetch(`${base}/api/v1/models`, { headers });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    models?: Array<{ type?: string; key: string; display_name?: string }>;
  };
  return (data.models || [])
    .filter((m) => m.type !== 'embedding')
    .map((m) => ({
      id: m.key,
      name: m.display_name || m.key,
    }));
}

export async function streamLmStudioChat(options: {
  openAiCompatBaseUrl: string;
  apiToken?: string;
  model: string;
  input: string;
  signal?: AbortSignal;
  onChunk: (s: string) => void;
  temperature?: number;
  contextLength?: number;
}): Promise<string> {
  const base = normalizeLmStudioRestBase(options.openAiCompatBaseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (options.apiToken) headers['Authorization'] = `Bearer ${options.apiToken}`;

  const body = {
    model: options.model,
    input: options.input,
    stream: true,
    store: false,
    temperature: options.temperature ?? 0.7,
    context_length: options.contextLength ?? 65536,
  };

  const res = await fetch(`${base}/api/v1/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LM Studio chat failed (${res.status}): ${t.slice(0, 800)}`);
  }

  if (!res.body) throw new Error('LM Studio: empty response body');

  return consumeLmStudioSse(res.body, options.onChunk, options.signal);
}
