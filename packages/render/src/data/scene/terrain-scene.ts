import type { WorldSnapshot } from '@open-northland/sim';
import { tileToScreen } from '../projection/index.js';
import type { ElevationField } from '../terrain/index.js';
import type { DrawItem } from './draw-item.js';
import { collectSpriteScene } from './sprite-scene.js';

/**
 * A decoded map's 1:1 per-triangle ground lanes (the `ground` layer of `content/maps/<id>.json`):
 * pattern `EditName`s plus each cell's two triangle picks as indices into them.
 */
export interface SceneGround {
  readonly patterns: readonly string[];
  /** Row-major per-cell index into {@link patterns} for triangle A (△ from the cell's centre node
   *  down to the SW/SE-below centres - `../terrain/tessellation.js` `triangleANodes`). */
  readonly a: readonly number[];
  /** Row-major per-cell index into {@link patterns} for triangle B (▽ across to the E centre -
   *  `../terrain/tessellation.js` `triangleBNodes`). */
  readonly b: readonly number[];
}

/**
 * A decoded map's per-triangle transition overlays (the `transitions` layer of
 * `content/maps/<id>.json`): the map's `eatd` name dictionary verbatim plus the four `emt1..emt4`
 * per-cell u8 lanes - `a1`/`b1` are layer 1 (topmost) for triangles A/B, `a2`/`b2` layer 2. A lane
 * value `v < 255` selects transition `⌊v/6⌋` from {@link types} and pair variant `v % 6`
 * (`../terrain/transitions.js` `transitionRef`).
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
   * present. It lifts the ground mesh and every projected item; absent → flat.
   */
  readonly elevation?: readonly number[];
  /**
   * The decoded map's per-cell `embr` baked shading (row-major, length `width*height`, u8 with 127 =
   * neutral), when present. The ground mesh consumes it per fragment as luminance × value/127 - slope
   * light and shadow plus the fade-to-black map border; absent → unshaded.
   */
  readonly brightness?: readonly number[];
}

/**
 * Terrain tiles sort among themselves back-to-front by ascending row, in a band strictly below every
 * sprite depth (sprite depths are ≥ 0 world rows), so ground never paints over a sprite.
 */
const TILE_DEPTH_BASE = -1_000_000;

/**
 * Re-view a loaded cell-resolution terrain map as the render shape, asserting nothing the loader's
 * schema already enforced (`typeIds.length === width*height`). The optional lanes accept an explicit
 * `undefined`, since zod's `.optional()` infers `T | undefined`.
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
 * The headless oracle for the projection and depth ordering the live renderer must match: a pure
 * function of the snapshot and grid, so the screenshot harness gets a reproducible frame.
 *
 * Known divergence: the renderer's painter key is the feet-anchor screen y (∝ row under the staggered
 * raster, so static map objects interleave correctly), while this oracle's sprite key is row-major
 * `(tileY, tileX)`. The two orders differ for items more than a row apart on one screen band.
 */
export function buildScene(
  snapshot: WorldSnapshot,
  terrain: SceneTerrain,
  elevation?: ElevationField,
): DrawItem[] {
  const tiles: DrawItem[] = [];
  // One tile per cell, row-major, which is back-to-front in iso space.
  for (let cell = 0; cell < terrain.typeIds.length; cell++) {
    const typeId = terrain.typeIds[cell];
    if (typeId === undefined) continue; // unreachable (cell < length) - satisfies noUncheckedIndexedAccess
    const col = cell % terrain.width;
    const row = Math.floor(cell / terrain.width);
    const screen = tileToScreen(col, row);
    tiles.push({
      kind: 'tile',
      ref: cell,
      x: screen.x,
      y: screen.y,
      // Under the staggered raster, diamonds interlock only across rows: a same-row pair never
      // overlaps, so ascending row is back-to-front.
      depth: TILE_DEPTH_BASE + row,
      typeId,
    });
  }

  // Stable, total order: tiles (all negative depth) ahead of sprites, sprites by (y, x, id).
  return [...tiles, ...collectSpriteScene(snapshot, { elevation }).items];
}
