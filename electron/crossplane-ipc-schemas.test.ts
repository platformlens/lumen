import { describe, expect, it } from 'vitest';
import { contextOnlySchema, managedItemsSchema, refRequestSchema, warningEventsSchema } from './crossplane-ipc-schemas';
import { SECRET_REFUSAL } from './crossplane';
import { harness } from './__fixtures__/crossplane-service-harness';

const ref = { apiVersion: 'ec2.example.io/v1beta1', kind: 'VPC', name: 'vpc-1' };

describe('crossplane IPC schemas', () => {
    it('accepts valid input', () => {
        expect(contextOnlySchema.safeParse({ context: 'arn:aws:eks:eu-west-1:123:cluster/a', force: true }).success).toBe(true);
        expect(managedItemsSchema.safeParse({ context: 'c', kindKeys: ['ec2.example.io/v1beta1/vpcs'] }).success).toBe(true);
        expect(warningEventsSchema.safeParse({ context: 'c', limit: 200 }).success).toBe(true);
        expect(refRequestSchema.safeParse({ context: 'c', ref: { ...ref, namespace: 'team', category: 'managed' } }).success).toBe(true);
    });

    it('rejects malformed input', () => {
        expect(contextOnlySchema.safeParse(undefined).success).toBe(false);
        expect(contextOnlySchema.safeParse({ context: '' }).success).toBe(false);
        expect(contextOnlySchema.safeParse({ context: 'a\0b' }).success).toBe(false);
        expect(contextOnlySchema.safeParse({ context: 'c', force: 'yes' }).success).toBe(false);
        expect(managedItemsSchema.safeParse({ context: 'c', kindKeys: [] }).success).toBe(false);
        expect(managedItemsSchema.safeParse({ context: 'c', kindKeys: ['ec2.example.io//vpcs'] }).success).toBe(false);
        expect(managedItemsSchema.safeParse({ context: 'c', kindKeys: Array(51).fill('a.io/v1/b') }).success).toBe(false);
        expect(warningEventsSchema.safeParse({ context: 'c', limit: 0 }).success).toBe(false);
        expect(warningEventsSchema.safeParse({ context: 'c', limit: 201 }).success).toBe(false);
        expect(refRequestSchema.safeParse({ context: 'c', ref: { ...ref, name: '../etc' } }).success).toBe(false);
        expect(refRequestSchema.safeParse({ context: 'c', ref: { ...ref, namespace: '' } }).success).toBe(false);
        expect(refRequestSchema.safeParse({ context: 'c', ref: { ...ref, category: 'pod' } }).success).toBe(false);
    });

    it('rejects extra keys at every level', () => {
        expect(contextOnlySchema.safeParse({ context: 'c', extra: 1 }).success).toBe(false);
        expect(refRequestSchema.safeParse({ context: 'c', ref: { ...ref, type: 'crossplane' } }).success).toBe(false);
        expect(refRequestSchema.safeParse({ context: 'c', ref, more: true }).success).toBe(false);
    });

    it('lets a structurally valid Secret ref through the schema, and the handler logic refuses it', async () => {
        const input = { context: 'test', ref: { apiVersion: 'v1', kind: 'Secret', name: 'creds', namespace: 'crossplane-system' } };
        const parsed = refRequestSchema.safeParse(input);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        const { service, api } = harness();
        await expect(service.getResource(parsed.data.context, parsed.data.ref)).rejects.toThrow(SECRET_REFUSAL);
        await expect(service.getTree(parsed.data.context, parsed.data.ref)).rejects.toThrow(SECRET_REFUSAL);
        expect(api.requestCount()).toBe(0);
    });
});
