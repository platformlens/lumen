import { describe, it, expect } from 'vitest';
import { resolveIntervalMs, shouldFetchOnVisible } from './crossplane-query-utils';

describe('resolveIntervalMs', () => {
    it('takes the max of settings, 15 s and the per-query minimum', () => {
        expect(resolveIntervalMs(30)).toBe(30_000);
        expect(resolveIntervalMs(5)).toBe(15_000);
        expect(resolveIntervalMs(30, 300_000)).toBe(300_000);
        expect(resolveIntervalMs(600, 120_000)).toBe(600_000);
    });
    it('falls back to 30 s for invalid settings', () => {
        expect(resolveIntervalMs(undefined)).toBe(30_000);
        expect(resolveIntervalMs(null)).toBe(30_000);
        expect(resolveIntervalMs(Number.NaN)).toBe(30_000);
        expect(resolveIntervalMs(-1)).toBe(30_000);
        expect(resolveIntervalMs(0, 1000)).toBe(30_000);
    });
});

describe('shouldFetchOnVisible', () => {
    it('fetches when never fetched or an interval has passed', () => {
        expect(shouldFetchOnVisible(null, 1000, 15_000)).toBe(true);
        expect(shouldFetchOnVisible(undefined, 1000, 15_000)).toBe(true);
        expect(shouldFetchOnVisible(0, 15_000, 15_000)).toBe(true);
        expect(shouldFetchOnVisible(0, 14_999, 15_000)).toBe(false);
    });
});
