# Measure a building against the DEFEND radius by its nearest wall, not its anchor

**Area:** sim · **Origin:** attack-enemy-buildings review, 2026-07-19 · **Priority:** P3
(correctness of an edge case — a metric inconsistency, not a live bug at current footprints)

The DEFEND-stance accept filter measures a candidate target's distance with `entityNode(t)` —
a building's **anchor** node:

```ts
// packages/sim/src/systems/conflict/engagement.ts (engageSpec, DEFEND branch)
const accept = (t) => generalAccept(t) && manhattan(terrain, anchor, entityNode(world, terrain, t)) <= DEFEND_RADIUS_NODES;
```

Every other combat distance — reach, chase goal, attack-order distance — measures a building at its
**nearest wall cell** (`combatTargetNode` / `buildingBodyNodes`). So a large enemy building whose
wall is inside a DEFEND guard's radius but whose anchor is outside is wrongly ignored: the guard
sees the far anchor, not the near wall it could actually reach. Harmless at today's small
footprints (anchor ≈ wall), but the metric is inconsistent with the rest of the siege math and will
misbehave once multi-cell buildings (the fort/wonder footprints) are common defend targets.

## Scope

Use the same nearest-wall measure the reach/chase use in the DEFEND accept — i.e. measure the
building at `combatTargetNode(world, ctx, terrain, anchor, t, bodyNodes)` (or the nearest of
`buildingBodyNodes`) against `DEFEND_RADIUS_NODES`, threading the tick's `BuildingBodyNodeCache` so
it costs no extra footprint translation. Keep unit targets on `entityNode` (unchanged). This will
move behavior for a DEFEND guard beside a large enemy building, so it is a real (if rare) change —
name it in the commit and add a test with a multi-cell building straddling the radius edge.

## Verify

`npm test`; a new case in `packages/sim/test/conflict/attack-buildings.test.ts`: a DEFEND guard
whose anchor sits so a multi-cell enemy building's near wall is within `DEFEND_RADIUS_NODES` but its
anchor is not — the guard should now engage it (and still ignore one whose nearest wall is beyond
the radius).
