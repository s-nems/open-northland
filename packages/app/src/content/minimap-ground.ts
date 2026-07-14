import {
  patternSrcRect,
  type SceneGround,
  type SceneTerrain,
  type TerrainTextureSet,
} from '@open-northland/render';
import { fetchImageData } from './net.js';

/**
 * The minimap's ground-colour binding for a DECODED map: one `0xRRGGBB` per cell, averaged from the
 * REAL terrain texture pages the map's baked `ground` lanes point at. A real map's water/land look
 * lives in those per-triangle `GfxPattern` picks, NOT its landscape typeIds (~97% of a real map shares
 * one typeId), so the typeId palette can never depict it — this join can.
 *
 * Source basis: the original's in-game minimap is the dynamically generated "world overview" window
 * (OpenVikings `CWorldOverviewStaticGuiWindow` — its rendering internals are not reversed, and the
 * shipped per-map `minimap.pcx` is the map-SELECTION card, sometimes a painted scene, so it can't
 * serve in-game). NAMED APPROXIMATION: we colour each cell with the mean texel of its two triangles'
 * pattern rects — transition overlays, elevation shading and the `embr` brightness lane are ignored.
 */

/** Sentinel above any `0xRRGGBB` marking "no lane colour — fall back to the typeId palette". */
export const MINIMAP_CELL_UNRESOLVED = 0x1000000;

/**
 * Mean RGB (`0xRRGGBB`) of a page rect, or undefined for a degenerate/out-of-bounds rect. Fully
 * transparent texels are skipped (page corners outside the pattern's triangles). Pure — unit-tested.
 */
export function averagePatternColour(
  rgba: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  rect: { x: number; y: number; w: number; h: number },
): number | undefined {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const x1 = Math.min(imgW, rect.x + rect.w);
  const y1 = Math.min(imgH, rect.y + rect.h);
  for (let y = Math.max(0, rect.y); y < y1; y++) {
    for (let x = Math.max(0, rect.x); x < x1; x++) {
      const o = (y * imgW + x) * 4;
      if ((rgba[o + 3] ?? 0) === 0) continue;
      r += rgba[o] ?? 0;
      g += rgba[o + 1] ?? 0;
      b += rgba[o + 2] ?? 0;
      n++;
    }
  }
  if (n === 0) return undefined;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

/**
 * Join the ground lanes onto per-pattern colours: each cell mixes its triangle-A and triangle-B
 * pattern colours (mean when both resolve), {@link MINIMAP_CELL_UNRESOLVED} when neither does.
 * Pure — unit-tested with a synthetic lane grid.
 */
export function cellColoursFromGround(
  ground: SceneGround,
  cellCount: number,
  colourOfPattern: (index: number) => number | undefined,
): Uint32Array {
  const out = new Uint32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    const a = colourOfPattern(ground.a[cell] ?? -1);
    const b = colourOfPattern(ground.b[cell] ?? -1);
    if (a !== undefined && b !== undefined) {
      const r = ((((a >> 16) & 0xff) + ((b >> 16) & 0xff)) / 2) | 0;
      const g = ((((a >> 8) & 0xff) + ((b >> 8) & 0xff)) / 2) | 0;
      const bl = (((a & 0xff) + (b & 0xff)) / 2) | 0;
      out[cell] = (r << 16) | (g << 8) | bl;
    } else {
      out[cell] = a ?? b ?? MINIMAP_CELL_UNRESOLVED;
    }
  }
  return out;
}

/** Fetch a served ground page PNG and read its pixels back (browser-only — canvas 2D readback).
 *  A missing page returns null so those patterns degrade to the typeId palette. */
async function fetchPagePixels(
  pageKey: string,
): Promise<{ rgba: Uint8ClampedArray; w: number; h: number } | null> {
  const image = await fetchImageData(`/textures/${pageKey}.png`);
  return image === null ? null : { rgba: image.data, w: image.width, h: image.height };
}

/**
 * Build the per-cell minimap colours for a decoded map, or null when the map carries no ground lanes
 * or texture set (synthetic scenes or a bare checkout) — the minimap then falls
 * back to its typeId raster. One fetch per referenced page (browser-cached — the renderer already
 * loaded the same PNGs), one mean per distinct pattern, one pass over the cells.
 */
export async function loadMinimapCellColours(
  terrain: SceneTerrain,
  textures: TerrainTextureSet | undefined,
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
