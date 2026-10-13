import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { diffPodTemplates, summarizeChanges, type TemplateChange } from './pod-template-diff-utils';
import { MASK } from './sensitive-value-utils';
import type { PodTemplate } from '../types/deployment-details';

type Env = { name: string; value?: string; valueFrom?: { configMapKeyRef?: { name: string; key: string } } };

function tpl(opts: {
    image?: string; env?: Env[]; limitsMemory?: string; labels?: Record<string, string>;
    annotations?: Record<string, string>; init?: { name: string; image: string }[]; containers?: { name: string; image: string }[];
} = {}): PodTemplate {
    return {
        metadata: { labels: opts.labels ?? { app: 'web' }, annotations: opts.annotations },
        spec: {
            initContainers: opts.init,
            containers: opts.containers ?? [{
                name: 'app',
                image: opts.image ?? 'web:v1',
                env: opts.env,
                resources: opts.limitsMemory ? { limits: { memory: opts.limitsMemory } } : undefined,
            }],
        },
    };
}

describe('diffPodTemplates', () => {
    it('masks a changed sensitive env value', () => {
        const changes = diffPodTemplates(tpl({ env: [{ name: 'DB_PASSWORD', value: 'a' }] }), tpl({ env: [{ name: 'DB_PASSWORD', value: 'b' }] }));
        expect(changes).toEqual([{
            kind: 'changed', scope: 'container', container: 'app', containerKind: 'main',
            field: 'env.DB_PASSWORD', label: 'env DB_PASSWORD changed (value hidden)', before: MASK, after: MASK,
        }]);
    });

    it('yields no change for an unchanged sensitive value', () => {
        const t = tpl({ env: [{ name: 'DB_PASSWORD', value: 'same' }] });
        expect(diffPodTemplates(t, tpl({ env: [{ name: 'DB_PASSWORD', value: 'same' }] }))).toEqual([]);
    });

    it('masks added and removed sensitive literals', () => {
        const added = diffPodTemplates(tpl(), tpl({ env: [{ name: 'API_KEY', value: 'k' }] }));
        expect(added).toEqual([expect.objectContaining({ kind: 'added', label: 'env API_KEY added', before: null, after: MASK })]);
        const removed = diffPodTemplates(tpl({ env: [{ name: 'X', value: 'sk-123' }] }), tpl());
        expect(removed).toEqual([expect.objectContaining({ kind: 'removed', label: 'env X removed', before: MASK, after: null })]);
    });

    it('property: diffPodTemplates(t, t) is empty', () => {
        const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
        const container = fc.record({
            name,
            image: fc.string(),
            env: fc.array(fc.record({ name, value: fc.string() }), { maxLength: 4 }),
            args: fc.array(fc.string(), { maxLength: 3 }),
        });
        const template = fc.record({
            labels: fc.dictionary(name, fc.string(), { maxKeys: 4 }),
            annotations: fc.dictionary(name, fc.string(), { maxKeys: 4 }),
            containers: fc.array(container, { minLength: 1, maxLength: 3 }),
            init: fc.array(container, { maxLength: 2 }),
            hostNetwork: fc.boolean(),
        }).map((r): PodTemplate => ({
            metadata: { labels: r.labels, annotations: r.annotations },
            spec: { containers: r.containers, initContainers: r.init, hostNetwork: r.hostNetwork },
        }));
        fc.assert(fc.property(template, t => {
            expect(diffPodTemplates(t, structuredClone(t))).toEqual([]);
        }));
    });

    it('labels image changes', () => {
        const changes = diffPodTemplates(tpl({ image: 'v1' }), tpl({ image: 'v2' }));
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ field: 'image', label: 'image app: v1 → v2', before: 'v1', after: 'v2', kind: 'changed' });
    });

    it('detects env added, removed and changed', () => {
        const before = tpl({ env: [{ name: 'A', value: '1' }, { name: 'B', value: '2' }] });
        const after = tpl({ env: [{ name: 'B', value: '3' }, { name: 'C', valueFrom: { configMapKeyRef: { name: 'cm', key: 'c' } } }] });
        const byField = new Map(diffPodTemplates(before, after).map(c => [c.field, c]));
        expect(byField.get('env.A')).toMatchObject({ kind: 'removed', label: 'env A removed', before: '1' });
        expect(byField.get('env.B')).toMatchObject({ kind: 'changed', label: 'env B: 2 → 3' });
        expect(byField.get('env.C')).toMatchObject({ kind: 'added', label: 'env C added', after: 'configmap cm/c' });
    });

    it('detects resources.limits.memory changes', () => {
        const changes = diffPodTemplates(tpl({ limitsMemory: '256Mi' }), tpl({ limitsMemory: '512Mi' }));
        expect(changes).toEqual([expect.objectContaining({
            kind: 'changed', field: 'resources.limits.memory', before: '256Mi', after: '512Mi', container: 'app',
        })]);
        expect(changes[0].label).toContain('256Mi → 512Mi');
    });

    it('reports a restartedAt change as a rollout restart', () => {
        const key = 'kubectl.kubernetes.io/restartedAt';
        const changes = diffPodTemplates(tpl(), tpl({ annotations: { [key]: '2024-01-01T00:00:00Z' } }));
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ scope: 'pod', label: 'Rollout restart triggered' });
        const again = diffPodTemplates(tpl({ annotations: { [key]: 'a' } }), tpl({ annotations: { [key]: 'b' } }));
        expect(again.map(c => c.label)).toEqual(['Rollout restart triggered']);
    });

    it('ignores pod-template-hash', () => {
        expect(diffPodTemplates(
            tpl({ labels: { app: 'web', 'pod-template-hash': 'aaa' } }),
            tpl({ labels: { app: 'web', 'pod-template-hash': 'bbb' } }),
        )).toEqual([]);
    });

    it('treats a container moved from init to main as removed + added', () => {
        const before = tpl({ init: [{ name: 'proxy', image: 'p:1' }], containers: [{ name: 'app', image: 'a:1' }] });
        const after = tpl({ containers: [{ name: 'app', image: 'a:1' }, { name: 'proxy', image: 'p:1' }] });
        const changes = diffPodTemplates(before, after);
        expect(changes.map(c => [c.kind, c.container, c.containerKind, c.field])).toEqual([
            ['removed', 'proxy', 'init', 'container'],
            ['added', 'proxy', 'main', 'container'],
        ]);
    });

    it('returns Initial revision when before is null', () => {
        expect(diffPodTemplates(null, tpl())).toEqual([{
            kind: 'added', scope: 'pod', container: null, containerKind: null, field: 'template', label: 'Initial revision', before: null, after: null,
        }]);
    });

    it('detects pod-level fields', () => {
        const b = tpl();
        const a: PodTemplate = { ...b, spec: { containers: b.spec?.containers ?? [], serviceAccountName: 'sa', hostNetwork: true } };
        const fields = diffPodTemplates(b, a).map(c => c.field);
        expect(fields).toEqual(['serviceAccountName', 'hostNetwork']);
    });
});

describe('summarizeChanges', () => {
    const mk = (label: string): TemplateChange => ({
        kind: 'changed', scope: 'pod', container: null, containerKind: null, field: label, label, before: null, after: null,
    });

    it('truncates to max (default 3) and reports the remainder', () => {
        const changes = ['a', 'b', 'c', 'd', 'e'].map(mk);
        expect(summarizeChanges(changes)).toEqual({ lines: ['a', 'b', 'c'], more: 2 });
        expect(summarizeChanges(changes, 1)).toEqual({ lines: ['a'], more: 4 });
        expect(summarizeChanges(changes.slice(0, 2))).toEqual({ lines: ['a', 'b'], more: 0 });
    });
});
