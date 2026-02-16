import { describe, it, expect } from 'vitest';
import { extractPodSnapshot, extractDeploymentSnapshot, extractNodeSnapshot } from './extractors';

// --- Pod fixtures ---

const healthyPod = {
    metadata: { name: 'nginx-abc123', namespace: 'default', creationTimestamp: '2025-01-01T00:00:00Z' },
    spec: {
        containers: [{
            name: 'nginx',
            resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '200m', memory: '256Mi' } }
        }]
    },
    status: {
        phase: 'Running',
        conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'ContainersReady', status: 'True' },
        ],
        containerStatuses: [{
            name: 'nginx', ready: true, restartCount: 0,
            state: { running: { startedAt: '2025-01-01T00:00:05Z' } }
        }]
    }
};

const crashingPod = {
    metadata: { name: 'api-server-def456', namespace: 'backend', creationTimestamp: '2025-01-01T00:00:00Z' },
    spec: { containers: [{ name: 'api' }] },
    status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False', reason: 'ContainersNotReady' }],
        containerStatuses: [{
            name: 'api', ready: false, restartCount: 12,
            state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting' } },
            lastState: { terminated: { reason: 'Error', exitCode: 1 } }
        }]
    }
};

const oomKilledPod = {
    metadata: { name: 'worker-789', namespace: 'jobs', creationTimestamp: '2025-01-02T00:00:00Z' },
    spec: { containers: [{ name: 'worker', resources: { requests: { memory: '512Mi' }, limits: { memory: '512Mi' } } }] },
    status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [{
            name: 'worker', ready: false, restartCount: 3,
            state: { waiting: { reason: 'CrashLoopBackOff' } },
            lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } }
        }]
    }
};

// --- Deployment fixtures ---

