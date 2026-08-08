import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import type { SceneGround } from '../scene/terrain-scene.js';

/**
 * The pure minimap raster: cell grid → RGBA picture, plus the ground-lane → cell-colour join it samples.
 * One owner, so every consumer rasterises a map identically. Named approximation: a cell takes the mean
 * texel of its two triangles' pattern rects, ignoring transition overlays, elevation shading and the
 * `embr` brightness lane.
 */

/** The world-space (projected px, pre-camera) axis-aligned bounds of a whole terrain grid. */
export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The world box covering every cell diamond of a `mapW × mapH` cell grid: centres span
 * `x ∈ [0, (2·mapW−1)·TILE_HALF_W]` and `y ∈ [0, (mapH−1)·TILE_HALF_H]`, and each diamond extends
 * ±TILE_HALF_W / ±TILE_HALF_H around its centre.
 */
export function terrainWorldBounds(mapW: number, mapH: number): WorldBounds {
  return {
    minX: -TILE_HALF_W,
    minY: -TILE_HALF_H,
    width: (2 * mapW + 1) * TILE_HALF_W,
    height: (mapH + 1) * TILE_HALF_H,
  };
}

/** The cell grid the raster samples - the `SceneTerrain` sub-shape it actually reads. */
export interface TerrainCells {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
}

/** The menu map-preview raster cap (px). */
const MAP_PREVIEW_MAX_WIDTH = 720;
const MAP_PREVIEW_MAX_HEIGHT = 420;

/** Aspect preserved, min 1 px. */
export function mapPreviewSize(
  mapW: number,
  mapH: number,
): { readonly width: number; readonly height: number } {
  const bounds = terrainWorldBounds(mapW, mapH);
  const scale = Math.min(MAP_PREVIEW_MAX_WIDTH / bounds.width, MAP_PREVIEW_MAX_HEIGHT / bounds.height);
  return {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}

/**
 * Rasterize the whole terrain into an RGBA byte grid (`pxW × pxH`, row-major, 4 bytes/px), built once
 * per map. Each pixel takes the cell diamond containing its world point, picked among the two nearest
 * rows by the diamond metric `|dx|/TILE_HALF_W + |dy|/TILE_HALF_H` (≤ 1 inside the diamond, and the
 * diamonds tile the plane, so the minimum is the containing cell). `colourOfCell` maps the winning cell
 * to `0xRRGGBB`.
 */
export function rasterizeTerrain(
  terrain: TerrainCells,
  colourOfCell: (cell: number, typeId: number) => number,
  pxW: number,
  pxH: number,
): Uint8Array {
  const bounds = terrainWorldBounds(terrain.width, terrain.height);
  const out = new Uint8Array(pxW * pxH * 4);
  for (let py = 0; py < pxH; py++) {
    const wy = bounds.minY + ((py + 0.5) / pxH) * bounds.height;
    // The two rows whose diamonds can contain this y (rows interlock at half-diamond spacing).
    const rowLo = Math.floor(wy / TILE_HALF_H);
    for (let px = 0; px < pxW; px++) {
      const wx = bounds.minX + ((px + 0.5) / pxW) * bounds.width;
      let bestCol = 0;
      let bestRow = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate < 2; candidate++) {
        const clampedRow = Math.min(terrain.height - 1, Math.max(0, rowLo + candidate));
        const stagger = clampedRow % 2 === 0 ? 0 : 1; // odd rows sit half a cell right (tileToScreen)
        const col = Math.min(terrain.width - 1, Math.max(0, Math.round((wx / TILE_HALF_W - stagger) / 2)));
        const cx = (2 * col + stagger) * TILE_HALF_W;
        const cy = clampedRow * TILE_HALF_H;
        const dist = Math.abs(wx - cx) / TILE_HALF_W + Math.abs(wy - cy) / TILE_HALF_H;
        if (dist < bestDist) {
          bestDist = dist;
          bestCol = col;
          bestRow = clampedRow;
        }
      }
      const cell = bestRow * terrain.width + bestCol;
      const colour = colourOfCell(cell, terrain.typeIds[cell] ?? 0);
      const o = (py * pxW + px) * 4;
      out[o] = (colour >> 16) & 0xff;
      out[o + 1] = (colour >> 8) & 0xff;
      out[o + 2] = colour & 0xff;
      out[o + 3] = 0xff;
    }
  }
  return out;
}

/** Sentinel above any `0xRRGGBB` marking "no lane colour - fall back to the typeId palette". */
export const MINIMAP_CELL_UNRESOLVED = 0x1000000;

/**
 * Mean RGB (`0xRRGGBB`) of a page rect, or undefined for a degenerate/out-of-bounds rect. Fully
 * transparent texels are skipped (page corners outside the pattern's triangles).
 */
export function averagePatternColour(
  rgba: Uint8ClampedArray | Uint8Array,
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

/**
 * The minimap cell-colour precedence: a baked ground-lane colour (below
 * {@link MINIMAP_CELL_UNRESOLVED}) wins, else the per-typeId `colourOfType` fills in. A null or absent
 * colour table degrades every cell to `colourOfType`.
 */
export function cellColourResolver(
  cellColours: ArrayLike<number> | null | undefined,
  colourOfType: (typeId: number) => number,
): (cell: number, typeId: number) => number {
  if (cellColours === null || cellColours === undefined) {
    return (_cell, typeId) => colourOfType(typeId);
  }
  return (cell, typeId) => {
    const colour = cellColours[cell] ?? MINIMAP_CELL_UNRESOLVED;
    return colour < MINIMAP_CELL_UNRESOLVED ? colour : colourOfType(typeId);
  };
}
