# Visit an idle settler only on its re-plan beat

**Area:** sim · **Focus:** settlers/planner · **Priority:** P2

An idle adult re-runs its ladder once per `IDLE_REPLAN_PERIOD_TICKS` (12 ticks), but the planner still
visits it on every tick. `idleRelease` (`planner/replan.ts`) returns null for any `IdleStand` holder, so
`SweepCandidates` (`planner/sweep.ts`) keeps it in `acting`, and `atomicPlanner`
(`planner/system.ts`) runs `releaseStaleIntent` before the idle gate:

```ts
if (!releaseStaleIntent(world, ctx, e, pass.farmClaims, pass.inbound, pass.shelters)) { /* ... */ }
// ...
if (waitsIdle(world, pass.shelters, ctx.tick, e)) { /* cut-off check */ continue; }
```

The per-tick cost is O(idle settlers), a pass over every idler whatever the beat skips. Measured on
`magiczny_las`, AI seats 0-6, profile from the 80k checkpoint (2000 ticks, busy box):
`releaseStaleIntent` 2.9% of the whole profile (self 0.8%, `topsUpAtHome` 0.6%, `stepOut` 0.4%,
`removeCurrentAtomic` 0.3%, `isManningPost` 0.2%), shared with the standing waits of
[the standing-wait ticket](planner-standing-waits-replan-every-tick.md); the idle share is not split.

## Scope

- Keep `IdleStand` settlers out of `acting` in a beat wheel keyed on
  `(tick + e) % IDLE_REPLAN_PERIOD_TICKS`, the key `idleReplanDue` already uses (pattern: `dueThisBeat`
  in `planner/assistant-grants.ts`), merged into the ascending-id sweep on their due tick. An idler
  whose owner has a shelter on alarm stays on every tick, as `idleReplanPeriodTicks` rules today.
  `wakeIdle` returns a settler to `acting` through the existing change feed.
- The standing idlers' cut-off check (`cutOffCheckDue`, every 60 ticks) must still reach every standing
  idler on its tick, or be staggered by entity as a separate, hash-moving change.
- State hash unchanged. Prove first that `releaseStaleIntent` changes nothing for a settled idler (the
  world's `mutationVersion` does not move across the visit); a mutation it does make moves into
  `IdleStands.settle`, so it happens once, when the settler goes idle.

## Verify

- The `plannerSweep` cache verifier covers the beat wheel; a test visits a settled idler off its beat
  and asserts no mutation.
- On an idle box, `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5
  ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint ON_BENCH_TICKS=4000 npm run bench:map` before and
  after (checkpoint from one 100k run, `docs/DEVELOPMENT.md`, Measuring performance), then
  `npm run bench:compare`: same state hash, planner median falls.
- `npm test`, `npm run check`, `npm run build`.
