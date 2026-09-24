# Narrow the gatherer rung's scans to candidates the seeker's trade can take

**Area:** sim · **Focus:** settlers/targets · **Priority:** P2

On `magiczny_las_12_players` with 13 AI seats (the session in `docs/DEVELOPMENT.md`, Measuring
performance), the trust-clean `npm run bench:profile` from the 40k checkpoint puts `planGatherer` at
15.1% of the tick (922 settlers; profiled timings are inflated by the sampler); the busy-machine
profile from 60k shows 18% (1,055 settlers). Its searches run through `nearestByCell`
(`settlers/targets/cell-index.ts`), a plain linear loop that calls the caller's `resolve` on every
list entry before distance is known: 14.2% of the tick at 40k, and at 60k 23.4k iterations per tick
with 22.5k rejected (exact count over 200 ticks from the 60k checkpoint). Three scans visit mostly
candidates the seeker's trade can never take (shares from the 40k profile, exact counts from 60k):

- **Pile scan.** `nearestCollectablePileFor` (`settlers/targets/resources.ts`) walks every `GroundDrop`
  for every settler that reaches the rung, with no trade gate: 3.0% of the tick at 40k. At 60k it runs
  67 times per tick, 64 of them for trades whose atomics match no standing resource's harvest atomic
  (women, soldiers, builders: the dormancy gate in `nearestHarvestableFor` already returns null for
  them), at 194 piles each: 12.9k pile resolves per tick. Piles grow 16 -> 69 -> 194 at ticks
  10k/30k/60k, and all pile resolves per tick, own-drop walks included, 0.4k -> 1.2k -> 13.9k.
  `nearestOwnDropFor` walks the same list for a flag collector's own `HarvestedBy` piles (5.5 calls per
  tick).
- **Hunter scan.** A hunter's `nearestHarvestableFor` call bounded by its hunting ground (`within`)
  reads every resource anchored in the ground's box, about 2,400 per scan at 60k (2.8 scans per tick),
  and rejects nearly all at the harvest-atomic gate because the box holds trees and stone: 6.7k of the
  8.1k resource resolves per tick. The bounded, non-flag harvest scans are 7.9% of the tick at 40k
  (5.9% at 60k), `resourcesNearNode` included.
- **Flag area scan.** A flag collector's area query returns the square box around the flag, wider than
  the Manhattan radius, and each candidate passing the atomic gate pays `interactionCell`
  (`resourceWorkCell`) before the radius test rejects it: 502 work cells per tick at 60k, 274 then
  outside the radius. `settlerMeetsNeed` also runs per candidate though it depends only on the good.
  `planFlagGatherer` is 3.9% at 40k, of which `resourceWorkCell` 1.1% and `settlerMeetsNeed` 0.5%.

Expected gain: about 1.5 ms of the 18.7 ms tick at 40k from the pile and hunter scans, measured
alone. The flag scan's cost is shared with
[idle-settler-ladder-dormancy.md](idle-settler-ladder-dormancy.md), which repeats it only on its cadence; neither
ticket counts that saving as its own, and whichever lands second gains less.

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
- Counter: pile resolves per tick over 200 ticks from the 60k checkpoint fall from 12.9k to the few
  hundred a collecting trade needs, and resource resolves per hunter scan to the game in its ground.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: planner median falls by about 1.5 ms with
  the state hash unchanged. `bench:profile` from the same mark shows `nearestByCell` well below 14%.
