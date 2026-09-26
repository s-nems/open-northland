# Fold the siege burst into the shot landing and measure the vehicle fight in map points

**Area:** sim · **Priority:** P3

Two seams were left when the combat fidelity work was rebased onto the vehicles work.

## Scope

1. Two victim collections for one landing. An arrow or an area shot (`damagetype 2`) lands through
   `struckVictims` in `packages/sim/src/systems/conflict/projectile.ts`: the victim loosed at, then
   the first man or beast, then a building, seven nodes for an area shot, the combat index answering.
   A catapult stone lands through `resolveGroundImpact` in `conflict/ground-impact.ts`: everything on
   its one node, vehicles and walls included, its own side too, with a `collateral` source for a side
   not at war. Both already resolve damage through `resolveCombatHit` and `landedDamage`, so only the
   collection differs. Fold the burst into `struckVictims` (vehicles by their disc, walls by their
   cells, the `hitSelf` and `collateral` rules kept) and delete `ground-impact.ts`.
2. Metric. `conflict/engage-vehicle.ts` scans, leashes, aims and picks a firing node in Manhattan
   half-cell nodes while every other weapon band, reach test and contact slot counts map points
   (`hexNodeDistance`). Its held-versus-found comparison mixes the two. Move it onto map points,
   `firingNode` included, and re-pin `packages/sim/test/conflict/catapult.test.ts`.

## Verify

`packages/sim/test/conflict/catapult.test.ts` and `projectiles.test.ts` keep every current case, the
area-shot cap and the wall valency rule included; the combat golden's trace is unchanged; `npm test`,
`npm run check`, `npm run build`.
