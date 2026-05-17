/**
 * Audit Logger — writes structured JSON audit logs for security-sensitive actions.
 *
 * - Writes to {app.getPath('userData')}/audit-logs/audit-YYYY-MM-DD.jsonl
 * - Append-only JSONL format (one JSON object per line)
 * - Daily rotation by filename
 * - 10 MB max per file; when exceeded, renames to .1 and starts a new file
 * - Buffers writes and flushes every 5 seconds or on app.on('before-quit')
 * - Never includes raw secret values — only key names and masked previews
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';

// --- Interfaces ---

export interface AuditLogEntry {
  timestamp: string;       // ISO 8601
  action: string;          // e.g., 'k8s:deleteResource', 'ipc:validationFailure'
  category: 'READ' | 'MUTATE' | 'DESTRUCTIVE' | 'SECURITY';
  context?: string;        // cluster name
  namespace?: string;
  resourceKind?: string;
  resourceName?: string;
  result: string;          // 'success' or error message
}

export type AuditLogInput = Omit<AuditLogEntry, 'timestamp'>;

// --- Constants ---

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const FLUSH_INTERVAL_MS = 5_000; // 5 seconds
const AUDIT_LOG_DIR = 'audit-logs';

/**
 * Sensitive field patterns that must never appear in log entries.
 * Used to sanitize context/result fields before writing.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // AWS Access Key IDs
  /AKIA[0-9A-Z]{16}/g,
  // AWS Secret Access Keys (40-char base64)
  /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/=]{40}(?![A-Za-z0-9+/=])/g,
  // Generic API key/token patterns (Bearer tokens)
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // Gemini/OpenAI-style API keys
  /(?:sk-|AIza)[A-Za-z0-9\-_]{20,}/g,
];

// --- Helpers ---

function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sanitizeValue(value: string): string {
  let sanitized = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

function sanitizeEntry(entry: AuditLogEntry): AuditLogEntry {
  return {
    ...entry,
    action: sanitizeValue(entry.action),
    result: sanitizeValue(entry.result),
    context: entry.context ? sanitizeValue(entry.context) : undefined,
    namespace: entry.namespace ? sanitizeValue(entry.namespace) : undefined,
    resourceKind: entry.resourceKind ? sanitizeValue(entry.resourceKind) : undefined,
    resourceName: entry.resourceName ? sanitizeValue(entry.resourceName) : undefined,
  };
}

// --- AuditLogger Class ---

export class AuditLogger {
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private logDir: string;
  private initialized = false;

  constructor(logDir?: string) {
    this.logDir = logDir ?? path.join(app.getPath('userData'), AUDIT_LOG_DIR);
  }

  /**
   * Initialize the logger: create the log directory and start the flush timer.
   * Must be called before logging. Safe to call multiple times.
   */
  init(): void {
    if (this.initialized) return;

    // Ensure log directory exists
    fs.mkdirSync(this.logDir, { recursive: true });

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Swallow flush errors to avoid crashing the app
      });
    }, FLUSH_INTERVAL_MS);

    // Register before-quit handler
    app.on('before-quit', () => {
      this.flush().catch(() => {
        // Best-effort flush on quit
      });
    });

    this.initialized = true;
  }

  /**
   * Write an audit log entry. The timestamp is added automatically.
   * Entries are buffered and flushed periodically.
   */
  log(entry: AuditLogInput): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    const sanitized = sanitizeEntry(fullEntry);
    const line = JSON.stringify(sanitized);
    this.buffer.push(line);
  }

  /**
   * Flush all buffered entries to disk.
   * Handles daily rotation and 10 MB size enforcement.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Take the current buffer and reset
    const entries = this.buffer.splice(0, this.buffer.length);
    const content = entries.join('\n') + '\n';

    const filePath = this.getCurrentLogPath();

    // Ensure directory exists (in case it was deleted while running)
    fs.mkdirSync(this.logDir, { recursive: true });

    // Check file size and rotate if needed
    await this.rotateIfNeeded(filePath);

    // Append to file
    fs.appendFileSync(filePath, content, { encoding: 'utf-8' });
  }

  /**
   * Stop the flush timer and flush remaining entries.
   * Call this during graceful shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    this.initialized = false;
  }

  /**
   * Get the current log file path based on today's date.
   */
  private getCurrentLogPath(): string {
    const dateStr = getDateString();
    return path.join(this.logDir, `audit-${dateStr}.jsonl`);
  }

  /**
   * Rotate the log file if it exceeds the max size.
   * Renames the current file to .1 and starts fresh.
   */
  private async rotateIfNeeded(filePath: string): Promise<void> {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size >= MAX_FILE_SIZE_BYTES) {
        const rotatedPath = `${filePath}.1`;
        // If a .1 already exists, remove it (only keep one rotation)
        if (fs.existsSync(rotatedPath)) {
          fs.unlinkSync(rotatedPath);
        }
        fs.renameSync(filePath, rotatedPath);
      }
    } catch (err: unknown) {
      // File doesn't exist yet — no rotation needed
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      // For other errors, swallow and continue (best-effort logging)
    }
  }
}

// --- Singleton instance ---

let _instance: AuditLogger | null = null;

/**
 * Get the singleton AuditLogger instance.
 * Call `initAuditLogger()` first to initialize.
 */
export function getAuditLogger(): AuditLogger {
  if (!_instance) {
    _instance = new AuditLogger();
  }
  return _instance;
}

/**
 * Initialize the global AuditLogger singleton.
 * Should be called once during app startup.
 */
export function initAuditLogger(): AuditLogger {
  const logger = getAuditLogger();
  logger.init();
  return logger;
}
