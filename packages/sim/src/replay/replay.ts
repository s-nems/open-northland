import type { ContentSet } from '@open-northland/data';
import type { LoggedCommand } from '../core/command-queue.js';
import type { TerrainMap } from '../nav/terrain/index.js';
import { type Simulation, simFor } from '../simulation.js';

/**
 * Deterministic replay, used by diagnostics and the replay inspector.
 *
 * Given the same content, seed, map, and logged commands, this function rebuilds the state at a tick in a
 * fresh {@link Simulation}. Matching hashes prove the replay stayed deterministic. This is not an on-disk
 * save format because replaying a long session is not a practical load path.
 *
 * It is render-agnostic and pure. Presentation tools build on it without entering sim state.
 *
 * Each `replay()` builds a FRESH `Simulation` with its own component stores (owned by the `World`), so
 * a replayed sim and the original coexist independently — hold as many live as you like.
 */
export interface ReplayOptions {
  readonly content: ContentSet;
  readonly seed: number;
  /** The terrain map the original run used, if any — replay must rebuild the SAME graph or state diverges. */
  readonly map?: TerrainMap;
  /** The recorded command log (`Simulation.commands.log`). */
  readonly log: readonly LoggedCommand[];
  /**
   * Reconstruct state as of the END of this tick (inclusive) — the "jump to tick N" target. An
   * EARLIER `untilTick` than later commands in the log is the normal scrub-backward case (the state
   * AT tick N, before those later commands existed) — faithful, not a divergence — so it is allowed;
   * a LATER one keeps stepping past the last command (the run continues deterministically). Must be
   * `>= 0` (a negative tick is nonsense — it throws). Defaults to the **last logged tick**, the
   * smallest target that re-applies every command (the full replay); to reconstruct the tail
   * past the last command, pass the recorded tick count explicitly (the log doesn't carry it).
   */
  readonly untilTick?: number;
}

/** One run's replay inputs, without a tick target — the shape a composition supplies its own tick to. */
export type RunReplay = Omit<ReplayOptions, 'untilTick'>;

/**
 * Rebuild a `Simulation` to the state it held at the end of `untilTick` by replaying `log` from tick
 * 1. Each logged command is enqueued just before its recorded apply tick's `step()` so CommandSystem
 * (which runs first each `step()`) applies it on exactly the tick it originally applied — preserving
 * entity-id assignment order and thus byte-identical state. A command logged at a tick LATER than
 * `untilTick` is simply never reached (the scrub-backward case): the state at `untilTick` is the
 * original run's state at that tick, which is exactly what a "jump to tick N" wants.
 *
 * Throws only on a negative `untilTick` (a nonsense target) — a caller bug, not recoverable bad
 * content. An out-of-range-high target is fine: the sim just keeps stepping deterministically.
 */
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
 * The shared replay forward pass: step `sim` from tick 1 through `untilTick`, enqueuing each logged
 * command just before the `step()` of its recorded tick. A command recorded at tick T must be pending
 * when `step()` increments the tick to T, so CommandSystem (which runs first each step) applies it on
 * exactly the tick it originally applied — preserving entity-id assignment order and thus byte-identical
 * state. `onTick`, when given, runs AFTER each `step()` with the tick just completed ({@link scrubWindow}
 * captures a snapshot there). `<= nextTick` (not `===`) never silently drops a command from a
 * non-monotonic/hand-built log; on a real monotonic log every command's tick equals some `nextTick`
 * exactly, so the reconstruction is identical. Commands past `untilTick` are left un-replayed (the
 * scrub-backward case).
 */
export function stepReplaying(
  sim: Simulation,
  log: readonly LoggedCommand[],
  untilTick: number,
  onTick?: (tick: number) => void,
): void {
  let cursor = 0;
  for (let nextTick = 1; nextTick <= untilTick; nextTick++) {
    // Discard what the replaying sim's own systems enqueued during the previous step (the AI player
    // re-emits its decisions live): the log already carries their applied copies verbatim, so leaving
    // the re-emissions pending would double-apply every sim-emitted command. The sim must hold no
    // pending commands at entry (callers enqueue only through the log below), so the first iteration's
    // discard is a no-op — it never drops a caller's pre-step command.
    sim.commands.discardPending();
    while (cursor < log.length && (log[cursor] as LoggedCommand).tick <= nextTick) {
      sim.enqueue((log[cursor] as LoggedCommand).command);
      cursor++;
    }
    sim.step();
    onTick?.(nextTick);
  }
}
