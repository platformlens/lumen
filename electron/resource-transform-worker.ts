/**
 * Resource Transform Worker - A Node.js worker_threads worker that transforms
 * raw Kubernetes API objects into UI-ready format off the main thread.
 *
 * Feature: ui-performance-optimization
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { parentPort } from 'worker_threads';
import zlib from 'zlib';
import type { BatchEvent } from './watcher-batch-buffer';

// --- Interfaces ---

type K8sObject = Record<string, unknown>;

export interface TransformRequest {
    id: string;
    resourceType: 'pod' | 'deployment' | 'node' | 'replicaset' | 'secret' | 'persistentvolume' | 'persistentvolumeclaim' | 'helmrelease';
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
        age: (prop(metadata, 'creationTimestamp') as string) || '',
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

// --- ReplicaSet Transformation ---

function transformReplicaSet(apiObj: K8sObject): K8sObject {
    const metadata = (prop(apiObj, 'metadata') ?? {}) as K8sObject;
    const status = (prop(apiObj, 'status') ?? {}) as K8sObject;
    const spec = (prop(apiObj, 'spec') ?? {}) as K8sObject;

    return {
        name: (prop(metadata, 'name') as string) || '',
        namespace: (prop(metadata, 'namespace') as string) || '',
        desired: (prop(spec, 'replicas') as number) ?? 0,
        current: (prop(status, 'replicas') as number) ?? 0,
        ready: (prop(status, 'readyReplicas') as number) ?? 0,
        age: (prop(metadata, 'creationTimestamp') as string) || '',
        metadata,
        spec,
    };
}

// --- Secret Transformation ---

function transformSecret(apiObj: K8sObject): K8sObject {
    const metadata = (prop(apiObj, 'metadata') ?? {}) as K8sObject;
    const data = (prop(apiObj, 'data') ?? {}) as Record<string, unknown>;

    return {
        name: (prop(metadata, 'name') as string) || '',
        namespace: (prop(metadata, 'namespace') as string) || '',
        type: (prop(apiObj, 'type') as string) || '',
        data: Object.keys(data).length,
        age: (prop(metadata, 'creationTimestamp') as string) || '',
        metadata,
    };
}

// --- PersistentVolume Transformation ---

function transformPersistentVolume(apiObj: K8sObject): K8sObject {
    const metadata = (prop(apiObj, 'metadata') ?? {}) as K8sObject;
    const spec = (prop(apiObj, 'spec') ?? {}) as K8sObject;
    const status = (prop(apiObj, 'status') ?? {}) as K8sObject;
    const capacity = (prop(spec, 'capacity') ?? {}) as K8sObject;
    const claimRef = (prop(spec, 'claimRef') ?? null) as K8sObject | null;

    return {
        name: (prop(metadata, 'name') as string) || '',
        capacity: (prop(capacity, 'storage') as string) || '',
        accessModes: ((prop(spec, 'accessModes') ?? []) as string[]).join(', '),
        reclaimPolicy: (prop(spec, 'persistentVolumeReclaimPolicy') as string) || '',
        status: (prop(status, 'phase') as string) || '',
        claim: claimRef
            ? `${(prop(claimRef, 'namespace') as string) || ''}/${(prop(claimRef, 'name') as string) || ''}`
            : '',
        storageClass: (prop(spec, 'storageClassName') as string) || '',
        age: (prop(metadata, 'creationTimestamp') as string) || '',
        metadata,
        spec,
        statusRaw: status,
    };
}

// --- PersistentVolumeClaim Transformation ---

function transformPersistentVolumeClaim(apiObj: K8sObject): K8sObject {
    const metadata = (prop(apiObj, 'metadata') ?? {}) as K8sObject;
    const spec = (prop(apiObj, 'spec') ?? {}) as K8sObject;
    const status = (prop(apiObj, 'status') ?? {}) as K8sObject;
    const statusCapacity = (prop(status, 'capacity') ?? {}) as K8sObject;

    return {
        name: (prop(metadata, 'name') as string) || '',
        namespace: (prop(metadata, 'namespace') as string) || '',
        status: (prop(status, 'phase') as string) || '',
        volume: (prop(spec, 'volumeName') as string) || '',
        capacity: (prop(statusCapacity, 'storage') as string) || '',
        accessModes: ((prop(spec, 'accessModes') ?? []) as string[]).join(', '),
        storageClass: (prop(spec, 'storageClassName') as string) || '',
        age: (prop(metadata, 'creationTimestamp') as string) || '',
        metadata,
        spec,
        statusRaw: status,
    };
}

// --- Helm Release Transformation ---

function transformHelmRelease(apiObj: K8sObject): K8sObject {
    const metadata = (prop(apiObj, 'metadata') ?? {}) as K8sObject;
    const data = (prop(apiObj, 'data') ?? {}) as Record<string, unknown>;

    const releaseB64 = data.release as string | undefined;
    if (!releaseB64) {
        throw new Error('Missing data.release field in Helm secret');
    }

    // Step 1: Base64 decode (K8s secret base64)
    let buf = Buffer.from(releaseB64, 'base64');

    // Step 2: Check gzip magic bytes — if not gzip, it's double-encoded (Helm base64 on top)
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
        buf = Buffer.from(buf.toString('utf-8'), 'base64');
    }

    // Step 3: Gzip decompress
    const decompressed = zlib.gunzipSync(buf);

    // Step 4: JSON parse
    const release = JSON.parse(decompressed.toString('utf-8')) as K8sObject;

    const info = (prop(release, 'info') ?? {}) as K8sObject;
    const chart = (prop(release, 'chart') ?? {}) as K8sObject;
    const chartMetadata = (prop(chart, 'metadata') ?? {}) as K8sObject;

    return {
        name: (prop(release, 'name') as string) || '',
        namespace: (prop(metadata, 'namespace') as string) || '',
        revision: (prop(release, 'version') as number) || 0,
        status: (prop(info, 'status') as string) || '',
        chart: (prop(chartMetadata, 'name') as string) || '',
        chartVersion: (prop(chartMetadata, 'version') as string) || '',
        appVersion: (prop(chartMetadata, 'appVersion') as string) || '',
        lastUpdated: (prop(info, 'last_deployed') as string) || '',
        description: (prop(info, 'description') as string) || '',
        secretName: (prop(metadata, 'name') as string) || '',
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
            } else if (resourceType === 'replicaset') {
                transformed = transformReplicaSet(event.resource);
            } else if (resourceType === 'secret') {
                transformed = transformSecret(event.resource);
            } else if (resourceType === 'persistentvolume') {
                transformed = transformPersistentVolume(event.resource);
            } else if (resourceType === 'persistentvolumeclaim') {
                transformed = transformPersistentVolumeClaim(event.resource);
            } else if (resourceType === 'helmrelease') {
                transformed = transformHelmRelease(event.resource);
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
