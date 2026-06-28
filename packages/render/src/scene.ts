import type { WorldSnapshot } from '@vinland/sim';
import { ONE, TILE_HALF_H, TILE_HALF_W, tileToScreen } from './index.js';

/**
 * The PURE scene-building layer — the part of rendering an agent CAN self-verify.
 *
 * It turns a {@link WorldSnapshot} (+ the terrain grid dimensions) into a flat, **depth-sorted**
 * list of draw items in isometric screen space. No Pixi, no canvas, no GPU: this is plain data the
 * GPU layer (the un-self-verifiable pixel half, deferred to a human) walks in order. Keeping the
 * projection + depth-sort here means the load-bearing render logic — *which* item draws *where* and
 * *in what order* — is unit-testable without a screen (see test/scene.test.ts).
 *
 * Why floats are fine here: this is `render`, a pure consumer of sim state (docs/ARCHITECTURE.md).
 * The sim stays fixed-point; render reads the snapshot's `Fixed` position (a scaled integer) and
 * divides by ONE to a float tile coordinate. Nothing here feeds back into the sim.
 */

/**
 * Depth-packing constants. A sprite's sort key is `tileY * ROW_STRIDE + tileX`, so the integer-tile
 * `y` dominates and `x` orders within a row — valid only while `tileX < ROW_STRIDE`, which holds for
 * any sane map (sim positions stay well under ~2^25 tiles; real maps are a few hundred). Tiles sit in
 * a band shifted strictly below every sprite (`TILE_DEPTH_BASE`), so ground never paints over a
 * sprite even at the largest map.
 */
const ROW_STRIDE = 4096;
const TILE_DEPTH_BASE = -1_000_000;

/** Kinds of thing the scene draws, in their natural layer grouping. */
export type DrawKind = 'tile' | 'building' | 'settler' | 'resource';

/**
 * A sprite's coarse logical state, the join key onto a per-state animation binding (the original's
 * `tribetypes` `setatomic` maps an atomic → its animation; a settler walking shows the walk bob, one
 * mid-swing the chop bob). Derived purely from the snapshot's components — `CurrentAtomic` ⇒ `acting`
 * (and the atomic's numeric id rides along as {@link DrawItem.atomicId} so a binding can pick the
 * *specific* action's frame), else a live `PathFollow` ⇒ `moving`, else `idle`. Buildings/resources
 * are always `idle` (they don't animate per-state in this slice). This is the render-side reading of
 * sim state the roadmap calls "animation playback driven by each entity's logical state"; it never
 * re-enters the sim.
 */
export type SpriteState = 'idle' | 'moving' | 'acting';

/**
 * One item to draw, already projected to isometric screen space (before the camera transform). The
 * GPU layer draws these in array order; `depth` is the sort key it was ordered by (kept for debug /
 * stable-sort proofs). Floats are deliberate (render-only).
 */
export interface DrawItem {
  readonly kind: DrawKind;
  /** Source entity id, or the cell id for a terrain tile (so a click can map a pixel back). */
  readonly ref: number;
  /** Isometric screen position of the item's anchor (tile centre for tiles; feet for sprites). */
  readonly x: number;
  readonly y: number;
  /** The world-space sort key the item was ordered by (see {@link buildScene}). */
  readonly depth: number;
  /** For a terrain tile: its landscape typeId, so the GPU layer can pick the tile sprite. */
  readonly typeId?: number;
  /** For a sprite: its coarse logical state, so a per-state binding can pick the right frame. */
  readonly state?: SpriteState;
  /** For an `acting` sprite: the numeric atomic id it's executing (the `setatomic` join key). */
  readonly atomicId?: number;
  /**
   * For an `acting` sprite: whole ticks executed in its current atomic so far — the sim's
   * `CurrentAtomic.elapsed`. The animation clock for an action: a directional binding advances its
   * swing one frame every `ticksPerFrame` of these ticks, a FIXED cadence — so every action animates at
   * the same speed (a 15-tick chop and a 4-tick deposit step frames identically), and a swing plays its
   * full cycle because the action's duration is tuned to a whole number of cycles. Omitted when idle.
   */
  readonly elapsed?: number;
  /**
   * For a settler: its facing direction index (0..7) — the screen-space heading a directional
   * animation binding indexes by. The Cultures human bob layout is `0 NW, 1 W, 2 SW, 3 S` (toward the
   * camera), `4 SE, 5 E, 6 NE, 7 N` (away). Derived from the live {@link readFacing} heading; omitted
   * when the settler isn't moving (the binding then falls back to {@link DEFAULT_FACING}).
   */
  readonly facing?: number;
}

