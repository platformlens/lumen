import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HelmIndex } from './helm-index';
import type { RawObject } from './kinds';
import type { HelmReleaseItem } from '../../src/types/resource-cache';
import type { TransformRequest, TransformResponse } from '../resource-transform-worker';

const helmSecret = (rel: string, rev: number, rv = '1', status = 'deployed', uid = `${rel}-v${rev}`): RawObject => ({
  metadata: {
    uid,
    name: `sh.helm.release.v1.${rel}.v${rev}`,
    namespace: 'ns',
    resourceVersion: rv,
    creationTimestamp: `2024-01-0${Math.min(rev, 9)}T00:00:00Z`,
    labels: { name: rel, version: String(rev), owner: 'helm', status },
  },
  type: 'helm.sh/release.v1',
  data: { release: 'BLOB' },
}) as unknown as RawObject;

interface Pending { req: TransformRequest; resolve(r: TransformResponse): void }
interface Fetch { ns: string; name: string; resolve(r: RawObject): void; reject(e: unknown): void }

function harness() {
  const decodes: Pending[] = [];
  const fetches: Fetch[] = [];
  const shown = new Map<string, HelmReleaseItem>();
  const deletes: string[] = [];
  let sessionId: string | null = 's1';
  const phaseChanges = vi.fn();
  const idx = new HelmIndex({
    sendToTransformWorker: (req) => new Promise((resolve) => decodes.push({ req, resolve })),
    readSecret: (ns, name) => new Promise((resolve, reject) => fetches.push({ ns, name, resolve, reject })),
    emitUpsert: (i) => shown.set(i.id, i),
    emitDelete: (id) => { shown.delete(id); deletes.push(id); },
    getSessionId: () => sessionId,
    onPhaseInputsChanged: phaseChanges,
  });
  const ok = (p: Pending, skip: string[] = []): TransformResponse => ({
    id: p.req.id,
    resourceType: 'helmrelease',
    events: p.req.events
      .map((ev) => ev.resource as Record<string, { uid: string; resourceVersion: string; labels: Record<string, string> }>)
      .filter((r) => !skip.includes(r.metadata.uid))
      .map((r) => ({
        type: 'ADDED' as const,
        resource: {
          name: r.metadata.labels.name, revision: Number(r.metadata.labels.version), status: 'deployed', chart: 'chart',
          chartVersion: '1.0.0', appVersion: '2.0', lastUpdated: 'x', description: 'd',
          secretUid: r.metadata.uid, secretResourceVersion: r.metadata.resourceVersion,
        },
      })),
  });
  const decodedUids = () => decodes.flatMap((d) => d.req.events.map((e) => (e.resource as { metadata: { uid: string } }).metadata.uid));
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { idx, decodes, fetches, shown, deletes, ok, decodedUids, flush, phaseChanges, setSession: (s: string | null) => { sessionId = s; } };
}

