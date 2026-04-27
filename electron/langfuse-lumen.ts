import { LangfuseClient } from '@langfuse/client';
import type { LanguageModelUsage } from 'ai';
import { withTimeout } from '../src/lib/with-timeout';
import { CHAT_SYSTEM_PROMPT } from './prompts';

/**
 * Text prompt name in Langfuse (must match the prompt you created, e.g. `chat-system-prompt`).
 * See `label` + `cacheTtlSeconds` on `prompt.get` below.
 */
export const CHAT_SYSTEM_PROMPT_NAME = 'chat-system-prompt';

const PROMPT_LABEL = 'production';

/** Default 10 minutes. SDK caches the fetched prompt; `compile()` stays local. Set `LANGFUSE_PROMPT_CACHE_TTL_SECONDS` to tune (0 disables SDK cache). */
const DEFAULT_PROMPT_CACHE_TTL_SEC = 600;

function getPromptCacheTtlSeconds(): number {
  const raw = process.env.LANGFUSE_PROMPT_CACHE_TTL_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_PROMPT_CACHE_TTL_SEC;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PROMPT_CACHE_TTL_SEC;
}

const PROMPT_FALLBACK = `${CHAT_SYSTEM_PROMPT}\n\n{{resource_context}}`;

let client: LangfuseClient | null | undefined;

export function getLangfuseClient(): LangfuseClient | null {
  if (client === undefined) {
    if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
      client = null;
    } else {
      client = new LangfuseClient();
    }
  }
  return client;
}

export function buildChatResourceContextSuffix(options: {
  resourceContext?: { name: string; type: string; namespace?: string };
  resourceName?: string;
  resourceType?: string;
}): string {
  const ctx =
    options.resourceContext ||
    (options.resourceName
      ? { name: options.resourceName, type: options.resourceType || 'Unknown' }
      : undefined);
  if (!ctx) return '';
  let s = `\n\nCurrent Context:\n- Resource: ${ctx.type} "${ctx.name}"`;
  if (ctx.namespace) s += `\n- Namespace/Container: ${ctx.namespace}`;
  return s;
}

export type LumenChatPromptRef = {
  name: string;
  version: number;
  isFallback: boolean;
};

/**
 * Resolves the base chat system string using Langfuse prompt management when configured.
 * Falls back to the system prompt supplied by the renderer (same as today).
 */
export async function resolveLumenChatSystemBase(
  options: {
    resourceContext?: { name: string; type: string; namespace?: string };
    resourceName?: string;
    resourceType?: string;
  },
  systemPromptFromRenderer: string
): Promise<{ baseSystem: string; promptRef: LumenChatPromptRef | null }> {
  if (process.env.LANGFUSE_PROMPTS_DISABLE === '1' || process.env.LANGFUSE_PROMPTS_DISABLE === 'true') {
    return { baseSystem: systemPromptFromRenderer, promptRef: null };
  }
  const langfuse = getLangfuseClient();
  if (!langfuse) {
    return { baseSystem: systemPromptFromRenderer, promptRef: null };
  }
  const resourceContext = buildChatResourceContextSuffix(options);
  try {
    const p = await withTimeout(
      langfuse.prompt.get(CHAT_SYSTEM_PROMPT_NAME, {
        label: PROMPT_LABEL,
        type: 'text',
        cacheTtlSeconds: getPromptCacheTtlSeconds(),
        fetchTimeoutMs: 20_000,
        fallback: PROMPT_FALLBACK,
      }),
      4_000,
      'langfuse prompt.get'
    );
    const baseSystem = p.compile({ resource_context: resourceContext });
    return {
      baseSystem,
      promptRef: { name: p.name, version: p.version, isFallback: p.isFallback },
    };
  } catch (e) {
    console.warn('[Langfuse] lumen chat prompt failed, using local system prompt:', e);
    return { baseSystem: systemPromptFromRenderer, promptRef: null };
  }
}

/** Map Vercel AI SDK usage to Langfuse generation `usageDetails`. */
export function mapAiUsageToLangfuse(usage: LanguageModelUsage | undefined): Record<string, number> | undefined {
  if (!usage) return undefined;
  const d: Record<string, number> = {};
  if (usage.inputTokens != null) d.input = usage.inputTokens;
  if (usage.outputTokens != null) d.output = usage.outputTokens;
  if (usage.totalTokens != null) d.total = usage.totalTokens;
  return Object.keys(d).length > 0 ? d : undefined;
}
