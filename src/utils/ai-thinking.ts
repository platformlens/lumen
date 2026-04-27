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

function parseWithPair(
  content: string,
  open: string,
  close: string
): { thinking: string | null; response: string } | null {
  const thinkStart = content.indexOf(open);
  if (thinkStart === -1) return null;

  const innerStart = thinkStart + open.length;
  const thinkEnd = content.indexOf(close, innerStart);

  if (thinkEnd !== -1) {
    return {
      thinking: content.slice(innerStart, thinkEnd).trim(),
      response: content.slice(thinkEnd + close.length).trim(),
    };
  }

  return {
    thinking: content.slice(innerStart).trim(),
    response: '',
  };
}

export function parseAssistantThinking(content: string): {
  thinking: string | null;
  response: string;
} {
  for (const [open, close] of THINKING_TAG_PAIRS) {
    const parsed = parseWithPair(content, open, close);
    if (parsed) return parsed;
  }
  return { thinking: null, response: content };
}

/** True while a supported thinking block is open (streaming). */
export function hasUnclosedThinkingBlock(content: string): boolean {
  for (const [open, close] of THINKING_TAG_PAIRS) {
    const start = content.lastIndexOf(open);
    if (start === -1) continue;
    const after = content.indexOf(close, start + open.length);
    if (after === -1) return true;
  }
  return false;
}

/** Assistant turns sent back to the model should omit the thinking envelope. */
export function assistantContentForModelHistory(content: string): string {
  const { response, thinking } = parseAssistantThinking(content);
  if (thinking !== null) return response;
  return content;
}
