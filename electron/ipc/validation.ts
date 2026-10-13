/**
 * IPC Validation — wraps ipcMain.handle and ipcMain.on with zod schema validation.
 *
 * - safeHandle: validates inputs before invoking handler; rejects with descriptive error on failure
 * - safeOn: validates inputs before invoking handler; silently drops message on failure
 * - All validation failures are logged via AuditLogger with category SECURITY
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import { getAuditLogger } from '../security/audit-logger';

/**
 * Wrap ipcMain.handle with zod schema validation.
 *
 * On validation failure:
 * - Logs the violation via AuditLogger with category SECURITY
 * - Rejects the Promise with a descriptive error: "IPC validation failed: {channel} — {zod error}"
 *
 * On validation success:
 * - Passes the validated (parsed) args to the handler
 */
export function safeHandle<T extends z.ZodType>(
  channel: string,
  schema: T,
  handler: (event: Electron.IpcMainInvokeEvent, args: z.infer<T>) => Promise<unknown>
): void {
  ipcMain.handle(channel, async (event, ...rawArgs) => {
    // For IPC invoke, the args come as spread parameters.
    // We validate the first argument (or undefined if none provided).
    const input = rawArgs.length === 1 ? rawArgs[0] : rawArgs.length === 0 ? undefined : rawArgs;

    const result = schema.safeParse(input);

    if (!result.success) {
      const errorMessage = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');

      const fullError = `IPC validation failed: ${channel} — ${errorMessage}`;

      // Log via AuditLogger
      const logger = getAuditLogger();
      logger.log({
        action: `ipc:validationFailure`,
        category: 'SECURITY',
        result: fullError,
      });

      return Promise.reject(new Error(fullError));
    }

    return handler(event, result.data);
  });
}

/**
 * Wrap ipcMain.on with zod schema validation.
 *
 * On validation failure:
 * - Logs the violation via AuditLogger with category SECURITY
 * - Silently drops the message (no response channel for send)
 *
 * On validation success:
 * - Passes the validated (parsed) args to the handler
 */
export function safeOn<T extends z.ZodType>(
  channel: string,
  schema: T,
  handler: (event: Electron.IpcMainEvent, args: z.infer<T>) => void
): void {
  ipcMain.on(channel, (event, ...rawArgs) => {
    // For IPC send, the args come as spread parameters.
    const input = rawArgs.length === 1 ? rawArgs[0] : rawArgs.length === 0 ? undefined : rawArgs;

    const result = schema.safeParse(input);

    if (!result.success) {
      const errorMessage = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');

      const fullError = `IPC validation failed: ${channel} — ${errorMessage}`;

      // Log via AuditLogger
      const logger = getAuditLogger();
      logger.log({
        action: `ipc:validationFailure`,
        category: 'SECURITY',
        result: fullError,
      });

      // Silently drop the message — no response for ipcMain.on
      return;
    }

    handler(event, result.data);
  });
}
