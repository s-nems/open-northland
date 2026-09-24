# Make the combat presence gate skip players at peace

**Area:** sim · **Focus:** conflict/combat-index, conflict/flee · **Priority:** P2

With no war on the map, `combat` is the second-largest system on `magiczny_las_12_players` with 13 AI
seats (the session in `docs/DEVELOPMENT.md`, Measuring performance). The trust-clean
`npm run bench:profile` from the 40k checkpoint puts it at 22.7% of the tick (median 3.9 of 18.7 ms,
900-922 settlers, 210 buildings; profiled timings are inflated by the sampler). The busy-machine
profiles from 50k and 60k show the same 20-24% share, and a busy-machine 60k-tick `bench:map` run
suggests it grows about 3.6x over the game (growth suspect). More than half of it is the FLEE drive of
calm civilians looking for a threat that is not there: `fleeDrive` (`systems/conflict/flee.ts`) is
10.6% of all sampled time at 40k (10-11% at 50k and 60k). Under it, `CombatIndex.nearest` takes 9.5%,
`candidatesInBand` 6.6% self (the largest self-time function of every profile) and `isFleeThreat`
1.7%.

Every combatant runs `engageCombatant` every tick: the dormancy gate `combatPossible`
(`conflict/dormancy.ts`) stays open whenever two players own units, so it never sleeps on a multi-seat
map. Each FLEE-stance civilian (672 of 733 owned combatants at 40k, 779 of 851 at 60k) then asks
`CombatIndex.othersWithin` for a possible threat within `SIGHT_RADIUS_NODES` and, when that passes,
runs the full `nearest` scan. A counted replay of 100 ticks from the 40k checkpoint (exact counts):

- about 570 gate checks per tick, 490 of them passing (87%), 464 full scans, 9,550 candidates, and one
  accepted threat per tick; at 60k 676 checks, 571 passes, 533 scans, 9,300 candidates, none accepted;
- every foreign member in those bands belonged to a seat holding a `neutral` stance both ways: 924
  settler candidates and 8,593 building wall-node candidates (340 distinct buildings) per tick at 40k.

`othersWithin` counts every member not owned by the asking player and not passive wildlife
(`CoarseCell.total - passive > byPlayer[player]`). Diplomacy never enters it, a building counts at each
of its wall nodes, and the box is whole 16-node coarse cells, so on a map where settlements touch the
gate passes for almost every civilian. The seeker path shares the gate (`EngageSpec.player` into
`resolveTarget`): 56-72 soldier scans per tick with about 38 candidates each, `pickInBand` 0.7%.

Expected gain: about 1.9 ms of the 18.7 ms tick at 40k (`fleeDrive` less the `othersWithin` gate
itself). Land this before [combat-index-rebuilt-every-tick.md](combat-index-rebuilt-every-tick.md),
which takes about 0.5 ms more.

## Scope

Two commits, pure first, so the pure gain is measured alone.

Step 1, a pure optimisation (state hash unchanged):

- Let the presence gate count an owned member only when its owner and the asking player hold `enemy`
  in either direction. The symmetric rule is `isFleeThreat`'s, and it covers the one-way
  `isValidTarget` rule as well, so one gate still over-approximates both callers. Unowned members keep
  today's classes: passive wildlife is discounted, while hostile or angered animals and unowned civs
  count.
- Skip non-hostile owners in `candidatesInBand` too, the way `skipOwner` skips the seeker's own player,
  so a border war does not rescan every neutral neighbour. Winners stay identical because `accept`
  rejects those members today.
- Resolve the directed stances between the seats when `combat` builds its index. Every stance writer
  that runs earlier in `systems/schedule.ts` has written by then: the command stage (`setDiplomacy`,
  `declareDiplomacy`), mission `SetDiplomacy` results in `mission`, and `provokeHostility` on a landed
  blow in `atomic`. The later writers (a landed arrow in `projectile`, `aiProgram`'s `ChangeDiplomacy`,
  `aiDiplomacy`) reach the next tick's build, and nothing inside `combat` writes a stance. If the
  building layer is kept across ticks, the stance filter stays per build. A new writer inside or before
  `combat` must either land before the build or the gate reads stances live.
- Once [flee-runs-aim-at-blocked-cells](flee-runs-aim-at-blocked-cells.md) limits building threats to
  buildings that shoot, the flee side of the gate may skip non-shooting enemy buildings as well; the
  seeker side keeps counting them, since soldiers still attack buildings.
- Hunters stay ungated, as today.

Step 2, a behaviour change: a calm civilian runs the flee check only on ticks where
`(tick + entity) % FLEE_CHECK_STRIDE_TICKS === 0`, with the stride 4, so it reacts up to a quarter
second late (at 12 ticks/s) to a raider coming into sight. A civilian already fleeing keeps checking every tick.
State hashes change; regenerate the goldens in this commit and name the behaviour change.

## Verify

- `test/conflict/combat-index-search.test.ts` and `test/conflict/presence-gate.test.ts` pass. Add
  cases: a neutral or friendly neighbour's settlers and buildings inside the box leave the gate closed,
  an `enemy` stance in either direction opens it, a one-way aggressor still makes a civilian flee, and
  a stance flipped by a landed blow earlier in the same tick is already seen by that tick's gate. For
  step 2, a calm civilian with a raider in sight flees on its next stride tick and not before.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after
  each step, then `npm run bench:compare`, on an idle box, trust clean: after step 1 `combat` median
  falls by about half and `bench:profile` shows `fleeDrive` near the `othersWithin` cost alone, with the
  state hash unchanged; step 2 moves the hash knowingly and reports its own gain.
- `npm test`, `npm run check`.
