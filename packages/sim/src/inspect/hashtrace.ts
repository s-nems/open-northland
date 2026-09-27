import type { WorldSnapshot } from './snapshot.js';

export interface HashTraceEntry {
  /** The tick this entry was recorded after (`Simulation.tick` at record time). */
  readonly tick: number;
  /** `Simulation.hashState()` at that tick. */
  readonly hash: string;
  /** Present only while the entry is inside the smaller snapshot window. */
  readonly snapshot?: WorldSnapshot;
}

export interface HashTraceOptions {
  /** Max retained entries, `>= 1`; recording past it drops the oldest. Defaults to 4096. */
  readonly hashCapacity?: number;
  /**
   * Max recent entries that also retain their `WorldSnapshot`, `>= 0` and `<= hashCapacity` because a
   * snapshot cannot outlive its hash entry. Defaults to 0.
   */
  readonly snapshotCapacity?: number;
}

/** A divergence point: the first tick at which two traces' hashes disagree, with both hashes. */
export interface Divergence {
  readonly tick: number;
  readonly hash: string;
  readonly otherHash: string;
}

const DEFAULT_HASH_CAPACITY = 4096;

/**
 * A fixed-capacity ring of per-tick `{tick, hash, snapshot?}` entries the caller records into after
 * `step()`. Recording is O(1); comparing two traces finds the first diverging tick without re-replaying
 * either run.
 */
export class HashTrace {
  private readonly hashCapacity: number;
  private readonly snapshotCapacity: number;
  /** Ring storage: grows by push until full, then overwrites the oldest slot. */
  private readonly slots: HashTraceEntry[] = [];
  /** The slot holding the oldest entry, 0 until the ring first wraps. */
  private head = 0;

  constructor(opts: HashTraceOptions = {}) {
    const hashCapacity = opts.hashCapacity ?? DEFAULT_HASH_CAPACITY;
    const snapshotCapacity = opts.snapshotCapacity ?? 0;
    if (!Number.isInteger(hashCapacity) || hashCapacity < 1) {
      throw new Error(`HashTrace hashCapacity must be an integer >= 1, got ${hashCapacity}`);
    }
    if (!Number.isInteger(snapshotCapacity) || snapshotCapacity < 0) {
      throw new Error(`HashTrace snapshotCapacity must be an integer >= 0, got ${snapshotCapacity}`);
    }
    if (snapshotCapacity > hashCapacity) {
      throw new Error(
        `HashTrace snapshotCapacity ${snapshotCapacity} exceeds hashCapacity ${hashCapacity}: a snapshot can't outlive its hash entry`,
      );
    }
    this.hashCapacity = hashCapacity;
    this.snapshotCapacity = snapshotCapacity;
  }

  /**
   * Record one tick's `hashState()` and, optionally, the `snapshot()` at the same boundary. Ticks must
   * arrive in strictly ascending order or this throws. A full trace overwrites its oldest entry.
   */
  record(tick: number, hash: string, snapshot?: WorldSnapshot): void {
    const last = this.entryAt(this.slots.length - 1);
    if (last !== undefined && tick <= last.tick) {
      throw new Error(`HashTrace.record tick ${tick} is not after the last recorded tick ${last.tick}`);
    }
    const entry: HashTraceEntry =
      snapshot !== undefined && this.snapshotCapacity > 0 ? { tick, hash, snapshot } : { tick, hash };
    if (this.slots.length < this.hashCapacity) {
      this.slots.push(entry);
    } else {
      this.slots[this.head] = entry;
      this.head = (this.head + 1) % this.hashCapacity;
    }
    // Every prior record aged its own boundary entry, so only the single entry that just left the
    // snapshot window can still hold one.
    if (this.snapshotCapacity > 0) {
      const boundary = this.slots.length - this.snapshotCapacity - 1;
      const e = this.entryAt(boundary);
      if (e !== undefined && e.snapshot !== undefined) {
        this.slots[this.slotOf(boundary)] = { tick: e.tick, hash: e.hash };
      }
    }
  }

  get size(): number {
    return this.slots.length;
  }

  get oldestTick(): number | undefined {
    return this.entryAt(0)?.tick;
  }

  get newestTick(): number | undefined {
    return this.entryAt(this.slots.length - 1)?.tick;
  }

  /** The entry recorded for `tick`, or `undefined` once it has aged out of the window. */
  at(tick: number): HashTraceEntry | undefined {
    let lo = 0;
    let hi = this.slots.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const e = this.entryAt(mid);
      if (e === undefined) return undefined;
      if (e.tick === tick) return e;
      if (e.tick < tick) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  hashAt(tick: number): string | undefined {
    return this.at(tick)?.hash;
  }

  /** Oldest-first copy; the ring stays private. */
  list(): readonly HashTraceEntry[] {
    return [...this.slots.slice(this.head), ...this.slots.slice(0, this.head)];
  }

  /**
   * The earliest tick whose hash disagrees with `other`, considering only ticks present in both
   * retained windows.
   */
  divergedFrom(other: HashTrace): Divergence | undefined {
    for (let i = 0; i < this.slots.length; i++) {
      const e = this.entryAt(i);
      if (e === undefined) continue;
      const otherHash = other.hashAt(e.tick);
      if (otherHash !== undefined && otherHash !== e.hash) {
        return { tick: e.tick, hash: e.hash, otherHash };
      }
    }
    return undefined;
  }

  /** The ring slot of the entry at `index` in ascending tick order. */
  private slotOf(index: number): number {
    return (this.head + index) % this.slots.length;
  }

  /** The entry at `index` in ascending tick order, or `undefined` outside `[0, size)`. */
  private entryAt(index: number): HashTraceEntry | undefined {
    if (index < 0 || index >= this.slots.length) return undefined;
    return this.slots[this.slotOf(index)];
  }
}
