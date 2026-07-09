import type { WorldSnapshot } from '@vinland/sim';
import type { ElevationField } from '../elevation.js';
import { tileToScreen } from '../iso.js';
import type { DrawItem, SceneGround, SceneTerrain } from './draw-item.js';
import { collectSpriteScene } from './sprite-scene.js';

/**
 * The terrain half of the pure scene layer: the decoded-map → {@link SceneTerrain} projection, plus the
 * whole-frame headless oracle {@link buildScene} (terrain tiles + sprites in one depth-sorted list).
 */

/**
 * Terrain tiles sort among themselves back-to-front (ascending row), shifted into a band strictly below
 * every sprite depth (sprite depths are ≥ 0 world rows; tiles negative) — so ground never paints over a
 * sprite even at the largest map.
 */
const TILE_DEPTH_BASE = -1_000_000;

/**
 * Project a loaded terrain map (the `{ width, height, typeIds }` shape `parseTerrainMap` validates a
 * `content/maps/<id>.json` into — a CELL-resolution grid, the sim-side `CellTerrainMap` shape, NOT
 * the half-cell `TerrainMap` the nav graph consumes) onto the {@link SceneTerrain} the scene layer
 * draws. This is the typed seam from a **real decoded map** to the renderer: the app/shot entry
 * loads a map file, validates it through `@vinland/data`, and feeds the result here — so the same
 * render line that draws the synthetic grass strip draws an actual decoded grid.
 *
 * Pure + total: it only re-views the (read-only) grid as the render shape, asserting nothing the
 * loader already enforced (the data-package zod schema pins `typeIds.length === width*height`). The
 * map's landscape typeIds carry straight through — the GPU layer tints each tile by typeId — so a
 * real multi-terrain map renders its varied ground, not a uniform fill. The optional lanes accept
 * an explicit `undefined` (zod's `.optional()` infers `T | undefined`) — the body spreads them
 * conditionally either way.
 */
export function terrainMapToScene(map: {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
  readonly ground?: SceneGround | undefined;
  readonly elevation?: readonly number[] | undefined;
  readonly brightness?: readonly number[] | undefined;
}): SceneTerrain {
  return {
    width: map.width,
    height: map.height,
    typeIds: map.typeIds,
    ...(map.ground !== undefined ? { ground: map.ground } : {}),
    ...(map.elevation !== undefined ? { elevation: map.elevation } : {}),
    ...(map.brightness !== undefined ? { brightness: map.brightness } : {}),
  };
}

/**
 * Build the depth-sorted isometric draw list for a frame.
 *
 * Ordering — the core correctness property a human eyeball would otherwise have to catch:
 *  1. **Terrain first, always behind sprites.** Tiles are emitted in row-major (back-to-front) order
 *     and carry a depth below every sprite, so no sprite is ever hidden by ground drawn after it.
 *  2. **Sprites sorted by feet anchor** = ascending world `(y, x)` (a settler lower/further-right on
 *     the map occludes one behind it). The sort key is the float tile `y` (the feet), with `x` then
 *     entity `id` as deterministic tie-breaks so the order is total and stable.
 *
 * Pure: a function of the snapshot + grid only. The same snapshot always yields the same list — the
 * determinism that lets the screenshot harness produce a reproducible frame.
 *
 * NOTE: the live render path is {@link import('../../gpu/world-renderer.js').WorldRenderer}, which
 * projects terrain itself and consumes {@link import('./sprite-scene.js').buildSpriteScene} (sprites
 * only) — it no longer calls `buildScene`. `buildScene` is retained as the **headless oracle** for the
 * projection + depth-ordering the renderer must match (its tests pin back-to-front terrain +
 * feet-anchor sprite order that a Pixi renderer can't easily unit-test).
 * KNOWN DIVERGENCE: the live renderer's painter key is the feet-anchor SCREEN y (∝ row under the
 * staggered raster, so static map objects interleave correctly), while this oracle's sprite key is row-major
 * `(tileY, tileX)` — the two orders differ for items more than a row apart on one screen band. The
 * terrain-projection duplication between here and the GPU terrain layer is deliberate — they share the
 * `terrain.ts` helpers, so they can't silently diverge.
 */
export function buildScene(
  snapshot: WorldSnapshot,
  terrain: SceneTerrain,
  elevation?: ElevationField,
): DrawItem[] {
  const tiles: DrawItem[] = [];
  // Terrain: one tile per cell, row-major (y outer, x inner) = back-to-front in iso space. Its depth
  // is forced below any sprite (negative world-space band) so ground never paints over a sprite.
  for (let cell = 0; cell < terrain.typeIds.length; cell++) {
    const typeId = terrain.typeIds[cell];
    if (typeId === undefined) continue; // unreachable (cell < length) — satisfies noUncheckedIndexedAccess
    const col = cell % terrain.width;
    const row = Math.floor(cell / terrain.width);
    const screen = tileToScreen(col, row);
    tiles.push({
      kind: 'tile',
      ref: cell,
      x: screen.x,
      y: screen.y,
      // Tiles sort among themselves back-to-front (ascending row — under the staggered raster,
      // diamonds interlock only across rows, and a same-row pair never overlaps), shifted into a
      // band strictly below every sprite depth.
      depth: TILE_DEPTH_BASE + row,
      typeId,
    });
  }

  // Stable, total order: tiles (all negative depth) ahead of sprites, sprites by (y, x, id).
  return [...tiles, ...collectSpriteScene(snapshot, undefined, elevation).items];
}
