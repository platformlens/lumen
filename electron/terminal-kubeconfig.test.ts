import { describe, it, expect } from 'vitest';
import * as yaml from 'js-yaml';
import { buildContextKubeconfig, buildKubeconfigEnv, isValidTerminalContext } from './terminal-kubeconfig';

describe('buildContextKubeconfig', () => {
    const contexts = [
        'arn:aws:eks:us-east-1:123456789012:cluster/prod',
        'admin@kind-dev',
        'my "quoted" context: with spaces',
        'kind-dev',
    ];

    for (const ctx of contexts) {
        it(`round-trips current-context for ${ctx}`, () => {
            const parsed = yaml.load(buildContextKubeconfig(ctx)) as Record<string, unknown>;
            expect(parsed['current-context']).toBe(ctx);
            expect(parsed.apiVersion).toBe('v1');
            expect(parsed.kind).toBe('Config');
        });
    }
});

describe('buildKubeconfigEnv', () => {
    it('falls back to ~/.kube/config when KUBECONFIG is unset', () => {
        expect(buildKubeconfigEnv('/tmp/o.yaml', undefined, '/Users/me', ':'))
            .toBe('/tmp/o.yaml:/Users/me/.kube/config');
    });

    it('falls back to ~/.kube/config when KUBECONFIG is empty', () => {
        expect(buildKubeconfigEnv('/tmp/o.yaml', '', '/Users/me', ':'))
            .toBe('/tmp/o.yaml:/Users/me/.kube/config');
    });

    it('prepends the override to a single existing entry', () => {
        expect(buildKubeconfigEnv('/tmp/o.yaml', '/etc/kube.yaml', '/Users/me', ':'))
            .toBe('/tmp/o.yaml:/etc/kube.yaml');
    });

    it('preserves multiple existing entries and drops empty segments', () => {
        expect(buildKubeconfigEnv('/tmp/o.yaml', '/a.yaml::/b.yaml:', '/Users/me', ':'))
            .toBe('/tmp/o.yaml:/a.yaml:/b.yaml');
    });

    it('honours a custom delimiter', () => {
        expect(buildKubeconfigEnv('C:\\o.yaml', 'C:\\a.yaml;C:\\b.yaml', 'C:\\Users\\me', ';'))
            .toBe('C:\\o.yaml;C:\\a.yaml;C:\\b.yaml');
    });
});

describe('isValidTerminalContext', () => {
    it('accepts normal context names', () => {
        expect(isValidTerminalContext('arn:aws:eks:us-east-1:123456789012:cluster/prod')).toBe(true);
        expect(isValidTerminalContext('admin@kind-dev')).toBe(true);
    });

    it('rejects empty, overlong and non-string values', () => {
        expect(isValidTerminalContext('')).toBe(false);
        expect(isValidTerminalContext('a'.repeat(513))).toBe(false);
        expect(isValidTerminalContext(undefined)).toBe(false);
        expect(isValidTerminalContext(42)).toBe(false);
    });

    it('rejects control characters', () => {
        expect(isValidTerminalContext('prod\nrm -rf')).toBe(false);
        expect(isValidTerminalContext('prod\x00')).toBe(false);
        expect(isValidTerminalContext('prod\x1b[31m')).toBe(false);
        expect(isValidTerminalContext('prod\x7f')).toBe(false);
    });
});
