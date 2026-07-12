/**
 * Barrel for the .ini/.cif extractors. Splitting `ini.ts` into `ini/` by domain
 * concern keeps every `decoders/ini.js` import path stable. See each module for its concern.
 */

export {
  extractBuildingBobs,
  extractBuildingFootprints,
  extractBuildingGraphics,
  extractBuildingOverlays,
  extractConstructionCosts,
  extractConstructionLayers,
  extractHouseHitpoints,
} from './ini/buildings-gfx/index.js';
export type {
  RuleSection,
  SourceRef,
} from './ini/grammar.js';
export {
  cifLinesToSections,
  decodeIni,
  parseIniSections,
} from './ini/grammar.js';
export type {
  BmdPaletteBinding,
  JobBaseGraphicsBinding,
  PaletteAlias,
} from './ini/graphics-bindings.js';
export {
  extractBobSequences,
  extractGfxAnimAtomics,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractLandscapeGraphics,
  extractPaletteIndex,
} from './ini/graphics-bindings.js';
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
export {
  buildTerrainPatterns,
  extractPatterns,
  extractPatternTransitions,
} from './ini/terrain.js';
export {
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractVehicles,
  extractWeapons,
} from './ini/types/actors.js';
export {
  extractBuildings,
  fillBuildingRecipes,
} from './ini/types/buildings.js';
export { extractGoods } from './ini/types/goods.js';
export {
  extractJobExperience,
  extractJobs,
  extractTribes,
} from './ini/types/jobs.js';
export {
  buildGatheringPipeline,
  extractLandscape,
  extractLandscapeGfx,
  extractTrianglePatternTypes,
} from './ini/types/landscape.js';
