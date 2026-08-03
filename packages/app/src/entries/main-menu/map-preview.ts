import {
  cellColourResolver,
  flatTileColour,
  mapPreviewSize,
  rasterizeTerrain,
  terrainMapToScene,
} from '@open-northland/render';
import { loadIr } from '../../content/ir/load.js';
import { loadTerrainMap } from '../../content/map-loader.js';
import { loadMinimapCellColours } from '../../content/minimap-ground.js';
import { buildGroundPatternIndex, buildTerrainDebugColourIndex } from '../../content/terrain.js';

/** mapId → generated preview URL, so each map rasterises at most once. The blob URLs are never
 *  revoked: Start is a full navigation, so the cache dies with the menu page. */
const previews = new Map<string, Promise<string | null>>();

function imageUrl(rgba: Uint8Array, width: number, height: number): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return Promise.resolve(null);
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob === null ? null : URL.createObjectURL(blob)), 'image/png');
  });
}

async function buildMapPreview(mapId: string): Promise<string | null> {
  const map = await loadTerrainMap(mapId);
  if (map === null) return null;
  const terrain = terrainMapToScene(map);
  const ir = await loadIr();
  const patternIndex = ir === null ? null : buildGroundPatternIndex(ir);
  const cellColours = await loadMinimapCellColours(
    terrain,
    patternIndex === null ? undefined : { groundFor: (name) => patternIndex.get(name) },
  );
  const typeColours = ir === null ? null : buildTerrainDebugColourIndex(ir);
  const colourOfType = (typeId: number): number => typeColours?.get(typeId) ?? flatTileColour(typeId);
  const colourOfCell = cellColourResolver(cellColours, colourOfType);
  const { width, height } = mapPreviewSize(terrain.width, terrain.height);
  return imageUrl(rasterizeTerrain(terrain, colourOfCell, width, height), width, height);
}

export function generatedMapPreview(mapId: string): Promise<string | null> {
  const cached = previews.get(mapId);
  if (cached !== undefined) return cached;
  const generated = buildMapPreview(mapId).catch(() => null);
  previews.set(mapId, generated);
  return generated;
}
