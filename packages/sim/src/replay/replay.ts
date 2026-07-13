import type { ContentSet } from '@open-northland/data';
import type { LoggedCommand } from '../core/command-queue.js';
import type { TerrainMap } from '../nav/terrain/index.js';
import { Simulation } from '../simulation.js';

/**
 * Deterministic replay — the headless core of the "time-travel / replay inspector" DX win.
 *
 * The command log IS the save format: a recorded run is fully reconstructable from `(content, seed,
 * map?, log)` because the sim is pure and seeded (no wall-clock, no `Math.random`, no I/O). This
 * function rebuilds the exact state at any tick by replaying the log into a FRESH `Simulation` — the
 * "jump to tick N" primitive a scrub overlay calls. Because `hashState()` is byte-identical across
 * two runs from the same seed + same commands on the same ticks, a replay to tick N hashes equal to
 * the original live run at tick N; that equality is this primitive's determinism oracle (the
 * inspector's "hash diverged at tick 432 → jump there → inspect" leans on exactly this).
 *
 * It is render-agnostic and pure (no DOM, no Pixi) — the dev overlay that scrubs/diffs/dumps is a
 * `render` concern built ON this; this is the part an agent can self-verify headlessly.
 *
 * ## Single-world constraint (important)
 *
 * Component stores are MODULE-LEVEL SINGLETONS shared across every `Simulation` (see
 * `ecs/world.ts` `defineComponent`; every sim test `beforeEach`-clears them; AGENTS.md
 * [56e8d3e]). So a replayed sim and the original sim CANNOT be alive at once — they would collide in
 * the same stores. `replay()` therefore returns a reconstructed sim that supersedes any prior one;
 * the caller must not keep reading the old sim's live stores afterward (its frozen `snapshot()` /
 * `hashState()` string, captured before the replay, stay valid — they are plain values, not store
 * views). A scrub overlay holds only the log + per-tick hashes/snapshots, never two live sims.
 */
export interface ReplayOptions {
  readonly content: ContentSet;
  readonly seed: number;
  /** The terrain map the original run used, if any — replay must rebuild the SAME graph or state diverges. */
  readonly map?: TerrainMap;
  /** The recorded command log (`Simulation.commands.log`) — the append-only save/replay record. */
  readonly log: readonly LoggedCommand[];
  /**
   * Reconstruct state as of the END of this tick (inclusive) — the "jump to tick N" target. An
   * EARLIER `untilTick` than later commands in the log is the normal scrub-backward case (the state
   * AT tick N, before those later commands existed) — faithful, not a divergence — so it is allowed;
   * a LATER one keeps stepping past the last command (the run continues deterministically). Must be
   * `>= 0` (a negative tick is nonsense — it throws). Defaults to the **last logged tick**, the
   * smallest target that re-applies every command (the full save-replay); to reconstruct the tail
   * past the last command, pass the recorded tick count explicitly (the log doesn't carry it).
   */
  readonly untilTick?: number;
}

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
  const { content, seed, map, log } = opts;
  const lastLoggedTick = log.length === 0 ? 0 : (log[log.length - 1] as LoggedCommand).tick;
  const untilTick = opts.untilTick ?? lastLoggedTick;
  if (untilTick < 0) {
    throw new Error(`replay untilTick ${untilTick} is negative: a tick target must be >= 0`);
  }

  const sim = new Simulation({ seed, content, ...(map !== undefined ? { map } : {}) });
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
    while (cursor < log.length && (log[cursor] as LoggedCommand).tick <= nextTick) {
      sim.enqueue((log[cursor] as LoggedCommand).command);
      cursor++;
    }
    sim.step();
    onTick?.(nextTick);
  }
}
