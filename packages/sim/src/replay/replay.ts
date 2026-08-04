import type { ContentSet } from '@open-northland/data';
import type { LoggedCommand } from '../core/command-queue.js';
import type { TerrainMap } from '../nav/terrain/index.js';
import { type Simulation, simFor } from '../simulation.js';

/**
 * Inputs that rebuild the state at a tick in a fresh {@link Simulation}, which owns its own stores and
 * coexists with the original. Not a save format: replaying a long session is not a practical load path.
 */
export interface ReplayOptions {
  readonly content: ContentSet;
  readonly seed: number;
  /** The terrain map the original run used; replay must rebuild the same graph or state diverges. */
  readonly map?: TerrainMap;
  /** The recorded command log (`Simulation.commands.log`). */
  readonly log: readonly LoggedCommand[];
  /**
   * Reconstruct state as of the end of this tick, inclusive, and `>= 0`. A target earlier than later
   * logged commands is the scrub-backward case and reproduces the original state at that tick.
   * Defaults to the last logged tick; the log carries no tick count, so reconstructing the tail past
   * the last command needs an explicit value.
   */
  readonly untilTick?: number;
}

/** Replay inputs without a tick target. */
export type RunReplay = Omit<ReplayOptions, 'untilTick'>;

/** Rebuild a `Simulation` to its state at the end of `untilTick`. Throws on a negative target. */
export function replay(opts: ReplayOptions): Simulation {
  const { log } = opts;
  const lastLoggedTick = log.length === 0 ? 0 : (log[log.length - 1] as LoggedCommand).tick;
  const untilTick = opts.untilTick ?? lastLoggedTick;
  if (untilTick < 0) {
    throw new Error(`replay untilTick ${untilTick} is negative: a tick target must be >= 0`);
  }

  const sim = simFor(opts);
  stepReplaying(sim, log, untilTick);
  return sim;
}

/**
 * Step `sim` from tick 1 through `untilTick`. A command recorded at tick T must be pending when `step()`
 * increments the tick to T, so CommandSystem applies it on exactly the tick it originally applied and
 * entity-id assignment order is preserved. `<=` rather than `===` keeps a hand-built non-monotonic log
 * from silently dropping commands. `onTick` runs after each `step()` with the tick just completed.
 */
export function stepReplaying(
  sim: Simulation,
  log: readonly LoggedCommand[],
  untilTick: number,
  onTick?: (tick: number) => void,
): void {
  let cursor = 0;
  for (let nextTick = 1; nextTick <= untilTick; nextTick++) {
    // The log already carries the applied copies of what the sim's own systems emit, so keeping their
    // live re-emissions pending would double-apply them. The sim holds nothing pending at entry.
    sim.commands.discardPending();
    while (cursor < log.length && (log[cursor] as LoggedCommand).tick <= nextTick) {
      sim.enqueue((log[cursor] as LoggedCommand).command);
      cursor++;
    }
    sim.step();
    onTick?.(nextTick);
  }
}
