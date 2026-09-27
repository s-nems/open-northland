# Give standing-wait settlers the idle cadence instead of a full re-plan every tick

**Area:** sim · **Focus:** settlers/planner · **Priority:** P3
**Needs user:** how late a seated crafter, a garrisoned archer and a resting or sheltering settler may
notice new work

Several outcomes keep a settler standing but outside `IdleStand`, so the planner sweep visits it and
runs its ladder every tick; `idleRelease` (`planner/replan.ts`) returns null for each of them:

- A seated crafter. `atomicHoldsSettler` (`atomics/busy.ts`) holds nothing for a craft clip:
  `if (atomic.effect.kind === 'produce') return world.has(e, Wedding);`. Every tick
  `releaseStaleIntent` runs `stepOut` and `removeCurrentAtomic`, then `planAdult` -> `planEconomy` ->
  `planProducer` re-adds the same clip and `Resting`.
- A `Garrison` holder in a tower.
- A `Resting` holder with no clip (probably `holdInsideWorkplace`; confirm).
- A `Sheltering` holder.

Counted on `krwawa_rzeka`, 12 AI seats, 2000 ticks from t80k and t100k
(`docs/perf/heavy-load-krwawa-rzeka-12ai.md`, temporary counters): seated crafters re-derive their clip
27 and 18.6 times a tick (0.18 to 0.24 ms); garrison holders 123 to 134 a tick (0.20 ms of ladder, plus
an `engageCombatant` call each); `Resting` without a clip 21 to 45; `Sheltering` 16 to 25. Loiterers and
builders in `waitAtSite` stay at 0.3 a tick or fewer, so they are no longer worth a cadence change.
Each remove and re-add bumps store generations, the sweep's change feed, the journals and the touched
log.

## Scope

- A seated crafter whose ladder would re-derive the same clip keeps it, with no release and re-add,
  until a wake: its workplace's `Production` cycles change, a need crosses `NEED_DRIVE_THRESHOLD`, an
  alarm, a shelter or an order.
- Garrison, resting and sheltering holders stand through `pass.idle.stand(e, false)` and take
  `IDLE_REPLAN_PERIOD_TICKS`, woken by the same events. The sweep leaves an `IdleStand` holder out
  between its beats only while `shedsNothing` (`planner/replan.ts`) holds.
- This changes behavior (up to a second before new work is noticed, and the `CurrentAtomic` store's
  insertion order), so goldens move in the commit that names it. The owner rules the cadence per
  class before implementation.

## Verify

- Tests: a crafter leaves its seat when a need crosses; a garrisoned archer leaves on an order; a
  sheltering settler leaves when the alarm ends.
- `bench:map` for 2000 ticks from the reference's t100k checkpoint before and after, then
  `npm run bench:compare`: planner mean and the per-class visit counts fall.
- `npm test`, `npm run check`, `npm run build`.
