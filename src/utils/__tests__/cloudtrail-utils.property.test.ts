import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    transformCloudTrailEvent,
    classifyIdentityType,
    filterByIdentity,
    filterByEventType,
    computeTimeRange,
    isDateRangeExceeding90Days,
    sortEvents,
    AuditEvent,
} from '../cloudtrail-utils';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a non-empty alphanumeric string (safe for usernames, event names, etc.) */
const nonEmptyAlphaNum = fc.stringMatching(/^[a-z0-9]{1,30}$/);

/** Generates a valid AuditEvent object. */
const auditEventArb: fc.Arbitrary<AuditEvent> = fc.record({
    eventId: nonEmptyAlphaNum,
    eventTime: fc.integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-01-01').getTime() }).map(ts => new Date(ts).toISOString()),
    eventName: fc.constantFrom('CreateCluster', 'DeleteNodegroup', 'UpdateClusterConfig', 'AccessKubernetesApi', 'DescribeCluster'),
    username: fc.oneof(
        nonEmptyAlphaNum,                                                                  // IAM user
        nonEmptyAlphaNum.map(n => `assumed-role/MyRole/${n}`),                              // IAM role
        nonEmptyAlphaNum.map(n => `system:serviceaccount:default:${n}`),                    // Service account
    ),
    sourceIpAddress: fc.ipV4(),
    userAgent: nonEmptyAlphaNum,
    readOnly: fc.boolean(),
    resources: fc.array(fc.record({ resourceType: nonEmptyAlphaNum, resourceName: nonEmptyAlphaNum }), { maxLength: 3 }),
    rawEvent: fc.constant('{}'),
});

