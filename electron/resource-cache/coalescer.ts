/**
 * Coalescer (design §3.8): per-kind last-write-wins buffer, per-kind reset,
 * a single 650 ms flush timer, and one `resources:batch` message per flush.
 */
import type { CoreKind, KindDelta, KindItemMap, KindStatus, ResourceBatch } from '../../src/types/resource-cache';

export const COALESCE_MS = 650;

export interface Subscriber {
  id: number;
  isDestroyed(): boolean;
  send(channel: 'resources:batch', batch: ResourceBatch): void;
}

export type Op<K extends CoreKind> = { kind: 'upsert'; item: KindItemMap[K] } | { kind: 'delete' };

interface KindBuffer<K extends CoreKind> {
  reset: boolean;
  ops: Map<string, Op<K>>;
  status?: KindStatus;
}

type Buffers = { [K in CoreKind]?: KindBuffer<K> };

export interface CoalescerDeps {
  sessionId: string;
  /** Returns ++session.seq. */
  nextSeq(): number;
  /** The bound subscriber, or null when unbound. */
  getSubscriber(): Subscriber | null;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
  delayMs?: number;
}

export class Coalescer {
  private buffers: Buffers = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly setT: NonNullable<CoalescerDeps['setTimeout']>;
  private readonly clearT: NonNullable<CoalescerDeps['clearTimeout']>;
  private readonly delay: number;

  constructor(private readonly deps: CoalescerDeps) {
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((t) => clearTimeout(t));
    this.delay = deps.delayMs ?? COALESCE_MS;
  }

  private buf<K extends CoreKind>(kind: K): KindBuffer<K> {
    let b = this.buffers[kind] as KindBuffer<K> | undefined;
    if (!b) {
      b = { reset: false, ops: new Map() };
      (this.buffers as Record<CoreKind, KindBuffer<K>>)[kind] = b;
    }
    return b;
  }

  private arm(): void {
    if (this.timer === null) this.timer = this.setT(() => this.flush(), this.delay);
  }

  upsert<K extends CoreKind>(kind: K, item: KindItemMap[K]): void {
    this.buf(kind).ops.set(item.id, { kind: 'upsert', item });
    this.arm();
  }

  delete(kind: CoreKind, id: string): void {
    const b = this.buf(kind);
    // Within a reset buffer a delete simply removes the entry (the reset replaces the map).
    if (b.reset) b.ops.delete(id);
    else b.ops.set(id, { kind: 'delete' });
    this.arm();
  }

  setStatus(kind: CoreKind, status: KindStatus): void {
    this.buf(kind).status = status;
    this.arm();
  }

  resetKind<K extends CoreKind>(kind: K, items: KindItemMap[K][]): void {
    const prev = this.buffers[kind] as KindBuffer<K> | undefined;
    const ops = new Map<string, Op<K>>();
    for (const item of items) ops.set(item.id, { kind: 'upsert', item });
    (this.buffers as Record<CoreKind, KindBuffer<K>>)[kind] = { reset: true, ops, status: prev?.status };
    this.arm();
  }

  hasTimer(): boolean {
    return this.timer !== null;
  }

  flush(): void {
    if (this.timer !== null) {
      this.clearT(this.timer);
      this.timer = null;
    }
    const buffers = this.buffers;
    this.buffers = {};
    const kinds: ResourceBatch['kinds'] = {};
    let any = false;
    for (const kind of Object.keys(buffers) as CoreKind[]) {
      const delta = toDelta(buffers[kind]!);
      (kinds as Record<CoreKind, KindDelta<CoreKind>>)[kind] = delta;
      any = true;
    }
    if (!any) return;
    const batch: ResourceBatch = { sessionId: this.deps.sessionId, seq: this.deps.nextSeq(), kinds };
    const sub = this.deps.getSubscriber();
    if (sub && !sub.isDestroyed()) sub.send('resources:batch', batch);
  }

  /** Drop everything without flushing. */
  clear(): void {
    if (this.timer !== null) {
      this.clearT(this.timer);
      this.timer = null;
    }
    this.buffers = {};
  }
}

function toDelta<K extends CoreKind>(b: KindBuffer<K>): KindDelta<K> {
  const upserts: KindItemMap[K][] = [];
  const deletes: string[] = [];
  for (const [id, op] of b.ops) {
    if (op.kind === 'upsert') upserts.push(op.item);
    else deletes.push(id);
  }
  const delta: KindDelta<K> = { upserts, deletes };
  if (b.reset) delta.reset = true;
  if (b.status) delta.status = b.status;
  return delta;
}
