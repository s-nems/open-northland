import * as components from '../components/index.js';
import type { Component } from '../ecs/world.js';
import type { HashTrace } from '../inspect/hashtrace.js';
import { type SnapshotDiff, diffSnapshots } from '../inspect/snapshot-diff.js';
import type { WorldSnapshot } from '../inspect/snapshot.js';
import { type ReplayOptions, replay } from './replay.js';

/**
 * `localizeDivergence` — the headless composition that wires the four replay-inspector primitives
 * into the inspector's documented end-to-end workflow: **"hash diverged at tick N → jump there →
 * inspect what differs"** (ROADMAP "Cross-cutting DX"). The four pieces already exist standalone:
 *
 *  - {@link HashTrace.divergedFrom} finds the FIRST tick two runs' hashes split — "diverged at N".
 *  - {@link replay} reconstructs the exact state of EITHER run at tick N from its command log.
 *  - {@link diffSnapshots} turns the two reconstructed states into a per-entity / per-component delta.
 *
 * The overlay would otherwise have to wire these three by hand AND know the single-world store
 * constraint (below); this function is that wiring, self-verifiable headlessly, so the human-eyed UI
 * is the only part left. It answers, in one call: *where* did the runs split, and *what* state
 * differs at that exact tick.
 *
 * ## Single-world constraint (the reason this isn't trivial glue)
 *
 * Component stores are MODULE-LEVEL SINGLETONS shared across every `Simulation` ({@link replay}'s
 * doc; docs/LESSONS.md [56e8d3e]) — so the two runs' reconstructed sims CANNOT be alive at once. This
 * function therefore replays them SERIALLY: it replays run A to the divergence tick, captures A's
 * plain {@link WorldSnapshot} (a plain value, valid after the stores are reused), clears the stores,
 * replays run B to the same tick (which supersedes A), captures B's snapshot, then diffs the two
 * plain snapshots. The caller must not keep a live sim from before this call — like `replay()`, this
 * supersedes the shared stores. It clears the stores between its OWN two replays so B doesn't inherit
 * A's entities; on return the stores hold run B's reconstructed state at the divergence tick.
 *
 * Purity note: this is as "pure" as `replay()` — it reads only plain inputs (logs, traces) and
 * returns plain data, but it rebuilds sims in the shared stores as a side effect (that is what
 * reconstructing state requires). It never touches a clock, the DOM, or I/O; it is render-agnostic.
 */

/** One run's replay inputs (no `untilTick` — this composition supplies the divergence tick). */
export type RunReplay = Omit<ReplayOptions, 'untilTick'>;

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

/** Clear every component store (shared singletons) so a fresh replay can't inherit the prior run's entities. */
function clearStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as Component<unknown>).store.clear();
    }
  }
}

/**
 * Localize where two runs diverged and diff their state there. Returns `null` when the two traces'
 * overlapping hashes all agree (no divergence detected within the retained windows) — the inspector's
 * "the runs match (within the trace window)" answer.
 *
 * `runA`/`runB` are the two runs' replay inputs (content + seed + map? + command log); `traceA`/
 * `traceB` are the per-tick {@link HashTrace}s recorded during those runs. The divergence tick comes
 * from `traceA.divergedFrom(traceB)`, so it is found WITHOUT re-replaying — only once the tick is
 * known are the two runs replayed (serially, see the module doc) to that tick to produce the diff.
 * Only the traces' HASH window is consulted (not their snapshot window): the diff is always rebuilt
 * fresh from the command logs, so the traces need carry no snapshots (`snapshotCapacity: 0` is fine)
 * and a divergence tick that has aged out of the snapshot window is still fully reconstructable.
 *
 * Side effect: rebuilds sims in the shared component stores (see the module doc). The caller must hold
 * no live sim across this call; on return the stores hold run B's reconstructed state at the
 * divergence tick.
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

  // Replay run A to the divergence tick, capture its plain snapshot, then clear so B starts clean.
  // The snapshot is a plain value (no live store views), so it survives the store reuse below.
  const simA = replay({ ...runA, untilTick: tick });
  const snapshotA: WorldSnapshot = simA.snapshot();
  clearStores();

  // Replay run B to the SAME tick (this supersedes A in the shared stores) and capture its snapshot.
  const simB = replay({ ...runB, untilTick: tick });
  const snapshotB: WorldSnapshot = simB.snapshot();

  return { tick, hashA, hashB, diff: diffSnapshots(snapshotA, snapshotB) };
}
