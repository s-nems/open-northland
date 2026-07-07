import type { LoggedCommand } from '../core/commands.js';
import { Simulation } from '../index.js';
import type { WorldSnapshot } from '../inspect/snapshot.js';
import type { RunReplay } from './localize-divergence.js';

/**
 * `scrubWindow` — the **single-run "free scrubbing"** composition of the time-travel / replay
 * inspector (plan "Cross-cutting DX": the overlay can "scrub ticks, diff state between two ticks,
 * and dump an entity"; it "calls `replay()`+`traceEntity()` for free scrubbing"). Where
 * {@link localizeDivergence} composes the TWO-run path ("hash diverged at tick N → inspect what
 * differs"), this composes the ONE-run path: reconstruct a contiguous window of plain
 * {@link WorldSnapshot}s `[fromTick, toTick]` from a single command log, ready to feed
 * `traceEntity()` (which wants the whole window) and `diffSnapshots()` (adjacent pairs).
 *
 * It exists for the same reason `localizeDivergence` does: the overlay would otherwise have to drive
 * {@link replay} by hand AND know the single-world store constraint (below) — exactly the
 * footgun-laden glue these compositions encapsulate so the only part left is the human-eyed UI.
 *
 * ## One forward pass, not N replays (still byte-identical)
 *
 * A naive scrub would `replay()` from tick 1 once PER tick in the window — O(window × toTick) work
 * and a store-clear between each. Instead this replays the log into ONE fresh sim, steps from tick 1
 * to `toTick` enqueuing each logged command on exactly its recorded tick (identically to
 * {@link replay}), and snapshots whenever the running tick lands inside `[fromTick, toTick]`. A
 * `WorldSnapshot` is a plain value (no live store views — see `snapshot.ts`), so every captured tick
 * survives the sim continuing to mutate the stores; the result is byte-identical to having replayed
 * each tick separately, at a fraction of the cost.
 *
 * ## Single-world constraint (the reason this isn't trivial glue)
 *
 * Component stores are MODULE-LEVEL SINGLETONS shared across every `Simulation` ({@link replay}'s
 * doc; AGENTS.md [56e8d3e]) — so this rebuilds a sim in the shared stores as a side effect (that
 * is what reconstructing state requires) and SUPERSEDES any prior live sim. The caller must hold no
 * live sim across this call; on return the stores hold the run's reconstructed state at `toTick`. The
 * returned snapshots are plain values and stay valid regardless. It is otherwise as "pure" as
 * `replay()`: it reads only plain inputs (a command log) and touches no clock, DOM, or I/O.
 */

/**
 * Reconstruct every tick in `[fromTick, toTick]` (inclusive) of a single recorded run as a plain
 * {@link WorldSnapshot}, returned in ascending-tick order — the contiguous scrub window the inspector
 * overlay follows an entity across (`traceEntity`) or steps through (`diffSnapshots` on adjacent
 * pairs).
 *
 * `run` is the run's replay inputs (content + seed + map? + command log), the same shape
 * {@link localizeDivergence} takes. The window is clamped to the meaningful range: `fromTick` floors
 * at `1` (tick 0 is the pre-step initial state, which `replay`/`step` never snapshots) and the result
 * spans `max(1, fromTick) .. toTick`. An empty window (`toTick < max(1, fromTick)`) yields `[]`.
 *
 * Throws on a negative `fromTick`/`toTick` (a nonsense target, like {@link replay}'s negative
 * `untilTick`) — a caller bug, not recoverable bad content. An out-of-range-high `toTick` is fine:
 * the sim keeps stepping deterministically past the last logged command (the deterministic tail).
 *
 * Side effect: rebuilds a sim in the shared component stores (see the module doc). The caller must
 * hold no live sim across this call.
 */
export function scrubWindow(run: RunReplay, fromTick: number, toTick: number): WorldSnapshot[] {
  if (fromTick < 0) {
    throw new Error(`scrubWindow fromTick ${fromTick} is negative: a tick target must be >= 0`);
  }
  if (toTick < 0) {
    throw new Error(`scrubWindow toTick ${toTick} is negative: a tick target must be >= 0`);
  }
  // Tick 0 is the pre-step initial state, never snapshotted by step(); the first reconstructable
  // tick is 1. Clamp the low end there so a from of 0 means "from the start", not an empty/odd window.
  const start = Math.max(1, fromTick);
  if (toTick < start) return [];

  const { content, seed, map, log } = run;
  const sim = new Simulation({ seed, content, ...(map !== undefined ? { map } : {}) });

  // One forward pass from tick 1 to toTick, enqueuing each logged command on exactly its recorded
  // tick (identically to replay()), capturing a plain snapshot whenever the tick is in the window.
  const snapshots: WorldSnapshot[] = [];
  let cursor = 0;
  for (let nextTick = 1; nextTick <= toTick; nextTick++) {
    // `<= nextTick` (not `===`), mirroring replay(): on a real monotonic log this enqueues each
    // command on its exact tick; it also never silently drops one from a malformed/non-monotonic log.
    while (cursor < log.length && (log[cursor] as LoggedCommand).tick <= nextTick) {
      sim.enqueue((log[cursor] as LoggedCommand).command);
      cursor++;
    }
    sim.step();
    if (nextTick >= start) snapshots.push(sim.snapshot());
  }
  return snapshots;
}
