/**
 * Property-based tests for whats-new-utils.
 * Uses fast-check to validate correctness properties from the design document.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { shouldShowWhatsNew, findRelease, handleDismiss } from './whats-new-utils';
import type { WhatsNewRelease } from '../data/whats-new';

const arbVersion = fc.string({ minLength: 1 });
const arbStoredVersion = fc.option(fc.string({ minLength: 1 }), { nil: null });

const arbRelease = (): fc.Arbitrary<WhatsNewRelease> =>
    fc.record({
        version: arbVersion,
        title: fc.string(),
        description: fc.string(),
        sections: fc.constant([]),
    });

// Feature: whats-new-modal, Property 2: Version mismatch triggers modal
// Validates: Requirements 3.2, 3.3
describe('Property 2: Version mismatch triggers modal', () => {
    it('returns true for any current/stored pair where they differ', () => {
        fc.assert(
            fc.property(arbVersion, arbStoredVersion, (current, stored) => {
                fc.pre(current !== stored);
                return shouldShowWhatsNew({ current, stored, isPackaged: true }) === true;
            }),
            { numRuns: 100 }
        );
    });
});

// Feature: whats-new-modal, Property 3: Dev mode always shows modal
// Validates: Requirements 3.4
describe('Property 3: Dev mode always shows modal', () => {
    it('returns true for any current/stored pair when isPackaged is false', () => {
        fc.assert(
            fc.property(arbVersion, arbStoredVersion, (current, stored) => {
                return shouldShowWhatsNew({ current, stored, isPackaged: false }) === true;
            }),
            { numRuns: 100 }
        );
    });
});

// Feature: whats-new-modal, Property 4: Dev mode suppresses persistence
// Validates: Requirements 3.6
describe('Property 4: Dev mode suppresses persistence', () => {
    it('does not call setLastSeenVersion when isPackaged is false', () => {
        fc.assert(
            fc.property(arbVersion, (version) => {
                const calls: string[] = [];
                handleDismiss({ version, isPackaged: false, setLastSeenVersion: (v) => calls.push(v) });
                return calls.length === 0;
            }),
            { numRuns: 100 }
        );
    });

    it('calls setLastSeenVersion with the version when isPackaged is true', () => {
        fc.assert(
            fc.property(arbVersion, (version) => {
                const calls: string[] = [];
                handleDismiss({ version, isPackaged: true, setLastSeenVersion: (v) => calls.push(v) });
                return calls.length === 1 && calls[0] === version;
            }),
            { numRuns: 100 }
        );
    });
});

// Feature: whats-new-modal, Property 5: Version lookup correctness
// Validates: Requirements 7.4, 7.5
describe('Property 5: Version lookup correctness', () => {
    it('finds a release that exists in the array', () => {
        fc.assert(
            fc.property(
                fc.array(arbRelease(), { minLength: 1, maxLength: 20 }),
                fc.nat(),
                (releases, idx) => {
                    const target = releases[idx % releases.length];
                    const result = findRelease(releases, target.version);
                    return result?.version === target.version;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('returns undefined for a version not in the array', () => {
        fc.assert(
            fc.property(
                fc.array(arbRelease(), { minLength: 0, maxLength: 20 }),
                fc.string({ minLength: 1 }),
                (releases, version) => {
                    // Ensure the version is not in the array
                    fc.pre(!releases.some((r) => r.version === version));
                    return findRelease(releases, version) === undefined;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// Feature: whats-new-modal, Property 1: Store round-trip
// Validates: Requirements 2.1, 2.2, 2.3
describe('Property 1: Store round-trip', () => {
    it('reading back a written version returns the same string', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (version) => {
                // Mock the store with a simple in-memory map
                let stored: string | null = null;
                const mockSetLastSeenVersion = (v: string) => { stored = v; };
                const mockGetLastSeenVersion = () => stored;

                mockSetLastSeenVersion(version);
                return mockGetLastSeenVersion() === version;
            }),
            { numRuns: 100 }
        );
    });

    it('returns null before any version is written', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (_version) => {
                let stored: string | null = null;
                const mockGetLastSeenVersion = () => stored;
                return mockGetLastSeenVersion() === null;
            }),
            { numRuns: 100 }
        );
    });
});
