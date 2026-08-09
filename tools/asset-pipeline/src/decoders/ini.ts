/** Public surface of the `ini/` modules: importers outside `decoders/` use this specifier. */

export type {
  BmdPaletteBinding,
  JobBaseGraphicsBinding,
  PaletteAlias,
} from './ini/bindings/index.js';
export {
  extractBobSequences,
  extractGfxAnimAtomics,
  extractGfxWalkAtomics,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractLandscapeGraphics,
  extractPaletteIndex,
  paletteAliasMap,
  type RampAlias,
  rampAliasMap,
} from './ini/bindings/index.js';
export {
  extractBuildingBobs,
  extractBuildingFlagPoints,
  extractBuildingFootprints,
  extractBuildingGraphics,
  extractBuildingOverlays,
  extractBuildingSoldierFlagPoints,
  extractConstructionCosts,
  extractConstructionLayers,
  extractHouseHitpoints,
  extractUpgradeTargets,
} from './ini/buildings-gfx/index.js';
export type { RuleSection } from './ini/grammar.js';
export {
  cifBytesToSections,
  cifLinesToSections,
  decodeIni,
  iniBytesToSections,
  parseIniSections,
} from './ini/grammar.js';
export { makeSource, normalizeAssetPath, type SourceRef } from './ini/ir-fields.js';
export { extractMapScript } from './ini/map-script.js';
export type { MapStaticObjects } from './ini/maps.js';
export {
  extractMapInfo,
  extractStaticObjects,
} from './ini/maps.js';
export { extractSounds } from './ini/sounds.js';
export {
  decodeCifStringTable,
  extractStringnById,
  extractStringTable,
  latin1ToCp1250,
} from './ini/string-tables.js';
export { extractPatterns, extractPatternTransitions } from './ini/terrain.js';
export {
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractVehicles,
  extractWeapons,
} from './ini/types/actors.js';
export { extractBuildings } from './ini/types/buildings.js';
export { extractGoods } from './ini/types/goods.js';
export {
  extractJobExperience,
  extractJobs,
  extractTribes,
} from './ini/types/jobs.js';
export {
  extractLandscape,
  extractLandscapeGfx,
  extractTrianglePatternTypes,
} from './ini/types/landscape.js';
