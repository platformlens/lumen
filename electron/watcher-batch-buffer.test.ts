import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WatcherBatchBuffer, BatchEvent } from './watcher-batch-buffer';

describe('WatcherBatchBuffer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('flushes accumulated events after the interval', () => {
        const onFlush = vi.fn();
        const buffer = new WatcherBatchBuffer({ onFlush });

        buffer.push({ type: 'ADDED', resource: { name: 'pod-1' } });
        buffer.push({ type: 'MODIFIED', resource: { name: 'pod-2' } });

        expect(onFlush).not.toHaveBeenCalled();

        vi.advanceTimersByTime(150);

        expect(onFlush).toHaveBeenCalledOnce();
        expect(onFlush).toHaveBeenCalledWith([
            { type: 'ADDED', resource: { name: 'pod-1' } },
            { type: 'MODIFIED', resource: { name: 'pod-2' } },
        ]);

        buffer.destroy();
    });

    it('does not call onFlush when buffer is empty (no-op)', () => {
        const onFlush = vi.fn();
        const buffer = new WatcherBatchBuffer({ onFlush });

        vi.advanceTimersByTime(150);

        expect(onFlush).not.toHaveBeenCalled();

        buffer.destroy();
    });

    it('uses default 150ms interval when flushIntervalMs is not provided', () => {
        const onFlush = vi.fn();
        const buffer = new WatcherBatchBuffer({ onFlush });

        buffer.push({ type: 'ADDED', resource: {} });

        vi.advanceTimersByTime(149);
        expect(onFlush).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onFlush).toHaveBeenCalledOnce();

        buffer.destroy();
    });

    it('respects custom flushIntervalMs', () => {
        const onFlush = vi.fn();
        const buffer = new WatcherBatchBuffer({ flushIntervalMs: 200, onFlush });

        buffer.push({ type: 'DELETED', resource: { name: 'dep-1' } });

        vi.advanceTimersByTime(150);
        expect(onFlush).not.toHaveBeenCalled();

        vi.advanceTimersByTime(50);
        expect(onFlush).toHaveBeenCalledOnce();

        buffer.destroy();
    });

    it('flush() force-flushes events immediately', () => {
        const onFlush = vi.fn();
        const buffer = new WatcherBatchBuffer({ onFlush });

        buffer.push({ type: 'ADDED', resource: { name: 'a' } });
        buffer.flush();

        expect(onFlush).toHaveBeenCalledOnce();
        expect(onFlush).toHaveBeenCalledWith([
            { type: 'ADDED', resource: { name: 'a' } },
        ]);

        buffer.destroy();
    });

    it('destroy() flushes remaining events and stops the timer', () => {
        const onFlush = vi.fn();
        const buffer = new WatcherBatchBuffer({ onFlush });

        buffer.push({ type: 'ADDED', resource: { name: 'x' } });
        buffer.push({ type: 'DELETED', resource: { name: 'y' } });

        buffer.destroy();

        expect(onFlush).toHaveBeenCalledOnce();
        expect(onFlush).toHaveBeenCalledWith([
            { type: 'ADDED', resource: { name: 'x' } },
            { type: 'DELETED', resource: { name: 'y' } },
        ]);

        // Timer should be cleared — no further flushes
        onFlush.mockClear();
        vi.advanceTimersByTime(300);
        expect(onFlush).not.toHaveBeenCalled();
    });

    it('preserves event order across pushes', () => {
        const onFlush = vi.fn();
        const buffer = new WatcherBatchBuffer({ onFlush });

        const events: BatchEvent[] = [
            { type: 'ADDED', resource: { id: 1 } },
            { type: 'MODIFIED', resource: { id: 2 } },
            { type: 'DELETED', resource: { id: 3 } },
            { type: 'ADDED', resource: { id: 4 } },
        ];

        events.forEach(e => buffer.push(e));
        buffer.flush();

        expect(onFlush).toHaveBeenCalledWith(events);

        buffer.destroy();
    });

    it('clears buffer after flush so next flush is empty (no-op)', () => {
        const onFlush = vi.fn();
        const buffer = new WatcherBatchBuffer({ onFlush });

        buffer.push({ type: 'ADDED', resource: {} });
        buffer.flush();
        expect(onFlush).toHaveBeenCalledOnce();

        onFlush.mockClear();
        buffer.flush();
        expect(onFlush).not.toHaveBeenCalled();

        buffer.destroy();
    });
});
