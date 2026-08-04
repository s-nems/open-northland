import type { GfxPattern, TerrainPattern } from '@open-northland/data';
import {
  averagePatternColour,
  cellColourResolver,
  cellColoursFromGround,
  mapPreviewSize,
  patternSrcRect,
  rasterizeTerrain,
  texturePageKey,
} from '@open-northland/render/data';
import type { RgbaImage } from '../../decoders/image.js';
import { encodePng } from '../../decoders/png.js';
import type { MapDatTerrainFile } from './terrain/index.js';

/**
 * Fill for cells whose lanes and typeId both resolve no colour, a deliberate divergence from the
 * browser preview's `flatTileColour` palette, which lives outside the pure seam.
 */
const UNRESOLVED_CELL_COLOUR = 0x18222e;

export interface MinimapSynthesizerSources {
  /** The extracted `[GfxPattern]` table - the ground-lane name → texture/UV join. */
  readonly gfxPatterns: readonly GfxPattern[];
  /** The per-typeId representative bindings - their `debugColor` is the laneless fallback. */
  readonly terrainPatterns: readonly TerrainPattern[];
  /** Read an emitted `text_NNN` page back as RGBA; null when the page was never emitted. */
  readonly readPage: (pageKey: string) => Promise<RgbaImage | null>;
}

/**
 * Builds the per-run synthesizer: pattern mean colours and page pixels are memoised across maps, so
 * each referenced page is read and averaged once. The returned function yields undefined when the map
 * carries no ground lanes or no lane pattern resolves a colour.
 */
export function createMinimapSynthesizer(
  sources: MinimapSynthesizerSources,
): (terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined> {
  const patternByName = new Map<string, GfxPattern>();
  for (const row of sources.gfxPatterns) {
    if (row.editName !== undefined && row.texture !== undefined) patternByName.set(row.editName, row);
  }
  const typeColours = new Map<number, number>();
  for (const row of sources.terrainPatterns) {
    const rgb = row.debugColor;
    if (rgb !== undefined) {
      typeColours.set(row.typeId, ((rgb[0] & 0xff) << 16) | ((rgb[1] & 0xff) << 8) | (rgb[2] & 0xff));
    }
  }
  const pages = new Map<string, Promise<RgbaImage | null>>();
  const readPage = (key: string): Promise<RgbaImage | null> => {
    let page = pages.get(key);
    if (page === undefined) {
      page = sources.readPage(key);
      pages.set(key, page);
    }
    return page;
  };
  const colours = new Map<string, Promise<number | undefined>>();
  const colourOf = (name: string): Promise<number | undefined> => {
    let colour = colours.get(name);
    if (colour === undefined) {
      colour = (async () => {
        const pattern = patternByName.get(name);
        if (
          pattern?.texture === undefined ||
          pattern.coordsA === undefined ||
          pattern.coordsB === undefined
        ) {
          return undefined;
        }
        const page = await readPage(texturePageKey(pattern.texture));
        if (page === null) return undefined;
        const rect = patternSrcRect(pattern.coordsA, pattern.coordsB);
        return averagePatternColour(page.rgba, page.width, page.height, rect);
      })();
      colours.set(name, colour);
    }
    return colour;
  };

  return async (terrain) => {
    const ground = terrain.ground;
    if (ground === undefined) return undefined;
    const laneColours = await Promise.all(ground.patterns.map(colourOf));
    if (!laneColours.some((colour) => colour !== undefined)) return undefined;
    const cellColours = cellColoursFromGround(
      ground,
      terrain.width * terrain.height,
      (index) => laneColours[index],
    );
    const { width, height } = mapPreviewSize(terrain.width, terrain.height);
    const rgba = rasterizeTerrain(
      terrain,
      cellColourResolver(cellColours, (typeId) => typeColours.get(typeId) ?? UNRESOLVED_CELL_COLOUR),
      width,
      height,
    );
    return encodePng({ width, height, rgba });
  };
}
