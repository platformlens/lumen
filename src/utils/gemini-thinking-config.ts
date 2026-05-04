/**
 * Enables Gemini thought summaries in the AI SDK stream (reasoning-* chunks → UI chain-of-thought).
 * Only models that support the Thinking API; omit for older IDs to avoid request errors.
 */
export type GeminiThinkingConfigOptions = {
  includeThoughts: true;
  thinkingBudget?: number;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
};

export function geminiThinkingConfigForModel(modelId: string): GeminiThinkingConfigOptions | undefined {
  const id = modelId.trim().toLowerCase();

  if (id.includes('gemma-')) return undefined;

  const legacyFlash =
    id.includes('gemini-1.5') ||
    id.includes('gemini-1.') ||
    (id.includes('gemini-2.0') && !id.includes('thinking'));

  if (legacyFlash && !id.includes('thinking')) return undefined;

  if (id.includes('gemini-3')) {
    return { includeThoughts: true, thinkingLevel: 'medium' };
  }

  if (
    id.includes('gemini-2.5') ||
    id.includes('thinking') ||
    id.includes('gemini-flash-latest') ||
    id.includes('gemini-pro-latest') ||
    id.includes('gemini-flash-lite-latest')
  ) {
    return { includeThoughts: true, thinkingBudget: 8192 };
  }

  return undefined;
}
