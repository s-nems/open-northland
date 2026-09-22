import type { SceneTerrain, TerrainTextureSet } from '@open-northland/render';
import type { Renderer, Texture } from 'pixi.js';
import { loadIr } from '../../content/ir/load.js';
import { loadTerrainMap } from '../../content/map-loader.js';
import { customGrassBindings, customMapPatch } from './map-patch.js';
import { mapGrassTexture } from './map-texture.js';
import { reviewTerrain, reviewTerrainTextures } from './terrain.js';

interface ReviewGround {
  readonly terrain: SceneTerrain;
  readonly textures: TerrainTextureSet;
  readonly label: string;
  readonly realMap: boolean;
}

export async function loadReviewGround(
  renderer: Renderer,
  grass: Texture,
  soil: Texture,
): Promise<ReviewGround> {
  const params = new URLSearchParams(location.search);
  const mapId = params.get('artMap');
  if (mapId === null)
    return {
      terrain: reviewTerrain(18, 20),
      textures: reviewTerrainTextures(renderer, grass, soil),
      label: 'Syntetyczna scena z domem i ścieżką.',
      realMap: false,
    };
  const [map, ir] = await Promise.all([loadTerrainMap(mapId), loadIr()]);
  if (!map || !ir)
    throw new Error(
      'Brakuje lokalnej mapy lub content/ir.json. Ten podgląd wymaga danych z własnej instalacji gry.',
    );
  const customGrass = mapGrassTexture(renderer, grass);
  const patterns = customGrassBindings(ir.gfxPatterns ?? [], customGrass.width, customGrass.height);
  const x = Number(params.get('artX') ?? 130);
  const y = Number(params.get('artY') ?? 70);
  const patch = customMapPatch(map, { x, y, width: 18, height: 20 }, patterns);
  return {
    terrain: patch.terrain,
    textures: {
      pages: new Map([['own-grass', customGrass.source]]),
      cellFor: () => undefined,
      groundFor: (name) => patterns.get(name),
    },
    label: `${mapId} · (${x}, ${y}) · 18×20 · pokryte wzory: ${patch.names.length}/${patch.names.length} · aktywne przejścia: 0. Oryginalne wysokości i cieniowanie; grafika podłoża własna.`,
    realMap: true,
  };
}
