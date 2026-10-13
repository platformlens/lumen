import { describe, it, expect } from 'vitest';
import { parseImageRef, describeProbe, buildContainerInsights, volumeTypeOf, type ContainerInsight } from './container-insights-utils';
import { MASK } from './sensitive-value-utils';
import type { DeploymentPodSummary, PodTemplate } from '../types/deployment-details';

type Spec = NonNullable<PodTemplate['spec']>;
type Container = Spec['containers'][number];

const good: Container = {
    name: 'app', image: 'ghcr.io/o/app:1.2.3',
    ports: [{ name: 'http', containerPort: 8080 }],
    resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '256Mi' } },
    readinessProbe: { httpGet: { path: '/ready', port: 'http' } },
    livenessProbe: { httpGet: { path: '/healthz', port: 'http' } },
    startupProbe: { tcpSocket: { port: 8080 } },
};
const insights = (spec: Partial<Spec>, pods: DeploymentPodSummary[] | null = null) =>
    buildContainerInsights({ spec: { containers: [good], ...spec } }, pods);
const flagIds = (i: ContainerInsight) => i.flags.map(f => f.id);
const podWith = (imageIDs: string[]): DeploymentPodSummary => ({
    name: 'p', uid: 'u', namespace: 'd', phase: 'Running', displayStatus: 'Running', readyContainers: 1, totalContainers: 1,
    restarts: 0, nodeName: 'n', podIP: null, hostIP: null, createdAt: '', startTime: null, deletionTimestamp: null,
    qosClass: null, podTemplateHash: null, ownerReplicaSet: null, unschedulableMessage: null,
    containers: imageIDs.map(id => ({ name: 'app', kind: 'main', ready: true, started: true, restartCount: 0, state: 'running',
        reason: null, lastTerminationReason: null, image: 'x', imageID: id })),
});

describe('parseImageRef', () => {
    it('parses common forms', () => {
        expect(parseImageRef('nginx')).toMatchObject({ registry: null, repository: 'nginx', tag: null, digest: null, isLatest: false, isUntagged: true });
        expect(parseImageRef('nginx:1.25')).toMatchObject({ registry: null, repository: 'nginx', tag: '1.25', isUntagged: false });
        expect(parseImageRef('ghcr.io/o/r:tag@sha256:abc')).toMatchObject({ registry: 'ghcr.io', repository: 'o/r', tag: 'tag', digest: 'sha256:abc' });
        expect(parseImageRef('localhost:5000/r')).toMatchObject({ registry: 'localhost:5000', repository: 'r', tag: null, isUntagged: true });
        expect(parseImageRef('r@sha256:abc')).toMatchObject({ registry: null, repository: 'r', tag: null, digest: 'sha256:abc', isUntagged: false });
        expect(parseImageRef('library/nginx:latest')).toMatchObject({ registry: null, repository: 'library/nginx', isLatest: true });
    });
});

describe('describeProbe', () => {
    it('resolves named ports and formats targets', () => {
        const ports = [{ name: 'http', containerPort: 8080, protocol: 'TCP', hostPort: null }];
        expect(describeProbe({ httpGet: { path: '/healthz', port: 'http' } }, ports)).toMatchObject({
            handler: 'httpGet', target: 'GET http://:8080/healthz', periodSeconds: 10, timeoutSeconds: 1, failureThreshold: 3, successThreshold: 1, initialDelaySeconds: 0,
        });
        expect(describeProbe({ tcpSocket: { port: 5432 }, periodSeconds: 5 }, ports)).toMatchObject({ target: 'TCP :5432', periodSeconds: 5 });
        expect(describeProbe({ exec: { command: ['cat', '/tmp/ready'] } }, ports)?.target).toBe('exec: cat /tmp/ready');
        expect(describeProbe({ grpc: { port: 9090 } }, ports)).toMatchObject({ handler: 'grpc', target: 'gRPC :9090' });
        expect(describeProbe(undefined, ports)).toBeNull();
    });
});

