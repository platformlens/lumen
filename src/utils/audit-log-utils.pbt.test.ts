/**
 * Property-based tests for audit-log-utils.
 * Uses fast-check to validate correctness properties from the design document.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    parseAuditLogEvent,
    filterByNamespace,
    filterByUsername,
    filterByVerbs,
    sortAuditEntries,
    buildLogGroupPath,
    KUBERNETES_VERBS,
    type AuditLogEntry,
} from './audit-log-utils';

// ─── Arbitrary: valid Kubernetes audit log JSON object ───────────────────────
// Sub-task 3.1

/** Generates a valid Kubernetes audit log JSON object with all required fields. */
const arbAuditLogJson = (): fc.Arbitrary<Record<string, unknown>> =>
    fc.record({
        verb: fc.constantFrom(...KUBERNETES_VERBS),
        user: fc.record({
            username: fc.string({ minLength: 1, maxLength: 40 }).filter(s => s.trim().length > 0),
            groups: fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0), { minLength: 0, maxLength: 4 }),
        }),
        objectRef: fc.record({
            namespace: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
            resource: fc.constantFrom('pods', 'deployments', 'services', 'configmaps', 'secrets', 'nodes', 'namespaces'),
            name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
        }),
        responseStatus: fc.record({
            code: fc.constantFrom(200, 201, 204, 400, 401, 403, 404, 409, 500),
        }),
        sourceIPs: fc.array(
            fc.tuple(fc.nat({ max: 255 }), fc.nat({ max: 255 }), fc.nat({ max: 255 }), fc.nat({ max: 255 }))
                .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
            { minLength: 1, maxLength: 3 },
        ),
        userAgent: fc.string({ minLength: 1, maxLength: 60 }).filter(s => s.trim().length > 0),
        requestReceivedTimestamp: fc.integer({ min: 1577836800000, max: 1893456000000 })
            .map(ms => new Date(ms).toISOString()),
        stageTimestamp: fc.integer({ min: 1577836800000, max: 1893456000000 })
            .map(ms => new Date(ms).toISOString()),
    });

/** Converts an audit log object to a JSON string. */
const arbAuditLogJsonString = (): fc.Arbitrary<string> =>
    arbAuditLogJson().map(obj => JSON.stringify(obj));

/** Generates a valid AuditLogEntry by parsing a generated JSON string. */
const arbAuditLogEntry = (): fc.Arbitrary<AuditLogEntry> =>
    arbAuditLogJsonString().map(json => parseAuditLogEvent(json)!).filter(e => e !== null);


