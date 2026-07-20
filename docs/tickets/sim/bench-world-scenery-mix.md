# Give the sim bench a scenery mix, so entity-count costs are visible at all

**Area:** sim (tooling) · **Origin:** ticket scout, 2026-07-20 · **Priority:** P3

`packages/app/bench/world.ts:19-27` builds the benchmark world as N copies of the sandbox scene's
authored settlement, plus an optional mirrored battle strip. It spawns **no** `Resource` nodes, **no**
`BerryBush`, **no** `Crop`; the knobs (`ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`) turn up settlers
and fighters only.

A real decoded map is ~17k entities, the large majority of them scenery — see
`packages/sim/src/systems/stockpile-index.ts:10`. The bench models roughly none of them. So any cost
that scales with *total entity count* rather than settler count is structurally invisible to
`npm run bench:sim`, which root `AGENTS.md` names as the tool for proving golden rule 6.

Two concrete costs this hides today:

- `packages/sim/src/systems/economy/jobs/system.ts:70` — a whole-world scan per tick
  (`docs/tickets/sim/job-system-settler-query.md`). The bench cannot show the regression *or* the
  fix.
- `packages/sim/src/systems/economy/berries.ts:88` — `berryGrowthSystem` visits every `BerryBush`
  every tick to conclude that essentially all of them are `ripe` and nothing is due. Wild bushes are
  spawned one per fruited-bush map object (`packages/app/src/game/sandbox/map-spawn.ts:113`), so a
  real map has thousands. `packages/sim/src/systems/economy/farming.ts:145` (`cropGrowthSystem`) has
  the same shape, bounded by field count.

It also means the per-system shares those tickets reason from were measured on a world with the wrong
entity mix.

## Relationship to the existing bench tickets (read both before starting)

- `docs/tickets/sim/ai-planner-scale-curve.md` **item 1** asks for a bench knob that separates
  population from map area. That is a different axis — how much of each thing there is — while this
  ticket is about *which kinds of entity exist at all*. They share one seam (`benchWorld`'s knobs),
  so whoever goes second should extend the first one's work rather than add a parallel mechanism.
  If the two land together, say so and close both.
- `docs/tickets/sim/bench-regression-gate.md` decides whether a gate exists and on what metric. Its
  candidate metrics (the scaling curve, the `sharePct` baseline with `ai` at ~89%) are computed on
  this world, so this ticket partly invalidates its baseline. It should be re-measured afterwards,
  but it does not block this one.

## Scope

- Add a scenery knob to `benchWorld` (e.g. `ON_BENCH_SCENERY`) that scatters synthetic resource
  nodes, berry bushes and crops at roughly decoded-map density, deterministically from the bench's
  existing seed.
- Content must stay the clean-room synthetic sandbox set that `createSceneSim` defaults to — no
  copyrighted map or IR bytes reach the bench, exactly as the file's header comment already
  requires.
- Document the chosen density and where it came from (count scenery objects in a decoded map rather
  than guessing).
- Re-read the per-system table afterwards and record the new baseline in the commit message; expect
  `job`, `berryGrowth`, `cropGrowth` and snapshot cloning to move.

## Verify

- `npm run bench:sim` runs at the default knob setting with no behavior change to the measured
  systems, and the new knob visibly moves the entity count.
- Bench-only change: `npm test` unaffected and goldens unmoved (the bench world is not a golden
  fixture). `npm run check`, `npm run build`.
- `npm run check:assets` stays green — the density figure must not bring any original bytes with it.

## Source basis

None needed — self-consistency tooling, not a mechanic. The one factual claim to pin is the scenery
density, which comes from counting objects in a decoded map in the owned game copy.
