import { flatTileColour, terrainMapToScene } from '@open-northland/render';
import { loadIr } from '../../content/ir.js';
import { loadMinimapCellColours, MINIMAP_CELL_UNRESOLVED } from '../../content/minimap-ground.js';
import { buildGroundPatternIndex, buildTerrainDebugColourIndex } from '../../content/terrain.js';
import { rasterizeTerrain, terrainWorldBounds } from '../../hud/minimap/model.js';
import { loadTerrainMap } from '../../slice/map-loader.js';

const PREVIEW_MAX_WIDTH = 720;
const PREVIEW_MAX_HEIGHT = 420;
const previews = new Map<string, Promise<string | null>>();

export function mapPreviewDimensions(
  mapWidth: number,
  mapHeight: number,
): { readonly width: number; readonly height: number } {
  const bounds = terrainWorldBounds(mapWidth, mapHeight);
  const scale = Math.min(PREVIEW_MAX_WIDTH / bounds.width, PREVIEW_MAX_HEIGHT / bounds.height);
  return {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}

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
  const colourOfCell = (cell: number, typeId: number): number => {
    const colour = cellColours?.[cell] ?? MINIMAP_CELL_UNRESOLVED;
    return colour < MINIMAP_CELL_UNRESOLVED ? colour : (typeColours?.get(typeId) ?? flatTileColour(typeId));
  };
  const { width, height } = mapPreviewDimensions(terrain.width, terrain.height);
  return imageUrl(rasterizeTerrain(terrain, colourOfCell, width, height), width, height);
}

export function generatedMapPreview(mapId: string): Promise<string | null> {
  const cached = previews.get(mapId);
  if (cached !== undefined) return cached;
  const generated = buildMapPreview(mapId).catch(() => null);
  previews.set(mapId, generated);
  return generated;
}
