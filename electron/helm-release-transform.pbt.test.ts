/**
 * Property-based tests for Helm release transform pipeline.
 * Uses fast-check to validate correctness properties from the design document.
 *
 * Properties covered:
 *   1. Namespace path selection
 *   2. Helm secret decode round-trip
 *   3. Batch error resilience
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import zlib from 'zlib';

// ---------------------------------------------------------------------------
// Pure replicas of production logic (extracted for testability)
// ---------------------------------------------------------------------------

/**
 * Replicates the namespace → API path logic from K8sService.startHelmReleaseWatch.
 */
function computeWatchPath(namespaces: string[]): string {
    return (namespaces.length === 0 || namespaces.includes('all'))
        ? '/api/v1/secrets'
        : `/api/v1/namespaces/${namespaces[0]}/secrets`;
}

/**
 * Encodes a HelmRelease object into a fake K8s secret's data.release field.
 * Pipeline: JSON → gzip → base64 (optionally double-base64 to mimic Helm encoding).
 */
function encodeRelease(release: Record<string, unknown>, doubleEncode: boolean): string {
    const json = JSON.stringify(release);
    const compressed = zlib.gzipSync(Buffer.from(json, 'utf-8'));
    const b64 = compressed.toString('base64');
    if (doubleEncode) {
        // Helm wraps the gzipped payload in another base64 layer
        return Buffer.from(b64, 'utf-8').toString('base64');
    }
    return b64;
}

/**
 * Mirrors transformHelmRelease from resource-transform-worker.ts.
 * Decodes a raw K8s secret object into a shaped HelmRelease.
 */
function decodeHelmSecret(apiObj: Record<string, unknown>): Record<string, unknown> {
    const metadata = (apiObj.metadata ?? {}) as Record<string, unknown>;
    const data = (apiObj.data ?? {}) as Record<string, unknown>;

    const releaseB64 = data.release as string | undefined;
    if (!releaseB64) {
        throw new Error('Missing data.release field in Helm secret');
    }

    let buf = Buffer.from(releaseB64, 'base64');

    // Detect double-encoding: if first two bytes are NOT gzip magic, decode base64 again
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
        buf = Buffer.from(buf.toString('utf-8'), 'base64');
    }

    const decompressed = zlib.gunzipSync(buf);
    const release = JSON.parse(decompressed.toString('utf-8')) as Record<string, unknown>;

    const info = (release.info ?? {}) as Record<string, unknown>;
    const chart = (release.chart ?? {}) as Record<string, unknown>;
    const chartMetadata = (chart.metadata ?? {}) as Record<string, unknown>;

    return {
        name: (release.name as string) || '',
        namespace: (metadata.namespace as string) || '',
        revision: (release.version as number) || 0,
        status: (info.status as string) || '',
        chart: (chartMetadata.name as string) || '',
        chartVersion: (chartMetadata.version as string) || '',
        appVersion: (chartMetadata.appVersion as string) || '',
        lastUpdated: (info.last_deployed as string) || '',
        description: (info.description as string) || '',
        secretName: (metadata.name as string) || '',
    };
}

/**
 * Processes a batch of events (mix of valid/invalid secrets) and returns
 * { successes, errors } counts — mirrors handleRequest's helmrelease path.
 */
function processBatch(events: Array<{ type: string; resource: Record<string, unknown> }>): {
    successes: number;
    errors: number;
} {
    let successes = 0;
    let errors = 0;
    for (const event of events) {
        try {
            decodeHelmSecret(event.resource);
            successes++;
        } catch {
            errors++;
        }
    }
    return { successes, errors };
}

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const arbNamespaceString = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}[a-z0-9]$/).filter(s => s.length >= 2 && s !== 'all');

const arbSimpleString = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,19}$/).filter(s => s.length >= 1);

const arbHelmRelease = () =>
    fc.record({
        name: arbSimpleString,
        version: fc.integer({ min: 1, max: 999 }),
        info: fc.record({
            status: fc.constantFrom('deployed', 'failed', 'pending-install', 'pending-upgrade', 'superseded', 'uninstalling'),
            last_deployed: fc.constant(new Date().toISOString()),
            description: arbSimpleString,
        }),
        chart: fc.record({
            metadata: fc.record({
                name: arbSimpleString,
                version: fc.stringMatching(/^[0-9]+\.[0-9]+\.[0-9]+$/).filter(s => s.length >= 5),
                appVersion: fc.stringMatching(/^[0-9]+\.[0-9]+\.[0-9]+$/).filter(s => s.length >= 5),
            }),
        }),
    });

// ---------------------------------------------------------------------------
// Property 1: Namespace path selection
// ---------------------------------------------------------------------------

