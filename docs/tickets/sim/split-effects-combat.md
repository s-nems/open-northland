# Split agents/effects-combat.ts by concern

**Area:** packages/sim · **Origin:** /refactor-cleanup of the sim package, refactor/sim-cleanup,
2026-07-12 (deferred sibling of the effects-goods split landed on that branch)

`packages/sim/src/systems/agents/effects-combat.ts` is ~439 lines — well past the ~300-line split
rule — and mixes several distinct atomic-effect concerns in one file, exactly like the
`effects-goods.ts` grab-bag that was split into an `effects-goods/` folder on the same pass:

- **stagger** — `PendingStagger`, `applyPendingStaggers`, `collectStagger`;
- **attack-hit resolution** — `resolveAttackHit`, `meleeTargetOutOfReach`, `resolveCombatHit`;
- **projectile launch** — `launchProjectile`;
- **swing need-cost** — `paySwingNeedCost`, `reserveDeltaToBar`, `clampNeed` (+ `NEED_EVENT_RESERVE`);
- **provoked reactions** — `harvestCadaver`, `provokeAnger` (+ `ATTACKED_ATOMIC_ID`).

It was left out of the refactor-cleanup pass because that pass was scoped to F1–F6 (stores, combat,
effects-goods, placement, core/commands, test reorg); this is the deferred F-list sibling.

## Scope

Behavior-preserving split into an `agents/effects-combat/` folder with an `index.ts` barrel that
keeps the import paths stable (the public consumers are `agents/atomic.ts` and the projectile
system, which import `applyPendingStaggers`/`PendingStagger`/`resolveCombatHit`/`launchProjectile`/
`resolveAttackHit`/`paySwingNeedCost`). Move bodies verbatim; group by the concerns above into a
clean DAG (need-cost and stagger are the leaf-ish primitives the hit resolvers build on). Preserve
determinism, canonical ordering, and fixed-point need math — goldens must stay byte-identical (a
moved golden means a real change crept in).

## Verify

`npm test`, `npm run check`, `npm run build`. The combat golden-trace and cadence suites
(`test/conflict/combat-*.test.ts`, `test/conflict/ranged-weapons.test.ts`) must pass unchanged with
no golden movement.
