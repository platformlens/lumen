/**
 * AI Tool definitions for agentic kubectl debugging.
 *
 * Tools use the Vercel AI SDK `tool()` with `execute` functions that support
 * human-in-the-loop approval. Auto-approved commands run immediately;
 * others wait for user approval via IPC.
 */
import { jsonSchema } from 'ai';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BrowserWindow } from 'electron';
import { KUBECTL_APPROVAL_TIMEOUT_MS } from '../src/constants/ai-kubectl-approval';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 12000;
const KUBECTL_TIMEOUT = 30000;

const READ_ONLY_VERBS = new Set([
  'get', 'describe', 'logs', 'top', 'explain', 'api-resources',
  'api-versions', 'cluster-info', 'config', 'version', 'auth',
  'diff', 'events', 'wait',
]);

const BLOCKED_PATTERNS = [
  /\bdelete\s+(namespace|ns)\b/i,
  /\bdelete\s+node\b/i,
  /--all-namespaces.*delete/i,
  /\bexec\b/i,
  /\bport-forward\b/i,
  /\bproxy\b/i,
  /\bcp\b/i,
  /\battach\b/i,
];

function isReadOnlyCommand(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const kubectlIdx = parts.findIndex(p => p === 'kubectl');
  const verb = parts[kubectlIdx + 1]?.toLowerCase();
  return verb ? READ_ONLY_VERBS.has(verb) : false;
}

function isBlockedCommand(command: string): boolean {
  return BLOCKED_PATTERNS.some(pattern => pattern.test(command));
}

export type ToolMode = 'off' | 'read' | 'read-write';

/**
 * Check if a command matches any trusted pattern.
 * Trusted patterns support prefix matching: "kubectl get" trusts all "kubectl get ..." commands.
 */
export function isAutoApproved(command: string, trustedCommands: string[]): boolean {
  const normalized = command.trim().toLowerCase();
  return trustedCommands.some(trusted => {
    const t = trusted.trim().toLowerCase();
    return normalized === t || normalized.startsWith(t + ' ');
  });
}

/**
 * Execute a raw kubectl command.
 */
async function runKubectl(command: string, context: string | undefined): Promise<string> {
  const parts = command.trim().split(/\s+/);
  const args = parts[0] === 'kubectl' ? parts.slice(1) : parts;

  if (context && !args.includes('--context')) {
    args.unshift('--context', context);
  }

  try {
    const { stdout, stderr } = await execFileAsync('kubectl', args, {
      timeout: KUBECTL_TIMEOUT,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    });

    let output = stdout || '';
    if (stderr && !stdout) output = stderr;

    if (output.length > MAX_OUTPUT_CHARS) {
      output = output.slice(0, MAX_OUTPUT_CHARS) + `\n\n... (truncated, ${output.length} total chars)`;
    }

    return output || '(no output)';
  } catch (err: any) {
    const message = err.stderr || err.message || String(err);
    return `Error executing kubectl: ${message.slice(0, 2000)}`;
  }
}

export interface ToolApprovalRequest {
  toolCallId: string;
  command: string;
  isReadOnly: boolean;
}

export interface BuildKubectlToolsOptions {
  /** Stream markdown hints to the renderer while kubectl waits (approval / exec / latency). */
  onAgentHint?: (markdownChunk: string) => void;
}

/**
 * Build tool definitions with execute functions that support human-in-the-loop.
 *
 * The execute function checks:
 * 1. Is the command blocked? → reject
 * 2. Is the command outside the allowed mode? → reject
 * 3. Is the command auto-approved (trusted list)? → execute immediately
 * 4. Otherwise → ask the user via IPC and wait for approval
 */
