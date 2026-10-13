import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoreV1Api } from '@kubernetes/client-node';
import type {
    AppsV1Api, NetworkingV1Api, AutoscalingV2Api, PolicyV1Api, V1Pod, CoreV1Event, V2HorizontalPodAutoscalerList,
} from '@kubernetes/client-node';
import {
    fetchDeploymentFullDetails, classifyK8sError, settle, filterHpa, pickPodMetrics, mapWithConcurrency,
    summarizePod, toDeploymentEvent, type DeploymentDetailsClients,
} from './deployment-full-details';
import { LAST_APPLIED } from '../src/utils/sensitive-value-utils';
import type { DeploymentFullDetails, DeploymentFullDetailsResponse, SectionResult } from '../src/types/deployment-details';

// --- Fixtures ---

type Fn = ReturnType<typeof vi.fn>;
type Mock = Record<string, Fn>;

const apiErr = (code: number) => Object.assign(new Error(`HTTP-Code: ${code}\nMessage: boom\nBody: {}\nHeaders: {}`), { code });
const hang = () => new Promise<never>(() => { /* never settles */ });

const LAST_APPLIED_VALUE = '{"kind":"Deployment","note":"héllo 日本"}';

function deploymentFixture(opts: { lastApplied?: boolean } = {}) {
    return {
        metadata: {
            name: 'web', namespace: 'ns', uid: 'dep-uid',
            annotations: { ...(opts.lastApplied === false ? {} : { [LAST_APPLIED]: LAST_APPLIED_VALUE }), team: 'core' },
            managedFields: [{ manager: 'kubectl' }],
            creationTimestamp: new Date('2024-01-01T00:00:00Z'),
        },
        spec: {
            selector: { matchLabels: { app: 'web' } },
            template: {
                metadata: { labels: { app: 'web' } },
                spec: {
                    serviceAccountName: 'web-sa',
                    containers: [{ name: 'app', image: 'nginx:1' }],
                    volumes: [
                        { name: 'a', persistentVolumeClaim: { claimName: 'c1' } },
                        { name: 'b', persistentVolumeClaim: { claimName: 'c2' } },
                        { name: 'c', persistentVolumeClaim: { claimName: 'c3' } },
                        { name: 'd', persistentVolumeClaim: { claimName: 'c1' } },
                        { name: 's', secret: { secretName: 'creds' } },
                    ],
                },
            },
        },
    };
}

const rsOwned = {
    metadata: { name: 'web-abc', uid: 'rs-uid', annotations: { [LAST_APPLIED]: '{}' }, managedFields: [{}],
        ownerReferences: [{ kind: 'Deployment', name: 'web', uid: 'dep-uid' }] },
};
const rsOrphan = {
    metadata: { name: 'web-old', uid: 'rs-orphan', ownerReferences: [{ kind: 'Deployment', name: 'web', uid: 'old-dep-uid' }] },
};

function podFixture(name: string, nodeName: string, ownerUid = 'rs-uid') {
    return {
        metadata: { name, namespace: 'ns', uid: `${name}-uid`, labels: { app: 'web', 'pod-template-hash': 'abc' },
            creationTimestamp: new Date('2024-01-02T00:00:00Z'),
            ownerReferences: [{ kind: 'ReplicaSet', name: 'web-abc', uid: ownerUid }] },
        spec: { nodeName, containers: [{ name: 'app', image: 'nginx:1' }] },
        status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: true, restartCount: 2, image: 'nginx:1',
            imageID: 'sha', state: { running: {} } }] },
    };
}

const nodeFixture = (name: string) => ({
    metadata: { name, labels: { 'topology.kubernetes.io/zone': 'z1' } },
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
});

