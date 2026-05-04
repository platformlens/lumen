/**
 * Envelope emitted by accumulateStreamWithReasoning in electron/main.ts for SDK reasoning parts.
 * Import these constants in main — do not duplicate literals there.
 */
export const AI_THINK_OPEN = '<' + 'redacted_thinking' + '>';
export const AI_THINK_CLOSE = '</' + 'redacted_thinking' + '>';

/** Order: most specific / our IPC envelope first; then common local / OSS model formats in plain text. */
const THINK_HARMONY_OPEN = '<' + 'think' + '>';
const THINK_HARMONY_CLOSE = '<' + '/' + 'think' + '>';

const THINKING_TAG_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [AI_THINK_OPEN, AI_THINK_CLOSE],
  [THINK_HARMONY_OPEN, THINK_HARMONY_CLOSE],
];

/**
 * Strip every closed envelope for one tag pair; handle one trailing unclosed envelope at the end.
 */
function parseAssistantThinkingWithPair(content: string, open: string, close: string): {
  thinking: string | null;
  response: string;
} | null {
  const segments: string[] = [];
  let responseChars: string[] = [];
  let i = 0;

  while (i < content.length) {
    const idx = content.indexOf(open, i);
    if (idx === -1) {
      responseChars.push(content.slice(i));
      break;
    }
    responseChars.push(content.slice(i, idx));
    const innerStart = idx + open.length;
    const endIdx = content.indexOf(close, innerStart);
    if (endIdx === -1) {
      segments.push(content.slice(innerStart).trim());
      i = content.length;
      break;
    }
    segments.push(content.slice(innerStart, endIdx).trim());
    i = endIdx + close.length;
  }

  const response = responseChars.join('').trim();
  if (segments.length === 0) return null;
  return {
    thinking: segments.filter(Boolean).join('\n\n---\n\n'),
    response,
  };
}

export function parseAssistantThinking(content: string): {
  thinking: string | null;
  response: string;
} {
  for (const [open, close] of THINKING_TAG_PAIRS) {
    const parsed = parseAssistantThinkingWithPair(content, open, close);
    if (parsed != null) return parsed;
  }
  return { thinking: null, response: content };
}

/** True while a supported thinking block is open (streaming). */
export function hasUnclosedThinkingBlock(content: string): boolean {
  for (const [open, close] of THINKING_TAG_PAIRS) {
    let pos = 0;
    while (true) {
      const start = content.indexOf(open, pos);
      if (start === -1) break;
      const afterOpen = start + open.length;
      const end = content.indexOf(close, afterOpen);
      if (end === -1) return true;
      pos = end + close.length;
    }
  }
  return false;
}

/** Assistant turns sent back to the model should omit the thinking envelope(s). */
export function assistantContentForModelHistory(content: string): string {
  const { response, thinking } = parseAssistantThinking(content);
  if (thinking !== null) return response;
  return content;
}
