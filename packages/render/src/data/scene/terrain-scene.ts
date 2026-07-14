import type { WorldSnapshot } from '@open-northland/sim';
import type { ElevationField } from '../elevation.js';
import { tileToScreen } from '../iso.js';
import type { DrawItem } from './draw-item.js';
import { collectSpriteScene } from './sprite-scene.js';

/**
 * The terrain half of the pure scene layer: the decoded-map grid shapes ({@link SceneTerrain} + its
 * per-triangle {@link SceneGround} / {@link SceneTransitions} lanes), the decoded-map → {@link SceneTerrain}
 * projection, plus the whole-frame headless oracle {@link buildScene} (terrain tiles + sprites in one
 * depth-sorted list).
 */

/**
 * A decoded map's 1:1 per-triangle ground lanes (the `ground` layer of `content/maps/<id>.json`):
 * pattern `EditName`s + each cell's two triangle picks as indices into them. Render-only data — the
 * renderer joins a name through {@link import('../../gpu/terrain-textures.js').TerrainTextureSet.groundFor}.
 */
export interface SceneGround {
  readonly patterns: readonly string[];
  /** Row-major per-cell index into {@link patterns} for triangle A (△ from the cell's centre node
   *  down to the SW/SE-below centres — `../terrain.js` `triangleANodes`). */
  readonly a: readonly number[];
  /** Row-major per-cell index into {@link patterns} for triangle B (▽ across to the E centre —
   *  `../terrain.js` `triangleBNodes`). */
  readonly b: readonly number[];
}

/**
 * A decoded map's per-triangle transition overlays (the `transitions` layer of
 * `content/maps/<id>.json`): the map's `eatd` name dictionary verbatim plus the four `emt1..emt4`
 * per-cell u8 lanes — `a1`/`b1` are layer 1 (topmost) for triangles A/B, `a2`/`b2` layer 2. A lane
 * value `v < 255` selects transition `⌊v/6⌋` from {@link types} and pair variant `v % 6`
 * (`../terrain.js` `transitionRef`); the renderer joins a name through
 * {@link import('../../gpu/terrain-textures.js').TerrainTextureSet.transitionFor}.
 */
export interface SceneTransitions {
  readonly types: readonly string[];
  readonly a1: readonly number[];
  readonly b1: readonly number[];
  readonly a2: readonly number[];
  readonly b2: readonly number[];
}

/** The terrain grid the snapshot is positioned over (dimensions + row-major landscape typeIds). */
export interface SceneTerrain {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell, length `width*height`. */
  readonly typeIds: readonly number[];
  /** The 1:1 per-triangle ground patterns, when the map carries them (a decoded original map). */
  readonly ground?: SceneGround;
  /** The per-triangle transition overlays (`emt1..emt4` + `eatd`), when the map carries them. */
  readonly transitions?: SceneTransitions;
  /**
   * The decoded map's per-cell `lmhe` terrain height (row-major, length `width*height`, 0..~250), when
   * present. The renderer builds an {@link import('../elevation.js').ElevationField} from it to lift the
   * ground mesh + every projected item; absent → flat (no lift). Render-only data — the sim never reads it.
   */
  readonly elevation?: readonly number[];
  /**
   * The decoded map's per-cell `embr` baked shading (row-major, length `width*height`, u8 with 127 =
   * neutral), when present. The ground mesh consumes it per fragment (luminance × value/127 sampled
   * from an R8 lane texture — slope light/shadow plus the fade-to-black map border); absent →
   * unshaded. Landscape objects shade separately at their anchor cell via an app-built
   * {@link import('../brightness.js').BrightnessField} (trees exempt — the measured split; see
   * `data/brightness.ts`); buildings/settlers are unmeasured and unshaded. Render-only data — the
   * sim never reads it.
   */
  readonly brightness?: readonly number[];
}

/**
 * Terrain tiles sort among themselves back-to-front (ascending row), shifted into a band strictly below
 * every sprite depth (sprite depths are ≥ 0 world rows; tiles negative) — so ground never paints over a
 * sprite even at the largest map.
 */
const TILE_DEPTH_BASE = -1_000_000;

/**
 * Project a loaded terrain map (the `{ width, height, typeIds }` shape `parseTerrainMap` validates a
 * `content/maps/<id>.json` into — a cell-resolution grid, the sim-side `CellTerrainMap` shape, not
 * the half-cell `TerrainMap` the nav graph consumes) onto the {@link SceneTerrain} the scene layer
 * draws.
 *
 * It only re-views the (read-only) grid as the render shape, asserting nothing the loader already
 * enforced (the data-package zod schema pins `typeIds.length === width*height`). The
 * optional lanes accept an explicit `undefined` (zod's `.optional()` infers `T | undefined`) — the
 * body spreads them conditionally either way.
 */
export function terrainMapToScene(map: {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
  readonly ground?: SceneGround | undefined;
  readonly transitions?: SceneTransitions | undefined;
  readonly elevation?: readonly number[] | undefined;
  readonly brightness?: readonly number[] | undefined;
}): SceneTerrain {
  return {
    width: map.width,
    height: map.height,
    typeIds: map.typeIds,
    ...(map.ground !== undefined ? { ground: map.ground } : {}),
    ...(map.transitions !== undefined ? { transitions: map.transitions } : {}),
    ...(map.elevation !== undefined ? { elevation: map.elevation } : {}),
    ...(map.brightness !== undefined ? { brightness: map.brightness } : {}),
  };
}

/**
 * Build the depth-sorted isometric draw list for a frame.
 *
 * Ordering:
 *  1. Tiles are emitted in row-major (back-to-front) order and carry a depth below every sprite, so
 *     no sprite is ever hidden by ground drawn after it.
 *  2. Sprites sort by feet anchor = ascending world `(y, x)` (a settler lower/further-right on the
 *     map occludes one behind it). The sort key is the float tile `y` (the feet), with `x` then
 *     entity `id` as deterministic tie-breaks so the order is total and stable.
 *
 * Pure: a function of the snapshot + grid only, so the screenshot harness gets a reproducible frame.
 *
 * The live render path is {@link import('../../gpu/world-renderer.js').WorldRenderer}, which projects
 * terrain itself and consumes {@link import('./sprite-scene.js').buildSpriteScene} (sprites only);
 * `buildScene` is the headless oracle for the projection + depth-ordering it must match. Known
 * divergence: the renderer's painter key is the feet-anchor screen y (∝ row under the staggered
 * raster, so static map objects interleave correctly), while this oracle's sprite key is row-major
 * `(tileY, tileX)` — the two orders differ for items more than a row apart on one screen band. The
 * terrain-projection duplication with the GPU terrain layer is deliberate: both share the
 * `terrain.ts` helpers, so they can't silently diverge.
 */
export function buildScene(
  snapshot: WorldSnapshot,
  terrain: SceneTerrain,
  elevation?: ElevationField,
): DrawItem[] {
  const tiles: DrawItem[] = [];
  // Terrain: one tile per cell, row-major (y outer, x inner) = back-to-front in iso space.
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
      // Ascending row is back-to-front: under the staggered raster, diamonds interlock only across
      // rows, and a same-row pair never overlaps.
      depth: TILE_DEPTH_BASE + row,
      typeId,
    });
  }

  // Stable, total order: tiles (all negative depth) ahead of sprites, sprites by (y, x, id).
  return [...tiles, ...collectSpriteScene(snapshot, { elevation }).items];
}
