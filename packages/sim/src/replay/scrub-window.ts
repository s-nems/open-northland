import type { WorldSnapshot } from '../inspect/snapshot.js';
import { simFor } from '../simulation.js';
import { type RunReplay, stepReplaying } from './replay.js';

/**
 * Reconstruct every tick in `[fromTick, toTick]`, inclusive, of one recorded run, in ascending-tick
 * order. One forward pass captures the whole window, which is byte-identical to replaying each tick
 * separately because a `WorldSnapshot` is detached plain data. `fromTick` clamps up to 1 and an empty
 * window yields `[]`. Throws on a negative bound; a `toTick` past the last logged command just keeps
 * stepping.
 */
export function scrubWindow(run: RunReplay, fromTick: number, toTick: number): WorldSnapshot[] {
  if (fromTick < 0) {
    throw new Error(`scrubWindow fromTick ${fromTick} is negative: a tick target must be >= 0`);
  }
  if (toTick < 0) {
    throw new Error(`scrubWindow toTick ${toTick} is negative: a tick target must be >= 0`);
  }
  // Tick 0 is the pre-step initial state, which step() never snapshots, so 1 is the first reconstructable tick.
  const start = Math.max(1, fromTick);
  if (toTick < start) return [];

  const sim = simFor(run);

  const snapshots: WorldSnapshot[] = [];
  stepReplaying(sim, run.log, toTick, (tick) => {
    if (tick >= start) snapshots.push(sim.snapshot());
  });
  return snapshots;
}
