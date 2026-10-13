/**
 * Canonical zod schemas for the read-only `crossplane:*` IPC channels (design B.8).
 * Pure: imports only zod and the shared types, so vitest can load it without Electron.
 * Every object schema is `.strict()`, so unknown keys are rejected.
 */
import { z } from 'zod';
import {
    API_VERSION, CROSSPLANE_CATEGORIES, DNS_LABEL, DNS_SUBDOMAIN, KIND, KIND_KEY, REF_LIMITS,
} from '../src/types/crossplane';

// Kube context names may contain ':', '/', '@' (EKS ARNs), so validateK8sParam is not used here.
export const contextSchema = z.string().min(1).max(REF_LIMITS.context).refine(s => !s.includes('\0'), 'NUL not allowed');

export const refSchema = z.object({
    apiVersion: z.string().max(REF_LIMITS.apiVersion).regex(API_VERSION),
    kind: z.string().min(1).max(REF_LIMITS.kind).regex(KIND),
    name: z.string().min(1).max(REF_LIMITS.name).regex(DNS_SUBDOMAIN),
    namespace: z.string().min(1).max(REF_LIMITS.namespace).regex(DNS_LABEL).optional(),
    category: z.enum(CROSSPLANE_CATEGORIES).optional(),
}).strict();

/** detect, getPackages, getDefinitions, getComposites, getManagedKinds, scanManaged */
export const contextOnlySchema = z.object({ context: contextSchema, force: z.boolean().optional() }).strict();

export const managedItemsSchema = z.object({
    context: contextSchema,
    kindKeys: z.array(z.string().max(REF_LIMITS.kindKey).regex(KIND_KEY)).min(1).max(REF_LIMITS.kindKeys),
    force: z.boolean().optional(),
}).strict();

export const warningEventsSchema = z.object({
    context: contextSchema,
    limit: z.number().int().min(1).max(200).optional(),
    force: z.boolean().optional(),
}).strict();

/** getResource, getTree */
export const refRequestSchema = z.object({ context: contextSchema, ref: refSchema }).strict();
