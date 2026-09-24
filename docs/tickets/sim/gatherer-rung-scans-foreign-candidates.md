# Narrow the gatherer rung's scans to candidates the seeker's trade can take

**Area:** sim · **Focus:** settlers/targets · **Priority:** P2

On `magiczny_las_12_players` with 13 AI seats (the session in `docs/DEVELOPMENT.md` "Benchmarks"),
`planGatherer` is 18% of the tick at tick 60k (8.9 s of 49 s over 2,000 profiled ticks, 1055 settlers)
and 15% at 40k, timings from `npm run bench:profile` and inflated by the sampler. Its searches run
through `nearestByCell` (`settlers/targets/cell-index.ts`), a plain linear loop that calls the caller's
`resolve` on every list entry before distance is known: 17% of the tick at 60k, 23.4k iterations per
tick with 22.5k rejected (precise call count over 200 ticks from the 60k checkpoint). Three scans visit
mostly candidates the seeker's trade can never take:

- **Pile scan.** `nearestCollectablePileFor` (`settlers/targets/resources.ts`) walks every `GroundDrop`
  for every settler that reaches the rung, with no trade gate. At 60k it runs 67 times per tick, 64 of
  them for trades whose atomics match no standing resource's harvest atomic (women, soldiers, builders:
  the dormancy gate in `nearestHarvestableFor` already returns null for them), at 194 piles each: 12.9k
  pile resolves per tick, 2.6 s or 5.2% of the profiled tick. Piles grow 16 -> 69 -> 194 at ticks
  10k/30k/60k, and pile resolves per tick 0.4k -> 1.2k -> 13.9k. `nearestOwnDropFor` walks the same list
  for a flag collector's own `HarvestedBy` piles (5.5 calls per tick).
- **Hunter scan.** A hunter's `nearestHarvestableFor` call bounded by its hunting ground (`within`)
  reads every resource anchored in the ground's box, about 2,400 per scan at 60k (2.8 scans per tick),
  and rejects nearly all at the harvest-atomic gate because the box holds trees and stone: 6.7k of the
  8.1k resource resolves per tick, 2.9 s or 5.9%, `resourcesNearNode` included (0.6 s).
- **Flag area scan.** A flag collector's area query returns the square box around the flag, wider than
  the Manhattan radius, and each candidate passing the atomic gate pays `interactionCell`
  (`resourceWorkCell`) before the radius test rejects it: 502 work cells per tick, 274 then outside the
  radius. `settlerMeetsNeed` also runs per candidate though it depends only on the good. 3.3 s or 6.7%,
  of which `resourceWorkCell` 1.3 s and `settlerMeetsNeed` 0.4 s.

## Scope

- A pile scan for a trade that can collect none of the goods lying in piles returns without visiting
  them, and one that can visits only piles of those goods; a flag collector finds its own piles without
  walking the others.
- A bounded harvest scan reads only resources whose harvest atomic the job allows. The resource region
  index (`systems/spatial/resources.ts`) already tracks the present atomics for the dormancy set.
- The flag area scan rejects a candidate whose anchor is farther than the radius plus
  `maxResourceWorkOffset` before resolving its work cell, and resolves the XP gate once per good per
  scan.
- Pure cost work: each scan must still return the `(distance, cell-id, entity-id)` winner of the full
  scan, so the state hash must not move. A per-tick memo keyed by seat and good is not sound here: the
  accept reads per-settler state (work cell from its node, route region, signpost gate, unreachable
  memo, experience, this pass's harvest claims).

## Verify

- Unit tests: a trade that can collect no piled good never resolves a pile; a hunter's ground scan never
  resolves a tree; the flag area scan picks the same node as before on a fixture with box-corner
  candidates.
- With the session env,
  `ON_BENCH_CHECKPOINT=<tick-60k mark> ON_BENCH_TICKS=5000 ON_BENCH_WINDOWS=5 npm run bench:map` before
  and after, then `npm run bench:compare`: planner median falls with the state hash unchanged. The
  recipe in `docs/DEVELOPMENT.md` writes the checkpoint family; one exists in this session's worktree
  `bench-out/`. `bench:profile` from the same mark shows `nearestByCell` well below 17%.