export function buildKubectlTools(
  clusterContext: string | undefined,
  mode: ToolMode,
  trustedCommands: string[],
  win: BrowserWindow | null,
  options?: BuildKubectlToolsOptions,
) {
  if (mode === 'off') return undefined;

  const hint = options?.onAgentHint;

  // Pending approval resolvers keyed by toolCallId
  const pendingApprovals = new Map<string, {
    resolve: (approved: boolean) => void;
    command: string;
    timer: ReturnType<typeof setTimeout> | null;
  }>();

  const executeKubectl = async ({ command }: { command: string }): Promise<string> => {
    console.log(`[AI Tool] kubectl requested: ${command}`);

    if (isBlockedCommand(command)) {
      return `⛔ Command blocked for safety: "${command}". This command type is not allowed.`;
    }
    if (mode === 'read' && !isReadOnlyCommand(command)) {
      return `⛔ Command blocked: "${command}" is a write operation. Tool calling is in read-only mode.`;
    }

    const readOnly = isReadOnlyCommand(command);

    if (isAutoApproved(command, trustedCommands)) {
      console.log(`[AI Tool] Auto-approved (trusted): ${command}`);
      hint?.('\n\n*Executing kubectl against the cluster…*\n\n');
      return runKubectl(command, clusterContext);
    }

    const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    hint?.('\n\n*Waiting for your approval in the panel below…*\n\n');

    let approvalTimedOut = false;
    const approved = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const pending = pendingApprovals.get(toolCallId);
        if (!pending) return;
        approvalTimedOut = true;
        pendingApprovals.delete(toolCallId);
        console.warn(
          `[AI Tool] kubectl approval timed out after ${KUBECTL_APPROVAL_TIMEOUT_MS}ms:`,
          command
        );
        hint?.(
          '\n\n*Approval timed out. The assistant was told the command was not approved in time.*\n\n'
        );
        resolve(false);
      }, KUBECTL_APPROVAL_TIMEOUT_MS);

      pendingApprovals.set(toolCallId, { resolve, command, timer });

      win?.webContents.send('ai:toolApprovalRequest', {
        toolCallId,
        command,
        isReadOnly: readOnly,
      } satisfies ToolApprovalRequest);
    });

    if (!approved) {
      if (approvalTimedOut) {
        return `⏱️ Approval timed out (no response within ${KUBECTL_APPROVAL_TIMEOUT_MS / 60_000} minutes). Command was not run: "${command}"`;
      }
      return `⛔ Command rejected by user: "${command}"`;
    }

    console.log(`[AI Tool] User approved: ${command}`);
    hint?.('\n\n*Executing kubectl against the cluster…*\n\n');
    return runKubectl(command, clusterContext);
  };

  const toolDescription = `Execute a kubectl command against the user's Kubernetes cluster to gather information for debugging. ${
    mode === 'read'
      ? 'Only read-only commands are allowed (get, describe, logs, top, explain, events, etc.).'
      : 'Both read and write commands are allowed. Use write commands only when the user explicitly asks.'
  } Always use this tool to look up real cluster state rather than guessing. You can call this tool multiple times.`;

  const tools = {
    kubectl: {
      type: 'function' as const,
      description: toolDescription,
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          command: {
            type: 'string' as const,
            description: 'The full kubectl command, e.g. "kubectl get pods -n kube-system", "kubectl describe deployment my-app", "kubectl logs deployment/my-app --tail=100"'
          }
        },
        required: ['command'] as const,
      }),
      execute: executeKubectl,
    },
  };

  // Return tools + a function to resolve pending approvals (called from IPC handler)
  return {
    tools,
    resolvePendingApproval: (toolCallId: string, approved: boolean, _trust: boolean) => {
      const pending = pendingApprovals.get(toolCallId);
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        pendingApprovals.delete(toolCallId);
        pending.resolve(approved);
      }
      return pending?.command;
    },
  };
}

/**
 * System prompt addition for tool-calling mode.
 */
export function buildToolSystemPrompt(mode: ToolMode): string {
  if (mode === 'off') return '';

  const modeDesc = mode === 'read'
    ? 'You have access to a kubectl tool that can execute READ-ONLY commands (get, describe, logs, top, events, etc.) against the user\'s cluster.'
    : 'You have access to a kubectl tool that can execute both read and write commands against the user\'s cluster. Only use write commands when the user explicitly asks for changes.';

  return `\n\n--- AGENTIC TOOLS ---
${modeDesc}

IMPORTANT: You MUST use the kubectl tool to gather real data. Do NOT fabricate or simulate command output. Do NOT write fake tool call XML or markdown — use the actual tool.

When debugging issues:
1. Start by gathering relevant information using kubectl (get resources, describe them, check logs, check events)
2. Make multiple tool calls as needed to build a complete picture
3. After gathering data, provide a thorough analysis with root cause and remediation steps

When the user asks you to fix something (and write mode is enabled):
1. First diagnose the issue with read commands
2. Explain what you found and what you plan to do
3. Then execute the fix with write commands
4. Verify the fix worked with follow-up read commands
--- END AGENTIC TOOLS ---`;
}
