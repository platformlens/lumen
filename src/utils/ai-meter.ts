import type { LanguageModelUsage } from "ai";

/** Serialized token usage included with ai:customPromptStream:done (Gemini / AI SDK). */
export type AiStreamUsagePayload = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

/** Running Gemini totals for the current assistant panel session (summed per completion). */
export type GeminiSessionMeter = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
};

export const EMPTY_GEMINI_METER: GeminiSessionMeter = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

export function addGeminiMeter(
  prev: GeminiSessionMeter,
  payload?: AiStreamUsagePayload
): GeminiSessionMeter {
  if (!payload) return prev;
  return {
    inputTokens: prev.inputTokens + (payload.inputTokens ?? 0),
    outputTokens: prev.outputTokens + (payload.outputTokens ?? 0),
    reasoningTokens: prev.reasoningTokens + (payload.reasoningTokens ?? 0),
    cachedInputTokens:
      prev.cachedInputTokens + (payload.cachedInputTokens ?? 0),
  };
}

export function geminiMeterToUsage(m: GeminiSessionMeter): Partial<LanguageModelUsage> {
  return {
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    reasoningTokens: m.reasoningTokens,
    cachedInputTokens: m.cachedInputTokens,
    totalTokens: m.inputTokens + m.outputTokens + m.reasoningTokens,
  };
}
