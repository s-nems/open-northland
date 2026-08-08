// The building/resource ground-footprint package - the collision/placement model extracted from the
// original's `[GfxHouse]` records (`blocked` walk-block body, `familyBody` max-level body, `reserved`
// build-exclusion zone, `door` entry cell) and the `[GfxLandscape]` resource areas. A leaf: it imports no
// tick system, only the shared system context and the `spatial/` leaves.
//
// A completed building TYPE without a footprint (synthetic test content; the one real graphics-less type)
// keeps the pre-footprint behavior: it places without collision checks, blocks no cell, and is interacted
// with on its anchor tile. While under construction, every type instead uses its legal work perimeter.

export {
  buildingDoorNodes,
  type ConstructionPlot,
  constructionSitePlots,
  dynamicBlockLayers,
  dynamicBlockOverlay,
  walkBlockedBodyOf,
} from './blocked.js';
export { buildingBlockedCells } from './building-blocked-cache.js';
export {
  constructionWorkCell,
  constructionWorkCells,
  type InteractionNode,
  interactionNode,
  positionedInteractionCell,
  resourceStanceCells,
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
export { resourceBlockedCells } from './resource-blocked-cache.js';
export {
  anchorOnlyFootprint,
  createResourceNode,
  type ResourceNodeSpec,
  resourceFootprintForGood,
  stampResourceFootprint,
  stampResourceFootprintData,
  stampResourceFootprintOrFallback,
  unstampResourceFootprint,
} from './resources.js';
export { ROUTE_REGION_POCKET_CAP, routeRegions } from './route-regions.js';
