import { describe, it, expect } from 'vitest';
import { isSensitiveEnv, maskTemplateEnv, displayAnnotations, MASK, LAST_APPLIED } from './sensitive-value-utils';
import type { PodTemplate } from '../types/deployment-details';

describe('isSensitiveEnv', () => {
    it.each(['DB_PASSWORD', 'API_KEY', 'GITHUB_TOKEN', 'AUTH_HEADER', 'db_passwd', 'PRIVATE-KEY', 'SENTRY_DSN'])(
        'flags sensitive name %s', name => {
            expect(isSensitiveEnv(name, 'plain')).toBe(true);
        });

    it('does not flag ordinary names with ordinary values', () => {
        expect(isSensitiveEnv('LOG_LEVEL', 'debug')).toBe(false);
        expect(isSensitiveEnv('PORT', '8080')).toBe(false);
        expect(isSensitiveEnv('URL', 'https://example.com/path')).toBe(false);
    });

    it.each([
        'eyJhbGciOiJIUzI1NiJ9.payload.sig',
        'AKIAIOSFODNN7EXAMPLE',
        'sk-abc123',
        'ghp_abcdef',
        'Bearer x',
        'postgres://u:p@h',
    ])('flags sensitive value %s', value => {
        expect(isSensitiveEnv('SOME_VAR', value)).toBe(true);
    });
});

describe('maskTemplateEnv', () => {
    const template: PodTemplate = {
        metadata: { labels: { app: 'web' } },
        spec: {
            initContainers: [{ name: 'init', env: [{ name: 'INIT_TOKEN', value: 'abc' }, { name: 'MODE', value: 'x' }] }],
            containers: [{
                name: 'app',
                env: [
                    { name: 'DB_PASSWORD', value: 'hunter2' },
                    { name: 'LOG_LEVEL', value: 'info' },
                    { name: 'API_KEY', valueFrom: { secretKeyRef: { name: 's', key: 'k' } } },
                ],
            }],
        },
    };

    it('masks literal sensitive values in containers and initContainers, leaves valueFrom untouched', () => {
        const masked = maskTemplateEnv(template);
        expect(masked.spec?.containers[0].env?.[0].value).toBe(MASK);
        expect(masked.spec?.containers[0].env?.[1].value).toBe('info');
        expect(masked.spec?.containers[0].env?.[2]).toEqual({ name: 'API_KEY', valueFrom: { secretKeyRef: { name: 's', key: 'k' } } });
        expect(masked.spec?.initContainers?.[0].env?.[0].value).toBe(MASK);
        expect(masked.spec?.initContainers?.[0].env?.[1].value).toBe('x');
    });

    it('does not mutate its input', () => {
        const snapshot = JSON.parse(JSON.stringify(template));
        maskTemplateEnv(template);
        expect(template).toEqual(snapshot);
    });
});

describe('displayAnnotations', () => {
    it('hides last-applied-configuration with its UTF-8 byte count and keeps others verbatim and sorted', () => {
        const value = '{"a":"é"}'; // é is 2 bytes in UTF-8 -> 10 bytes total
        const out = displayAnnotations({ 'z.io/x': '1', [LAST_APPLIED]: value, 'a.io/y': '2' });
        expect(out).toEqual([
            { key: 'a.io/y', value: '2', hidden: false },
            { key: LAST_APPLIED, value: '(10 bytes, hidden; use Edit YAML)', hidden: true },
            { key: 'z.io/x', value: '1', hidden: false },
        ]);
    });

    it('emits one hidden placeholder from strippedBytes when the key is absent', () => {
        const out = displayAnnotations({ foo: 'bar' }, { strippedBytes: { [LAST_APPLIED]: 1234 } });
        expect(out.filter(e => e.key === LAST_APPLIED)).toEqual([
            { key: LAST_APPLIED, value: '(1234 bytes, hidden; use Edit YAML)', hidden: true },
        ]);
        expect(out).toHaveLength(2);
    });

    it('emits the key once when present in both (present value wins)', () => {
        const out = displayAnnotations({ [LAST_APPLIED]: 'abc' }, { strippedBytes: { [LAST_APPLIED]: 999 } });
        expect(out).toEqual([{ key: LAST_APPLIED, value: '(3 bytes, hidden; use Edit YAML)', hidden: true }]);
    });

    it('handles undefined annotations', () => {
        expect(displayAnnotations(undefined)).toEqual([]);
    });
});
