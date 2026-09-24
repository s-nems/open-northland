# Keep the combat index's building layer across ticks

**Area:** sim · **Focus:** conflict/combat-index · **Priority:** P2

`combatSystem` (`systems/conflict/combat.ts`) builds a new `CombatIndex` every tick on any map with two
players, war or not. On `magiczny_las_12_players` with 13 AI seats (the session in
`docs/DEVELOPMENT.md`, Measuring performance), the trust-clean `npm run bench:profile` from the 40k
checkpoint puts the constructor at 4.6% of all sampled time (3.6 s total, 1.9 s self over 4,000
ticks, `admit` 1.3 s; profiled timings are inflated by the sampler), and the busy-machine profiles
from 50k and 60k at the same 4.5-4.6%. An unprofiled replay from the 40k checkpoint times one build at
0.84 ms per tick, 0.51 ms of it for buildings alone and 0.26 ms for the 900 combatants.

The building half is static work repeated: 210 buildings are admitted at 10,100 wall nodes per tick
(about 48 each, from `buildingBodyNodes`), against 900 settler members, and each admit redoes the cell
lookup, the owner read and `isLowPriorityBuildingTarget`. A building never moves, and its body nodes are
already memoized per world on the Building store generations (`conflict/target-node.ts`). The cost
grows with the building count, which went 96 -> 233 over a 60k-tick run. Each build also allocates
new nested `Map` cells and member arrays: an allocation sample of a live session of `specjalna_forteca`
with its 13 AI seats at tick ~48k (x3, 45 s) put 344 MB on `admit` and 157 MB on `candidatesInBand`,
whose per-call `number[]` and `Float64Array` the same index owns.

Expected gain: about 0.5 ms of the 18.7 ms tick at 40k. The presence gate reads diplomacy through the
hostile masks `CombatIndex` resolves per build, while the cells hold only owner bits; a layer that
outlives the tick keeps it that way and never bakes a stance into a cell.

## Scope

- Hold the building members in a per-world layer that is rebuilt only when the building set, a
  building's type or its owner changes: the Building membership and value generations the body cache
  already keys on, plus the owner (a mission result can hand a house to another player). A building
  at zero hitpoints may stay in the layer until the next rebuild, because the presence gate may
  over-count and every `accept` filter already rejects a dead target. Register a cache verifier the
  way `combatBuildingBodies` does.
- Keep the settler layer per tick, but reuse its cell records and arrays by resetting lengths instead of
  reallocating them.
- Give `candidatesInBand` a reusable key buffer. `nearest` documents that `accept` may re-enter it and
  that all search state is call-local, and `lastBand` hands the sorted keys to the next tier, so a shared
  buffer must survive a nested call. Keep a nested query on its own buffer.
- Query results must not change. The equivalence test in `test/conflict/combat-index-search.test.ts`
  is the guard; extend it to a building placed, destroyed and handed to another player between two
  ticks.

## Verify

- `npm test` (the conflict suites and the cache verifiers), `npm run check`.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: `combat` median falls by about half a
  millisecond, and `bench:profile` shows the `CombatIndex` constructor at about the settler share
  (under 2%). The state hash must not change.
- Repeat the allocation sample of a late `specjalna_forteca` session (13 AI seats, tick ~48k;
  `ON_BENCH_MAP=specjalna_forteca ON_BENCH_SEATS=13 ON_BENCH_SKIP=48000` reaches it headlessly, per the
  same recipe): `admit` and `candidatesInBand` fall an order of magnitude.
