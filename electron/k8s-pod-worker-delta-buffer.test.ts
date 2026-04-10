import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeltaBatchBuffer } from './k8s-pod-worker';
import type { PodDelta, LightweightPod } from '../src/types/pod-worker';

function makePod(uid: string, name = `pod-${uid}`): LightweightPod {
  return {
    uid,
    name,
    namespace: 'default',
    status: 'Running',
    restarts: 0,
    age: new Date().toISOString(),
    node: 'node-1',
    containers: [],
  };
}

describe('DeltaBatchBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes buffered deltas after the default 150ms interval', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    buffer.push({ action: 'add', pod: makePod('a') });

    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0][0]).toHaveLength(1);

    buffer.destroy();
  });

  it('does not call onFlush when buffer is empty', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    vi.advanceTimersByTime(150);
    expect(onFlush).not.toHaveBeenCalled();

    buffer.destroy();
  });

  it('respects custom flushIntervalMs', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ flushIntervalMs: 300, onFlush });

    buffer.push({ action: 'add', pod: makePod('a') });

    vi.advanceTimersByTime(150);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(onFlush).toHaveBeenCalledOnce();

    buffer.destroy();
  });

  it('coalesces multiple updates to the same UID (last-write-wins)', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    const pod1 = makePod('a');
    pod1.status = 'Pending';
    const pod2 = makePod('a');
    pod2.status = 'Running';

    buffer.push({ action: 'update', pod: pod1 });
    buffer.push({ action: 'update', pod: pod2 });

    buffer.flush();

    expect(onFlush).toHaveBeenCalledOnce();
    const flushed: PodDelta[] = onFlush.mock.calls[0][0];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].action).toBe('update');
    expect(flushed[0].pod!.status).toBe('Running');

    buffer.destroy();
  });

  it('delete supersedes prior add for the same UID', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    buffer.push({ action: 'add', pod: makePod('a') });
    buffer.push({ action: 'delete', uid: 'a' });

    buffer.flush();

    const flushed: PodDelta[] = onFlush.mock.calls[0][0];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].action).toBe('delete');
    expect(flushed[0].uid).toBe('a');

    buffer.destroy();
  });

  it('delete supersedes prior update for the same UID', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    buffer.push({ action: 'update', pod: makePod('a') });
    buffer.push({ action: 'delete', uid: 'a' });

    buffer.flush();

    const flushed: PodDelta[] = onFlush.mock.calls[0][0];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].action).toBe('delete');

    buffer.destroy();
  });

  it('add after delete emits only the add', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    buffer.push({ action: 'delete', uid: 'a' });
    buffer.push({ action: 'add', pod: makePod('a') });

    buffer.flush();

    const flushed: PodDelta[] = onFlush.mock.calls[0][0];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].action).toBe('add');
    expect(flushed[0].pod!.uid).toBe('a');

    buffer.destroy();
  });

  it('update after delete emits only the add', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    buffer.push({ action: 'delete', uid: 'a' });
    buffer.push({ action: 'update', pod: makePod('a') });

    buffer.flush();

    const flushed: PodDelta[] = onFlush.mock.calls[0][0];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].action).toBe('add');

    buffer.destroy();
  });

  it('preserves add action when update follows add for the same UID', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    const pod1 = makePod('a');
    pod1.status = 'Pending';
    const pod2 = makePod('a');
    pod2.status = 'Running';

    buffer.push({ action: 'add', pod: pod1 });
    buffer.push({ action: 'update', pod: pod2 });

    buffer.flush();

    const flushed: PodDelta[] = onFlush.mock.calls[0][0];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].action).toBe('add');
    expect(flushed[0].pod!.status).toBe('Running');

    buffer.destroy();
  });

  it('handles deltas for different UIDs independently', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    buffer.push({ action: 'add', pod: makePod('a') });
    buffer.push({ action: 'update', pod: makePod('b') });
    buffer.push({ action: 'delete', uid: 'c' });

    buffer.flush();

    const flushed: PodDelta[] = onFlush.mock.calls[0][0];
    expect(flushed).toHaveLength(3);

    buffer.destroy();
  });

  it('destroy() flushes remaining events and stops the timer', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    buffer.push({ action: 'add', pod: makePod('a') });
    buffer.push({ action: 'update', pod: makePod('b') });

    buffer.destroy();

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0][0]).toHaveLength(2);

    // Timer should be cleared — no further flushes
    onFlush.mockClear();
    buffer.push({ action: 'add', pod: makePod('c') });
    vi.advanceTimersByTime(300);
    expect(onFlush).not.toHaveBeenCalled();

    buffer.destroy();
  });

  it('clears buffer after flush', () => {
    const onFlush = vi.fn();
    const buffer = new DeltaBatchBuffer({ onFlush });

    buffer.push({ action: 'add', pod: makePod('a') });
    buffer.flush();
    expect(onFlush).toHaveBeenCalledOnce();

    onFlush.mockClear();
    buffer.flush();
    expect(onFlush).not.toHaveBeenCalled();

    buffer.destroy();
  });
});