const healthyDeployment = {
    metadata: { name: 'web-app', namespace: 'production', creationTimestamp: '2025-01-01T00:00:00Z' },
    spec: { replicas: 3 },
    status: {
        readyReplicas: 3,
        unavailableReplicas: 0,
        conditions: [
            { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable' },
            { type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' },
        ]
    }
};

const degradedDeployment = {
    metadata: { name: 'api-gateway', namespace: 'production', creationTimestamp: '2025-01-01T00:00:00Z' },
    spec: { replicas: 5 },
    status: {
        readyReplicas: 3,
        unavailableReplicas: 2,
        conditions: [
            { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable' },
            { type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' },
        ]
    }
};

// --- Node fixtures ---

const readyNode = {
    metadata: { name: 'ip-10-0-1-42', creationTimestamp: '2025-01-01T00:00:00Z' },
    status: {
        conditions: [
            { type: 'Ready', status: 'True', reason: 'KubeletReady' },
            { type: 'MemoryPressure', status: 'False' },
            { type: 'DiskPressure', status: 'False' },
        ],
        allocatable: { cpu: '4', memory: '16Gi' },
        capacity: { cpu: '4', memory: '16Gi' },
    }
};

const notReadyNode = {
    metadata: { name: 'ip-10-0-2-99', creationTimestamp: '2025-01-01T00:00:00Z' },
    status: {
        conditions: [
            { type: 'Ready', status: 'False', reason: 'KubeletNotReady', message: 'container runtime not ready' },
            { type: 'MemoryPressure', status: 'True' },
            { type: 'DiskPressure', status: 'False' },
        ],
        allocatable: { cpu: '2', memory: '8Gi' },
        capacity: { cpu: '2', memory: '8Gi' },
    }
};

// --- Tests ---

describe('extractPodSnapshot', () => {
    it('extracts a healthy running pod', () => {
        const snap = extractPodSnapshot(healthyPod);
        expect(snap.kind).toBe('Pod');
        expect(snap.name).toBe('nginx-abc123');
        expect(snap.namespace).toBe('default');
        expect(snap.phase).toBe('Running');
        expect(snap.ready).toBe(true);
        expect(snap.restartCount).toBe(0);
        expect(snap.warnings).toEqual([]);
        expect(snap.resourceUsage).toEqual({
            cpuRequests: '100m', memoryRequests: '128Mi',
            cpuLimits: '200m', memoryLimits: '256Mi',
        });
    });

    it('extracts a crashing pod with CrashLoopBackOff', () => {
        const snap = extractPodSnapshot(crashingPod);
        expect(snap.name).toBe('api-server-def456');
        expect(snap.namespace).toBe('backend');
        expect(snap.ready).toBe(false);
        expect(snap.restartCount).toBe(12);
        expect(snap.warnings).toContain('CrashLoopBackOff');
        expect(snap.warnings).toContain('Error');
    });

    it('extracts an OOMKilled pod', () => {
        const snap = extractPodSnapshot(oomKilledPod);
        expect(snap.ready).toBe(false);
        expect(snap.restartCount).toBe(3);
        expect(snap.warnings).toContain('OOMKilled');
        expect(snap.warnings).toContain('CrashLoopBackOff');
    });

    it('handles a minimal/empty pod object', () => {
        const snap = extractPodSnapshot({});
        expect(snap.kind).toBe('Pod');
        expect(snap.name).toBe('');
        expect(snap.phase).toBe('Unknown');
        expect(snap.ready).toBe(false);
        expect(snap.restartCount).toBe(0);
        expect(snap.warnings).toEqual([]);
    });
});

describe('extractDeploymentSnapshot', () => {
    it('extracts a healthy deployment', () => {
        const snap = extractDeploymentSnapshot(healthyDeployment);
        expect(snap.kind).toBe('Deployment');
        expect(snap.name).toBe('web-app');
        expect(snap.phase).toBe('Available');
        expect(snap.ready).toBe(true);
        expect(snap.replicas).toEqual({ desired: 3, ready: 3, unavailable: 0 });
        expect(snap.warnings).toEqual([]);
    });

    it('extracts a degraded deployment with unavailable replicas', () => {
        const snap = extractDeploymentSnapshot(degradedDeployment);
        expect(snap.name).toBe('api-gateway');
        expect(snap.phase).toBe('Degraded');
        expect(snap.ready).toBe(false);
        expect(snap.replicas).toEqual({ desired: 5, ready: 3, unavailable: 2 });
        expect(snap.warnings).toContain('2 unavailable replica(s)');
    });

    it('handles a minimal/empty deployment object', () => {
        const snap = extractDeploymentSnapshot({});
        expect(snap.kind).toBe('Deployment');
        expect(snap.name).toBe('');
        expect(snap.phase).toBe('Unknown');
        expect(snap.replicas).toEqual({ desired: 0, ready: 0, unavailable: 0 });
    });
});

describe('extractNodeSnapshot', () => {
    it('extracts a ready node', () => {
        const snap = extractNodeSnapshot(readyNode);
        expect(snap.kind).toBe('Node');
        expect(snap.name).toBe('ip-10-0-1-42');
        expect(snap.namespace).toBeNull();
        expect(snap.phase).toBe('Ready');
        expect(snap.ready).toBe(true);
        expect(snap.warnings).toEqual([]);
        expect(snap.resourceUsage).toEqual({
            cpuRequests: '4', memoryRequests: '16Gi',
            cpuLimits: '4', memoryLimits: '16Gi',
        });
    });

    it('extracts a not-ready node with memory pressure', () => {
        const snap = extractNodeSnapshot(notReadyNode);
        expect(snap.phase).toBe('NotReady');
        expect(snap.ready).toBe(false);
        expect(snap.warnings).toContain('MemoryPressure');
        expect(snap.warnings).toContain('container runtime not ready');
    });

    it('handles a minimal/empty node object', () => {
        const snap = extractNodeSnapshot({});
        expect(snap.kind).toBe('Node');
        expect(snap.name).toBe('');
        expect(snap.namespace).toBeNull();
        expect(snap.phase).toBe('NotReady');
        expect(snap.ready).toBe(false);
    });
});
