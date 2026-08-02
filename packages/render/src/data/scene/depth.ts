import { depthKey } from '../projection/index.js';
import type { DrawKind } from './draw-item.js';

/**
 * Same-anchor sprite depth: the one home of the "who paints in front at a shared feet anchor"
 * decision. Two composed keys share the bias table below, {@link spriteDepth} for the headless
 * oracle's row-major list order and {@link screenDepth} for the live painter's `zIndex`, so the two
 * orders cannot drift.
 */

/**
 * Same-feet-anchor paint priority per drawable kind - a higher value draws later (in front) when two
 * sprites resolve to (nearly) the same depth. A worker stands on the resource cell it harvests and a
 * delivery flag sits on the ground drops piling up around it, so without a tiebreak the taller node/drop
 * paints over the unit/flag by mere attach order. Each composed key scales it by its own sub-cell
 * epsilon - orders of magnitude below one row's depth separation - so it only breaks ties at a shared
 * anchor and never reorders sprites a genuine row apart. `tile` is 0 (tiles carry their own sub-zero
 * depth band).
 */
const SPRITE_PAINT_ORDER: Readonly<Record<DrawKind, number>> = {
  tile: 0,
  resource: 0,
  berrybush: 0, // a bush sits behind the settler foraging it, like a resource node
  stump: 0,
  building: 1,
  grounddrop: 1,
  signpost: 1, // the post occludes like a small building; its boards ride the flag half-step above it
  stockpile: 2,
  settler: 3,
  projectile: 4, // an arrow in flight crosses over the fighters it flies between
};

/**
 * Extra fractional paint-order step a delivery flag gets above a plain `stockpile` heap on the same
 * tile. A flag and the goods heaps it collects are both `stockpile` kind (same
 * {@link SPRITE_PAINT_ORDER}), so the kind bias alone ties them - and since the flag is created first
 * (lowest id) the id tiebreak would bury it under the later heap. Half a paint step lifts the flag
 * just past a co-located heap; `2 + 0.5` sits below `settler`'s `3`, so a worker on the tile still
 * draws in front.
 */
const FLAG_PAINT_STEP = 0.5;

/** The same-feet-anchor paint bias of a draw item - the kind's {@link SPRITE_PAINT_ORDER} plus the
 *  extra {@link FLAG_PAINT_STEP} for a delivery flag - as a unitless order value. */
function paintOrderBias(kind: DrawKind, isFlag: boolean): number {
  return SPRITE_PAINT_ORDER[kind] + (isFlag ? FLAG_PAINT_STEP : 0);
}

/**
 * Oracle depth packing. A sprite's sort key is `tileY * ROW_STRIDE + tileX`, so the integer-tile
 * `y` dominates and `x` orders within a row - valid only while `tileX < ROW_STRIDE`, which holds for
 * any sane map (sim positions stay well under ~2^25 tiles; real maps are a few hundred). Terrain tiles
 * sit in a band shifted strictly below every sprite (see {@link import('./terrain-scene.js')}).
 */
const ROW_STRIDE = 4096;

/** Depth added per {@link paintOrderBias} step in the oracle sort key. `< 1 / maxOrder` so the whole
 *  bias stays under one tile-column (base depths differ by ≥ 1 across cells) and can't cross a cell. */
const PAINT_ORDER_EPS = 1 / 16;

/** The oracle depth key for a sprite at integer-tile `(tileX, tileY)` (x-first, like `tileToScreen`):
 *  the row-major feet-anchor packing (`tileY` dominates, `tileX` orders within a row) plus the
 *  sub-cell paint-order tiebreak. */
export function spriteDepth(tileX: number, tileY: number, kind: DrawKind, isFlag = false): number {
  return tileY * ROW_STRIDE + tileX + paintOrderBias(kind, isFlag) * PAINT_ORDER_EPS;
}

/**
 * Screen-px depth added per {@link paintOrderBias} step in the live painter key. Comfortably above the
 * `depthKey` x-tiebreak's max contribution (so the kind order wins at a shared feet anchor) yet far below
 * one iso row's screen-y gap (so it never lifts a sprite past one a genuine row behind/ahead of it).
 */
const SCREEN_PAINT_EPS = 0.25;

/** The live painter's `zIndex` for a feet anchor at projected `(x, y)` px: the screen-space
 *  {@link depthKey} plus the sub-row paint-order tiebreak, {@link spriteDepth}'s screen twin. */
export function screenDepth(x: number, y: number, kind: DrawKind, isFlag = false): number {
  return depthKey(x, y) + paintOrderBias(kind, isFlag) * SCREEN_PAINT_EPS;
}

/**
 * How far below its caster's {@link depthKey} a tall object's cast shadow sorts. The original blits a
 * shadow immediately before its caster, so the shadow draws over sprites behind the caster but under
 * the caster itself. Half a {@link SCREEN_PAINT_EPS} kind-bias step: above `depthKey`'s max x-tiebreak
 * contribution (~0.07 on a 1024-tile-wide map) so the pair can't interleave, and below one whole step
 * so the shadow never
 * drops behind a genuinely earlier sprite.
 */
export const SHADOW_DEPTH_EPS = SCREEN_PAINT_EPS / 2;
