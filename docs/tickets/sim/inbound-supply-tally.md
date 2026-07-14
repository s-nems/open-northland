# Hoist the construction inbound-supply reservation into a per-pass tally

**Area:** sim (economy scaling) · **Origin:** bmd-build-progress review, 2026-07-14 · **Priority:** P2

The `SupplyRun` reservation added for construction over-delivery is read via `inboundSupply(world,
site, goodType)` (`packages/sim/src/systems/stores/construction.ts`), which runs
`world.query(SupplyRun)` — a full scan of the reservation store — on every call. It is called from two
per-plan loops:

- `nextNeededConstructionGood` iterates it **per cost line** (`construction.ts`), called from
  `planBuilder` per builder per plan → `O(costLines × supplyRuns)`.
- `nearestConstructionSiteNeeding` iterates it **per candidate site** (`agents/economy/routing.ts`),
  and that runs on **every delivery plan of any good** (step 4 of `deliveryTargetFor`, not just
  construction hauls) → `O(sites × supplyRuns)` per delivering hauler.

Both `sites` and `supplyRuns` are active-work bounded, so this is within budget at current scale (not
an entities² pin). But the diff turned two `O(active)` planner loops into `O(active × active)`; a heavy
construction phase (many foundations, many haulers on supply errands, many replanning per tick) scales
as `sites × supplyRuns × planners`. This is the "full-store scan inside a per-entity loop" shape the
scaling contract calls out — worth hoisting before construction cohorts grow.

## Constraint (why a naive memo is wrong)

`inboundSupply` is read **live mid-planner** and the reads must reflect within-tick `SupplyRun`
mutations: earlier-planned settlers stamp fresh runs this tick (`fieldwork.ts`, `delivery.ts`) and
`ai.ts` removes a run at replan. A tick-start snapshot would miss those and **move goldens**. The sum
is commutative, so the fix must be an **incrementally-maintained** tally, not a snapshot.

## Scope

- Build a `Map<site, Map<goodType, inbound>>` tally, threaded through `PlannerContext` beside the
  existing `farmClaims`/`seatClaims` claim maps, updated as `SupplyRun` is stamped/removed so a
  mid-pass read sees exactly what the live `world.query` sees today (byte-identical pick winner).
- Replace the two `inboundSupply` call sites with tally lookups; keep the commutative-sum semantics.

## Verify

- `npm test` — goldens must NOT move (the tally must reproduce the live-scan result exactly); add a
  construction-cohort case that exercises several concurrent supply runs to one site.