describe('buildContainerInsights', () => {
    it('a well-configured container has no flags', () => {
        const [i] = insights({});
        expect(i.flags).toEqual([]);
        expect(i.probes.readiness?.target).toBe('GET http://:8080/ready');
        expect(i.effectivePullPolicy).toBe('IfNotPresent');
    });
    it('effective pull policy', () => {
        expect(insights({ containers: [{ ...good, image: 'nginx' }] })[0].effectivePullPolicy).toBe('Always');
        expect(insights({ containers: [{ ...good, image: 'nginx:latest' }] })[0].effectivePullPolicy).toBe('Always');
        expect(insights({ containers: [{ ...good, image: 'nginx@sha256:abc' }] })[0].effectivePullPolicy).toBe('IfNotPresent');
        expect(insights({ containers: [{ ...good, image: 'nginx', imagePullPolicy: 'Never' }] })[0].effectivePullPolicy).toBe('Never');
    });
    it('flags', () => {
        expect(flagIds(insights({ containers: [{ ...good, image: 'nginx:latest' }] })[0])).toEqual(['latest-tag']);
        expect(flagIds(insights({ containers: [{ ...good, image: 'nginx' }] })[0])).toEqual(['no-tag']);
        expect(flagIds(insights({ containers: [{ ...good, imagePullPolicy: 'Never' }] })[0])).toEqual(['pull-never']);
        const bare = insights({ containers: [{ name: 'app', image: 'x:1' }] })[0];
        expect(flagIds(bare)).toEqual(['no-requests-cpu', 'no-requests-memory', 'no-limits-memory', 'no-limits-cpu', 'no-readiness', 'no-liveness', 'no-startup']);
        expect(bare.flags.find(f => f.id === 'no-limits-cpu')?.level).toBe('info');
        expect(bare.flags.find(f => f.id === 'no-startup')?.level).toBe('info');
        expect(bare.flags.find(f => f.id === 'no-readiness')?.level).toBe('warn');
        const same = { ...good, livenessProbe: good.readinessProbe };
        expect(flagIds(insights({ containers: [same] })[0])).toEqual(['liveness-equals-readiness']);
    });
    it('probe flags apply to main containers only', () => {
        const all = insights({ initContainers: [{ name: 'init', image: 'x:1' }] });
        expect(flagIds(all[0])).not.toContain('no-readiness');
        expect(flagIds(all[0])).not.toContain('no-startup');
    });
    it('multiple-digests', () => {
        expect(flagIds(insights({}, [podWith(['sha256:a']), podWith(['sha256:a'])])[0])).toEqual([]);
        const i = insights({}, [podWith(['sha256:a']), podWith(['sha256:b'])])[0];
        expect(i.runningImageIDs).toEqual(['sha256:a', 'sha256:b']);
        expect(flagIds(i)).toEqual(['multiple-digests']);
    });
    it('env: secretKeyRef carries no value; sensitive literals masked', () => {
        const [i] = insights({ containers: [{ ...good, env: [
            { name: 'DB_PASSWORD', valueFrom: { secretKeyRef: { name: 'db', key: 'password' } } },
            { name: 'API_KEY', value: 'abc123' },
            { name: 'LOG_LEVEL', value: 'info' },
            { name: 'CFG', valueFrom: { configMapKeyRef: { name: 'cm', key: 'k', optional: true } } },
            { name: 'POD_IP', valueFrom: { fieldRef: { fieldPath: 'status.podIP' } } },
            { name: 'MEM', valueFrom: { resourceFieldRef: { resource: 'limits.memory' } } },
        ] }] });
        expect(i.env[0]).toEqual({ name: 'DB_PASSWORD', source: 'secretKeyRef', display: 'secret db / password', masked: false, refName: 'db', refKey: 'password', optional: false });
        expect(i.env[1]).toMatchObject({ source: 'literal', display: MASK, masked: true });
        expect(JSON.stringify(i.env)).not.toContain('abc123');
        expect(i.env[2]).toMatchObject({ display: 'info', masked: false });
        expect(i.env[3]).toMatchObject({ source: 'configMapKeyRef', refName: 'cm', refKey: 'k', optional: true });
        expect(i.env[4]).toMatchObject({ source: 'fieldRef', display: 'status.podIP' });
        expect(i.env[5]).toMatchObject({ source: 'resourceFieldRef', display: 'limits.memory' });
    });
    it('envFrom, mounts and lifecycle', () => {
        const [i] = insights({
            volumes: [{ name: 'cfg', configMap: { name: 'c' } }, { name: 'tmp', emptyDir: {} }],
            containers: [{ ...good,
                envFrom: [{ configMapRef: { name: 'c' } }, { secretRef: { name: 's' }, prefix: 'S_' }],
                volumeMounts: [{ name: 'cfg', mountPath: '/etc/cfg', readOnly: true }, { name: 'tmp', mountPath: '/tmp', subPath: 'x' }, { name: 'gone', mountPath: '/g' }],
                lifecycle: { preStop: { exec: { command: ['sleep', '5'] } }, postStart: { sleep: { seconds: 3 } } },
            }],
        });
        expect(i.envFrom).toEqual([
            { kind: 'configMap', name: 'c', prefix: null, optional: false },
            { kind: 'secret', name: 's', prefix: 'S_', optional: false },
        ]);
        expect(i.volumeMounts.map(m => [m.name, m.volumeType, m.readOnly, m.subPath])).toEqual([
            ['cfg', 'configMap', true, null], ['tmp', 'emptyDir', false, 'x'], ['gone', 'unknown', false, null],
        ]);
        expect(i.lifecycle).toEqual({ preStop: 'exec: sleep 5', postStart: 'sleep 3s' });
    });
    it('init / sidecar / main kinds in spec order', () => {
        const all = insights({ initContainers: [{ name: 'migrate', image: 'x:1' }, { name: 'proxy', image: 'y:1', restartPolicy: 'Always' }] });
        expect(all.map(i => [i.name, i.kind])).toEqual([['migrate', 'init'], ['proxy', 'sidecar'], ['app', 'main']]);
    });
    it('ports carry hostPort only when set', () => {
        const [i] = insights({ containers: [{ ...good, ports: [{ containerPort: 80, hostPort: 8080, protocol: 'UDP' }, { containerPort: 81 }] }] });
        expect(i.ports).toEqual([
            { name: null, containerPort: 80, protocol: 'UDP', hostPort: 8080 },
            { name: null, containerPort: 81, protocol: 'TCP', hostPort: null },
        ]);
    });
});

describe('volumeTypeOf', () => {
    it('returns the source key', () => {
        expect(volumeTypeOf({ name: 'x', nfs: { server: 's' } })).toBe('nfs');
        expect(volumeTypeOf({ name: 'x' })).toBe('unknown');
        expect(volumeTypeOf(undefined)).toBe('unknown');
    });
});