/** The terrain grid the snapshot is positioned over (dimensions + row-major landscape typeIds). */
export interface SceneTerrain {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell, length `width*height`. */
  readonly typeIds: readonly number[];
}

/**
 * Project a loaded terrain map (the `{ width, height, typeIds }` shape `parseTerrainMap` validates a
 * `content/maps/<id>.json` into, structurally a sim `TerrainMap`) onto the {@link SceneTerrain} the
 * scene layer draws. This is the typed seam from a **real decoded map** to the renderer: the app/shot
 * entry loads a map file, validates it through `@vinland/data`, and feeds the result here — so the
 * same render line that draws the synthetic grass strip draws an actual decoded grid.
 *
 * Pure + total: it only re-views the (read-only) grid as the render shape, asserting nothing the
 * loader already enforced (the data-package zod schema pins `typeIds.length === width*height`). The
 * map's landscape typeIds carry straight through — the GPU layer tints each tile by typeId — so a
 * real multi-terrain map renders its varied ground, not a uniform fill.
 */
export function terrainMapToScene(map: {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
}): SceneTerrain {
  return { width: map.width, height: map.height, typeIds: map.typeIds };
}

/**
 * The snapshot's `Position` component value, as plain data (Fixed = a scaled integer). Mirrors the
 * sim component; redeclared here so `render` doesn't reach into sim internals for a 2-field shape.
 */
interface PositionValue {
  x: number;
  y: number;
}

function readPosition(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Position as PositionValue | undefined;
  if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  return p;
}

/** Classify a snapshot entity by which marker component it carries (terrain tiles are separate). */
function classify(components: Readonly<Record<string, unknown>>): DrawKind | null {
  if ('Building' in components) return 'building';
  if ('Resource' in components) return 'resource';
  if ('Settler' in components) return 'settler';
  return null; // an entity with a Position but no drawable marker is skipped (e.g. a pure mover)
}

/**
 * The atomic id a snapshot entity is mid-execution on, or `null`. Reads only the `atomicId` field of
 * the (plain-cloned) `CurrentAtomic` component — the same numeric id the sim stores as the `setatomic`
 * animation join key. Total: a missing/malformed component reads as "not acting".
 */
function readActingAtomic(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { atomicId?: unknown } | undefined;
  if (a === undefined || typeof a.atomicId !== 'number') return null;
  return a.atomicId;
}

/**
 * The whole ticks the settler has executed in its current atomic — the sim's `CurrentAtomic.elapsed`
 * (a plain integer, no fixed-point rescale). The action's animation clock: a directional swing advances
 * at a fixed cadence over these ticks, so its speed never depends on the action's duration. Returns
 * `null` when not mid-atomic. Pure read of plain snapshot data (no sim re-entry).
 */
function readAtomicElapsed(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { elapsed?: unknown } | undefined;
  if (a === undefined || typeof a.elapsed !== 'number') return null;
  return a.elapsed;
}

/**
 * Map the angle of a settler's screen-space movement vector onto the bob layout's facing-direction
 * index, so the sprite faces the way it walks. The `CR_Hum_Body` direction layout (read off the decoded
 * frames) runs: 0 NW, 1 W, 2 SW, 3 S (toward the camera), 4 SE, 5 E, 6 NE, 7 N (away). `atan2(sy, sx)`
 * runs from screen-East with y pointing *down*, so each +45° of θ steps the index back by one from
 * `225°/45° = 5` at θ=0 (East) — hence `(225° − θ) / 45°` rounded and wrapped. So walking +col (screen
 * down-right) reads SE (4), −col (up-left) reads NW (0): the sprite faces its heading.
 */
function screenVecToDir(sx: number, sy: number): number {
  const deg = (Math.atan2(sy, sx) * 180) / Math.PI;
  return ((Math.round((225 - deg) / 45) % 8) + 8) % 8;
}

/**
 * One {@link PathFollow} waypoint, as plain snapshot data (Fixed = scaled int). Redeclared here so
 * `render` doesn't import the sim component shape for a 2-field read.
 */
