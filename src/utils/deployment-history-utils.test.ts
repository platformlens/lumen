import { describe, it, expect } from 'vitest';
import * as jsYaml from 'js-yaml';
import {
    buildRevisionTimeline, getCurrentRevision, getPreviousRevision, buildRevisionByHash,
    eventsForRevision, revisionToYaml, revisionEntryToYamlInput, type RevisionEntry,
} from './deployment-history-utils';
import { MASK } from './sensitive-value-utils';
import type { DeploymentEvent, DeploymentObj, DeploymentPodSummary, ReplicaSetObj } from '../types/deployment-details';

function rs(name: string, revision: string | undefined, opts: {
    hash?: string; created?: string; replicas?: number; history?: string; uid?: string; image?: string;
} = {}): ReplicaSetObj {
    const annotations: Record<string, string> = {};
    if (revision !== undefined) annotations['deployment.kubernetes.io/revision'] = revision;
    if (opts.history) annotations['deployment.kubernetes.io/revision-history'] = opts.history;
    const labels = { app: 'web', ...(opts.hash ? { 'pod-template-hash': opts.hash } : {}) };
    return {
        metadata: { name, uid: opts.uid ?? `uid-${name}`, annotations, labels, creationTimestamp: opts.created ?? '2024-01-01T00:00:00Z' },
        spec: {
            replicas: opts.replicas ?? 0,
            selector: { matchLabels: labels },
            template: {
                metadata: { labels },
                spec: { containers: [{ name: 'app', image: opts.image ?? 'web:v1' }], initContainers: [{ name: 'proxy', image: 'p:1', restartPolicy: 'Always' }] },
            },
        },
        status: { replicas: opts.replicas ?? 0 },
    };
}

const deployment = (revision?: string): DeploymentObj => ({
    metadata: { name: 'web', annotations: revision ? { 'deployment.kubernetes.io/revision': revision } : {} },
});

const pod = (hash: string | null): DeploymentPodSummary => ({
    name: 'p', uid: 'u', namespace: 'default', phase: 'Running', displayStatus: 'Running', readyContainers: 1, totalContainers: 1,
    restarts: 0, nodeName: null, podIP: null, hostIP: null, createdAt: '', startTime: null, deletionTimestamp: null, qosClass: null,
    podTemplateHash: hash, ownerReplicaSet: null, unschedulableMessage: null, containers: [],
});

describe('buildRevisionTimeline', () => {
    it('orders ascending by revision with null revisions last by createdAt', () => {
        const entries = buildRevisionTimeline(deployment('3'), [
            rs('c', undefined, { created: '2024-03-01T00:00:00Z' }),
            rs('r3', '3'),
            rs('b', 'abc', { created: '2024-02-01T00:00:00Z' }),
            rs('r1', '1'),
        ]);
        expect(entries.map(e => e.replicaSetName)).toEqual(['r1', 'r3', 'b', 'c']);
        expect(entries.map(e => e.revisionLabel)).toEqual(['1', '3', '?', '?']);
    });

    it('detects current revision by the deployment annotation first', () => {
        const entries = buildRevisionTimeline(deployment('1'), [rs('r1', '1', { hash: 'h1' }), rs('r2', '2', { hash: 'h2' })], [pod('h2'), pod('h2')]);
        expect(entries.filter(e => e.isCurrent).map(e => e.replicaSetName)).toEqual(['r1']);
    });

    it('falls back to the most common pod hash, then the highest revision', () => {
        const sets = [rs('r1', '1', { hash: 'h1' }), rs('r2', '2', { hash: 'h2' }), rs('r3', '3', { hash: 'h3' })];
        const byHash = buildRevisionTimeline(deployment(), sets, [pod('h1'), pod('h2'), pod('h2'), pod(null)]);
        expect(getCurrentRevision(byHash)?.replicaSetName).toBe('r2');
        const highest = buildRevisionTimeline(deployment(), sets, null);
        expect(getCurrentRevision(highest)?.replicaSetName).toBe('r3');
        expect(highest.filter(e => e.isCurrent)).toHaveLength(1);
    });

    it('parses revision-history, images, activity, and strips pod-template-hash from template', () => {
        const [entry] = buildRevisionTimeline(deployment('5'), [rs('r5', '5', { hash: 'h5', history: '1,3', replicas: 2 })]);
        expect(entry.previousRevisions).toEqual([1, 3]);
        expect(entry.podTemplateHash).toBe('h5');
        expect(entry.isActive).toBe(true);
        expect(entry.images).toEqual([
            { container: 'proxy', image: 'p:1', kind: 'sidecar' },
            { container: 'app', image: 'web:v1', kind: 'main' },
        ]);
        expect(entry.template.metadata?.labels).toEqual({ app: 'web' });
        expect(entry.selector).toEqual({ matchLabels: { app: 'web', 'pod-template-hash': 'h5' } });
    });

    it('returns an empty list for no ReplicaSets', () => {
        expect(buildRevisionTimeline(deployment('1'), [])).toEqual([]);
        expect(getCurrentRevision([])).toBeNull();
    });
});

