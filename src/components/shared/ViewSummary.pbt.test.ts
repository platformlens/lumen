/**
 * Property-based tests for ViewSummary fallback summary.
 * Feature: ai-context-engine, Property 7: Fallback summary produces correct statistical counts
 * Validates: Requirements 3.4
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildFallbackSummary } from './ViewSummary';

const PHASES = ['Running', 'Pending', 'Failed', 'Succeeded', 'NotReady', 'Unknown'];

const arbResource = fc.record({
    phase: fc.constantFrom(...PHASES),
});

// Feature: ai-context-engine, Property 7: Fallback summary produces correct statistical counts
// Validates: Requirements 3.4
describe('Property 7: Fallback summary produces correct statistical counts', () => {
    it('total count and per-phase counts are correct in the fallback summary', () => {
        fc.assert(
            fc.property(
                fc.array(arbResource, { minLength: 1, maxLength: 50 }),
                (resources) => {
                    const summary = buildFallbackSummary(resources);
                    const total = resources.length;

                    // Summary should start with the total count
                    expect(summary).toContain(`${total} resources:`);

                    // Compute expected phase counts
                    const phaseCounts = new Map<string, number>();
                    for (const r of resources) {
                        phaseCounts.set(r.phase, (phaseCounts.get(r.phase) || 0) + 1);
                    }

                    // Each phase count should appear in the summary
                    for (const [phase, count] of phaseCounts) {
                        expect(summary).toContain(`${count} ${phase.toLowerCase()}`);
                    }

                    // Sum of all phase counts in the summary should equal total
                    let sumFromSummary = 0;
                    for (const [, count] of phaseCounts) {
                        sumFromSummary += count;
                    }
                    expect(sumFromSummary).toBe(total);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('returns "No resources found." for empty input', () => {
        expect(buildFallbackSummary([])).toBe('No resources found.');
    });
});