interface WaypointValue {
  x: number;
  y: number;
}

/**
 * Derive a settler's facing direction index (0..7) from its live heading: the vector from its current
 * position to the {@link PathFollow} waypoint it is walking toward, projected into screen space (the
 * iso 2:1 aspect via {@link tileToScreen}'s half-extents) and snapped to the nearest of 8 directions.
 * Returns `undefined` when there is no movement to read a heading from (no path, or already on the
 * waypoint) — the binding then falls back to a default facing. The Fixed scale is common to both
 * points, so it cancels in the direction; only the *ratio* matters. Pure read of plain snapshot data.
 */
function readFacing(components: Readonly<Record<string, unknown>>): number | undefined {
  const pf = components.PathFollow as { waypoints?: unknown; index?: unknown } | undefined;
  const pos = readPosition(components);
  if (pf === undefined || pos === null || !Array.isArray(pf.waypoints)) return undefined;
  const idx = typeof pf.index === 'number' ? pf.index : 0;
  const wp = pf.waypoints[idx] as WaypointValue | undefined;
  if (wp === undefined || typeof wp.x !== 'number' || typeof wp.y !== 'number') return undefined;
  const dCol = wp.x - pos.x;
  const dRow = wp.y - pos.y;
  if (dCol === 0 && dRow === 0) return undefined; // already there — no heading
  return screenVecToDir((dCol - dRow) * TILE_HALF_W, (dCol + dRow) * TILE_HALF_H);
}

/**
 * Derive a sprite's coarse {@link SpriteState} from its snapshot components, in priority order:
 * mid-atomic (`CurrentAtomic`) ⇒ `acting`, else following a path (`PathFollow`) ⇒ `moving`, else
 * `idle`. Acting wins over moving because a settler that started an atomic has stopped to act even if
 * a stale path lingers. Pure read of plain snapshot data — never re-enters the sim.
 */
function readSpriteState(components: Readonly<Record<string, unknown>>): SpriteState {
  if (readActingAtomic(components) !== null) return 'acting';
  if ('PathFollow' in components) return 'moving';
  return 'idle';
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
 */
export function buildScene(snapshot: WorldSnapshot, terrain: SceneTerrain): DrawItem[] {
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
      // Tiles sort among themselves back-to-front (col+row), shifted into a band strictly below
      // every sprite depth (sprite depths are >= 0 world rows; tiles are negative).
      depth: TILE_DEPTH_BASE + (col + row),
      typeId,
    });
  }

  const sprites: DrawItem[] = [];
  for (const entity of snapshot.entities) {
    const kind = classify(entity.components);
    if (kind === null) continue;
    const pos = readPosition(entity.components);
    if (pos === null) continue;
    // Fixed (scaled int) -> float tile coordinate. Render-only; never re-enters the sim.
    const tileX = pos.x / ONE;
    const tileY = pos.y / ONE;
    const screen = tileToScreen(tileX, tileY);
    // Only settlers animate per-state in this slice; a building/resource is always idle. When acting,
    // carry the atomic id so a per-state binding can pick the specific action's frame (the `setatomic`
    // join key); otherwise it's omitted under exactOptionalPropertyTypes.
    const state: SpriteState = kind === 'settler' ? readSpriteState(entity.components) : 'idle';
    const actingAtomic = kind === 'settler' ? readActingAtomic(entity.components) : null;
    const elapsed = kind === 'settler' ? readAtomicElapsed(entity.components) : null;
    const facing = kind === 'settler' ? readFacing(entity.components) : undefined;
    sprites.push({
      kind,
      ref: entity.id,
      x: screen.x,
      y: screen.y,
      // Feet-anchor depth: lower (greater y), then further-right (greater x), then id. A total order,
      // so the sort is deterministic regardless of snapshot iteration nuances.
      depth: tileY * ROW_STRIDE + tileX,
      state,
      ...(actingAtomic !== null ? { atomicId: actingAtomic } : {}),
      ...(elapsed !== null ? { elapsed } : {}),
      ...(facing !== undefined ? { facing } : {}),
    });
  }

  // Stable, total order: tiles (all negative depth) ahead of sprites, sprites by (y, x, id). The
  // entity-id tie-break makes two sprites on the exact same tile order deterministically.
  sprites.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return [...tiles, ...sprites];
}