// ─── Property 1: Log group path construction ─────────────────────────────────
// Feature: eks-audit-logs, Property 1: Log group path construction
// **Validates: Requirements 2.1**
describe('Property 1: Log group path construction', () => {
    it('for any cluster name, buildLogGroupPath returns /aws/eks/${name}/cluster', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
                (clusterName) => {
                    const result = buildLogGroupPath(clusterName);
                    expect(result).toBe(`/aws/eks/${clusterName}/cluster`);
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ─── Property 2: Parsing extracts all required fields ────────────────────────
// Feature: eks-audit-logs, Property 2: Audit log parsing extracts all required fields
// **Validates: Requirements 3.1**
describe('Property 2: Parsing extracts all required fields', () => {
    it('for any valid audit log JSON, parsed entry fields match source paths', () => {
        fc.assert(
            fc.property(arbAuditLogJson(), (obj) => {
                const json = JSON.stringify(obj);
                const entry = parseAuditLogEvent(json);

                expect(entry).not.toBeNull();
                if (!entry) return;

                const user = obj.user as { username: string; groups: string[] };
                const objectRef = obj.objectRef as { namespace: string; resource: string; name: string };
                const responseStatus = obj.responseStatus as { code: number };
                const sourceIPs = obj.sourceIPs as string[];

                expect(entry.verb).toBe(obj.verb);
                expect(entry.username).toBe(user.username);
                expect(entry.groups).toEqual(user.groups);
                expect(entry.namespace).toBe(objectRef.namespace);
                expect(entry.resource).toBe(objectRef.resource);
                expect(entry.resourceName).toBe(objectRef.name);
                expect(entry.statusCode).toBe(responseStatus.code);
                expect(entry.sourceIP).toBe(sourceIPs[0]);
                expect(entry.userAgent).toBe(obj.userAgent);
                expect(entry.timestamp).toBe(obj.requestReceivedTimestamp);
                expect(entry.rawEvent).toBe(json);
            }),
            { numRuns: 100 },
        );
    });
});

// ─── Property 3: Malformed JSON entries are skipped ──────────────────────────
// Feature: eks-audit-logs, Property 3: Malformed JSON entries are skipped
// **Validates: Requirements 3.2**
describe('Property 3: Malformed JSON entries are skipped', () => {
    it('for any mixed array of valid/invalid JSON, only valid entries are returned', () => {
        const arbMalformed = fc.string({ minLength: 1, maxLength: 50 })
            .filter(s => {
                try { JSON.parse(s); return false; } catch { return true; }
            });

        fc.assert(
            fc.property(
                fc.array(
                    fc.oneof(
                        arbAuditLogJsonString().map(s => ({ raw: s, valid: true })),
                        arbMalformed.map(s => ({ raw: s, valid: false })),
                    ),
                    { minLength: 1, maxLength: 20 },
                ),
                (items) => {
                    const results = items
                        .map(item => parseAuditLogEvent(item.raw))
                        .filter((e): e is AuditLogEntry => e !== null);

                    const expectedValidCount = items.filter(i => i.valid).length;
                    expect(results.length).toBe(expectedValidCount);

                    // Every result must be a valid AuditLogEntry
                    for (const entry of results) {
                        expect(entry).toHaveProperty('id');
                        expect(entry).toHaveProperty('verb');
                        expect(entry).toHaveProperty('rawEvent');
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});


// ─── Property 4: Missing namespace defaults to cluster-scoped ────────────────
// Feature: eks-audit-logs, Property 4: Missing namespace defaults to cluster-scoped
// **Validates: Requirements 3.4**
describe('Property 4: Missing namespace defaults to cluster-scoped', () => {
    it('for any audit log JSON without objectRef.namespace, parsed namespace equals "cluster-scoped"', () => {
        fc.assert(
            fc.property(arbAuditLogJson(), (obj) => {
                // Remove namespace from objectRef
                const modified = { ...obj };
                const objectRef = { ...(modified.objectRef as Record<string, unknown>) };
                delete objectRef.namespace;
                modified.objectRef = objectRef;

                const json = JSON.stringify(modified);
                const entry = parseAuditLogEvent(json);

                expect(entry).not.toBeNull();
                if (!entry) return;

                expect(entry.namespace).toBe('cluster-scoped');
            }),
            { numRuns: 100 },
        );
    });
});

// ─── Property 5: Parsing round-trip ──────────────────────────────────────────
// Feature: eks-audit-logs, Property 5: Parsing round-trip
// **Validates: Requirements 3.6**
describe('Property 5: Parsing round-trip', () => {
    it('for any valid AuditLogEntry, parsing its rawEvent produces equivalent field values', () => {
        fc.assert(
            fc.property(arbAuditLogEntry(), (entry) => {
                const reparsed = parseAuditLogEvent(entry.rawEvent);

                expect(reparsed).not.toBeNull();
                if (!reparsed) return;

                expect(reparsed.timestamp).toBe(entry.timestamp);
                expect(reparsed.verb).toBe(entry.verb);
                expect(reparsed.username).toBe(entry.username);
                expect(reparsed.groups).toEqual(entry.groups);
                expect(reparsed.namespace).toBe(entry.namespace);
                expect(reparsed.resource).toBe(entry.resource);
                expect(reparsed.resourceName).toBe(entry.resourceName);
                expect(reparsed.statusCode).toBe(entry.statusCode);
                expect(reparsed.sourceIP).toBe(entry.sourceIP);
                expect(reparsed.userAgent).toBe(entry.userAgent);
            }),
            { numRuns: 100 },
        );
    });
});

// ─── Property 6: Text filter returns only matching entries ───────────────────
// Feature: eks-audit-logs, Property 6: Text filter returns only matching entries
// **Validates: Requirements 4.2, 8.2**
describe('Property 6: Text filter returns only matching entries', () => {
    it('namespace filter returns only entries containing the text case-insensitively', () => {
        fc.assert(
            fc.property(
                fc.array(arbAuditLogEntry(), { minLength: 0, maxLength: 20 }),
                fc.string({ minLength: 1, maxLength: 15 }).filter(s => s.trim().length > 0),
                (entries, filterText) => {
                    const result = filterByNamespace(entries, filterText);
                    const lower = filterText.toLowerCase();

                    // Every result must contain the filter text
                    for (const entry of result) {
                        expect(entry.namespace.toLowerCase()).toContain(lower);
                    }

                    // Every entry that matches must be in the result
                    const expected = entries.filter(e => e.namespace.toLowerCase().includes(lower));
                    expect(result.length).toBe(expected.length);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('username filter returns only entries containing the text case-insensitively', () => {
        fc.assert(
            fc.property(
                fc.array(arbAuditLogEntry(), { minLength: 0, maxLength: 20 }),
                fc.string({ minLength: 1, maxLength: 15 }).filter(s => s.trim().length > 0),
                (entries, filterText) => {
                    const result = filterByUsername(entries, filterText);
                    const lower = filterText.toLowerCase();

                    // Every result must contain the filter text
                    for (const entry of result) {
                        expect(entry.username.toLowerCase()).toContain(lower);
                    }

                    // Every entry that matches must be in the result
                    const expected = entries.filter(e => e.username.toLowerCase().includes(lower));
                    expect(result.length).toBe(expected.length);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('empty filter returns all entries', () => {
        fc.assert(
            fc.property(
                fc.array(arbAuditLogEntry(), { minLength: 0, maxLength: 20 }),
                (entries) => {
                    expect(filterByNamespace(entries, '')).toEqual(entries);
                    expect(filterByUsername(entries, '')).toEqual(entries);
                },
            ),
            { numRuns: 100 },
        );
    });
});


// ─── Property 7: Verb filter returns only entries with selected verbs ────────
// Feature: eks-audit-logs, Property 7: Verb filter returns only entries with selected verbs
// **Validates: Requirements 5.2**
describe('Property 7: Verb filter returns only entries with selected verbs', () => {
    it('for any entries and verb subset, filter returns only matching entries', () => {
        fc.assert(
            fc.property(
                fc.array(arbAuditLogEntry(), { minLength: 0, maxLength: 20 }),
                fc.subarray([...KUBERNETES_VERBS]),
                (entries, selectedVerbs) => {
                    const result = filterByVerbs(entries, [...selectedVerbs]);

                    if (selectedVerbs.length === 0) {
                        // Empty verb set returns all entries
                        expect(result).toEqual(entries);
                    } else {
                        const verbSet = new Set(selectedVerbs);

                        // Every result must have a verb in the selected set
                        for (const entry of result) {
                            expect(verbSet.has(entry.verb)).toBe(true);
                        }

                        // Every entry with a matching verb must be in the result
                        const expected = entries.filter(e => verbSet.has(e.verb));
                        expect(result.length).toBe(expected.length);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ─── Property 8: Sorting produces correctly ordered results ──────────────────
// Feature: eks-audit-logs, Property 8: Sorting produces correctly ordered results
// **Validates: Requirements 7.2**
describe('Property 8: Sorting produces correctly ordered results', () => {
    const sortableStringKeys: (keyof AuditLogEntry)[] = [
        'timestamp', 'verb', 'username', 'namespace', 'resource', 'resourceName', 'sourceIP', 'userAgent',
    ];

    it('ascending sort on string keys produces non-decreasing order', () => {
        fc.assert(
            fc.property(
                fc.array(arbAuditLogEntry(), { minLength: 0, maxLength: 20 }),
                fc.constantFrom(...sortableStringKeys),
                (entries, key) => {
                    const sorted = sortAuditEntries(entries, key, 'asc');

                    expect(sorted.length).toBe(entries.length);

                    for (let i = 1; i < sorted.length; i++) {
                        const prev = String(sorted[i - 1][key]);
                        const curr = String(sorted[i][key]);
                        expect(prev.localeCompare(curr)).toBeLessThanOrEqual(0);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it('ascending sort on statusCode produces non-decreasing numeric order', () => {
        fc.assert(
            fc.property(
                fc.array(arbAuditLogEntry(), { minLength: 0, maxLength: 20 }),
                (entries) => {
                    const sorted = sortAuditEntries(entries, 'statusCode', 'asc');

                    expect(sorted.length).toBe(entries.length);

                    for (let i = 1; i < sorted.length; i++) {
                        expect(sorted[i - 1].statusCode).toBeLessThanOrEqual(sorted[i].statusCode);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it('descending sort produces reverse of ascending sort', () => {
        fc.assert(
            fc.property(
                fc.array(arbAuditLogEntry(), { minLength: 0, maxLength: 20 }),
                fc.constantFrom(...sortableStringKeys, 'statusCode' as keyof AuditLogEntry),
                (entries, key) => {
                    const asc = sortAuditEntries(entries, key, 'asc');
                    const desc = sortAuditEntries(entries, key, 'desc');

                    expect(desc).toEqual([...asc].reverse());
                },
            ),
            { numRuns: 100 },
        );
    });
});
