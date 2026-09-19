import { depthKey } from '../projection/index.js';
import type { DrawKind } from './draw-item.js';

/**
 * Same-feet-anchor paint priority per drawable kind - a higher value draws in front when two sprites
 * resolve to nearly the same depth. Both {@link spriteDepth} and {@link screenDepth} scale this one
 * table by their own sub-cell epsilon, so it only breaks ties at a shared anchor and never reorders
 * sprites a genuine row apart. `tile` is 0; tiles carry their own sub-zero depth band.
 */
const SPRITE_PAINT_ORDER: Readonly<Record<DrawKind, number>> = {
  tile: 0,
  fish: 0,
  resource: 0,
  berrybush: 0, // a bush sits behind the settler foraging it, like a resource node
  stump: 0,
  chest: 0, // a chest sits behind the settler opening it, like a resource node
  building: 1,
  palisade: 1,
  grounddrop: 1,
  signpost: 1, // the post occludes like a small building
  stockpile: 2,
  // A staged effect (the cauldron's fire and smoke, the forge's flame) sits on the house and its piles but
  // behind the worker tending it: every extracted program lists its overlays before its first walk, and
  // the schema reads that file order as depth.
  craftfx: 2.5,
  settler: 3,
  vehicle: 3, // a cart and its crewman share a feet row; the id tiebreak orders them
  projectile: 4, // an arrow in flight crosses over the fighters it flies between
};

/**
 * Extra paint-order step lifting a delivery flag above a heap on the same tile. Both are `stockpile`
 * kind, so the kind bias ties them and the id tiebreak would bury the earlier-created flag under the
 * later heap. Half a step stays below `settler`'s `3`, so a worker on the tile still draws in front.
 */
const FLAG_PAINT_STEP = 0.5;

function paintOrderBias(kind: DrawKind, isFlag: boolean): number {
  return SPRITE_PAINT_ORDER[kind] + (isFlag ? FLAG_PAINT_STEP : 0);
}

/**
 * The original paints a frame in passes, each finished before the next begins: the still landscape
 * (`GfxStatic` records), then the fish, then one row-sorted pass of everything else. So a fish never
 * shows over a hull, and nothing standing on a bridge deck is buried by it. Basis: the `GfxStatic` key
 * of the readable landscape table, whose records all keep their sprite inside their own blocked area,
 * so nothing can stand behind one. The pass order itself is a lead from the macOS build's draw routine,
 * not checked against the running original. The waves' pass between the two is not modelled: they draw
 * with the flat decor, under all three.
 */
export type DrawPass = 'ground' | 'fish' | 'sorted';

/** Wider than any map's depth range in either key (the oracle's tops out at `ROW_STRIDE` squared), so a
 *  pass keeps its own row order and never interleaves with the next. */
const PASS_BAND = 2 ** 25;

const PASS_DEPTH: Readonly<Record<DrawPass, number>> = {
  ground: -2 * PASS_BAND,
  fish: -PASS_BAND,
  sorted: 0,
};

/** The depth offset that files a key into `pass`. */
export function drawPassDepth(pass: DrawPass): number {
  return PASS_DEPTH[pass];
}

/** A depth under every pass, for the ground tiles' own band. */
export const UNDER_EVERY_PASS = -3 * PASS_BAND;

function kindPassDepth(kind: DrawKind): number {
  return PASS_DEPTH[kind === 'fish' ? 'fish' : 'sorted'];
}

/** Row stride of the oracle sort key `tileY * ROW_STRIDE + tileX`, valid only while
 *  `tileX < ROW_STRIDE` (real maps are a few hundred tiles wide). */
const ROW_STRIDE = 4096;

/** Depth added per paint-order step in the oracle key. `< 1 / maxOrder`, so the whole bias stays under
 *  one tile column (base depths differ by ≥ 1 across cells) and can't cross a cell. */
const PAINT_ORDER_EPS = 1 / 16;

export function spriteDepth(tileX: number, tileY: number, kind: DrawKind, isFlag = false): number {
  return kindPassDepth(kind) + tileY * ROW_STRIDE + tileX + paintOrderBias(kind, isFlag) * PAINT_ORDER_EPS;
}

/** Screen-px depth added per paint-order step in the live painter key. Above `depthKey`'s max
 *  x-tiebreak contribution, so the kind order wins at a shared feet anchor, and far below one iso
 *  row's screen-y gap, so it never lifts a sprite past one a genuine row away. */
const SCREEN_PAINT_EPS = 0.25;

export function screenDepth(x: number, y: number, kind: DrawKind, isFlag = false): number {
  return kindPassDepth(kind) + depthKey(x, y) + paintOrderBias(kind, isFlag) * SCREEN_PAINT_EPS;
}

/**
 * The offset a mark takes to sit beside one sprite without joining the kind order: above `depthKey`'s
 * max x-tiebreak contribution (~0.07 on a 1024-tile-wide map, so the pair can never interleave) and
 * below one whole step, so it never crosses a genuine kind or row boundary.
 */
const HALF_PAINT_STEP = SCREEN_PAINT_EPS / 2;

/** How far above its building a planted door-badge chain sorts - enough to clear the house, still
 *  under `stockpile`, so anything standing in front of the house paints over the chain. */
export const SIGN_DEPTH_EPS = HALF_PAINT_STEP;

/** How far below its caster a tall object's cast shadow sorts. The original blits a shadow immediately
 *  before its caster, so the shadow draws over sprites behind the caster but under the caster itself. */
export const SHADOW_DEPTH_EPS = HALF_PAINT_STEP;
