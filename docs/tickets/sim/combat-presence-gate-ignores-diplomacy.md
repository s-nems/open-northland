# Make the combat presence gate skip players at peace

**Area:** sim · **Focus:** conflict/combat-index, conflict/flee · **Priority:** P2

With no war on the map, `combat` is the second-largest system on `magiczny_las_12_players` with 13 AI
seats (the session in `docs/DEVELOPMENT.md` "Benchmarks"): 22.7% of the tick at tick 40k (median
3.9 ms, 900-922 settlers, 210 buildings) and 20-24% at 50k and 60k, growing 3.6x over a 60k-tick
`bench:map` run. Timings come from `npm run bench:profile` and are inflated by the sampler. More than
half of it is the FLEE drive of calm civilians looking for a threat that is not there: `fleeDrive`
(`systems/conflict/flee.ts`) is 10.6% of all sampled time at 40k, 11.2% at 50k and 10.1% at 60k.
Under it, `CombatIndex.nearest` takes 9.5%, `candidatesInBand` 6.6% self (the largest self-time
function of every profile) and `isFleeThreat` 1.7%.

Every combatant runs `engageCombatant` every tick: the dormancy gate `combatPossible`
(`conflict/dormancy.ts`) stays open whenever two players own units, so it never sleeps on a multi-seat
map. Each FLEE-stance civilian (672 of 733 owned combatants at 40k, 779 of 851 at 60k) then asks
`CombatIndex.othersWithin` for a possible threat within `SIGHT_RADIUS_NODES` and, when that passes,
runs the full `nearest` scan. A counted replay of 100 ticks from the 40k checkpoint:

- about 570 gate checks per tick, 490 of them passing (87%), 464 full scans, 9,550 candidates, and one
  accepted threat per tick; at 60k 676 checks, 571 passes, 533 scans, 9,300 candidates, none accepted;
- every foreign member in those bands belonged to a seat holding a `neutral` stance both ways: 924
  settler candidates and 8,593 building wall-node candidates (340 distinct buildings) per tick at 40k.

`othersWithin` counts every member not owned by the asking player and not passive wildlife
(`CoarseCell.total - passive > byPlayer[player]`). Diplomacy never enters it, a building counts at each
of its wall nodes, and the box is whole 16-node coarse cells, so on a map where settlements touch the
gate passes for almost every civilian. The seeker path shares the gate (`EngageSpec.player` into
`resolveTarget`): 56-72 soldier scans per tick with about 38 candidates each, `pickInBand` 0.7%.

## Scope

- Resolve the directed diplomacy stances between the seats once per index build and let the presence
  gate count an owned member only when its owner and the asking player hold `enemy` in either
  direction. The symmetric rule is `isFleeThreat`'s, and it covers the one-way `isValidTarget` rule as
  well, so one gate still over-approximates both callers. Unowned members keep today's classes: passive
  wildlife is discounted, while hostile or angered animals and unowned civs count.
- Skip non-hostile owners in `candidatesInBand` too, the way `skipOwner` skips the seeker's own player,
  so a border war does not rescan every neutral neighbour. Winners stay identical because `accept`
  rejects those members today.
- The index is rebuilt in the same tick after the command stage, so a stance declared this tick is
  already in the matrix. Keep that ordering.
- Hunters stay ungated, as today.

Gameplay limit option, needs the user's decision: after the fix, a calm civilian could run the flee
check on a deterministic stride (`(tick + entity) % N`) instead of every tick. At 12 ticks per second
and N = 4 a civilian would react up to a quarter second late to a raider coming into sight. The
remaining gain is small once the gate is hostility-aware, so this is not the default.

## Verify

- `test/conflict/combat-index-search.test.ts` and `test/conflict/presence-gate.test.ts` pass. Add
  cases: a neutral or friendly neighbour's settlers and buildings inside the box leave the gate closed,
  an `enemy` stance in either direction opens it, and a one-way aggressor still makes a civilian flee.
- With the session env from `docs/DEVELOPMENT.md` "Benchmarks", measure from a late checkpoint before
  and after (this session left a checkpoint family in the worktree's `bench-out/`; the recipe there
  recreates it): `ON_BENCH_CHECKPOINT=<40k or 50k checkpoint> ON_BENCH_TICKS=5000 ON_BENCH_WINDOWS=5
  npm run bench:map`, then `npm run bench:compare`. `combat` median should fall by about half.
  `bench:profile` should show `fleeDrive` near the `othersWithin` cost alone. The state hash must not
  change: this is a pure optimisation.
- `npm test`, `npm run check`.
