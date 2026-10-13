import { describe, it, expect } from 'vitest';
import { sortResourceData } from './useResourceSorting';

const names = (rows: { name: string }[]) => rows.map(r => r.name);

describe('sortResourceData', () => {
    it('returns the input unchanged without a sort config', () => {
        const data = [{ name: 'b' }, { name: 'a' }];
        expect(sortResourceData(data, null)).toBe(data);
    });
    it('sorts numbers numerically (9 before 10) asc and desc', () => {
        const data = [{ name: 'ten', n: 10 }, { name: 'nine', n: 9 }, { name: 'hundred', n: 100 }];
        expect(names(sortResourceData(data, { key: 'n', direction: 'asc' }))).toEqual(['nine', 'ten', 'hundred']);
        expect(names(sortResourceData(data, { key: 'n', direction: 'desc' }))).toEqual(['hundred', 'ten', 'nine']);
    });
    it('sorts healthOrder by number', () => {
        const data = [{ name: 'healthy', healthOrder: 4 }, { name: 'none', healthOrder: 5 }, { name: 'bad', healthOrder: 0 }, { name: 'prog', healthOrder: 1 }];
        expect(names(sortResourceData(data, { key: 'healthOrder', direction: 'asc' }))).toEqual(['bad', 'prog', 'healthy', 'none']);
    });
    it('falls back to the string path when a value is not a number', () => {
        // number vs undefined compares '10' with '' as strings, so the missing value sorts first asc / last desc
        const data = [{ name: 'ten', n: 10 }, { name: 'missing', n: undefined }];
        expect(names(sortResourceData(data, { key: 'n', direction: 'asc' }))).toEqual(['missing', 'ten']);
        expect(names(sortResourceData(data, { key: 'n', direction: 'desc' }))).toEqual(['ten', 'missing']);
        const mixed = [{ name: 'a', v: '10' }, { name: 'b', v: 9 }];
        expect(names(sortResourceData(mixed, { key: 'v', direction: 'asc' }))).toEqual(['a', 'b']);
    });
    it('keeps the case-insensitive string comparison', () => {
        const data = [{ name: 'Beta' }, { name: 'alpha' }, { name: 'Gamma' }];
        expect(names(sortResourceData(data, { key: 'name', direction: 'asc' }))).toEqual(['alpha', 'Beta', 'Gamma']);
        expect(names(sortResourceData(data, { key: 'name', direction: 'desc' }))).toEqual(['Gamma', 'Beta', 'alpha']);
    });
    it('age sorts by timestamp', () => {
        const data = [
            { name: 'new', age: '2025-01-02T00:00:00Z' }, { name: 'old', age: '2024-01-01T00:00:00Z' }, { name: 'mid', age: '2024-06-01T00:00:00Z' },
        ];
        expect(names(sortResourceData(data, { key: 'age', direction: 'asc' }))).toEqual(['old', 'mid', 'new']);
        expect(names(sortResourceData(data, { key: 'age', direction: 'desc' }))).toEqual(['new', 'mid', 'old']);
    });
    it('cpu and memory sort by parsed Kubernetes units', () => {
        const cpu = [{ name: 'one', cpu: '1' }, { name: 'quarter', cpu: '250m' }, { name: 'dash', cpu: '-' }, { name: 'nano', cpu: '500000n' }];
        expect(names(sortResourceData(cpu, { key: 'cpu', direction: 'asc' }))).toEqual(['dash', 'nano', 'quarter', 'one']);
        const mem = [{ name: 'gi', memory: '1Gi' }, { name: 'mi', memory: '128Mi' }, { name: 'ki', memory: '512Ki' }, { name: 'm', memory: '200M' }];
        expect(names(sortResourceData(mem, { key: 'memory', direction: 'asc' }))).toEqual(['ki', 'mi', 'm', 'gi']);
        expect(names(sortResourceData(mem, { key: 'memory', direction: 'desc' }))).toEqual(['gi', 'm', 'mi', 'ki']);
    });
    it('restarts, replicas and status keep their special handling', () => {
        const r = [{ name: 'a', restarts: 3 }, { name: 'b', restarts: 1 }];
        expect(names(sortResourceData(r, { key: 'restarts', direction: 'asc' }))).toEqual(['b', 'a']);
        const rep = [{ name: 'a', replicas: 2 }, { name: 'b' }, { name: 'c', replicas: 1 }];
        expect(names(sortResourceData(rep, { key: 'replicas', direction: 'asc' }))).toEqual(['b', 'c', 'a']);
        const st = [
            { name: 'healthy', replicas: 2, availableReplicas: 2 },
            { name: 'down', replicas: 2, availableReplicas: 0 },
            { name: 'partial', replicas: 3, availableReplicas: 1 },
        ];
        expect(names(sortResourceData(st, { key: 'status', direction: 'asc' }))).toEqual(['down', 'partial', 'healthy']);
        expect(names(sortResourceData(st, { key: 'status', direction: 'desc' }))[0]).toBe('healthy');
    });
});
