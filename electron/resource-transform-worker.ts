/**
 * Resource Transform Worker - A Node.js worker_threads worker that transforms
 * raw Kubernetes API objects into UI-ready format off the main thread.
 *
 * Feature: ui-performance-optimization
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { parentPort } from 'worker_threads';
import type { BatchEvent } from './watcher-batch-buffer';

// --- Interfaces ---

type K8sObject = Record<string, unknown>;

export interface TransformRequest {
    id: string;
    resourceType: 'pod' | 'deployment' | 'node';
    events: BatchEvent<K8sObject>[];
}

export interface TransformResponse {
    id: string;
    resourceType: string;
    events: BatchEvent<K8sObject>[];
    error?: string;
}

// --- Helpers ---

/** Safely access a nested property, returning a fallback if missing. */
function prop(obj: unknown, key: string): unknown {
    if (obj && typeof obj === 'object' && key in obj) {
        return (obj as Record<string, unknown>)[key];
    }
    return undefined;
}

// --- Pod Transformation ---

function transformPod(apiObj: K8sObject): K8sObject {
    const metadata = (prop(apiObj, 'metadata') ?? {}) as K8sObject;
    const status = (prop(apiObj, 'status') ?? {}) as K8sObject;
    const spec = (prop(apiObj, 'spec') ?? {}) as K8sObject;

    const containerStatuses = (prop(status, 'containerStatuses') ?? []) as K8sObject[];
    const initContainerStatuses = (prop(status, 'initContainerStatuses') ?? []) as K8sObject[];
    const allStatuses = [...initContainerStatuses, ...containerStatuses];

    const phase = prop(metadata, 'deletionTimestamp')
        ? 'Terminating'
        : ((prop(status, 'phase') as string) || 'Unknown');

    return {
        name: (prop(metadata, 'name') as string) || '',
        namespace: (prop(metadata, 'namespace') as string) || '',
        status: phase,
        restarts: containerStatuses.reduce(
            (acc: number, c: K8sObject) => acc + ((prop(c, 'restartCount') as number) || 0),
            0
        ),
        age: (prop(metadata, 'creationTimestamp') as string) || '',
        containers: allStatuses.map((c: K8sObject) => {
            const state = (prop(c, 'state') ?? {}) as K8sObject;
            return {
                name: (prop(c, 'name') as string) || '',
                state: prop(state, 'running')
                    ? 'running'
                    : prop(state, 'waiting')
                        ? 'waiting'
                        : 'terminated',
                ready: (prop(c, 'ready') as boolean) ?? false,
                image: (prop(c, 'image') as string) || '',
                restartCount: (prop(c, 'restartCount') as number) || 0,
            };
        }),
        metadata,
        spec,
        node: (prop(spec, 'nodeName') as string) || '',
        rawStatus: status,
    };
}

// --- Deployment Transformation ---

function transformDeployment(apiObj: K8sObject): K8sObject {
    const metadata = (prop(apiObj, 'metadata') ?? {}) as K8sObject;
    const status = (prop(apiObj, 'status') ?? {}) as K8sObject;
    const spec = (prop(apiObj, 'spec') ?? {}) as K8sObject;

    return {
        name: (prop(metadata, 'name') as string) || '',
        namespace: (prop(metadata, 'namespace') as string) || '',
        replicas: (prop(spec, 'replicas') as number) ?? 0,
        availableReplicas: (prop(status, 'availableReplicas') as number) ?? 0,
        status,
        metadata,
        spec,
    };
}

// --- Node Transformation ---

function transformNode(apiObj: K8sObject): K8sObject {
    const metadata = (prop(apiObj, 'metadata') ?? {}) as K8sObject;
    const status = (prop(apiObj, 'status') ?? {}) as K8sObject;
    const spec = (prop(apiObj, 'spec') ?? {}) as K8sObject;

    const conditions = (prop(status, 'conditions') ?? []) as K8sObject[];
    const isReady = conditions.find(
        (c: K8sObject) => prop(c, 'type') === 'Ready'
    );
    const nodeInfo = (prop(status, 'nodeInfo') ?? {}) as K8sObject;
    const capacity = (prop(status, 'capacity') ?? {}) as K8sObject;
    const labels = (prop(metadata, 'labels') ?? {}) as Record<string, string>;

    return {
        name: (prop(metadata, 'name') as string) || '',
        status: isReady && prop(isReady, 'status') === 'True' ? 'Ready' : 'NotReady',
        roles: Object.keys(labels)
            .filter((k: string) => k.startsWith('node-role.kubernetes.io/'))
            .map((k: string) => k.split('/')[1])
            .join(', ') || 'worker',
        version: (prop(nodeInfo, 'kubeletVersion') as string) || '',
        age: (prop(metadata, 'creationTimestamp') as string) || '',
        cpu: (prop(capacity, 'cpu') as string) || '',
        memory: (prop(capacity, 'memory') as string) || '',
        metadata,
        spec,
        statusObj: status,
    };
}

// --- Request Handler ---

function handleRequest(request: TransformRequest): TransformResponse {
    const { id, resourceType, events } = request;
    const transformedEvents: BatchEvent<K8sObject>[] = [];
    const errors: string[] = [];

    for (const event of events) {
        try {
            let transformed: K8sObject;
            if (resourceType === 'pod') {
                transformed = transformPod(event.resource);
            } else if (resourceType === 'deployment') {
                transformed = transformDeployment(event.resource);
            } else if (resourceType === 'node') {
                transformed = transformNode(event.resource);
            } else {
                // Unknown resource type — pass through as-is
                transformed = event.resource;
            }
            transformedEvents.push({ type: event.type, resource: transformed });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'unknown error';
            errors.push(`Failed to transform ${resourceType}: ${message}`);
        }
    }

    const response: TransformResponse = {
        id,
        resourceType,
        events: transformedEvents,
    };

    if (errors.length > 0) {
        response.error = errors.join('; ');
    }

    return response;
}

// --- Worker Message Listener ---

if (parentPort) {
    parentPort.on('message', (message: TransformRequest) => {
        try {
            const response = handleRequest(message);
            parentPort!.postMessage(response);
        } catch (err: unknown) {
            const errMessage = err instanceof Error ? err.message : 'unknown error';
            // Catch-all for completely unexpected failures
            const errorResponse: TransformResponse = {
                id: message?.id || 'unknown',
                resourceType: message?.resourceType || 'unknown',
                events: [],
                error: `Worker error: ${errMessage}`,
            };
            parentPort!.postMessage(errorResponse);
        }
    });
}