function makeClients() {
    const apps: Mock = {
        readNamespacedDeployment: vi.fn(async () => deploymentFixture()),
        listNamespacedReplicaSet: vi.fn(async () => ({ items: [rsOwned, rsOrphan] })),
    };
    const core: Mock = {};
    // Spy on every Secret method of the real CoreV1Api surface.
    for (const m of Object.getOwnPropertyNames(CoreV1Api.prototype).filter(n => /Secret/.test(n))) core[m] = vi.fn();
    Object.assign(core, {
        listNamespacedPod: vi.fn(async () => ({ items: [podFixture('p1', 'n1'), podFixture('p2', 'n2'), podFixture('orphan', 'n3', 'rs-orphan')] })),
        listNamespacedEvent: vi.fn(async () => ({ items: [] })),
        listNamespacedService: vi.fn(async () => ({ items: [
            { metadata: { name: 'web-svc' }, spec: { selector: { app: 'web' } } },
            { metadata: { name: 'other' }, spec: { selector: { app: 'other' } } },
        ] })),
        readNamespacedServiceAccount: vi.fn(async () => ({ metadata: { name: 'web-sa' }, secrets: [{ name: 'tok' }] })),
        readNamespace: vi.fn(async () => ({ metadata: { name: 'ns', labels: { 'pod-security.kubernetes.io/enforce': 'baseline' } } })),
        readNamespacedPersistentVolumeClaim: vi.fn(async ({ name }: { name: string }) => ({ metadata: { name }, status: { phase: 'Bound' } })),
        readNode: vi.fn(async ({ name }: { name: string }) => nodeFixture(name)),
    });
    const networking: Mock = {
        listNamespacedIngress: vi.fn(async () => ({ items: [
            { metadata: { name: 'ing' }, spec: { rules: [{ http: { paths: [{ backend: { service: { name: 'web-svc' } } }] } }] } },
            { metadata: { name: 'ing-other' }, spec: { defaultBackend: { service: { name: 'other' } } } },
        ] })),
        listNamespacedNetworkPolicy: vi.fn(async () => ({ items: [{ metadata: { name: 'all' }, spec: { podSelector: {} } }] })),
    };
    const autoscaling: Mock = { listNamespacedHorizontalPodAutoscaler: vi.fn(async () => ({ items: [] })) };
    const policy: Mock = { listNamespacedPodDisruptionBudget: vi.fn(async () => ({ items: [] })) };
    const getPodMetrics = vi.fn(async () => new Map([['ns/p1', { cpu: '10m', memory: '20Mi' }]]));
    const clients = {
        apps: apps as unknown as AppsV1Api, core: core as unknown as CoreV1Api,
        networking: networking as unknown as NetworkingV1Api, autoscaling: autoscaling as unknown as AutoscalingV2Api,
        policy: policy as unknown as PolicyV1Api, getPodMetrics,
    } satisfies DeploymentDetailsClients;
    return { clients, apps, core, networking, autoscaling, policy, getPodMetrics };
}

const run = (clients: DeploymentDetailsClients) => fetchDeploymentFullDetails(clients, 'ctx', 'ns', 'web');

function details(res: DeploymentFullDetailsResponse): DeploymentFullDetails {
    if (!res.found) throw new Error(`expected found, got ${res.reason}`);
    return res.details;
}

