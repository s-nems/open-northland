# Execute the landscape, build-ban, and terrain-tint opcodes

**Area:** sim, render · **Focus:** `systems/missions` · **Priority:** P3
**Blocked by:** [map-scripts-2-mission-system-core.md](map-scripts-2-mission-system-core.md)

Map-scripts epic, stage 6 of 10. Reference: [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md).

Scripts open passages and dress scenes by editing landscape objects: `SetLandscape` (761 lines),
`RemoveLandscape` (439), `SetHouseBuildForbiddenArea` (158), and tint terrain with
`SetVertexColor` (428).

## Scope

- Investigate first how placed landscape objects are modelled in the sim and the renderer (footprint,
  collision, decoration) and record the seam the opcodes use; `content/collision.ts` and
  `docs/formats/MAPDAT.md` describe where walkability comes from today.
- Results `SetLandscape`, `RemoveLandscape`, `RemoveLandscapesInArea`, `RemoveBlockerLandscapeInArea`,
  the three `RemoveFX*LandscapeInArea` variants, `SetHouseBuildForbiddenArea`.
- `SetVertexColor` and `SetVertexColorOnLand` as sim events that the renderer applies as a terrain
  tint; goal `IsAnyLandscapeOnPoint`.
- Non-goals: chests, wall gates, weather.

## Where to look

`packages/sim/src/systems/footprint`, `nav/` (terrain graph), `packages/render` terrain layers,
`packages/app/src/entries/map/world.ts`.

## Verify

Headless: a blocker removed by script becomes walkable in the terrain graph; a build ban refuses a
placement. A scene shows a tinted area for human review. Coverage delta. Normal gates.
