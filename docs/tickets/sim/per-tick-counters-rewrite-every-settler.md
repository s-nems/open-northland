# Stop the per-tick counters from rewriting every settler's components each tick

**Area:** sim, render, app · **Focus:** needs, atomics, movement, snapshot deltas · **Priority:** P2

Three counters advance by one every tick and each advance is a `World.mut` of a larger component:

- `drainNeeds` (`systems/lifecycle/needs/system.ts`) writes `Settler` for every adult whose bars have
  not pinned, to move `hunger`, `fatigue` and `enjoyment`;
- `atomicSystem` (`systems/settlers/atomics/system.ts`) writes `AtomicClock.elapsed += 1` for every
  running atomic;
- the walk step writes `PathFollow.legTicks` for every walker.

Every such write marks the entity touched, so the snapshot delta re-clones and re-sends the whole
component, and every mirror index that reads `Settler`'s value re-checks the settler: HUD people
(`render/src/data/hud/totals.ts`) compares the job before recounting, and the bubble carriers
(`app/src/view/projections/settler-bubbles.ts`) test the bars again.

Measured on `krwawa_rzeka`, 12 AI seats, t100k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): of 1464
touched entities per tick, 308 change nothing but their needs and 282 only their atomic clock and
needs; `Settler` is written 1321 times a tick and is 107 KB of a 267 KB delta (40%). On the main
thread at t100k (`ON_BENCH_MIRROR_SPLIT=on`), HUD totals' upkeep is 0.43 ms per delta and the bubble
carriers' 0.14 ms, the settler re-checks a part of each.

## Scope

- Move the three need bars out of `Settler` into their own component, so the job, tribe and home data
  every reader keys on stop changing every tick. The bubbles and the details panel read the new
  component where they show the bars; HUD people then skips a settler whose job stayed.
- Store `AtomicClock` and the leg progress as the tick they started, with elapsed ticks derived from
  the current tick, so a running clip or leg writes nothing between its boundaries. Readers in sim,
  render and app take the derived value through one helper each.
- Save format: bump the version and regenerate the committed fixture in the same commit
  (`AGENTS.md`, "Persisted state"). Goldens and state hashes move for the representation change only;
  name that in the commit.

## Verify

- `ON_BENCH_MIRROR=on` from the reference's t100k checkpoint: touched entities and delta KB per tick
  against the numbers above; the per-window mirror check passes.
- The sim's behaviour is unchanged: the same need thresholds, clip lengths and walk timing in the
  needs, atomics and movement tests; `npm run test:content` passes.
- `npm test`, `npm run check`, `npm run build`.
