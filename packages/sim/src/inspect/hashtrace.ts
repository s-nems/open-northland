import type { WorldSnapshot } from './snapshot.js';

/**
 * `HashTrace` — the per-tick hash (+ bounded snapshot) capped list for the replay inspector. It is the
 * "find tick N" half; `replay()` is the "jump to tick N" half:
 *
 *  - `replay({content,seed,map?,log,untilTick})` reconstructs the exact state at a tick by re-applying the
 *    command log — the expensive, on-demand primitive a scrub overlay calls once you know which tick.
 *  - `HashTrace` records `{tick, hash}` cheaply during a live run, so "the hash diverged at tick N" is
 *    detectable by comparing two runs' traces without re-replaying either. The overlay hands that N to
 *    `replay()` to inspect.
 *
 * ## Why it is capped (not an ever-growing log)
 *
 * A settlement runs for hours = millions of ticks; keeping every `{tick, hash}` (let alone every snapshot) is
 * unbounded memory. So the trace is a capped list: once full, recording a new tick drops the oldest.
 * The hash window is cheap (a tick number + an 8-char string per entry) so it can be large; the optional
 * snapshot window is heavy (a full cloned world per entry) so it has its own, smaller cap — recent snapshots
 * let the overlay dump an entity at a recent tick without a `replay()`, while older ticks fall back to
 * `replay()` from the (unbounded) command log, which remains the authoritative save/replay record.
 *
 * Eviction shifts the backing array, so a full trace costs O(hashCapacity) per record — fine for the
 * inspector's throttled, debug-gated recording, but this is not a ring buffer: don't put `record` on an
 * unthrottled per-tick path at a large capacity without making it one.
 *
 * ## Purity
 *
 * Pure data: no DOM, no I/O, no clock. A passive recorder the caller drives — call {@link HashTrace.record}
 * after each `step()` with the already-computed `hashState()` (and optional `snapshot()`). It deliberately
 * does not hook `Simulation.step()`: per-tick hashing stays opt-in and out of the deterministic hot loop, so
 * enabling the inspector can never change sim state or the golden hashes. It holds only plain values, so it is
 * itself transferable to a render/worker thread alongside the snapshot it mirrors.
 */
export interface HashTraceEntry {
  /** The tick this hash/snapshot was recorded after (`Simulation.tick` at record time). */
  readonly tick: number;
  /** `Simulation.hashState()` at that tick — the canonical full-state fingerprint. */
  readonly hash: string;
  /**
   * The plain `WorldSnapshot` at that tick, if this entry is within the (smaller) snapshot window.
   * `undefined` when only the hash was recorded, or when the snapshot has aged out of its window
   * while the hash is still in the (larger) hash window. The overlay dumps from here when present and
   * falls back to `replay()` otherwise.
   */
  readonly snapshot?: WorldSnapshot;
}

export interface HashTraceOptions {
  /**
   * Max `{tick, hash}` entries retained. Once full, recording drops the oldest.
   * Must be `>= 1`. The hashes are cheap, so this is typically large (a wide divergence-detection
   * window). Defaults to 4096.
   */
  readonly hashCapacity?: number;
  /**
   * Max recent entries that also retain their full `WorldSnapshot` (the heavy payload). Must be
   * `>= 0` and `<= hashCapacity` (a snapshot can't outlive its hash entry). `0` means "hashes only".
   * Defaults to 0 — opt into snapshots explicitly, since they are large.
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
 * A capped per-tick `{tick, hash, snapshot?}` list for the replay inspector. Cheap to record
 * (the caller passes an already-computed hash), bounded in memory, and pure. See the module doc.
 */
export class HashTrace {
  private readonly hashCapacity: number;
  private readonly snapshotCapacity: number;
  /** Entries in record (ascending-tick) order, oldest first. Length <= hashCapacity. */
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
   * Record one tick's fingerprint. Pass the value of `Simulation.hashState()` for `tick` and,
   * optionally, the `Simulation.snapshot()` at the same boundary. Appends, dropping the oldest entry
   * if it would exceed `hashCapacity`, and ages the snapshot out of any entry that has fallen outside
   * the (more recent) snapshot window so the heavy payload stays bounded.
   *
   * Ticks must be recorded in strictly ascending order (the natural per-`step()` cadence) — a non-monotonic
   * record is a caller bug (out-of-order ticks would make `at`/`divergedFrom` lookups meaningless), so it
   * throws rather than silently corrupting the window.
   */
  record(tick: number, hash: string, snapshot?: WorldSnapshot): void {
    const last = this.entries[this.entries.length - 1];
    if (last !== undefined && tick <= last.tick) {
      throw new Error(`HashTrace.record tick ${tick} is not after the last recorded tick ${last.tick}`);
    }
    const entry: HashTraceEntry =
      snapshot !== undefined && this.snapshotCapacity > 0 ? { tick, hash, snapshot } : { tick, hash };
    this.entries.push(entry);
    // Drop oldest hash entries beyond the hash window.
    while (this.entries.length > this.hashCapacity) this.entries.shift();
    // Age the snapshot out of the one entry that just fell outside the (smaller) snapshot window, so
    // the heavy payload stays capped at the most-recent `snapshotCapacity` entries. This is O(1): we
    // ran on every prior `record`, so everything older is already snapshot-free — only the single
    // entry now at the window's boundary can still hold one. Nothing to do when snapshots are off.
    if (this.snapshotCapacity > 0) {
      const boundary = this.entries.length - this.snapshotCapacity - 1;
      const e = boundary >= 0 ? this.entries[boundary] : undefined;
      if (e !== undefined && e.snapshot !== undefined) {
        this.entries[boundary] = { tick: e.tick, hash: e.hash };
      }
    }
  }

  /** Number of `{tick, hash}` entries currently retained (<= hashCapacity). */
  get size(): number {
    return this.entries.length;
  }

  /** The oldest retained tick, or `undefined` if empty — the floor of the in-memory window. */
  get oldestTick(): number | undefined {
    return this.entries[0]?.tick;
  }

  /** The newest retained tick, or `undefined` if empty — the head of the in-memory window. */
  get newestTick(): number | undefined {
    return this.entries[this.entries.length - 1]?.tick;
  }

  /**
   * The entry recorded for `tick`, or `undefined` if that tick is outside the retained window (aged
   * out, or never recorded). Binary search — entries are ascending by tick.
   */
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

  /** The hash recorded at `tick`, or `undefined` if outside the retained window. */
  hashAt(tick: number): string | undefined {
    return this.at(tick)?.hash;
  }

  /** All retained entries, oldest-first (a defensive shallow copy — the backing list stays private). */
  list(): readonly HashTraceEntry[] {
    return [...this.entries];
  }

  /**
   * Find the first tick where this trace's hash disagrees with `other`'s — "the hash diverged at tick N",
   * computed without re-replaying either run. Compares only ticks present in both retained windows, in
   * ascending order; returns the earliest mismatch, or `undefined` if every shared tick agrees. The
   * inspector's bug-localizer: feed it a reference run's trace (a golden, or a peer's lockstep trace) and it
   * points at the first tick to `replay()` and inspect.
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
