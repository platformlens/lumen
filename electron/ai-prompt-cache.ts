import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { ModelMessage } from 'ai';

/** Rough lower bound aligned with Gemini explicit-cache minimums (~1024+ tokens). */
const GEMINI_EXPLICIT_CACHE_MIN_CHARS = 4096;

/** Bedrock / Anthropic prompt cache typically needs ~1024+ tokens on the cached block. */
const BEDROCK_ANTHROPIC_CACHE_MIN_CHARS = 4096;

type GeminiCacheEntry = { name: string; expiresAtMs: number };

const geminiExplicitCache = new Map<string, GeminiCacheEntry>();

export function isAnthropicBedrockModel(modelId: string): boolean {
  return /anthropic\.claude/i.test(modelId);
}

/**
 * Explicit Gemini context cache (AI SDK: providerOptions.google.cachedContent).
 * Matches https://ai-sdk.dev — create via @google/genai, consume via streamText/generateText.
 */
export async function getOrCreateGeminiExplicitCachedContentName(
  apiKey: string,
  modelId: string,
  cachedPrefixText: string,
  abortSignal?: AbortSignal
): Promise<string | null> {
  if (cachedPrefixText.length < GEMINI_EXPLICIT_CACHE_MIN_CHARS) return null;

  const key = createHash('sha256').update(modelId).update('\0').update(cachedPrefixText).digest('hex');
  const now = Date.now();
  const existing = geminiExplicitCache.get(key);
  if (existing && existing.expiresAtMs > now + 30_000) {
    return existing.name;
  }

  const ai = new GoogleGenAI({ apiKey });
  try {
    const cache = await ai.caches.create({
      model: modelId,
      config: {
        contents: [
          {
            role: 'user',
            parts: [{ text: cachedPrefixText }],
          },
        ],
        displayName: `lumen-${key.slice(0, 12)}`,
        ttl: '3600s',
        abortSignal,
      },
    });
    if (!cache.name) return null;

    const expiresAtMs = cache.expireTime
      ? Date.parse(cache.expireTime)
      : now + 3_600_000;
    geminiExplicitCache.set(key, { name: cache.name, expiresAtMs: expiresAtMs - 60_000 });
    return cache.name;
  } catch (err) {
    console.warn('[AI] Gemini explicit cache create failed; using non-cached request.', err);
    return null;
  }
}

/** First system message + history; optional Anthropic ephemeral cache on Bedrock Claude. */
export function bedrockMessagesWithOptionalCache(
  enhancedSystemPrompt: string,
  historyMessages: ModelMessage[]
): ModelMessage[] {
  const useCache = enhancedSystemPrompt.length >= BEDROCK_ANTHROPIC_CACHE_MIN_CHARS;
  const systemMsg: ModelMessage = {
    role: 'system',
    content: enhancedSystemPrompt,
    ...(useCache
      ? {
          providerOptions: {
            anthropic: {
              cacheControl: { type: 'ephemeral', ttl: '5m' },
            },
          },
        }
      : {}),
  };
  return [systemMsg, ...historyMessages];
}
