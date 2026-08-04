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
 * A capped per-tick `{tick, hash, snapshot?}` list the caller records into after `step()`. Comparing
 * two traces finds the first diverging tick without re-replaying either run.
 */
export class HashTrace {
  private readonly hashCapacity: number;
  private readonly snapshotCapacity: number;
  /** Ascending by tick, oldest first. */
  private readonly entries: HashTraceEntry[] = [];

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
   * arrive in strictly ascending order or this throws. Eviction shifts the backing array, so a full
   * trace costs O(hashCapacity) per call; this is not a ring buffer.
   */
  record(tick: number, hash: string, snapshot?: WorldSnapshot): void {
    const last = this.entries[this.entries.length - 1];
    if (last !== undefined && tick <= last.tick) {
      throw new Error(`HashTrace.record tick ${tick} is not after the last recorded tick ${last.tick}`);
    }
    const entry: HashTraceEntry =
      snapshot !== undefined && this.snapshotCapacity > 0 ? { tick, hash, snapshot } : { tick, hash };
    this.entries.push(entry);
    while (this.entries.length > this.hashCapacity) this.entries.shift();
    // Every prior record aged its own boundary entry, so only the single entry that just left the
    // snapshot window can still hold one.
    if (this.snapshotCapacity > 0) {
      const boundary = this.entries.length - this.snapshotCapacity - 1;
      const e = boundary >= 0 ? this.entries[boundary] : undefined;
      if (e !== undefined && e.snapshot !== undefined) {
        this.entries[boundary] = { tick: e.tick, hash: e.hash };
      }
    }
  }

  get size(): number {
    return this.entries.length;
  }

  get oldestTick(): number | undefined {
    return this.entries[0]?.tick;
  }

  get newestTick(): number | undefined {
    return this.entries[this.entries.length - 1]?.tick;
  }

  /** The entry recorded for `tick`, or `undefined` once it has aged out of the window. */
  at(tick: number): HashTraceEntry | undefined {
    let lo = 0;
    let hi = this.entries.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const e = this.entries[mid] as HashTraceEntry;
      if (e.tick === tick) return e;
      if (e.tick < tick) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  hashAt(tick: number): string | undefined {
    return this.at(tick)?.hash;
  }

  /** Oldest-first copy; the backing list stays private. */
  list(): readonly HashTraceEntry[] {
    return [...this.entries];
  }

  /**
   * The earliest tick whose hash disagrees with `other`, considering only ticks present in both
   * retained windows.
   */
  divergedFrom(other: HashTrace): Divergence | undefined {
    for (const e of this.entries) {
      const otherHash = other.hashAt(e.tick);
      if (otherHash !== undefined && otherHash !== e.hash) {
        return { tick: e.tick, hash: e.hash, otherHash };
      }
    }
    return undefined;
  }
}
