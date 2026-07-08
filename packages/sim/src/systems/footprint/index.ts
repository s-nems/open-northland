// The building/resource ground-footprint package — the collision/placement model extracted from
// the original's `[GfxHouse]` records (`blocked` walk-block body, `familyBody` max-level body,
// `reserved` build-exclusion zone, `door` entry cell) and the `[GfxLandscape]` resource areas.
// A leaf package: consumed by the CommandSystem (placement validation), the PathfindingSystem
// (the walk-block overlay), the AI planner + JobSystem + ProductionSystem (door-cell interaction),
// never importing any system.
//
// A building TYPE without a footprint (synthetic test content; the one real graphics-less type)
// keeps the pre-footprint behavior everywhere: it places without collision checks, blocks no cell,
// and is interacted with on its anchor tile.

export { manhattan, tileKey } from './geometry.js';
export {
  resourceBlockedCells,
  resourceFootprintForGood,
  resourceFootprintFromLandscapeGfx,
  stampResourceFootprint,
  unstampResourceFootprint,
} from './resources.js';
export {
  buildingBlockedCells,
  canPlaceBuilding,
  dynamicBlockedCells,
  interactionTile,
  positionedInteractionCell,
  resourceWorkCell,
} from './placement.js';
