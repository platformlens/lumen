import { describe, it, expect } from 'vitest';
import { toLogTarget, firstMainContainerName } from './deployment-log-utils';
import type { DeploymentPodContainerStatus, DeploymentPodSummary, PodTemplate } from '../types/deployment-details';

const c = (name: string, kind: DeploymentPodContainerStatus['kind']): DeploymentPodContainerStatus => ({
    name, kind, ready: true, started: true, restartCount: 0, state: 'running', reason: null, lastTerminationReason: null, image: 'i', imageID: '',
});

const pod = (containers: DeploymentPodContainerStatus[]): DeploymentPodSummary => ({
    name: 'web-1', uid: 'u', namespace: 'prod', phase: 'Running', displayStatus: 'Running', readyContainers: 1, totalContainers: 1,
    restarts: 0, nodeName: null, podIP: null, hostIP: null, createdAt: '', startTime: null, deletionTimestamp: null, qosClass: null,
    podTemplateHash: null, ownerReplicaSet: null, unschedulableMessage: null, containers,
});

const template: PodTemplate = {
    spec: { containers: [{ name: 't-app' }, { name: 't-side' }], initContainers: [{ name: 't-init' }] },
};

describe('toLogTarget', () => {
    it('puts main containers in spec.containers and init + sidecar in spec.initContainers', () => {
        const target = toLogTarget(pod([c('init', 'init'), c('proxy', 'sidecar'), c('app', 'main'), c('worker', 'main')]), template);
        expect(target).toEqual({
            name: 'web-1', namespace: 'prod',
            spec: { containers: [{ name: 'app' }, { name: 'worker' }], initContainers: [{ name: 'init' }, { name: 'proxy' }] },
        });
    });

    it('falls back to template names when the pod lists no containers', () => {
        expect(toLogTarget(pod([]), template).spec).toEqual({
            containers: [{ name: 't-app' }, { name: 't-side' }], initContainers: [{ name: 't-init' }],
        });
        expect(toLogTarget(pod([]), {}).spec).toEqual({ containers: [], initContainers: [] });
    });
});

describe('firstMainContainerName', () => {
    it('skips init and sidecar entries', () => {
        expect(firstMainContainerName(pod([c('init', 'init'), c('proxy', 'sidecar'), c('app', 'main')]), template)).toBe('app');
    });

    it('falls back to the template, then empty string', () => {
        expect(firstMainContainerName(pod([c('init', 'init')]), template)).toBe('t-app');
        expect(firstMainContainerName(pod([]), {})).toBe('');
    });
});