function okData<T>(r: SectionResult<T>): T {
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}: ${r.message}`);
    return r.data;
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
    vi.spyOn(console, 'log').mockImplementation(() => { /* silence */ });
    vi.spyOn(console, 'error').mockImplementation(() => { /* silence */ });
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// --- Phase 1 ---

describe('fetchDeploymentFullDetails: deployment read', () => {
    it('maps 404 to not-found and 403 to forbidden', async () => {
        const a = makeClients();
        a.apps.readNamespacedDeployment.mockRejectedValue(apiErr(404));
        expect(await run(a.clients)).toMatchObject({ found: false, reason: 'not-found' });
        const b = makeClients();
        b.apps.readNamespacedDeployment.mockRejectedValue(apiErr(403));
        expect(await run(b.clients)).toMatchObject({ found: false, reason: 'forbidden' });
    });

    it('rethrows 401 for code 401 and for a message-only "Unauthorized"', async () => {
        const a = makeClients();
        a.apps.readNamespacedDeployment.mockRejectedValue(apiErr(401));
        await expect(run(a.clients)).rejects.toMatchObject({ code: 401 });
        const b = makeClients();
        b.apps.readNamespacedDeployment.mockRejectedValue(new Error('exec plugin: Unauthorized'));
        await expect(run(b.clients)).rejects.toThrow('Unauthorized');
    });

    it('rethrows a 401 raised by a section so withAuthRetry can refresh', async () => {
        const c = makeClients();
        c.core.listNamespacedService.mockRejectedValue(new Error('Unauthorized'));
        await expect(run(c.clients)).rejects.toThrow('Unauthorized');
    });

    it('strips managedFields and defaults kind/apiVersion', async () => {
        const d = details(await run(makeClients().clients));
        expect(d.deployment.kind).toBe('Deployment');
        expect(d.deployment.apiVersion).toBe('apps/v1');
        expect(d.deployment.metadata?.managedFields).toBeUndefined();
        expect(d.deployment.metadata?.creationTimestamp).toBe('2024-01-01T00:00:00.000Z');
        const rs = okData(d.replicaSets);
        expect(rs[0].metadata?.managedFields).toBeUndefined();
    });

    it('strips last-applied-configuration and records its UTF-8 byte length', async () => {
        const d = details(await run(makeClients().clients));
        expect(d.deployment.metadata?.annotations?.[LAST_APPLIED]).toBeUndefined();
        expect(d.deployment.metadata?.annotations?.team).toBe('core');
        expect(d.lastAppliedBytes).toBe(Buffer.byteLength(LAST_APPLIED_VALUE, 'utf8'));
        expect(d.lastAppliedBytes).toBeGreaterThan(LAST_APPLIED_VALUE.length);
        expect(okData(d.replicaSets)[0].metadata?.annotations?.[LAST_APPLIED]).toBeUndefined();
    });

    it('lastAppliedBytes is null when the annotation is absent', async () => {
        const c = makeClients();
        c.apps.readNamespacedDeployment.mockResolvedValue(deploymentFixture({ lastApplied: false }));
        expect(details(await run(c.clients)).lastAppliedBytes).toBeNull();
    });
});

// --- Phase 2 ---

describe('fetchDeploymentFullDetails: sections', () => {
    it('services 403 marks only services forbidden', async () => {
        const c = makeClients();
        c.core.listNamespacedService.mockRejectedValue(apiErr(403));
        const d = details(await run(c.clients));
        expect(d.services).toEqual({ status: 'forbidden', message: 'services: forbidden' });
        expect(d.ingresses).toEqual({ status: 'error', message: 'Requires Services' });
        const others = [d.replicaSets, d.pods, d.nodes, d.events, d.networkPolicies, d.hpas, d.pdbs,
            d.serviceAccount, d.namespace, d.pvcs, d.podMetrics];
        for (const s of others) expect(s.status).toBe('ok');
    });

    it('owns ReplicaSets and pods by uid, excluding same-name orphans', async () => {
        const c = makeClients();
        const d = details(await run(c.clients));
        expect(c.apps.listNamespacedReplicaSet).toHaveBeenCalledWith({ namespace: 'ns', labelSelector: 'app=web' });
        expect(okData(d.replicaSets).map(r => r.metadata?.name)).toEqual(['web-abc']);
        expect(okData(d.pods).map(p => p.name)).toEqual(['p1', 'p2']);
        expect(d.pods.status === 'ok' && d.pods.note).toBeFalsy();
    });

    it('RS failure gives pods ok with an ownership note and events a note', async () => {
        const c = makeClients();
        c.apps.listNamespacedReplicaSet.mockRejectedValue(apiErr(500));
        const d = details(await run(c.clients));
        expect(d.replicaSets.status).toBe('error');
        expect(d.pods).toMatchObject({ status: 'ok', note: expect.stringContaining('Ownership approximate') });
        expect(okData(d.pods)).toHaveLength(3);
        expect(d.events).toMatchObject({ status: 'ok', note: 'Some related events may be missing' });
    });

    it('maps, filters, sorts (newest first) and caps events at 300', async () => {
        const c = makeClients();
        const many = Array.from({ length: 350 }, (_, i) => ({
            metadata: {}, involvedObject: { kind: 'Pod', name: 'p1', uid: 'p1-uid' }, reason: `r${i}`,
            lastTimestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, i)),
        }));
        const eventTimeOnly = {
            metadata: {}, involvedObject: { kind: 'Deployment', name: 'web', uid: 'dep-uid' }, reason: 'ScalingReplicaSet',
            eventTime: new Date('2025-01-01T00:00:00Z'), series: { count: 4 }, reportingComponent: 'deployment-controller',
        };
        const unrelated = { metadata: {}, involvedObject: { kind: 'Pod', name: 'x', uid: 'other-uid' }, lastTimestamp: new Date('2026-01-01T00:00:00Z') };
        c.core.listNamespacedEvent.mockResolvedValue({ items: [...many, eventTimeOnly, unrelated] });
        const events = okData(details(await run(c.clients)).events);
        expect(events).toHaveLength(300);
        expect(events[0]).toMatchObject({ reason: 'ScalingReplicaSet', lastTimestamp: '2025-01-01T00:00:00.000Z', count: 4,
            source: 'deployment-controller', firstTimestamp: '2025-01-01T00:00:00.000Z', involvedKind: 'Deployment' });
        expect(events.some(e => e.involvedUid === 'other-uid')).toBe(false);
        for (let i = 1; i < events.length; i++) {
            expect(Date.parse(events[i - 1].lastTimestamp)).toBeGreaterThanOrEqual(Date.parse(events[i].lastTimestamp));
        }
    });

    it('toDeploymentEvent defaults count to 1 and lastTimestamp to fetchedAt', () => {
        const e = toDeploymentEvent({ metadata: {}, involvedObject: {} } as unknown as CoreV1Event, '2024-05-05T00:00:00.000Z');
        expect(e).toMatchObject({ count: 1, lastTimestamp: '2024-05-05T00:00:00.000Z', firstTimestamp: null, source: null,
            involvedKind: '', involvedName: '', involvedUid: '' });
    });

    it('filters services, ingresses and network policies to this deployment', async () => {
        const d = details(await run(makeClients().clients));
        expect(okData(d.services).map(s => s.metadata?.name)).toEqual(['web-svc']);
        expect(okData(d.ingresses).map(i => i.metadata?.name)).toEqual(['ing']);
        expect(okData(d.networkPolicies)).toHaveLength(1);
        expect(okData(d.namespace).podSecurity.enforce).toBe('baseline');
        expect(okData(d.podMetrics)).toEqual({ p1: { cpu: '10m', memory: '20Mi' } });
    });

    it('ServiceAccount 404 gives ok exists:false; a found SA never copies secrets', async () => {
        const found = okData(details(await run(makeClients().clients)).serviceAccount);
        expect(found).toEqual({ name: 'web-sa', exists: true, automountServiceAccountToken: null, imagePullSecretNames: [], irsaRoleArn: null });
        const c = makeClients();
        c.core.readNamespacedServiceAccount.mockRejectedValue(apiErr(404));
        expect(okData(details(await run(c.clients)).serviceAccount)).toMatchObject({ name: 'web-sa', exists: false });
    });

    it('one PVC 404 among three gives ok with that claim found:false and no note', async () => {
        const c = makeClients();
        c.core.readNamespacedPersistentVolumeClaim.mockImplementation(async ({ name }: { name: string }) => {
            if (name === 'c2') throw apiErr(404);
            return { metadata: { name }, status: { phase: 'Bound' } };
        });
        const pvcs = details(await run(c.clients)).pvcs;
        expect(c.core.readNamespacedPersistentVolumeClaim).toHaveBeenCalledTimes(3);
        expect(pvcs.status === 'ok' && pvcs.note).toBeFalsy();
        expect(okData(pvcs).find(p => p.claimName === 'c2')).toMatchObject({ found: false });
        expect(okData(pvcs).filter(p => p.found)).toHaveLength(2);
    });

    it('HPA list 404 gives "autoscaling/v2 API not available"', async () => {
        const c = makeClients();
        c.autoscaling.listNamespacedHorizontalPodAutoscaler.mockRejectedValue(apiErr(404));
        expect(details(await run(c.clients)).hpas).toEqual({ status: 'error', message: 'autoscaling/v2 API not available' });
    });

    it('never invokes any Secret API', async () => {
        const c = makeClients();
        await run(c.clients);
        const secretMethods = Object.keys(c.core).filter(k => /Secret/.test(k));
        expect(secretMethods.length).toBeGreaterThan(0);
        for (const m of secretMethods) expect(c.core[m]).not.toHaveBeenCalled();
    });
});

// --- Phase 3: nodes ---

describe('fetchDeploymentFullDetails: nodes', () => {
    it('reads only hosting nodes; a partial failure gives ok with a note', async () => {
        const c = makeClients();
        c.core.listNamespacedPod.mockResolvedValue({ items: [podFixture('p1', 'n1'), podFixture('p2', 'n2'), podFixture('p3', 'n3')] });
        c.core.readNode.mockImplementation(async ({ name }: { name: string }) => {
            if (name === 'n2') throw apiErr(500);
            return nodeFixture(name);
        });
        const nodes = details(await run(c.clients)).nodes;
        expect(nodes).toMatchObject({ status: 'ok', note: '1 of 3 node reads failed' });
        expect(okData(nodes).map(n => n.name)).toEqual(['n1', 'n3']);
        expect(okData(nodes)[0]).toMatchObject({ ready: true, zone: 'z1' });
    });

    it('stops at the first 403 and reports forbidden', async () => {
        const c = makeClients();
        c.core.listNamespacedPod.mockResolvedValue({ items: Array.from({ length: 20 }, (_, i) => podFixture(`p${i}`, `n${i}`)) });
        c.core.readNode.mockRejectedValue(apiErr(403));
        const nodes = details(await run(c.clients)).nodes;
        expect(nodes).toEqual({ status: 'forbidden', message: 'No permission to read nodes' });
        expect(c.core.readNode.mock.calls.length).toBeLessThanOrEqual(8);
    });

    it('overall deadline gives an error and no new readNode starts after 20 s; PVCs still read in phase 2', async () => {
        vi.useFakeTimers();
        const c = makeClients();
        c.core.listNamespacedPod.mockResolvedValue({ items: Array.from({ length: 40 }, (_, i) => podFixture(`p${i}`, `n${i}`)) });
        c.core.readNode.mockImplementation(hang);
        const p = run(c.clients);
        await vi.advanceTimersByTimeAsync(0);
        expect(c.core.readNode).toHaveBeenCalledTimes(8);
        expect(c.core.readNamespacedPersistentVolumeClaim).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(20001);
        const callsAtDeadline = c.core.readNode.mock.calls.length;
        expect(callsAtDeadline).toBeLessThanOrEqual(16);
        await vi.advanceTimersByTimeAsync(60000);
        expect(c.core.readNode.mock.calls.length).toBe(callsAtDeadline);
        const d = details(await p);
        expect(d.nodes).toEqual({ status: 'error', message: 'Timed out reading nodes' });
        expect(okData(d.pvcs)).toHaveLength(3);
    });
});

// --- Pure helpers ---

describe('helpers', () => {
    it('classifyK8sError reads code/statusCode/response.statusCode and message-only 401s', () => {
        expect(classifyK8sError({ code: 401 })).toBe('unauthorized');
        expect(classifyK8sError({ statusCode: 403 })).toBe('forbidden');
        expect(classifyK8sError({ response: { statusCode: 404 } })).toBe('not-found');
        expect(classifyK8sError(new Error('Unauthorized'))).toBe('unauthorized');
        expect(classifyK8sError(new Error('got 401 from server'))).toBe('unauthorized');
        expect(classifyK8sError(new Error('x timed out after 5ms'))).toBe('timeout');
        expect(classifyK8sError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe('other');
    });

    it('settle: 404 without onNotFound gives "not found (API not available?)"', async () => {
        expect(await settle(Promise.reject(apiErr(404)), 'thing')).toEqual({ status: 'error', message: 'thing: not found (API not available?)' });
    });

    it('settle rethrows 401 (numeric and message-only)', async () => {
        await expect(settle(Promise.reject(apiErr(401)), 'x')).rejects.toMatchObject({ code: 401 });
        await expect(settle(Promise.reject(new Error('Unauthorized')), 'x')).rejects.toThrow('Unauthorized');
    });

    it('settle times out a hanging call', async () => {
        vi.useFakeTimers();
        const p = settle(hang(), 'slow', { timeoutMs: 100 });
        await vi.advanceTimersByTimeAsync(101);
        expect(await p).toEqual({ status: 'error', message: 'slow: timed out' });
    });

    it('filterHpa keeps only the HPA targeting this deployment', () => {
        const list = { items: [
            { metadata: { name: 'mine' }, spec: { scaleTargetRef: { kind: 'Deployment', name: 'web' } } },
            { metadata: { name: 'other-name' }, spec: { scaleTargetRef: { kind: 'Deployment', name: 'api' } } },
            { metadata: { name: 'sts' }, spec: { scaleTargetRef: { kind: 'StatefulSet', name: 'web' } } },
        ] } as unknown as V2HorizontalPodAutoscalerList;
        expect(filterHpa(list, 'web').map(h => h.metadata?.name)).toEqual(['mine']);
    });

    it('pickPodMetrics turns a ns/name Map into a pod-name record and ignores other namespaces', () => {
        const map = new Map([
            ['ns/a', { cpu: '1m', memory: '1Mi' }],
            ['other/a', { cpu: '9m', memory: '9Mi' }],
            ['other/b', { cpu: '2m', memory: '2Mi' }],
        ]);
        expect(pickPodMetrics(map, 'ns', ['a', 'b'])).toEqual({ a: { cpu: '1m', memory: '1Mi' } });
    });

    it('mapWithConcurrency honours the limit and shouldStop', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const res = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async i => {
            inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(r => setTimeout(r, 1));
            inFlight--;
            return i * 2;
        });
        expect(res).toEqual([2, 4, 6, 8, 10, 12, 14]);
        expect(maxInFlight).toBe(3);

        let started = 0;
        let stop = false;
        const partial = await mapWithConcurrency([1, 2, 3, 4, 5], 1, async i => {
            started++;
            if (i === 2) stop = true;
            return i;
        }, () => stop);
        expect(started).toBe(2);
        expect(partial).toEqual([1, 2, undefined, undefined, undefined]);
    });

    it('summarizePod lists spec containers without status as unknown and kinds init/sidecar/main', () => {
        const pod = {
            metadata: { name: 'p', uid: 'u', namespace: 'ns', creationTimestamp: new Date('2024-01-01T00:00:00Z') },
            spec: {
                nodeName: 'n1',
                initContainers: [{ name: 'init', image: 'busybox' }, { name: 'proxy', image: 'envoy', restartPolicy: 'Always' }],
                containers: [{ name: 'app', image: 'nginx' }],
            },
            status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'True' }] },
        } as unknown as V1Pod;
        const s = summarizePod(pod);
        expect(s.containers.map(c => [c.name, c.kind, c.state, c.ready, c.restartCount])).toEqual([
            ['init', 'init', 'unknown', false, 0],
            ['proxy', 'sidecar', 'unknown', false, 0],
            ['app', 'main', 'unknown', false, 0],
        ]);
        expect(s.containers[2].image).toBe('nginx');
        expect(s).toMatchObject({ totalContainers: 2, readyContainers: 0, displayStatus: 'Pending',
            createdAt: '2024-01-01T00:00:00.000Z', nodeName: 'n1', unschedulableMessage: null });
    });

    it('summarizePod derives displayStatus from waiting reasons and deletion', () => {
        const base = podFixture('p', 'n1') as unknown as V1Pod;
        const waiting = { ...base, status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: false, restartCount: 5,
            image: 'nginx:1', imageID: '', state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'OOMKilled' } } }] } } as unknown as V1Pod;
        const w = summarizePod(waiting);
        expect(w.displayStatus).toBe('CrashLoopBackOff');
        expect(w.containers[0]).toMatchObject({ reason: 'CrashLoopBackOff', lastTerminationReason: 'OOMKilled', restartCount: 5 });
        const deleting = { ...base, metadata: { ...base.metadata, deletionTimestamp: new Date('2024-02-02T00:00:00Z') } } as V1Pod;
        expect(summarizePod(deleting)).toMatchObject({ displayStatus: 'Terminating', deletionTimestamp: '2024-02-02T00:00:00.000Z',
            ownerReplicaSet: 'web-abc', podTemplateHash: 'abc' });
    });
});
