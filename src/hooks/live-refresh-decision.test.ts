import { describe, it, expect } from 'vitest';
import { decideLiveRefresh, shouldApplyResponse, type LiveRefreshState } from './live-refresh-decision';

/** Runs a sequence of live rvs through decideLiveRefresh and returns the actions. */
function run(seq: (string | undefined)[], fetchedRv: string | undefined, start: LiveRefreshState = { hadLive: false }) {
    let state = start;
    return seq.map(rv => {
        const { action, next } = decideLiveRefresh(state, rv, fetchedRv);
        state = next;
        return action;
    });
}

describe('decideLiveRefresh', () => {
    it('first observation -> none', () => {
        expect(run(['10'], '10')).toEqual(['none']);
        expect(run(['10'], '5')).toEqual(['none']);
    });

    it('same rv -> none', () => {
        expect(run(['10', '10'], '1')).toEqual(['none', 'none']);
    });

    it('new rv equal to fetched -> none', () => {
        expect(run(['10', '11'], '11')).toEqual(['none', 'none']);
    });

    it('new rv different from fetched -> debounce', () => {
        expect(run(['10', '11'], '10')).toEqual(['none', 'debounce']);
    });

    it('present -> absent -> debounce', () => {
        expect(run(['10', undefined], '10')).toEqual(['none', 'debounce']);
    });

    it('present -> absent -> present (re-seed) -> the reappearance is a first observation', () => {
        expect(run(['10', undefined, '12'], '10')).toEqual(['none', 'debounce', 'none']);
    });

    it('absent while never live -> none', () => {
        expect(run([undefined, undefined], undefined)).toEqual(['none', 'none']);
    });

    it('a lagging watcher never triggers twice for the same live rv', () => {
        // fetched rv (20) is newer than anything the watcher reports
        expect(run(['10', '11', '11', '11'], '20')).toEqual(['none', 'debounce', 'none', 'none']);
    });
});

describe('shouldApplyResponse', () => {
    const key = 'c1|ns|web';
    it('latest id, same key, mounted -> true', () => {
        expect(shouldApplyResponse({ id: 3, key }, { id: 3, key, mounted: true })).toBe(true);
    });
    it('older id -> false', () => {
        expect(shouldApplyResponse({ id: 2, key }, { id: 3, key, mounted: true })).toBe(false);
    });
    it('same id, different key -> false', () => {
        expect(shouldApplyResponse({ id: 3, key: 'c2|ns|web' }, { id: 3, key, mounted: true })).toBe(false);
    });
    it('unmounted -> false', () => {
        expect(shouldApplyResponse({ id: 3, key }, { id: 3, key, mounted: false })).toBe(false);
    });
});
