/**
 * The map extraction stage, split by concern: `terrain.ts` (the `map.dat` → `maps/<id>.json` grid +
 * render lanes), `info.ts` (the `map.cif` logic-header `MapInfo` for the IR), `meta.ts` (the menu's
 * name/description sidecar via the folder string tables), `minimap.ts` (the thumbnail PNG), and
 * `convert.ts` (the batch walker wiring them per map folder). This barrel is the stage's public
 * surface — import from `stages/maps/index.js`.
 */
export { findPathCaseInsensitive } from './case-path.js';
export { convertMapDatTree, type MapDatConversion } from './convert.js';
export { decodeMapTree, mapCifToInfo, mapIdFromPath } from './info.js';
export { type MapMetaFile, resolveMapMeta } from './meta.js';
export { minimapToPng } from './minimap.js';
export { type MapDatTerrainFile, mapDatToTerrain } from './terrain.js';
