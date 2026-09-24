# Cut what the sync digest folds each tick

**Area:** sim, lockstep · **Priority:** P3

A relay session (`relay-client.ts` calls `Simulation.setSyncDigest(true)`) makes
`SyncDigestRecorder` (`packages/sim/src/simulation/sync-digest.ts`) record every component a tick
writes through `componentWritten` and re-fold each touched value in full in `seal`, which is what lets
lockstep peers compare ticks without the full state hash. On `magiczny_las` with six AI seats that was
about 11.8k mixed words over roughly 510 values a tick: between 5% and 17% of a settled tick, measured
in one process with the two paths interleaved per tick. The budget is 0.2 ms, roughly 6% of a settled
tick on that map. The twelve-seat benchmarks run with the digest off, so a networked twelve-seat game
pays it on top of the tick they report; it grows with the entities that write each tick.

Three components carried about 90% of the fold, and the code still has the shape that made them
heavy: `Settler` (`components/settler.ts`) holds its experience `Map` in the same value the needs
drain writes every tick, so the map is re-folded with it; `CurrentAtomic` is written on every
atomic tick; and `PathFollow` (`components/movement.ts`) keeps its `waypoints` array in the same
value as `index` and `legTicks`, so every step re-folds the route though it only changes on a
reroute.

## Scope

Bring the per-tick fold well under a tenth of a settled tick without weakening what it detects: every
state a run can diverge in must still move a digest domain.

Split the rarely-written payload out of each of the three hot components into its own store, so a
step along a route stops re-folding the route; that is a component-layout and save-format change, and
it needs no new digest machinery.

**Needs the user's decision:** whether the digest must seal every tick. Accumulating the touched sets
across an N-tick window and sealing at the boundary folds a per-tick component once per window instead
of N times, and stays a pure function of the state at the seal tick, but it names a window rather than
a tick when two clients part. Take it only if the split alone misses the budget.

A depth or size cut that stops folding part of a value is not in scope: it trades away the property
the digest exists for.

## Verify

- The digest sequence keeps its shape: the same inputs still produce identical sequences, and the
  perturbation cases in `packages/sim/test/core/sync-digest.test.ts` still name one domain each.
- `npm run bench:map` from a late checkpoint of the twelve-player session in `docs/DEVELOPMENT.md`
  (Measuring performance) with `ON_BENCH_TICKS=4000` and `ON_BENCH_SYNC_DIGEST=on`, against the same
  run with it off, on an idle box, trust clean, reports the added cost per tick before and after.
- `npm run check`, `npm run build`, `npm test`.
