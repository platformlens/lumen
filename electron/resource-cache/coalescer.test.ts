import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Coalescer, type Subscriber } from './coalescer';
import type { ResourceBatch, SecretItem } from '../../src/types/resource-cache';

const secret = (id: string, name = id): SecretItem => ({ id, name, namespace: 'ns', type: 'Opaque', data: 1, age: '', metadata: { uid: id, name } });

function setup() {
  let seq = 0;
  const sent: ResourceBatch[] = [];
  const sub: Subscriber = { id: 1, isDestroyed: () => false, send: (_c, b) => sent.push(b) };
  const c = new Coalescer({ sessionId: 's1', nextSeq: () => ++seq, getSubscriber: () => sub });
  return { c, sent };
}

describe('Coalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('last write wins and delete overrides upsert', () => {
    const { c, sent } = setup();
    c.upsert('secrets', secret('a', 'v1'));
    c.upsert('secrets', secret('a', 'v2'));
    c.upsert('secrets', secret('b'));
    c.delete('secrets', 'b');
    vi.advanceTimersByTime(650);
    expect(sent).toHaveLength(1);
    expect(sent[0].kinds.secrets!.upserts.map((s) => s.name)).toEqual(['v2']);
    expect(sent[0].kinds.secrets!.deletes).toEqual(['b']);
  });

  it('resetKind discards earlier ops; later pushes modify the reset map', () => {
    const { c, sent } = setup();
    c.upsert('secrets', secret('old'));
    c.delete('secrets', 'gone');
    c.resetKind('secrets', [secret('a'), secret('b')]);
    c.upsert('secrets', secret('c'));
    c.delete('secrets', 'a');
    vi.advanceTimersByTime(650);
    const d = sent[0].kinds.secrets!;
    expect(d.reset).toBe(true);
    expect(d.upserts.map((s) => s.id).sort()).toEqual(['b', 'c']);
    expect(d.deletes).toEqual([]);
  });

  it('arms one timer, and none while empty', () => {
    const { c, sent } = setup();
    expect(c.hasTimer()).toBe(false);
    c.upsert('secrets', secret('a'));
    c.upsert('pods', { id: 'p', uid: 'p', name: 'p', namespace: 'ns', status: 'Running', restarts: 0, age: '', node: '', containers: [] });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(650);
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0].kinds).sort()).toEqual(['pods', 'secrets']);
    expect(c.hasTimer()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });

  it('seq increments per flush, including unsent flushes', () => {
    let seq = 0;
    const sent: ResourceBatch[] = [];
    let bound = false;
    const sub: Subscriber = { id: 1, isDestroyed: () => false, send: (_c, b) => sent.push(b) };
    const c = new Coalescer({ sessionId: 's', nextSeq: () => ++seq, getSubscriber: () => (bound ? sub : null) });
    c.upsert('secrets', secret('a'));
    c.flush();
    bound = true;
    c.upsert('secrets', secret('b'));
    c.flush();
    expect(seq).toBe(2);
    expect(sent.map((b) => b.seq)).toEqual([2]);
  });

  it('clear drops ops and the timer without sending', () => {
    const { c, sent } = setup();
    c.upsert('secrets', secret('a'));
    c.clear();
    expect(c.hasTimer()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(0);
  });
});
