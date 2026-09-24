# Aim flee and fright runs at cells a route can reach

**Area:** sim · **Focus:** conflict/flee, conflict/fright · **Priority:** P2

In a settlement, a civilian running from a raider mostly aims into a building or a tree and then
freezes. On `magiczny_las_12_players` with 13 AI seats (the session in `docs/DEVELOPMENT.md`,
Measuring performance), a replay from the 40k checkpoint switched every `neutral` seat pair to
`enemy`, which is the state the `setDiplomacy` command writes, and ran 600 ticks. Up to 331 civilians
were fleeing at once. 117,332 of 179,652 fleer-ticks (65%) re-aimed after a failed route, and the
worst fleers failed on every one of 599 ticks. In a 300-tick breakdown, 54,826 of 55,125 failed routes
(99.5%) aimed at a dynamically blocked cell: 43,531 inside a building and 11,295 on a resource such as
a tree. None aimed into another walk component. 54,707 of the failures left the fleer with no live
route, and 127 of 289 fleers stood on the same spot 200 ticks later.

Two faults combine:

- `fleeDestination` (`systems/conflict/flee.ts`) picks the compass cell `FLEE_STEP_NODES` away by
  `terrain.isWalkable` alone, which is static terrain. The router also refuses the dynamic walk-block
  (`dynamicBlockOverlay`: buildings, resources, landscapes), so in a dense town or a wood the best
  away-cell is often a house or a tree. The pick is a pure function of (here, threat), so the fleer
  asks for the same doomed cell again.
- `fleeDrive` reads `if (failed) clearNavState(...) else if (travelling && tick < repathAt) return;`, so
  a failed route skips the `FLEE_REPATH_CADENCE` hold and re-aims on the same tick, every tick, after
  dropping the route it had. `animalFrightSystem` (`conflict/fright.ts`) has the same shape against its
  scare node. `chase.ts` shows the fix for both: refuse a destination on another bank before routing,
  and stand a refused route out until `repathAt`.

About a third of the accepted flee threats in that replay were enemy buildings (roughly 87 of 260 per
tick). `isFleeThreat` admits any valid target of the fleer, and `isValidTarget` admits an enemy building
for an owned unit. So a civilian within `SIGHT_RADIUS_NODES` of an enemy house it can see keeps
fleeing until it is out of range.

## Scope

- `fleeDestination` refuses a cell in the dynamic walk-block and a cell in another static walk
  component than the runner's. When no compass cell qualifies, keep the boxed-in "stand and hope"
  fallback.
- Both drives keep the cadence throttle over a failed route instead of re-aiming on the failure tick.
- One change per drive; do not fold the two drives together.
- Decision: civilians flee only from buildings that shoot, never from plain enemy houses.
  `isFleeThreat` (`conflict/targeting.ts`) admits an enemy building only while it can fire: a manned
  tower or a shelter whose garrison can shoot. Enemy settlers stay threats as today. This frees
  civilians who live next to an enemy's houses, and lets the flee side of the presence gate in
  [combat-presence-gate-ignores-diplomacy](combat-presence-gate-ignores-diplomacy.md) ignore
  non-shooting buildings.

## Verify

- Headless: a FLEE civilian whose best away-cell is a house or a tree runs to another cell, and a
  civilian cornered against water or walls re-aims at most once per `FLEE_REPATH_CADENCE`. A frightened
  animal beside a building does the same per `FRIGHT_REPATH_CADENCE`. Count path requests with a probe,
  as in `test/conflict/melee-engagement/autonomous.cases.ts`.
- Headless: a civilian next to an enemy house stays put; a civilian next to an enemy tower with a
  fighter at its post flees.
- Replay a late checkpoint with the neighbours set to `enemy` (the staged battle of
  [the heavy-load reference](../runtime-architecture/00-heavy-load-reference.md) once it exists, or a
  script issuing `setDiplomacy`): failed flee routes fall from about two-thirds of fleer-ticks to a small fraction,
  fleers move, and building threats drop to the shooting ones. These are behaviour changes, so state
  hashes change: regenerate the goldens that contain a fleer in the same commit and name the change.
- `npm test`, `npm run check`.
