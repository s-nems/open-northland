import {
  averagePatternColour,
  cellColoursFromGround,
  patternSrcRect,
  type SceneTerrain,
  type TerrainTextureSet,
} from '@open-northland/render';
import { fetchImageData } from './net.js';

/**
 * The minimap's ground-colour binding for a decoded map: one `0xRRGGBB` per cell, averaged from the real
 * terrain texture pages the map's baked `ground` lanes point at. A real map's water and land look lives
 * in those per-triangle `GfxPattern` picks, not its landscape typeIds (~97% of a real map shares one), so
 * the typeId palette cannot depict it.
 *
 * Observed: the original generates its in-game minimap dynamically, and the shipped per-map `minimap.pcx`
 * is a map-selection card, sometimes a painted scene, so it cannot serve in-game. This module owns only
 * the browser fetch; the pure join halves live in `@open-northland/render`.
 */

/** Fetch a served ground page PNG and read its pixels back (browser-only - canvas 2D readback).
 *  A missing page returns null so those patterns degrade to the typeId palette. */
async function fetchPagePixels(
  pageKey: string,
): Promise<{ rgba: Uint8ClampedArray; w: number; h: number } | null> {
  const image = await fetchImageData(`/textures/${pageKey}.png`);
  return image === null ? null : { rgba: image.data, w: image.width, h: image.height };
}

/**
 * Build the per-cell minimap colours for a decoded map, or null when the map carries no ground lanes or
 * texture set, in which case the minimap falls back to its typeId raster. One fetch per referenced page,
 * one mean per distinct pattern, one pass over the cells.
 */
export async function loadMinimapCellColours(
  terrain: SceneTerrain,
  textures: Pick<TerrainTextureSet, 'groundFor'> | undefined,
): Promise<Uint32Array | null> {
  const ground = terrain.ground;
  const groundFor = textures?.groundFor;
  if (ground === undefined || groundFor === undefined) return null;
  const patterns = ground.patterns.map((name) => groundFor(name));
  const pageKeys = new Set<string>();
  for (const p of patterns) {
    if (p !== undefined) pageKeys.add(p.pageKey);
  }
  const pages = new Map<string, { rgba: Uint8ClampedArray; w: number; h: number }>();
  await Promise.all(
    [...pageKeys].map(async (key) => {
      const px = await fetchPagePixels(key);
      if (px !== null) pages.set(key, px);
    }),
  );
  const colours = patterns.map((p) => {
    if (p === undefined) return undefined;
    const page = pages.get(p.pageKey);
    if (page === undefined) return undefined;
    return averagePatternColour(page.rgba, page.w, page.h, patternSrcRect(p.coordsA, p.coordsB));
  });
  return cellColoursFromGround(ground, terrain.width * terrain.height, (i) => colours[i]);
}
