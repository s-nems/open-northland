# Run the combat pass over the units that can act, not every combatant

**Area:** sim · **Focus:** conflict · **Priority:** P2

With two players on a map, `combatSystem` (`systems/conflict/combat.ts`) works through every settler and
animal on every tick, at war or not:

- `combatPossible` (`conflict/dormancy.ts`) walks the whole list before returning, although the answer
  is fixed once `owners.size >= 2`;
- `new CombatIndex(world, ctx, terrain, combatants)` admits every combatant to the grid;
- `for (const e of combatants) engageCombatant(world, ctx, terrain, pass, e)` runs the ladder
  (`towerPostFor`, `asleepOnDuty`, `atomicHoldsSettler`, `actingMode`, `resolveFleeState`, `engageSpec`,
  ...) for each, although almost every unit leaves it without acting.

Measured on `magiczny_las`, AI seats 0-6, no war in the run: combat median 3.95 ms at ticks 95k-100k,
9.3x its first-window cost. Profile from the 80k checkpoint (2000 ticks, busy box), share of the whole
profile: `combatSystem` 9.0%, of which self 2.6%, `engageCombatant` 3.7% (self 1.6%,
`resolveFleeState` 0.5%), `CombatIndex` construction 1.7%, `combatPossible` 0.6%, `canonicalQuery` 0.3%.

## Scope

- Return from `combatPossible` as soon as its answer is fixed. Hash-identical.
- Run `engageCombatant` only for units that can act this tick: holders of `Engagement`, `AttackOrder`,
  `Anger`, `Fleeing`, `HuntFocus`, `HuntRest` or `UnreachableTargets`, attack-move orders, hunters,
  manned tower posts, sleepers on duty, defend-stance units away from their anchor, and units whose
  coarse cells hold a hostile owner or an aggressive animal (the `CombatIndex` coarse queries answer
  that). Every combatant stays admitted as a target.
- Determinism risk: the ladder has side effects on units outside that set today (a `disengage` that
  finds nothing, `Anger` reaped by the hostile-animal rung, a defend-stance walk home, the strided flee
  check). List each rung and show it cannot fire outside the set, or move the effect to the change that
  triggers it. The target is an unchanged state hash; a rung that cannot keep it is named and put to
  the owner before it lands.

## Verify

- Same state hash before and after over 4000 ticks from the 80k checkpoint (checkpoint from one 100k
  `bench:map` run with `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5`, `docs/DEVELOPMENT.md`,
  Measuring performance), and over a war run from the same checkpoint with every seat pair set to enemy.
  `packages/sim/test` combat tests unchanged.
- On an idle box, `ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint ON_BENCH_TICKS=4000
  npm run bench:map` before and after, then `npm run bench:compare`: combat median falls.
- `npm test`, `npm run check`, `npm run build`.