describe('HelmIndex', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('latest revision wins; only the max is decoded; label summary until decoded', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 1), helmSecret('app', 2), helmSecret('app', 3)], { first: true });
    expect(h.decodedUids()).toEqual(['app-v3']);
    expect(h.shown.get('ns/app')).toMatchObject({ revision: 3, status: 'deployed', chart: '' });
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    expect(h.shown.get('ns/app')).toMatchObject({ revision: 3, chart: 'chart' });
    expect(h.fetches).toHaveLength(0);
  });

  it('same-page v3 then v2 issues one decode and no readSecret', () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 3), helmSecret('app', 2)], { first: true });
    expect(h.decodes).toHaveLength(1);
    expect(h.decodedUids()).toEqual(['app-v3']);
    expect(h.fetches).toHaveLength(0);
  });

  it('cross-page revisions: one decode (v10), zero readSecret', () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 1), helmSecret('app', 10)], { first: true });
    h.idx.onListPage([helmSecret('app', 2)], { first: true });
    expect(h.decodedUids()).toEqual(['app-v10']);
    expect(h.fetches).toHaveLength(0);
  });

  it('decode in flight + older-revision event: no readSecret, then the result applies', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 3)], { first: true });
    h.idx.onWatchEvent('ADDED', helmSecret('app', 1));
    h.idx.onWatchEvent('DELETED', helmSecret('app', 1));
    vi.advanceTimersByTime(650);
    expect(h.fetches).toHaveLength(0);
    expect(h.decodes).toHaveLength(1);
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    expect(h.shown.get('ns/app')?.chart).toBe('chart');
  });

  it('unchanged uid@rv is a cache hit on re-list', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 1)], { first: true });
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    h.idx.onListPage([helmSecret('app', 1)], { first: false });
    expect(h.decodes).toHaveLength(1);
  });

  it('delete latest → label-derived v2, one readSecret, then full v2', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 2, '1', 'superseded'), helmSecret('app', 3)], { first: true });
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    h.idx.onWatchEvent('DELETED', helmSecret('app', 3));
    expect(h.shown.get('ns/app')).toMatchObject({ revision: 2, status: 'superseded', chart: '' });
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0]).toMatchObject({ ns: 'ns', name: 'sh.helm.release.v1.app.v2' });
    // A second recompute while in flight does not fetch again
    h.idx.onWatchEvent('ADDED', helmSecret('app', 1));
    expect(h.fetches).toHaveLength(1);
    h.fetches[0].resolve(helmSecret('app', 2, '1', 'superseded'));
    await h.flush();
    expect(h.decodes).toHaveLength(2);
    h.decodes[1].resolve(h.ok(h.decodes[1]));
    await h.flush();
    expect(h.shown.get('ns/app')).toMatchObject({ revision: 2, chart: 'chart' });
  });

  it('deleting every revision removes the release (re-list deletes too)', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 1), helmSecret('app', 2), helmSecret('app', 3)], { first: true });
    h.idx.onListComplete(['app-v3'], true);
    expect(h.shown.get('ns/app')?.revision).toBe(2);
    h.idx.onListComplete(['app-v1', 'app-v2', 'unknown-uid'], false);
    expect(h.shown.has('ns/app')).toBe(false);
    expect(h.deletes).toContain('ns/app');
  });

  it('a failures[] entry excludes the corrupt revision and falls back', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 2), helmSecret('app', 3)], { first: true });
    const p = h.decodes[0];
    h.idx.onSecretDeleted('noop');
    p.resolve({ id: p.req.id, resourceType: 'helmrelease', events: [], error: 'bad', failures: [{ index: 0, uid: 'app-v3', message: 'x' }] });
    await h.flush();
    expect(h.idx.entry('app-v3')).toMatchObject({ decodeState: 'failed', corrupt: true });
    expect(h.shown.get('ns/app')?.revision).toBe(2);
    expect(h.fetches).toHaveLength(1); // v2 was never decoded
  });

  it('rv change resets a corrupt entry and decodes from the raw in hand', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 3)], { first: true });
    h.decodes[0].resolve({ id: h.decodes[0].req.id, resourceType: 'helmrelease', events: [], error: 'e', failures: [{ index: 0, uid: 'app-v3', message: 'x' }] });
    await h.flush();
    expect(h.shown.has('ns/app')).toBe(false);
    h.idx.onWatchEvent('MODIFIED', helmSecret('app', 3, '2'));
    vi.advanceTimersByTime(650);
    expect(h.decodes).toHaveLength(2);
    expect(h.fetches).toHaveLength(0);
  });

  it('partial failure: 49 events + 1 failure applies the 49', async () => {
    const h = harness();
    const secrets = Array.from({ length: 50 }, (_, i) => helmSecret(`r${i}`, 1));
    h.idx.onListPage(secrets, { first: true });
    expect(h.decodes).toHaveLength(1);
    const p = h.decodes[0];
    const resp = h.ok(p, ['r7-v1']);
    resp.error = 'one failed';
    resp.failures = [{ index: 7, uid: 'r7-v1', message: 'x' }];
    p.resolve(resp);
    await h.flush();
    const decoded = [...h.shown.values()].filter((s) => s.chart === 'chart');
    expect(decoded).toHaveLength(49);
  });

  it('whole-request failure retries once via readSecret, then gives up', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 3)], { first: true });
    h.decodes[0].resolve({ id: h.decodes[0].req.id, resourceType: 'helmrelease', events: [], error: 'worker exited' });
    await h.flush();
    expect(h.fetches).toHaveLength(1);
    h.fetches[0].resolve(helmSecret('app', 3));
    await h.flush();
    expect(h.decodes).toHaveLength(2);
    expect(h.decodes[1].req.events).toHaveLength(1);
    h.decodes[1].resolve({ id: h.decodes[1].req.id, resourceType: 'helmrelease', events: [], error: 'worker exited' });
    await h.flush();
    expect(h.idx.entry('app-v3')).toMatchObject({ decodeState: 'failed', corrupt: false });
    expect(h.fetches).toHaveLength(1);
    expect(h.shown.get('ns/app')).toMatchObject({ revision: 3, chart: '' });
  });

  it('fetch returning a newer rv → failed, then MODIFIED decodes in hand without refetch', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 2), helmSecret('app', 3)], { first: true });
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    h.idx.onWatchEvent('DELETED', helmSecret('app', 3));
    h.fetches[0].resolve(helmSecret('app', 2, '9'));
    await h.flush();
    expect(h.idx.entry('app-v2')).toMatchObject({ decodeState: 'failed', corrupt: false });
    expect(h.shown.get('ns/app')?.revision).toBe(2);
    h.idx.onWatchEvent('MODIFIED', helmSecret('app', 2, '9'));
    vi.advanceTimersByTime(650);
    expect(h.decodes).toHaveLength(2);
    expect(h.fetches).toHaveLength(1);
  });

  it('fetch overtaken by the watch is ignored; the in-hand decode applies', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 2), helmSecret('app', 3)], { first: true });
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    h.idx.onWatchEvent('DELETED', helmSecret('app', 3));
    expect(h.fetches).toHaveLength(1);
    h.idx.onWatchEvent('MODIFIED', helmSecret('app', 2, '5'));
    vi.advanceTimersByTime(650);
    expect(h.decodes).toHaveLength(2);
    h.fetches[0].resolve(helmSecret('app', 2, '1'));
    await h.flush();
    expect(h.idx.entry('app-v2')?.decodeState).toBe('pending');
    expect(h.fetches).toHaveLength(1);
    h.decodes[1].resolve(h.ok(h.decodes[1]));
    await h.flush();
    expect(h.shown.get('ns/app')).toMatchObject({ revision: 2, chart: 'chart' });
  });

  it('a rejected readSecret keeps the label summary and logs once', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 2), helmSecret('app', 3)], { first: true });
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    h.idx.onWatchEvent('DELETED', helmSecret('app', 3));
    h.fetches[0].reject({ statusCode: 404 });
    await h.flush();
    expect(h.shown.get('ns/app')).toMatchObject({ revision: 2, chart: '' });
    expect(h.idx.entry('app-v2')).toMatchObject({ decodeState: 'failed', corrupt: false });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('results after clear() or from a stale session are dropped', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('app', 3)], { first: true });
    h.setSession('s2');
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    expect(h.shown.get('ns/app')?.chart).toBe('');
    h.setSession('s1');
    h.idx.onListPage([helmSecret('b', 2), helmSecret('b', 3)], { first: false });
    const pending = h.decodes[1];
    h.idx.clear({ emit: true });
    expect(h.shown.size).toBe(0);
    pending.resolve(h.ok(pending));
    await h.flush();
    expect(h.shown.size).toBe(0);
    expect(h.idx.getDiagnostics()).toEqual({ helmDecodeCacheSize: 0, helmFallbackFetchesInFlight: 0, hasTimer: false });
  });

  it('helm phase: settles only after the first list and its decodes (counting only first pages)', async () => {
    const h = harness();
    h.idx.onListPage([helmSecret('a', 1)], { first: true });
    h.idx.onListPage([helmSecret('b', 1)], { first: true });
    h.idx.onFirstListComplete();
    expect(h.idx.isInitialSettled()).toBe(false);
    h.decodes[0].resolve(h.ok(h.decodes[0]));
    await h.flush();
    expect(h.idx.isInitialSettled()).toBe(false);
    h.decodes[1].resolve({ id: h.decodes[1].req.id, resourceType: 'helmrelease', events: [], error: 'worker exited' });
    await h.flush();
    expect(h.idx.isInitialSettled()).toBe(true); // retry fetch does not count
    h.idx.onListPage([helmSecret('c', 1)], { first: false });
    expect(h.idx.isInitialSettled()).toBe(true);
  });
});
