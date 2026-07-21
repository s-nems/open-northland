// The building/resource ground-footprint package — the collision/placement model extracted from
// the original's `[GfxHouse]` records (`blocked` walk-block body, `familyBody` max-level body,
// `reserved` build-exclusion zone, `door` entry cell) and the `[GfxLandscape]` resource areas.
// A leaf package: consumed by the CommandSystem (placement validation), the PathfindingSystem
// (the walk-block overlay), the AI planner + JobSystem + ProductionSystem (door-cell interaction),
// never importing any system.
//
// A completed building TYPE without a footprint (synthetic test content; the one real graphics-less type)
// keeps the pre-footprint behavior: it places without collision checks, blocks no cell, and is interacted
// with on its anchor tile. While under construction, every type instead uses its legal work perimeter.

export {
  buildingDoorNodes,
  type ConstructionPlot,
  constructionSitePlots,
  dynamicBlockedCells,
  dynamicBlockOverlay,
  walkBlockedBodyOf,
} from './blocked.js';
export { buildingBlockedCells } from './building-blocked-cache.js';
export {
  constructionWorkCell,
  constructionWorkCells,
  interactionNode,
  positionedInteractionCell,
  resourceWorkCell,
} from './interaction.js';
export {
  canPlaceBuilding,
  canPlaceWorkFlag,
  nearestWorkFlagPlacement,
  noteWorkFlagMove,
  type PlacementProbe,
  placementBlockerVersion,
  placementProbe,
  workFlagBlockerVersion,
  workFlagPlacementBlocks,
} from './placement/index.js';
// manhattan/nodeKey are published through systems/spatial.ts (their single public export
// site — two star-export paths to one name would silently drop it from the systems barrel on a
// future collision); package siblings import them from ./geometry.js directly.
export { resourceBlockedCells } from './resource-blocked-cache.js';
export {
  createResourceNode,
  type ResourceNodeSpec,
  resourceFootprintForGood,
  stampResourceFootprint,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from './resources.js';