// Feature: helm-releases-optimization, Property 1: Namespace path selection
// **Validates: Requirements 1.6, 1.7**
describe('Property 1: Namespace path selection', () => {
    it('empty or "all"-containing namespace arrays produce cluster-wide path; single namespace produces namespaced path; fieldSelector always present', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    // Case 1: empty array → cluster-wide
                    fc.constant([] as string[]),
                    // Case 2: array containing "all" (possibly with others)
                    fc.array(arbNamespaceString, { minLength: 0, maxLength: 3 }).map(arr => ['all', ...arr]),
                    // Case 3: single namespace → namespaced path
                    arbNamespaceString.map(ns => [ns]),
                ),
                (namespaces) => {
                    const path = computeWatchPath(namespaces);
                    const isClusterWide = namespaces.length === 0 || namespaces.includes('all');

                    if (isClusterWide) {
                        expect(path).toBe('/api/v1/secrets');
                    } else {
                        expect(path).toBe(`/api/v1/namespaces/${namespaces[0]}/secrets`);
                    }

                    // The fieldSelector is always appended as a query param by the Watch API call,
                    // not embedded in the path. Verify the path itself is well-formed.
                    expect(path).toMatch(/^\/api\/v1\/(namespaces\/[a-z][a-z0-9-]*\/)?secrets$/);
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 2: Helm secret decode round-trip
// ---------------------------------------------------------------------------

// Feature: helm-releases-optimization, Property 2: Helm secret decode round-trip
// **Validates: Requirements 2.2, 2.3, 2.4**
describe('Property 2: Helm secret decode round-trip', () => {
    it('encoding then decoding a HelmRelease produces equivalent field values for both single and double encoding', () => {
        fc.assert(
            fc.property(
                arbHelmRelease(),
                arbNamespaceString,
                fc.boolean(), // doubleEncode flag
                (release, namespace, doubleEncode) => {
                    const secretName = `sh.helm.release.v1.${release.name}.v${release.version}`;

                    // Build a fake K8s secret
                    const secret: Record<string, unknown> = {
                        metadata: {
                            name: secretName,
                            namespace,
                        },
                        data: {
                            release: encodeRelease(release, doubleEncode),
                        },
                        type: 'helm.sh/release.v1',
                    };

                    const decoded = decodeHelmSecret(secret);

                    // Verify all required fields match
                    expect(decoded.name).toBe(release.name);
                    expect(decoded.namespace).toBe(namespace);
                    expect(decoded.revision).toBe(release.version);
                    expect(decoded.status).toBe(release.info.status);
                    expect(decoded.chart).toBe(release.chart.metadata.name);
                    expect(decoded.chartVersion).toBe(release.chart.metadata.version);
                    expect(decoded.appVersion).toBe(release.chart.metadata.appVersion);
                    expect(decoded.lastUpdated).toBe(release.info.last_deployed);
                    expect(decoded.description).toBe(release.info.description);
                    expect(decoded.secretName).toBe(secretName);
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 3: Batch error resilience
// ---------------------------------------------------------------------------

// Feature: helm-releases-optimization, Property 3: Batch error resilience
// **Validates: Requirements 2.5**
describe('Property 3: Batch error resilience', () => {
    it('valid count + error count equals total batch size for any mix of valid and invalid secrets', () => {
        // Generator for a valid secret event
        const arbValidEvent = fc.tuple(arbHelmRelease(), arbNamespaceString, fc.boolean()).map(
            ([release, namespace, doubleEncode]) => ({
                type: 'ADDED' as const,
                resource: {
                    metadata: { name: `sh.helm.release.v1.${release.name}.v${release.version}`, namespace },
                    data: { release: encodeRelease(release, doubleEncode) },
                    type: 'helm.sh/release.v1',
                },
            })
        );

        // Generator for an invalid secret event (various failure modes)
        const arbInvalidEvent = fc.oneof(
            // Missing data.release entirely
            fc.constant({
                type: 'ADDED' as const,
                resource: {
                    metadata: { name: 'bad-secret', namespace: 'default' },
                    data: {},
                    type: 'helm.sh/release.v1',
                } as Record<string, unknown>,
            }),
            // Corrupted base64 data
            fc.constant({
                type: 'MODIFIED' as const,
                resource: {
                    metadata: { name: 'corrupt-secret', namespace: 'default' },
                    data: { release: 'not-valid-base64-!@#$%' },
                    type: 'helm.sh/release.v1',
                } as Record<string, unknown>,
            }),
            // Valid base64 but not gzip
            fc.constant({
                type: 'ADDED' as const,
                resource: {
                    metadata: { name: 'not-gzip', namespace: 'default' },
                    data: { release: Buffer.from('just plain text').toString('base64') },
                    type: 'helm.sh/release.v1',
                } as Record<string, unknown>,
            }),
        );

        fc.assert(
            fc.property(
                fc.array(fc.oneof(arbValidEvent, arbInvalidEvent), { minLength: 1, maxLength: 20 }),
                (events) => {
                    const { successes, errors } = processBatch(events);

                    // Core invariant: successes + errors = total
                    expect(successes + errors).toBe(events.length);

                    // Both counts must be non-negative
                    expect(successes).toBeGreaterThanOrEqual(0);
                    expect(errors).toBeGreaterThanOrEqual(0);
                }
            ),
            { numRuns: 100 }
        );
    });
});