/** Generates a raw CloudTrail JSON string with all required fields. */
const cloudTrailRawArb = fc.record({
    eventID: nonEmptyAlphaNum,
    eventTime: fc.integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-01-01').getTime() }).map(ts => new Date(ts).toISOString()),
    eventName: nonEmptyAlphaNum,
    userIdentity: fc.record({ userName: nonEmptyAlphaNum }),
    sourceIPAddress: fc.ipV4(),
    userAgent: nonEmptyAlphaNum,
    readOnly: fc.boolean(),
    resources: fc.array(fc.record({ resourceType: nonEmptyAlphaNum, resourceName: nonEmptyAlphaNum }), { maxLength: 3 }),
}).map(obj => JSON.stringify(obj));

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Feature: eks-access-logs — Property-Based Tests', () => {

    // -------------------------------------------------------------------------
    // Property 1: CloudTrail event transformation preserves all required fields
    // Validates: Requirements 2.2
    // -------------------------------------------------------------------------
    describe('Property 1: CloudTrail event transformation preserves all required fields', () => {
        it('should preserve eventTime, eventName, username, sourceIpAddress, and userAgent from the raw JSON', () => {
            fc.assert(
                fc.property(cloudTrailRawArb, (raw) => {
                    const parsed = JSON.parse(raw);
                    const event = transformCloudTrailEvent(raw);

                    expect(event.eventTime).toBe(parsed.eventTime);
                    expect(event.eventName).toBe(parsed.eventName);
                    expect(event.username).toBe(parsed.userIdentity.userName);
                    expect(event.sourceIpAddress).toBe(parsed.sourceIPAddress);
                    expect(event.userAgent).toBe(parsed.userAgent);

                    // All required fields are non-empty
                    expect(event.eventTime.length).toBeGreaterThan(0);
                    expect(event.eventName.length).toBeGreaterThan(0);
                    expect(event.username.length).toBeGreaterThan(0);
                    expect(event.sourceIpAddress.length).toBeGreaterThan(0);
                    expect(event.userAgent.length).toBeGreaterThan(0);
                }),
                { numRuns: 100 },
            );
        });
    });

    // -------------------------------------------------------------------------
    // Property 2: Sorting produces correctly ordered results
    // Validates: Requirements 3.2
    // -------------------------------------------------------------------------
    describe('Property 2: Sorting produces correctly ordered results', () => {
        const sortableKeys: (keyof AuditEvent)[] = ['eventTime', 'eventName', 'username', 'sourceIpAddress', 'userAgent'];

        it('should produce a list where consecutive pairs are in the correct order', () => {
            fc.assert(
                fc.property(
                    fc.array(auditEventArb, { minLength: 0, maxLength: 50 }),
                    fc.constantFrom(...sortableKeys),
                    fc.constantFrom('asc' as const, 'desc' as const),
                    (events, key, direction) => {
                        const sorted = sortEvents(events, key, direction);

                        // Length is preserved
                        expect(sorted.length).toBe(events.length);

                        // Consecutive pairs are in correct order
                        for (let i = 0; i < sorted.length - 1; i++) {
                            const a = String(sorted[i][key]);
                            const b = String(sorted[i + 1][key]);
                            const cmp = a.localeCompare(b);
                            if (direction === 'asc') {
                                expect(cmp).toBeLessThanOrEqual(0);
                            } else {
                                expect(cmp).toBeGreaterThanOrEqual(0);
                            }
                        }
                    },
                ),
                { numRuns: 100 },
            );
        });
    });

    // -------------------------------------------------------------------------
    // Property 3: Identity filtering returns only matching events
    // Validates: Requirements 4.3, 4.5
    // -------------------------------------------------------------------------
    describe('Property 3: Identity filtering returns only matching events', () => {
        const identityTypeArb = fc.constantFrom('all' as const, 'iam-user' as const, 'iam-role' as const, 'service-account' as const);

        it('should return only events matching the identity text and type, and be a subset of the original', () => {
            fc.assert(
                fc.property(
                    fc.array(auditEventArb, { minLength: 0, maxLength: 30 }),
                    fc.string({ maxLength: 10 }),
                    identityTypeArb,
                    (events, text, type) => {
                        const filtered = filterByIdentity(events, text, type);

                        // Subset check
                        expect(filtered.length).toBeLessThanOrEqual(events.length);
                        for (const e of filtered) {
                            expect(events).toContainEqual(e);
                        }

                        // Every returned event matches the text filter (case-insensitive)
                        if (text) {
                            for (const e of filtered) {
                                expect(e.username.toLowerCase()).toContain(text.toLowerCase());
                            }
                        }

                        // Every returned event matches the identity type
                        if (type !== 'all') {
                            for (const e of filtered) {
                                expect(classifyIdentityType(e.username)).toBe(type);
                            }
                        }
                    },
                ),
                { numRuns: 100 },
            );
        });
    });

    // -------------------------------------------------------------------------
    // Property 4: Event type filtering returns only matching events
    // Validates: Requirements 5.2, 5.4
    // -------------------------------------------------------------------------
    describe('Property 4: Event type filtering returns only matching events', () => {
        it('should return only events whose eventName is in the selected set, and be a subset', () => {
            const eventTypeSetArb = fc.uniqueArray(
                fc.constantFrom('CreateCluster', 'DeleteNodegroup', 'UpdateClusterConfig', 'AccessKubernetesApi', 'DescribeCluster'),
                { minLength: 1, maxLength: 5 },
            );

            fc.assert(
                fc.property(
                    fc.array(auditEventArb, { minLength: 0, maxLength: 30 }),
                    eventTypeSetArb,
                    (events, selectedTypes) => {
                        const filtered = filterByEventType(events, selectedTypes);
                        const typeSet = new Set(selectedTypes) as Set<string>;

                        // Subset check
                        expect(filtered.length).toBeLessThanOrEqual(events.length);
                        for (const e of filtered) {
                            expect(events).toContainEqual(e);
                        }

                        // Every returned event has an eventName in the selected set
                        for (const e of filtered) {
                            expect(typeSet.has(e.eventName)).toBe(true);
                        }
                    },
                ),
                { numRuns: 100 },
            );
        });
    });

    // -------------------------------------------------------------------------
    // Property 5: Preset time range calculation produces valid windows
    // Validates: Requirements 6.3
    // -------------------------------------------------------------------------
    describe('Property 5: Preset time range calculation produces valid windows', () => {
        const presetArb = fc.constantFrom('1h' as const, '24h' as const, '7d' as const);
        const refDateArb = fc.integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-01-01').getTime() }).map(ts => new Date(ts));

        const expectedDurations: Record<string, number> = {
            '1h': 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
        };

        it('should produce startTime exactly the preset duration before endTime, with endTime equal to the reference', () => {
            fc.assert(
                fc.property(presetArb, refDateArb, (preset, refDate) => {
                    const { startTime, endTime } = computeTimeRange(preset, refDate);

                    // endTime equals the reference timestamp
                    expect(endTime.getTime()).toBe(refDate.getTime());

                    // startTime is exactly the specified duration before endTime
                    expect(endTime.getTime() - startTime.getTime()).toBe(expectedDurations[preset]);

                    // startTime is strictly before endTime
                    expect(startTime.getTime()).toBeLessThan(endTime.getTime());
                }),
                { numRuns: 100 },
            );
        });
    });

    // -------------------------------------------------------------------------
    // Property 6: Date range exceeding 90 days is detected
    // Validates: Requirements 6.6
    // -------------------------------------------------------------------------
    describe('Property 6: Date range exceeding 90 days is detected', () => {
        const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

        it('should return true when the range exceeds 90 days', () => {
            // Use integer timestamps to avoid NaN date edge cases from fc.date
            const startTsArb = fc.integer({ min: new Date('2020-01-01').getTime(), max: new Date('2025-01-01').getTime() });

            fc.assert(
                fc.property(
                    startTsArb,
                    // offset > 90 days (90 days + 1ms to 365 days)
                    fc.integer({ min: NINETY_DAYS_MS + 1, max: 365 * 24 * 60 * 60 * 1000 }),
                    (startTs, offsetMs) => {
                        const start = new Date(startTs);
                        const end = new Date(startTs + offsetMs);
                        expect(isDateRangeExceeding90Days(start, end)).toBe(true);
                    },
                ),
                { numRuns: 100 },
            );
        });

        it('should return false when the range is 90 days or fewer', () => {
            const startTsArb = fc.integer({ min: new Date('2020-01-01').getTime(), max: new Date('2025-01-01').getTime() });

            fc.assert(
                fc.property(
                    startTsArb,
                    // offset 0 to exactly 90 days
                    fc.integer({ min: 0, max: NINETY_DAYS_MS }),
                    (startTs, offsetMs) => {
                        const start = new Date(startTs);
                        const end = new Date(startTs + offsetMs);
                        expect(isDateRangeExceeding90Days(start, end)).toBe(false);
                    },
                ),
                { numRuns: 100 },
            );
        });
    });
});
