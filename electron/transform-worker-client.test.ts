import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createTransformWorkerClient, type TransformWorkerLike } from './transform-worker-client';
import type { TransformRequest, TransformResponse } from './resource-transform-worker';

class FakeWorker extends EventEmitter {
  posted: TransformRequest[] = [];
  postMessage(req: TransformRequest) { this.posted.push(req); }
  terminate() { return Promise.resolve(0); }
}

const req = (id: string): TransformRequest => ({ id, resourceType: 'node', events: [] });

describe('transform worker client', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('W1 error → W2 created → W1 exit leaves W2 pending and current', async () => {
    const workers: FakeWorker[] = [];
    const client = createTransformWorkerClient({ createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as unknown as TransformWorkerLike; } });

    const p1 = client.sendToWorker(req('a'));
    const w1 = workers[0];
    w1.emit('error', new Error('boom'));
    const r1 = await p1;
    expect(r1.error).toBe('worker error');

    const p2 = client.sendToWorker(req('b'));
    const w2 = workers[1];
    expect(w2).toBeDefined();
    w1.emit('exit', 1);
    expect(client.currentWorker()).toBe(w2);
    expect(client.pendingTransformCount()).toBe(1);

    const resp: TransformResponse = { id: 'b', resourceType: 'node', events: [] };
    w2.emit('message', resp);
    await expect(p2).resolves.toEqual(resp);
    expect(client.pendingTransformCount()).toBe(0);
  });

  it('exit fails only that worker\'s requests', async () => {
    const workers: FakeWorker[] = [];
    const client = createTransformWorkerClient({ createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as unknown as TransformWorkerLike; } });
    const p = client.sendToWorker(req('a'));
    workers[0].emit('exit', 1);
    await expect(p).resolves.toMatchObject({ error: 'worker exited' });
    expect(client.currentWorker()).toBeNull();
  });

  it('times out after 15 s and removes the id from both maps', async () => {
    const workers: FakeWorker[] = [];
    const client = createTransformWorkerClient({ createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as unknown as TransformWorkerLike; } });
    const p = client.sendToWorker(req('a'));
    vi.advanceTimersByTime(15_000);
    await expect(p).resolves.toMatchObject({ error: 'timeout' });
    expect(client.pendingTransformCount()).toBe(0);
    // A late message for the timed-out id is a no-op; an exit afterwards fails nothing.
    workers[0].emit('message', { id: 'a', resourceType: 'node', events: [] });
    workers[0].emit('exit', 1);
    expect(client.pendingTransformCount()).toBe(0);
  });
});