describe('getPreviousRevision / buildRevisionByHash', () => {
    const entries = buildRevisionTimeline(deployment('4'), [
        rs('r1', '1', { hash: 'h1' }), rs('r4', '4', { hash: 'h4' }), rs('r2', '2', { hash: 'h2' }), rs('x', undefined),
    ]);
    const find = (n: string) => entries.find(e => e.replicaSetName === n) as RevisionEntry;

    it('returns the nearest lower revision', () => {
        expect(getPreviousRevision(entries, find('r4'))?.replicaSetName).toBe('r2');
        expect(getPreviousRevision(entries, find('r2'))?.replicaSetName).toBe('r1');
        expect(getPreviousRevision(entries, find('r1'))).toBeNull();
        expect(getPreviousRevision(entries, find('x'))).toBeNull();
    });

    it('maps pod-template-hash to entry', () => {
        const m = buildRevisionByHash(entries);
        expect(m.get('h4')?.replicaSetName).toBe('r4');
        expect(m.size).toBe(3);
    });
});

/** Verbatim copy of the original local helper in RevisionDiffModal.tsx (pre-refactor), used as the oracle. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legacyRevisionToYaml(rev: any): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clean: any = {
        revision: rev.revision,
        name: rev.name,
        createdAt: rev.creationTimestamp,
        replicas: rev.spec?.replicas,
        template: {
            labels: rev.spec?.template?.metadata?.labels,
            annotations: rev.spec?.template?.metadata?.annotations,
            spec: rev.spec?.template?.spec,
        },
        selector: rev.spec?.selector,
    };
    return jsYaml.dump(clean, { indent: 2, lineWidth: 120, noRefs: true, skipInvalid: true, sortKeys: false });
}

describe('revisionToYaml', () => {
    const spec = {
        replicas: 3,
        selector: { matchLabels: { app: 'web' } },
        template: {
            metadata: { labels: { app: 'web', 'pod-template-hash': 'abc' }, annotations: { 'x/y': 'z' } },
            spec: {
                containers: [{
                    name: 'app', image: 'web:v1', ports: [{ containerPort: 8080, protocol: 'TCP' }],
                    env: [{ name: 'LOG_LEVEL', value: 'info' }, { name: 'REF', valueFrom: { configMapKeyRef: { name: 'cm', key: 'k' } } }],
                    resources: { limits: { memory: '256Mi' } }, livenessProbe: undefined,
                }],
                restartPolicy: 'Always',
            },
        },
    };

    it('is byte-identical to the old modal helper (Date createdAt)', () => {
        const created = new Date('2024-05-06T07:08:09Z');
        const legacy = legacyRevisionToYaml({ revision: '7', name: 'web-6d4f', creationTimestamp: created, spec });
        const next = revisionToYaml({ revision: '7', name: 'web-6d4f', createdAt: created, replicas: spec.replicas, selector: spec.selector, template: spec.template });
        expect(next).toBe(legacy);
    });

    it('is byte-identical with a string createdAt and missing template', () => {
        const legacy = legacyRevisionToYaml({ revision: 'unknown', name: 'n', creationTimestamp: '2024-01-01T00:00:00Z', spec: {} });
        const next = revisionToYaml({ revision: 'unknown', name: 'n', createdAt: '2024-01-01T00:00:00Z', template: undefined });
        expect(next).toBe(legacy);
    });

    it('masks sensitive env without mutating the input', () => {
        const template = { spec: { containers: [{ name: 'app', env: [{ name: 'DB_PASSWORD', value: 'hunter2' }] }] } };
        const out = revisionToYaml({ revision: '1', name: 'n', createdAt: 'x', template });
        expect(out).not.toContain('hunter2');
        expect(out).toContain(MASK);
        expect(template.spec.containers[0].env[0].value).toBe('hunter2');
    });

    it('revisionEntryToYamlInput includes the selector', () => {
        const [entry] = buildRevisionTimeline(deployment('1'), [rs('r1', '1', { hash: 'h1', replicas: 2 })]);
        const input = revisionEntryToYamlInput(entry);
        expect(input).toEqual({
            revision: '1', name: 'r1', createdAt: '2024-01-01T00:00:00Z', replicas: 2,
            selector: { matchLabels: { app: 'web', 'pod-template-hash': 'h1' } }, template: entry.template,
        });
        expect(revisionToYaml(input)).toContain('selector:');
    });
});

describe('eventsForRevision', () => {
    const ev = (over: Partial<DeploymentEvent>): DeploymentEvent => ({
        type: 'Normal', reason: 'ScalingReplicaSet', message: '', count: 1, firstTimestamp: null,
        lastTimestamp: '2024-01-01T00:00:00Z', involvedKind: 'Deployment', involvedName: 'web', involvedUid: 'dep-uid', source: null, ...over,
    });
    const [entry] = buildRevisionTimeline(deployment('1'), [rs('web-6d4f', '1', { uid: 'rs-uid' })]);

    it('matches by RS uid', () => {
        const e = ev({ involvedKind: 'ReplicaSet', involvedUid: 'rs-uid', message: 'Created pod: web-6d4f-abc' });
        expect(eventsForRevision([e], entry)).toEqual([e]);
    });

    it('matches Deployment events naming the RS as a whole token', () => {
        const plain = ev({ message: 'Scaled up replica set web-6d4f to 3' });
        const quoted = ev({ message: 'Scaled down replica set "web-6d4f" to 0' });
        const comma = ev({ message: 'Scaled up replica set web-6d4f, now 3' });
        const dot = ev({ message: 'Scaled up replica set web-6d4f.' });
        expect(eventsForRevision([plain, quoted, comma, dot], entry)).toHaveLength(4);
    });

    it('does not match a longer name sharing the prefix', () => {
        expect(eventsForRevision([ev({ message: 'Scaled up replica set web-6d4f9 to 3' })], entry)).toEqual([]);
    });

    it('escapes regex metacharacters in the RS name', () => {
        const [weird] = buildRevisionTimeline(deployment('1'), [rs('web.6d4f', '1', { uid: 'w' })]);
        expect(eventsForRevision([ev({ message: 'Scaled up replica set webX6d4f to 1' })], weird)).toEqual([]);
        expect(eventsForRevision([ev({ message: 'Scaled up replica set web.6d4f to 1' })], weird)).toHaveLength(1);
    });

    it('ignores non-Deployment events that only mention the name', () => {
        expect(eventsForRevision([ev({ involvedKind: 'Pod', involvedUid: 'p', message: 'replica set web-6d4f' })], entry)).toEqual([]);
    });

    it('deduplicates the union and sorts newest first', () => {
        const both = ev({ involvedKind: 'ReplicaSet', involvedUid: 'rs-uid', message: 'x web-6d4f y', lastTimestamp: '2024-01-01T00:00:00Z' });
        const newer = ev({ message: 'Scaled up replica set web-6d4f to 2', lastTimestamp: '2024-02-01T00:00:00Z' });
        expect(eventsForRevision([both, newer, both], entry)).toEqual([newer, both]);
    });
});
