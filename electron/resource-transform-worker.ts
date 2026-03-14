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

export interface TransformRequest {
    id: string;
    resourceType: 'pod' | 'deployment' | 'node';
    events: BatchEvent<any>[];
}

export interface TransformResponse {
    id: string;
    resourceType: string;
    events: BatchEvent<any>[];
    error?: string;
}

// --- Pod Transformation ---

function transformPod(apiObj: any): any {
    const metadata = apiObj?.metadata || {};
    const status = apiObj?.status || {};
    const spec = apiObj?.spec || {};

    const containerStatuses = status.containerStatuses || [];
    const initContainerStatuses = status.initContainerStatuses || [];
    const allStatuses = [...initContainerStatuses, ...containerStatuses];

    const phase = metadata.deletionTimestamp
        ? 'Terminating'
        : (status.phase || 'Unknown');

    return {
        name: metadata.name || '',
        namespace: metadata.namespace || '',
        status: phase,
        restarts: containerStatuses.reduce(
            (acc: number, c: any) => acc + (c?.restartCount || 0),
            0
        ),
        age: metadata.creationTimestamp || '',
        containers: allStatuses.map((c: any) => ({
            name: c?.name || '',
            state: c?.state?.running
                ? 'running'
                : c?.state?.waiting
                    ? 'waiting'
                    : 'terminated',
            ready: c?.ready ?? false,
            image: c?.image || '',
            restartCount: c?.restartCount || 0,
        })),
        metadata,
        spec,
        node: spec.nodeName || '',
        rawStatus: status,
    };
}

// --- Deployment Transformation ---

function transformDeployment(apiObj: any): any {
    const metadata = apiObj?.metadata || {};
    const status = apiObj?.status || {};
    const spec = apiObj?.spec || {};

    return {
        name: metadata.name || '',
        namespace: metadata.namespace || '',
        replicas: spec.replicas ?? 0,
        availableReplicas: status.availableReplicas ?? 0,
        status,
        metadata,
        spec,
    };
}

// --- Node Transformation ---

function transformNode(apiObj: any): any {
    const metadata = apiObj?.metadata || {};
    const status = apiObj?.status || {};
    const spec = apiObj?.spec || {};

    const isReady = status.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True';

    return {
        name: metadata.name || '',
        status: isReady ? 'Ready' : 'NotReady',
        roles: Object.keys(metadata.labels || {})
            .filter((k: string) => k.startsWith('node-role.kubernetes.io/'))
            .map((k: string) => k.split('/')[1])
            .join(', ') || 'worker',
        version: status.nodeInfo?.kubeletVersion || '',
        age: metadata.creationTimestamp || '',
        cpu: status.capacity?.cpu || '',
        memory: status.capacity?.memory || '',
        metadata,
        spec,
        statusObj: status,
    };
}

// --- Request Handler ---

function handleRequest(request: TransformRequest): TransformResponse {
    const { id, resourceType, events } = request;
    const transformedEvents: BatchEvent<any>[] = [];
    const errors: string[] = [];

    for (const event of events) {
        try {
            let transformed: any;
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
        } catch (err: any) {
            errors.push(
                `Failed to transform ${resourceType}: ${err?.message || 'unknown error'}`
            );
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
        } catch (err: any) {
            // Catch-all for completely unexpected failures
            const errorResponse: TransformResponse = {
                id: message?.id || 'unknown',
                resourceType: message?.resourceType || 'unknown',
                events: [],
                error: `Worker error: ${err?.message || 'unknown error'}`,
            };
            parentPort!.postMessage(errorResponse);
        }
    });
}
