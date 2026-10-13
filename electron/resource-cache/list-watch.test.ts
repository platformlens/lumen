import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { KubeConfig } from '@kubernetes/client-node';
import { ListWatchStream, type ListPageFn, type WatchFn, type WatchParams } from './list-watch';
import { CORE_KIND_DESCRIPTORS, type ListPageResult, type ListPageOptions, type RawObject } from './kinds';
import type { ListedKind } from '../../src/types/resource-cache';

const SENTINEL = 'dG9wLXNlY3JldC12YWx1ZQ==';

const secret = (uid: string, rv = '1', extra: Record<string, unknown> = {}): RawObject => ({
  metadata: { uid, name: `s-${uid}`, namespace: 'ns', resourceVersion: rv, managedFields: [{ f: SENTINEL }] },
  type: 'Opaque',
  data: { k: SENTINEL },
  ...extra,
}) as unknown as RawObject;

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface WatchCall {
  path: string;
  params: WatchParams;
  onEvent: (type: string, obj: unknown) => void;
  onDone: (err: unknown) => void;
  ctrl: AbortController;
  result: Deferred<AbortController>;
}

function harness(kind: ListedKind = 'secrets', opts: { manualWatch?: boolean } = {}) {
  const listCalls: Array<{ opts: ListPageOptions; d: Deferred<ListPageResult> }> = [];
  const watchCalls: WatchCall[] = [];
  const upserts: string[] = [];
  const deletes: string[] = [];
  const phases: string[] = [];
  const pages: Array<{ ids: string[]; first: boolean }> = [];
  const completes: Array<{ ids: string[]; meta: Map<string, { name: string; namespace?: string }> }> = [];
  const authRebuild = vi.fn();
  const timers: number[] = [];

  const listPage: ListPageFn = (_kc, _scope, o) => {
    const d = deferred<ListPageResult>();
    listCalls.push({ opts: o, d });
    return d.promise;
  };
  const watch: WatchFn = (_kc, path, params, onEvent, onDone) => {
    const ctrl = new AbortController();
    const result = deferred<AbortController>();
    watchCalls.push({ path, params, onEvent, onDone, ctrl, result });
    if (!opts.manualWatch) result.resolve(ctrl);
    return result.promise;
  };

  const stream = new ListWatchStream({
    descriptor: CORE_KIND_DESCRIPTORS[kind],
    scope: '*',
    getKc: () => ({}) as KubeConfig,
    sink: {
      upsert: (i) => upserts.push(i.id),
      delete: (id) => deletes.push(id),
      phaseChanged: () => phases.push(stream.phase),
    },
    hooks: {
      onListPage: (raw, ctx) => pages.push({ ids: raw.map((r) => r.metadata!.uid!), first: ctx.first }),
      onListComplete: (ids, meta) => completes.push({ ids, meta }),
    },
    requestAuthRebuild: authRebuild,
    listPage,
    watch,
    random: () => 0.5,
    setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, ms); },
  });

  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  async function completeList(items: RawObject[][], rv = '100') {
    for (let i = 0; i < items.length; i++) {
      const call = listCalls[listCalls.length - 1];
      call.d.resolve({ items: items[i], continueToken: i < items.length - 1 ? `c${i}` : undefined, resourceVersion: rv });
      await flush();
    }
  }
  return { stream, listCalls, watchCalls, upserts, deletes, phases, pages, completes, authRebuild, timers, flush, completeList };
}

