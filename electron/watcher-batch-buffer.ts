/**
 * WatcherBatchBuffer - Accumulates Kubernetes watcher events and flushes
 * them as batched arrays on a configurable interval.
 *
 * Feature: ui-performance-optimization
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

export interface BatchEvent<T = any> {
    type: 'ADDED' | 'MODIFIED' | 'DELETED';
    resource: T;
}

export interface WatcherBatchBufferOptions {
    flushIntervalMs?: number; // 100–200ms, default 150ms
    onFlush: (events: BatchEvent[]) => void;
}

export class WatcherBatchBuffer {
    private buffer: BatchEvent[] = [];
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private readonly flushIntervalMs: number;
    private readonly onFlush: (events: BatchEvent[]) => void;

    constructor(options: WatcherBatchBufferOptions) {
        this.flushIntervalMs = options.flushIntervalMs ?? 150;
        this.onFlush = options.onFlush;
        this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    }

    /** Add an event to the buffer. */
    push(event: BatchEvent): void {
        this.buffer.push(event);
    }

    /** Force-flush all buffered events. No-op if buffer is empty. */
    flush(): void {
        if (this.buffer.length === 0) return;
        const events = this.buffer;
        this.buffer = [];
        this.onFlush(events);
    }

    /** Clear the interval timer and flush any remaining events. */
    destroy(): void {
        if (this.flushTimer !== null) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        this.flush();
    }
}
