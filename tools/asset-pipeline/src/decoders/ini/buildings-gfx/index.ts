/**
 * Barrel for the `[GfxHouse]` graphics-table extractors, split into the structural overlays
 * (costs/hitpoints/footprints) and the visual bindings (layers/overlays/graphics/bobs) that share the
 * record-split and body+palette preamble in `shared.ts`.
 */
export {
  extractBuildingFootprints,
  extractConstructionCosts,
  extractHouseHitpoints,
  extractUpgradeTargets,
} from './structure.js';
export {
  extractBuildingBobs,
  extractBuildingGraphics,
  extractBuildingOverlays,
  extractConstructionLayers,
} from './visuals.js';