describe('ListWatchStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('paginates, calls hooks per page, then watches from the list rv', async () => {
    const h = harness();
    h.stream.start();
    expect(h.stream.lastEventAt).toBeNull();
    await h.completeList([[secret('a')], [secret('b')], [secret('c')]], '77');
    expect(h.listCalls.map((c) => c.opts)).toEqual([
      { limit: 100, continueToken: undefined },
      { limit: 100, continueToken: 'c0' },
      { limit: 100, continueToken: 'c1' },
    ]);
    expect(h.pages).toEqual([{ ids: ['a'], first: true }, { ids: ['b'], first: true }, { ids: ['c'], first: true }]);
    expect(h.completes).toHaveLength(1);
    expect(h.upserts).toEqual(['a', 'b', 'c']);
    expect(h.stream.phase).toBe('ready');
    expect(h.stream.lastEventAt).not.toBeNull();
    expect(h.watchCalls).toHaveLength(1);
    expect(h.watchCalls[0].params).toMatchObject({ allowWatchBookmarks: true, resourceVersion: '77' });
    const t = h.watchCalls[0].params.timeoutSeconds as number;
    expect(t).toBeGreaterThanOrEqual(300);
    expect(t).toBeLessThanOrEqual(600);
    expect(h.stream.listRuns).toBe(1);
    expect(h.stream.listPages).toBe(3);
    expect(h.stream.getDiagnostics().hasController).toBe(true);
  });

  it('uses limit 500 for non-secret kinds', async () => {
    const h = harness('deployments');
    h.stream.start();
    expect(h.listCalls[0].opts.limit).toBe(500);
    h.stream.stop();
  });

  it('keeps only trimmed items (no values, no managedFields)', async () => {
    const h = harness();
    h.stream.start();
    h.listCalls[0].d.resolve({ items: [secret('a')], continueToken: 'c0' });
    await h.flush();
    expect(JSON.stringify([...h.stream.items()])).not.toContain(SENTINEL);
    h.stream.stop();
  });

  it('re-list emits deletes with deletedMeta and upserts only changed items', async () => {
    const h = harness();
    h.stream.start();
    await h.completeList([[secret('a'), secret('b'), secret('c')]]);
    h.upserts.length = 0;
    h.watchCalls[0].onEvent('ERROR', { code: 410 });
    await h.flush();
    await h.completeList([[secret('a'), secret('b', '2')]], '200');
    expect(h.deletes).toEqual(['c']);
    expect(h.upserts).toEqual(['b']);
    expect(h.pages[h.pages.length - 1].first).toBe(false);
    const last = h.completes[h.completes.length - 1];
    expect(last.ids).toEqual(['c']);
    expect(last.meta.get('c')).toEqual({ name: 's-c', namespace: 'ns' });
    expect(h.stream.listRuns).toBe(2);
    expect(h.watchCalls[1].params.resourceVersion).toBe('200');
  });

  it('applies watch events and bookmarks', async () => {
    const h = harness();
    h.stream.start();
    await h.completeList([[secret('a')]]);
    const w = h.watchCalls[0];
    w.onEvent('ADDED', secret('b', '5'));
    w.onEvent('DELETED', secret('a', '6'));
    w.onEvent('BOOKMARK', { metadata: { resourceVersion: '9' } });
    expect(h.upserts).toEqual(['a', 'b']);
    expect(h.deletes).toEqual(['a']);
    w.onDone(null); // after 1 event: healthy close
    vi.advanceTimersByTime(500);
    await h.flush();
    expect(h.watchCalls[1].params.resourceVersion).toBe('9');
  });

  it('backoff follows its sequence and caps at 30 s', async () => {
    const h = harness();
    h.stream.start();
    for (let i = 0; i < 7; i++) {
      h.listCalls[h.listCalls.length - 1].d.reject({ code: 503 });
      await h.flush();
      vi.advanceTimersByTime(h.timers[h.timers.length - 1]);
      await h.flush();
    }
    expect(h.timers.slice(0, 7)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(h.stream.phase).toBe('reconnecting');
    h.stream.stop();
  });

  it('three consecutive watch failures drop the rv and re-list', async () => {
    const h = harness();
    h.stream.start();
    await h.completeList([[secret('a')]]);
    for (let i = 0; i < 3; i++) {
      h.watchCalls[h.watchCalls.length - 1].onDone({ statusCode: 500 });
      vi.advanceTimersByTime(30_000);
      await h.flush();
    }
    expect(h.watchCalls).toHaveLength(3);
    expect(h.listCalls).toHaveLength(2);
    h.stream.stop();
  });

  it('consecutive watch ERROR events grow the backoff and drop the rv', async () => {
    const h = harness();
    h.stream.start();
    await h.completeList([[secret('a')]]);
    h.timers.length = 0;
    for (let i = 0; i < 3; i++) {
      h.watchCalls[h.watchCalls.length - 1].onEvent('ERROR', { code: 500 });
      vi.advanceTimersByTime(h.timers[h.timers.length - 1]);
      await h.flush();
    }
    expect(h.timers).toEqual([1000, 2000, 4000]);
    expect(h.watchCalls).toHaveLength(3);
    expect(h.listCalls).toHaveLength(2); // 3rd strike re-lists instead of re-watching the stale rv
    h.stream.stop();
  });

  it('401 ERROR events reach the 3-strike give-up', async () => {
    const h = harness();
    h.stream.start();
    await h.completeList([[secret('a')]]);
    h.watchCalls[0].onEvent('ERROR', { code: 401 });
    await h.flush();
    expect(h.stream.phase).toBe('reconnecting');
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(30_000);
      await h.flush();
      h.listCalls[h.listCalls.length - 1].d.reject({ statusCode: 401 });
      await h.flush();
    }
    expect(h.authRebuild).toHaveBeenCalledTimes(3);
    expect(h.stream.phase).toBe('error');
    expect(h.stream.isAuthFailed()).toBe(true);
    h.stream.stop();
  });

  it('stop during LIST produces no emits and no timers', async () => {
    const h = harness();
    h.stream.start();
    h.stream.stop();
    h.listCalls[0].d.resolve({ items: [secret('a')] });
    await h.flush();
    expect(h.upserts).toEqual([]);
    expect(h.pages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.stream.getDiagnostics()).toMatchObject({ hasTimer: false, hasController: false, connecting: false });
  });

  it('a superseded page never reaches onListPage', async () => {
    const h = harness();
    h.stream.start();
    await h.completeList([[secret('a')]]);
    h.stream.restart();
    const stale = h.listCalls[1];
    h.stream.restart();
    stale.d.resolve({ items: [secret('zzz')] });
    await h.flush();
    expect(h.pages.some((p) => p.ids.includes('zzz'))).toBe(false);
    h.stream.stop();
  });

  it('stop while watch() is pending aborts the late controller', async () => {
    const h = harness('secrets', { manualWatch: true });
    h.stream.start();
    await h.completeList([[secret('a')]]);
    const w = h.watchCalls[0];
    expect(h.stream.getDiagnostics().connecting).toBe(true);
    h.stream.stop();
    w.result.resolve(w.ctrl);
    await h.flush();
    expect(w.ctrl.signal.aborted).toBe(true);
    expect(h.stream.getDiagnostics()).toMatchObject({ hasController: false, connecting: false });
  });

  it('done(err) before watch() returns: no controller stored, exactly one retry', async () => {
    const h = harness('secrets', { manualWatch: true });
    h.stream.start();
    await h.completeList([[secret('a')]]);
    const w = h.watchCalls[0];
    const before = h.timers.length;
    w.onDone({ statusCode: 500 });
    w.result.resolve(w.ctrl);
    await h.flush();
    expect(w.ctrl.signal.aborted).toBe(true);
    expect(h.stream.getDiagnostics().hasController).toBe(false);
    expect(h.timers.length - before).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    h.stream.stop();
  });

  it('fast close counts as failure; slow close or close after an event re-watches in 500 ms', async () => {
    const h = harness();
    h.stream.start();
    await h.completeList([[secret('a')]]);
    vi.advanceTimersByTime(100);
    h.watchCalls[0].onDone(null);
    expect(h.timers[h.timers.length - 1]).toBeGreaterThanOrEqual(800);
    expect(h.stream.phase).toBe('reconnecting');
    // Two more fast closes → rv dropped → LIST
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(h.timers[h.timers.length - 1]);
      await h.flush();
      vi.advanceTimersByTime(100);
      h.watchCalls[h.watchCalls.length - 1].onDone(null);
    }
    vi.advanceTimersByTime(h.timers[h.timers.length - 1]);
    await h.flush();
    expect(h.listCalls).toHaveLength(2);
    await h.completeList([[secret('a')]]);
    const n = h.watchCalls.length;
    vi.advanceTimersByTime(6000);
    h.watchCalls[n - 1].onDone(null);
    expect(h.timers[h.timers.length - 1]).toBe(500);
    vi.advanceTimersByTime(500);
    await h.flush();
    expect(h.watchCalls).toHaveLength(n + 1);
    h.stream.stop();
  });

  it('401: rebuild requested, error at the 3rd, restart resets', async () => {
    const h = harness();
    h.stream.start();
    for (let i = 0; i < 3; i++) {
      h.listCalls[h.listCalls.length - 1].d.reject({ statusCode: 401 });
      await h.flush();
      if (i < 2) { vi.advanceTimersByTime(30_000); await h.flush(); }
    }
    expect(h.authRebuild).toHaveBeenCalledTimes(3);
    expect(h.stream.phase).toBe('error');
    expect(h.stream.error).toBe('Authentication failed: refresh credentials');
    expect(h.stream.isAuthFailed()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    h.stream.restart();
    expect(h.listCalls).toHaveLength(4);
    h.listCalls[3].d.reject({ statusCode: 401 });
    await h.flush();
    expect(h.stream.phase).toBe('reconnecting'); // counter was reset
    h.stream.stop();
  });

  it('403 marks forbidden with no retry; 404 marks error', async () => {
    const h = harness();
    h.stream.start();
    h.listCalls[0].d.reject({ code: 403 });
    await h.flush();
    expect(h.stream.phase).toBe('forbidden');
    expect(vi.getTimerCount()).toBe(0);
    const h2 = harness();
    h2.stream.start();
    h2.listCalls[0].d.reject({ code: 404 });
    await h2.flush();
    expect(h2.stream.phase).toBe('error');
    expect(h2.stream.error).toBe('Resource type not served by cluster');
  });

  it('health check skips connecting streams and re-watches after 5 min of silence', async () => {
    const h = harness('secrets', { manualWatch: true });
    h.stream.start();
    await h.completeList([[secret('a')]]);
    vi.advanceTimersByTime(6 * 60_000);
    h.stream.checkHealth();
    expect(h.watchCalls).toHaveLength(1); // connecting: skipped
    h.watchCalls[0].result.resolve(h.watchCalls[0].ctrl);
    await h.flush();
    h.stream.checkHealth();
    expect(h.watchCalls).toHaveLength(1); // just connected
    vi.advanceTimersByTime(5 * 60_000 + 1);
    h.stream.checkHealth();
    expect(h.watchCalls[0].ctrl.signal.aborted).toBe(true);
    expect(h.watchCalls).toHaveLength(2);
    expect(h.watchCalls[1].params.resourceVersion).toBe('100');
    h.stream.stop();
  });

  it('ensureFresh applies the 660 s floor; 0 always re-watches', async () => {
    const h = harness();
    h.stream.start();
    await h.completeList([[secret('a')]]);
    vi.advanceTimersByTime(3 * 60_000);
    const epoch = h.stream.getDiagnostics().epoch;
    h.stream.ensureFresh(120_000);
    expect(h.stream.getDiagnostics().epoch).toBe(epoch);
    expect(h.watchCalls).toHaveLength(1);
    vi.advanceTimersByTime(8 * 60_000 + 1); // just over 11 min of silence
    h.stream.ensureFresh(300_000);
    expect(h.watchCalls).toHaveLength(2);
    await h.flush();
    h.stream.ensureFresh(0);
    expect(h.watchCalls).toHaveLength(3);
    h.stream.stop();
  });
});
