/**
 * Registers the ten read-only `crossplane:*` IPC channels (design B.8). Each input is validated by the
 * `.strict()` zod schemas through safeHandle (audit-logged on failure); ref fields additionally go through
 * validateK8sParam and the Secret refusal inside CrossplaneService (defence in depth).
 */
import { safeHandle } from './ipc/validation';
import {
    contextOnlySchema, managedItemsSchema, refRequestSchema, warningEventsSchema,
} from './crossplane-ipc-schemas';
import type { CrossplaneService } from './crossplane';

export function registerCrossplaneIpc(service: CrossplaneService): void {
    safeHandle('crossplane:detect', contextOnlySchema, async (_e, a) => service.detect(a.context, { force: a.force }));
    safeHandle('crossplane:getPackages', contextOnlySchema, async (_e, a) => service.getPackages(a.context, { force: a.force }));
    safeHandle('crossplane:getDefinitions', contextOnlySchema, async (_e, a) => service.getDefinitions(a.context, { force: a.force }));
    safeHandle('crossplane:getComposites', contextOnlySchema, async (_e, a) => service.getComposites(a.context, { force: a.force }));
    safeHandle('crossplane:getManagedKinds', contextOnlySchema, async (_e, a) => service.getManagedKinds(a.context, { force: a.force }));
    safeHandle('crossplane:scanManaged', contextOnlySchema, async (_e, a) => service.scanManaged(a.context, { force: a.force }));
    safeHandle('crossplane:getManagedItems', managedItemsSchema, async (_e, a) =>
        service.getManagedItems(a.context, a.kindKeys, { force: a.force }));
    safeHandle('crossplane:getWarningEvents', warningEventsSchema, async (_e, a) =>
        service.getWarningEvents(a.context, { limit: a.limit, force: a.force }));
    safeHandle('crossplane:getResource', refRequestSchema, async (_e, a) => service.getResource(a.context, a.ref));
    safeHandle('crossplane:getTree', refRequestSchema, async (_e, a) => service.getTree(a.context, a.ref));
}
