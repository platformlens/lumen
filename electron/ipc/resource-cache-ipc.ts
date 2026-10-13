/**
 * Resource cache IPC (design §5.1): six zod-validated invoke channels over WatchManager.
 */
import { z } from 'zod';
import type { EnsureFreshResult, ResourceCacheChannel, ResourceCacheDiagnostics } from '../../src/types/resource-cache';
import type { Subscriber } from '../resource-cache/coalescer';
import type { WatchManager } from '../resource-cache/watch-manager';
import { safeHandle } from './validation';

export const NamespacesSchema = z
  .array(z.union([z.literal('all'), z.string().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/).max(63)]))
  .min(1)
  .max(100);

export const StartSessionSchema = z.object({
  context: z.string().min(1).max(253),
  namespaces: NamespacesSchema.optional(),
});

export const SetNamespacesSchema = z.object({ namespaces: NamespacesSchema });

const CHANNELS: readonly ResourceCacheChannel[] = ['startSession', 'subscribe', 'stopSession', 'setNamespaces', 'ensureFresh', 'getDiagnostics'];

export interface ResourceCacheIpcOptions {
  /** Dev-only diagnostics: getDiagnostics returns null when false (packaged builds). */
  diagnosticsEnabled: boolean;
}

function toSubscriber(sender: Electron.WebContents): Subscriber {
  return {
    id: sender.id,
    isDestroyed: () => sender.isDestroyed(),
    send: (channel, batch) => sender.send(channel, batch),
  };
}

export function registerResourceCacheIpc(manager: WatchManager, opts: ResourceCacheIpcOptions): void {
  const invokeCounts = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<ResourceCacheChannel, number>;
  const registered = new Set<ResourceCacheChannel>();
  const handle = <T extends z.ZodType>(name: ResourceCacheChannel, schema: T, fn: (e: Electron.IpcMainInvokeEvent, args: z.infer<T>) => Promise<unknown>) => {
    safeHandle(`resources:${name}`, schema, async (event, args) => {
      invokeCounts[name]++;
      return fn(event, args);
    });
    registered.add(name);
  };

  handle('startSession', StartSessionSchema, async (event, args) => manager.startSession(args, toSubscriber(event.sender)));
  handle('subscribe', z.undefined(), async (event) => manager.subscribe(toSubscriber(event.sender)));
  handle('stopSession', z.undefined(), async () => {
    manager.stopSession('renderer');
    return true;
  });
  handle('setNamespaces', SetNamespacesSchema, async (_event, args) => {
    manager.setNamespaces(args.namespaces);
    return true;
  });
  handle('ensureFresh', z.undefined(), async (event): Promise<EnsureFreshResult> => {
    manager.ensureFresh(300_000);
    // Lets the renderer rebind if main lost its subscriber (e.g. an unbind it never saw).
    return { bound: manager.isBoundTo(event.sender.id) };
  });
  handle('getDiagnostics', z.undefined(), async (): Promise<ResourceCacheDiagnostics | null> => {
    if (!opts.diagnosticsEnabled) return null;
    const base = await manager.getDiagnostics();
    const handlersRegistered = Object.fromEntries(CHANNELS.map((c) => [c, registered.has(c)])) as Record<ResourceCacheChannel, boolean>;
    return { ...base, invokeCounts: { ...invokeCounts }, handlersRegistered };
  });
}
