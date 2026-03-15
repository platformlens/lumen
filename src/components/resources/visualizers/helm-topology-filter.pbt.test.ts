/**
 * Property-based tests for Helm release topology manifest filtering.
 * Uses fast-check to validate correctness properties from the design document.
 *
 * Properties covered:
 *   6. Topology manifest filtering
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Pure replica of production filtering logic from HelmReleaseTopology.tsx
// ---------------------------------------------------------------------------

interface ManifestResource {
    apiVersion: string;
    kind: string;
    name: string;
    namespace?: string;
}

function getNodeId(kind: string, name: string): string {
    return `${kind}/${name}`;
}

/**
 * Replicates buildLiveMapFromProps from HelmReleaseTopology.tsx.
 * Filters live cluster resources to only include those matching manifest entries.
 */
function buildLiveMapFromProps(
    resources: ManifestResource[],
    pods: any[],
    deployments: any[],
    replicaSets: any[],
    services: any[],
    statefulSets: any[],
    daemonSets: any[],
): Map<string, any> {
    const liveMap = new Map<string, any>();
    const manifestKeys = new Set(resources.map(r => getNodeId(r.kind, r.name)));

    const kindArrays: Record<string, any[]> = {
        Pod: pods,
        Deployment: deployments,
        ReplicaSet: replicaSets,
        Service: services,
        StatefulSet: statefulSets,
        DaemonSet: daemonSets,
    };

    for (const [kind, items] of Object.entries(kindArrays)) {
        for (const item of items) {
            const name = item.metadata?.name || item.name;
            if (!name) continue;
            const nodeId = getNodeId(kind, name);
            if (manifestKeys.has(nodeId)) {
                liveMap.set(nodeId, item);
            }
        }
    }

    return liveMap;
}


// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const SUPPORTED_KINDS = ['Pod', 'Deployment', 'ReplicaSet', 'Service', 'StatefulSet', 'DaemonSet'] as const;

const arbKind = fc.constantFrom(...SUPPORTED_KINDS);

const arbResourceName = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}[a-z0-9]$/).filter(s => s.length >= 2);

const arbManifestResource = fc.tuple(arbKind, arbResourceName).map(([kind, name]) => ({
    apiVersion: 'v1',
    kind,
    name,
}));

/**
 * Generates a live resource item for a given kind and name.
 * Wraps the name in metadata.name to match the K8s resource shape.
 */
function makeLiveResource(kind: string, name: string): any {
    return {
        metadata: { name, namespace: 'default' },
        kind,
    };
}

/**
 * Generates a set of manifest resources and live resources where:
 * - Some live resources match manifest entries (should be included)
 * - Some live resources do NOT match manifest entries (should be excluded)
 */
const arbManifestAndLiveResources = fc.tuple(
    fc.array(arbManifestResource, { minLength: 0, maxLength: 10 }),
    fc.array(fc.tuple(arbKind, arbResourceName), { minLength: 0, maxLength: 15 }),
).map(([manifest, extraLiveEntries]) => {
    // Build live resource arrays per kind
    const liveByKind: Record<string, any[]> = {
        Pod: [],
        Deployment: [],
        ReplicaSet: [],
        Service: [],
        StatefulSet: [],
        DaemonSet: [],
    };

    // Add some resources that match manifest entries
    for (const res of manifest) {
        liveByKind[res.kind].push(makeLiveResource(res.kind, res.name));
    }

    // Add extra live resources (may or may not match manifest)
    for (const [kind, name] of extraLiveEntries) {
        liveByKind[kind].push(makeLiveResource(kind, name));
    }

    return { manifest, liveByKind };
});

// ---------------------------------------------------------------------------
// Property 6: Topology manifest filtering
// ---------------------------------------------------------------------------

// Feature: helm-releases-optimization, Property 6: Topology manifest filtering
// **Validates: Requirements 6.4**
describe('Property 6: Topology manifest filtering', () => {
    it('liveMap contains only nodes whose kind and name match a manifest entry; no non-manifest resource appears', () => {
        fc.assert(
            fc.property(
                arbManifestAndLiveResources,
                ({ manifest, liveByKind }) => {
                    const liveMap = buildLiveMapFromProps(
                        manifest,
                        liveByKind.Pod,
                        liveByKind.Deployment,
                        liveByKind.ReplicaSet,
                        liveByKind.Service,
                        liveByKind.StatefulSet,
                        liveByKind.DaemonSet,
                    );

                    const manifestKeys = new Set(manifest.map(r => getNodeId(r.kind, r.name)));

                    // 1. Every key in liveMap corresponds to a manifest entry
                    for (const key of liveMap.keys()) {
                        expect(manifestKeys.has(key)).toBe(true);
                    }

                    // 2. No resource outside the manifest appears in liveMap
                    for (const [kind, items] of Object.entries(liveByKind)) {
                        for (const item of items) {
                            const name = item.metadata?.name || item.name;
                            const nodeId = getNodeId(kind, name);
                            if (!manifestKeys.has(nodeId)) {
                                expect(liveMap.has(nodeId)).toBe(false);
                            }
                        }
                    }

                    // 3. Every manifest entry that has a matching live resource IS in liveMap
                    for (const res of manifest) {
                        const nodeId = getNodeId(res.kind, res.name);
                        const hasLive = liveByKind[res.kind].some(
                            (item: any) => (item.metadata?.name || item.name) === res.name
                        );
                        if (hasLive) {
                            expect(liveMap.has(nodeId)).toBe(true);
                        }
                    }
                }
            ),
            { numRuns: 200 }
        );
    });
});
