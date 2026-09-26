# Give standing-wait settlers the idle cadence instead of a full re-plan every tick

**Area:** sim · **Focus:** settlers/planner · **Priority:** P2
**Needs user:** how late a seated crafter, a loitering worker and a builder waiting at its site may
notice new work

Three outcomes keep a settler standing but outside `IdleStand`, so the planner sweep runs its whole
ladder every tick:

- A seated crafter. `atomicHoldsSettler` (`atomics/busy.ts`) holds nothing for a craft clip:
  `if (atomic.effect.kind === 'produce') return world.has(e, Wedding);`. Every tick
  `releaseStaleIntent` runs `stepOut` and `removeCurrentAtomic`, then `planAdult` -> `planEconomy` ->
  `planProducer` (`planVehicleYard`, `operatorRecipes`, `holdInsideWorkplace`) re-adds the same clip and
  `Resting`.
- A loitering worker: `LOITER_PLAN_PERIOD_TICKS = 1` in `drives/economy/workshop/index.ts`, so
  `planGossipIdle` rolls the RNG per loiterer per tick, and the first call each tick refills
  `GossipCandidates` over every person.
- A builder in `waitAtSite` (`drives/economy/builder.ts`), which never calls `pass.idle.stand`. Only the
  ladder's idle tail, the flag gatherer's wait and the vehicle rider's waits do.

Each remove and re-add bumps store generations, the sweep's change feed, the journals and the touched
log. Measured on `magiczny_las`, AI seats 0-6, profile from the 80k checkpoint (2000 ticks, busy box),
share of the whole profile: `planProducer` 5.9% (`planVehicleYard` 1.0%, `recipesFor` 0.9%,
`holdInsideWorkplace` 0.4%; its `nearestMissingInputSource` belongs to the store-search ticket),
`releaseStaleIntent` 2.9% (`stepOut` 0.4%, `removeCurrentAtomic` 0.3%), `planGossipIdle` 0.4%. The
profile does not split these by outcome.

## Scope

- Count first, through `Simulation.setInstrument`: ladder runs per tick by outcome (seated crafter
  re-deriving its clip, loiterer, `waitAtSite`, idle tail) on the 80k checkpoint.
- A seated crafter whose ladder would re-derive the same clip keeps it, with no release and re-add,
  until a wake: its workplace's `Production` cycles change, a need crosses `NEED_DRIVE_THRESHOLD`, an
  alarm, a shelter or an order.
- Loiterers and `waitAtSite` stand through `pass.idle.stand(e, false)` and take
  `IDLE_REPLAN_PERIOD_TICKS`; `LOITER_PLAN_PERIOD_TICKS` follows so the chat roll keeps its mean wait.
- This changes behavior (up to a second before new work is noticed, and the `CurrentAtomic` store's
  insertion order), so goldens move in the commit that names it. The owner rules the cadence per
  class before implementation.

## Verify

- Tests: a crafter leaves its seat when a need crosses; a loiterer takes a newly startable batch within
  the period; a waiting builder starts when material arrives.
- On an idle box, `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5
  ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint ON_BENCH_TICKS=4000 npm run bench:map` before and
  after (checkpoint from one 100k run, `docs/DEVELOPMENT.md`, Measuring performance), then
  `npm run bench:compare`: planner median and the per-outcome counts fall.
- `npm test`, `npm run check`, `npm run build`.
