import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { selectorToQueryString, matchesLabelSelector, matchesServiceSelector } from './label-selector-utils';

describe('selectorToQueryString', () => {
    it('renders matchLabels and every operator', () => {
        expect(selectorToQueryString({
            matchLabels: { app: 'web', tier: 'fe' },
            matchExpressions: [
                { key: 'env', operator: 'In', values: ['prod', 'stg'] },
                { key: 'zone', operator: 'NotIn', values: ['a'] },
                { key: 'team', operator: 'Exists' },
                { key: 'legacy', operator: 'DoesNotExist' },
            ],
        })).toBe('app=web,tier=fe,env in (prod,stg),zone notin (a),team,!legacy');
    });

    it('returns null for nil and empty selectors', () => {
        expect(selectorToQueryString(undefined)).toBeNull();
        expect(selectorToQueryString(null)).toBeNull();
        expect(selectorToQueryString({})).toBeNull();
        expect(selectorToQueryString({ matchLabels: {}, matchExpressions: [] })).toBeNull();
    });
});

describe('matchesLabelSelector', () => {
    const labels = { app: 'web', env: 'prod', team: 'core' };

    it('nil never matches', () => {
        expect(matchesLabelSelector(undefined, labels, { emptyMatchesAll: true })).toBe(false);
        expect(matchesLabelSelector(null, labels, { emptyMatchesAll: true })).toBe(false);
    });

    it('empty follows emptyMatchesAll', () => {
        expect(matchesLabelSelector({}, labels, { emptyMatchesAll: true })).toBe(true);
        expect(matchesLabelSelector({}, labels, { emptyMatchesAll: false })).toBe(false);
    });

    const opts = { emptyMatchesAll: false };
    it('In', () => {
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'env', operator: 'In', values: ['prod'] }] }, labels, opts)).toBe(true);
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'env', operator: 'In', values: ['dev'] }] }, labels, opts)).toBe(false);
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'nope', operator: 'In', values: ['x'] }] }, labels, opts)).toBe(false);
    });
    it('NotIn', () => {
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'env', operator: 'NotIn', values: ['dev'] }] }, labels, opts)).toBe(true);
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'env', operator: 'NotIn', values: ['prod'] }] }, labels, opts)).toBe(false);
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'nope', operator: 'NotIn', values: ['x'] }] }, labels, opts)).toBe(true);
    });
    it('Exists / DoesNotExist', () => {
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'team', operator: 'Exists' }] }, labels, opts)).toBe(true);
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'nope', operator: 'Exists' }] }, labels, opts)).toBe(false);
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'nope', operator: 'DoesNotExist' }] }, labels, opts)).toBe(true);
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'team', operator: 'DoesNotExist' }] }, labels, opts)).toBe(false);
    });
    it('combines matchLabels AND expressions', () => {
        const sel = { matchLabels: { app: 'web' }, matchExpressions: [{ key: 'env', operator: 'In', values: ['prod'] }] };
        expect(matchesLabelSelector(sel, labels, opts)).toBe(true);
        expect(matchesLabelSelector(sel, { ...labels, app: 'api' }, opts)).toBe(false);
        expect(matchesLabelSelector(sel, { ...labels, env: 'dev' }, opts)).toBe(false);
    });
    it('undefined labels only satisfy negative expressions', () => {
        expect(matchesLabelSelector({ matchLabels: { app: 'web' } }, undefined, opts)).toBe(false);
        expect(matchesLabelSelector({ matchExpressions: [{ key: 'x', operator: 'DoesNotExist' }] }, undefined, opts)).toBe(true);
    });

    it('property: labels ⊇ matchLabels ⇒ match', () => {
        const kv = fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), fc.stringMatching(/^[a-z0-9]{1,8}$/), { minKeys: 1 });
        fc.assert(fc.property(kv, kv, (matchLabels, extra) => {
            const labels = { ...extra, ...matchLabels };
            return matchesLabelSelector({ matchLabels }, labels, { emptyMatchesAll: false });
        }));
    });
});

describe('matchesServiceSelector', () => {
    it('selectorless services match nothing', () => {
        expect(matchesServiceSelector(undefined, { app: 'web' })).toBe(false);
        expect(matchesServiceSelector(null, { app: 'web' })).toBe(false);
        expect(matchesServiceSelector({}, { app: 'web' })).toBe(false);
    });
    it('subset match', () => {
        expect(matchesServiceSelector({ app: 'web' }, { app: 'web', env: 'prod' })).toBe(true);
        expect(matchesServiceSelector({ app: 'web', env: 'dev' }, { app: 'web', env: 'prod' })).toBe(false);
        expect(matchesServiceSelector({ app: 'web' }, undefined)).toBe(false);
    });
});
