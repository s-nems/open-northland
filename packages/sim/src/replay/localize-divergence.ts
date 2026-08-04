import type { HashTrace } from '../inspect/hashtrace.js';
import type { WorldSnapshot } from '../inspect/snapshot.js';
import { diffSnapshots, type SnapshotDiff } from '../inspect/snapshot-diff.js';
import { type RunReplay, replay } from './replay.js';

export interface DivergenceReport {
  /** The first tick at which the two runs' recorded hashes disagree. */
  readonly tick: number;
  /** Run A's `hashState()` at that tick. */
  readonly hashA: string;
  /** Run B's `hashState()` at that tick. */
  readonly hashB: string;
  /**
   * Run A's state at {@link tick} against run B's, so `fromTick` and `toTick` both equal it. An empty
   * diff under differing hashes means the split is in RNG or tick state, which a snapshot omits and
   * `hashState()` mixes in.
   */
  readonly diff: SnapshotDiff;
}

/**
 * Localize where two runs diverged and diff their state there, or `null` when every overlapping hash
 * agrees. Only the traces' hash windows are consulted, so a tick that aged out of a snapshot window is
 * still reconstructable from the command logs.
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

  // Each replay builds its own World, so the two runs' stores stay independent.
  const simA = replay({ ...runA, untilTick: tick });
  const snapshotA: WorldSnapshot = simA.snapshot();

  const simB = replay({ ...runB, untilTick: tick });
  const snapshotB: WorldSnapshot = simB.snapshot();

  return { tick, hashA, hashB, diff: diffSnapshots(snapshotA, snapshotB) };
}
