import type { HashTrace } from '../inspect/hashtrace.js';
import type { WorldSnapshot } from '../inspect/snapshot.js';
import { diffSnapshots, type SnapshotDiff } from '../inspect/snapshot-diff.js';
import { type RunReplay, replay } from './replay.js';

/**
 * `localizeDivergence` — the headless composition that wires the four replay-inspector primitives
 * into the inspector's documented end-to-end workflow: **"hash diverged at tick N → jump there →
 * inspect what differs"** (plan "Cross-cutting DX"). The four pieces already exist standalone:
 *
 *  - {@link HashTrace.divergedFrom} finds the FIRST tick two runs' hashes split — "diverged at N".
 *  - {@link replay} reconstructs the exact state of EITHER run at tick N from its command log.
 *  - {@link diffSnapshots} turns the two reconstructed states into a per-entity / per-component delta.
 *
 * The overlay would otherwise have to wire these three by hand; this function is that wiring,
 * self-verifiable headlessly, so the human-eyed UI is the only part left. It answers, in one call:
 * *where* did the runs split, and *what* state differs at that exact tick.
 *
 * Each `replay()` builds its own {@link Simulation} with its own component stores (owned by the
 * `World`), so the two runs are independent: replay run A to the divergence tick and capture its plain
 * {@link WorldSnapshot}, replay run B to the same tick and capture its snapshot, then diff the two.
 *
 * Purity note: this is as "pure" as `replay()` — it reads only plain inputs (logs, traces) and returns
 * plain data. It never touches a clock, the DOM, or I/O; it is render-agnostic.
 */

/** The localized split: where the two runs' hashes first diverged, and the state delta there. */
export interface DivergenceReport {
  /** The first tick at which the two runs' recorded hashes disagree. */
  readonly tick: number;
  /** Run A's `hashState()` at that tick (the value `traceA` recorded). */
  readonly hashA: string;
  /** Run B's `hashState()` at that tick (the value `traceB` recorded). */
  readonly hashB: string;
  /**
   * The per-entity / per-component delta from run A's state to run B's state AT the divergence tick —
   * exactly what {@link diffSnapshots} would report for `(snapshotA, snapshotB)`. `fromTick` and
   * `toTick` both equal {@link tick} (the two snapshots are the same tick of two different runs).
   *
   * Usually non-empty — the hashes differ, so the canonical state differs — but it CAN be empty: a
   * snapshot omits the RNG state and the tick (both equal here), whereas `hashState()` mixes them, so
   * two runs whose entities/components are byte-identical but whose RNG streams have split hash-differ
   * yet diff-empty. An empty `diff` with a non-empty divergence is itself the useful signal: "the
   * entities match; the split is in RNG/tick state, not in any component" — narrowing the bug.
   */
  readonly diff: SnapshotDiff;
}

/**
 * Localize where two runs diverged and diff their state there. Returns `null` when the two traces'
 * overlapping hashes all agree (no divergence detected within the retained windows) — the inspector's
 * "the runs match (within the trace window)" answer.
 *
 * `runA`/`runB` are the two runs' replay inputs (content + seed + map? + command log); `traceA`/
 * `traceB` are the per-tick {@link HashTrace}s recorded during those runs. The divergence tick comes
 * from `traceA.divergedFrom(traceB)`, so it is found WITHOUT re-replaying — only once the tick is
 * known are the two runs replayed to that tick to produce the diff. Only the traces' HASH window is
 * consulted (not their snapshot window): the diff is always rebuilt fresh from the command logs, so the
 * traces need carry no snapshots (`snapshotCapacity: 0` is fine) and a divergence tick that has aged out
 * of the snapshot window is still fully reconstructable.
 */
export function localizeDivergence(
  runA: RunReplay,
  traceA: HashTrace,
  runB: RunReplay,
  traceB: HashTrace,
): DivergenceReport | null {
  const divergence = traceA.divergedFrom(traceB);
  if (divergence === undefined) return null;
  const { tick, hash: hashA, otherHash: hashB } = divergence;

  // Each replay builds its own sim/World (independent stores), so the two runs don't collide.
  const simA = replay({ ...runA, untilTick: tick });
  const snapshotA: WorldSnapshot = simA.snapshot();

  const simB = replay({ ...runB, untilTick: tick });
  const snapshotB: WorldSnapshot = simB.snapshot();

  return { tick, hashA, hashB, diff: diffSnapshots(snapshotA, snapshotB) };
}
