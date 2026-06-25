import type { WorldSnapshot } from '@vinland/sim';
import { ONE, tileToScreen } from './index.js';

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
}

/** The terrain grid the snapshot is positioned over (dimensions + row-major landscape typeIds). */
export interface SceneTerrain {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell, length `width*height`. */
  readonly typeIds: readonly number[];
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
    sprites.push({
      kind,
      ref: entity.id,
      x: screen.x,
      y: screen.y,
      // Feet-anchor depth: lower (greater y), then further-right (greater x), then id. A total order,
      // so the sort is deterministic regardless of snapshot iteration nuances.
      depth: tileY * ROW_STRIDE + tileX,
    });
  }

  // Stable, total order: tiles (all negative depth) ahead of sprites, sprites by (y, x, id). The
  // entity-id tie-break makes two sprites on the exact same tile order deterministically.
  sprites.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return [...tiles, ...sprites];
}
