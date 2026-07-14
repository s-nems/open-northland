import {
  type Camera,
  type ElevationField,
  type EntityBounds,
  TILE_HALF_H,
  TILE_HALF_W,
} from '@open-northland/render';

/**
 * Pure picking math — the screen→world→node inverse of the render projection, plus the point/box
 * hit-tests the selection controller runs over the on-screen units. No DOM, no Pixi, no sim: plain
 * geometry, so it is unit-tested headless (see `packages/app/test/picking.test.ts`) exactly like the
 * render-side `viewport.ts` cull math. The controller (`view/unit-controls/`) is the impure half that
 * reads the mouse and calls these.
 *
 * Three coordinate spaces (mirroring `render`): screen/canvas px → world px (pre-camera, what
 * `tileToScreen` and a `DrawItem.x/y` live in) → half-cell node (col,row on the sim's `2W×2H`
 * lattice — `halfCellToScreen` is its projection, a plain rectangular grid, so the inverse is a
 * per-axis rounding). The camera transform is `screen = world*scale + offset`, so its inverse is
 * `world = (screen - offset)/scale`.
 */

/** A pickable on-screen target: an entity id + its world-space feet anchor (a `DrawItem.x/y`). */
export interface Pickable {
  readonly ref: number;
  readonly x: number;
  readonly y: number;
  /** The drawable kind, so a click hit-box can be sized per kind when exact bounds aren't available. */
  readonly kind?: 'settler' | 'building';
  /**
   * The entity's exact rendered sprite bounds (world px), from the renderer's per-entity bounds. When
   * present the hit test uses this box — so a click anywhere on the actual graphic selects, a big building
   * getting a big box and a small one a small box. Absent (off-screen / no renderer) → the kind fallback.
   */
  readonly box?: EntityBounds | undefined;
  /**
   * Pixel-accurate refinement of the box hit (the renderer's `entityPixelHit`): `true`/`false` = the
   * point does / does not land on a solid texel of the drawn sprite; `undefined` = no exact answer
   * (off-screen, unreadable atlas), so the box verdict stands. Wired for buildings — their box swallows
   * a lot of transparent corner, so a click just next to the house must not select it. Settlers keep
   * the deliberately generous box (a small sprite needs the slack to stay clickable).
   */
  readonly pixelHit?: ((wx: number, wy: number) => boolean | undefined) | undefined;
}

/** A half-cell node coordinate (integer col,row on the `2W×2H` lattice), the target of a move order. */
export interface Tile {
  readonly col: number;
  readonly row: number;
}

/**
 * Invert the camera: a screen/canvas-px point → the world-px point under it. The exact inverse the
 * camera controller uses to zoom toward the cursor (`world = (screen - offset)/scale`).
 */
export function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  const scale = camera.scale ?? 1;
  return { x: (sx - camera.offsetX) / scale, y: (sy - camera.offsetY) / scale };
}

/**
 * Invert the flat half-cell projection (no elevation): a world-px point → the nearest node.
 * `halfCellToScreen(col,row) = (col·HALF_W, row·HALF_H/2)` is a plain rectangular lattice, so the
 * inverse is an independent per-axis rounding — no candidate scoring. Deterministic (`Math.round`
 * half-up on both axes).
 */
function worldToTileFlat(wx: number, wy: number): Tile {
  return { col: Math.round(wx / TILE_HALF_W), row: Math.round(wy / (TILE_HALF_H / 2)) };
}

/**
 * How many correction passes the elevation-aware inverse takes before giving up. The renderer lifts a
 * cell's ground UP by `LIFT·elev` (up to ~7–8 rows on a tall map), so the flat inverse lands rows below
 * the clicked hilltop; each pass re-samples the current guess's lift and re-solves, converging to the
 * cell actually drawn under the cursor. A handful of passes reaches a fixed point for real terrain
 * (smooth slopes); the loop also breaks as soon as the estimate stops moving.
 */
const PICK_ELEVATION_PASSES = 8;

/**
 * Invert the projection to the tile drawn under a world-px point, accounting for the elevation lift. The
 * renderer draws cell `(col,row)`'s ground at `y = projected_y − liftAt(col,row)`, so a click at screen
 * `wy` sits on ground whose unlifted `y` is `wy + lift`. We can't know the lift without the cell, so we
 * iterate: estimate the cell with the flat inverse, sample its lift, add it back, re-solve — a fixed
 * point (the 2-pass the design calls for, iterated so steep slopes still round-trip). Without a field
 * (or a flat one) this is exactly {@link worldToTileFlat}. Pure + deterministic.
 */
export function worldToTile(wx: number, wy: number, elevation?: ElevationField): Tile {
  if (elevation === undefined || elevation.maxLift === 0) return worldToTileFlat(wx, wy);
  let guess = worldToTileFlat(wx, wy);
  for (let pass = 0; pass < PICK_ELEVATION_PASSES; pass++) {
    const lift = elevation.liftAtNode(guess.col, guess.row);
    const next = worldToTileFlat(wx, wy + lift);
    if (next.col === guess.col && next.row === guess.row) return next;
    guess = next;
  }
  return guess;
}

/** Clamp a tile to the map bounds `[0,width) × [0,height)` (a click off the map still yields a legal cell). */
export function clampTile(tile: Tile, width: number, height: number): Tile {
  return {
    col: Math.max(0, Math.min(width - 1, tile.col)),
    row: Math.max(0, Math.min(height - 1, tile.row)),
  };
}

/**
 * The half-cell node bounds of a `width×height`-cell map — cell `(c, r)` owns the 2×2 node block
 * `(2c..2c+1, 2r..2r+1)`, so the node grid spans `[0, 2·cells)` on each axis. The one app-side owner
 * of the cell→node bounds convention (order targeting, tile hit-bounds, overlay bands all derive
 * from it — a caller hand-rolling the ×2 is the bug this helper exists to prevent).
 */
export function nodeBounds(mapSize: { readonly width: number; readonly height: number }): {
  width: number;
  height: number;
} {
  return { width: mapSize.width * 2, height: mapSize.height * 2 };
}

/** The node band covering an inclusive cell range — each cell contributes its whole 2×2 node block
 *  (see {@link nodeBounds} for the convention). */
export function nodeBandOfCells(cells: {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
}): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
  return {
    minCol: cells.minCol * 2,
    maxCol: cells.maxCol * 2 + 1,
    minRow: cells.minRow * 2,
    maxRow: cells.maxRow * 2 + 1,
  };
}

/**
 * Horizontal half-width / upward / downward reach (world px) of a target's clickable box around its feet
 * anchor. A standing sprite's body extends up from the feet, so the box reaches further up than down —
 * a click on the body (not just the feet) still selects. In world px, so it scales with zoom for free.
 * A building is a much larger, taller sprite than a settler, so a settler-sized box makes it nearly
 * unclickable (only a pixel at the base registers); it gets a generous box so a click anywhere on the
 * house body selects it. (Fixed magnitudes, not the exact per-type footprint — a click-usability box,
 * generous by design; a footprint-accurate box is a later refinement.)
 */
const PICK_BOX = {
  settler: { halfW: 18, up: 42, down: 12 },
  building: { halfW: 44, up: 104, down: 22 },
} as const;

/** Whether a world-px point falls within a target's clickable area: its exact sprite {@link Pickable.box}
 *  when known (refined to solid pixels by {@link Pickable.pixelHit} when one is wired), else its
 *  feet-anchored kind fallback box ({@link PICK_BOX}). */
function hits(t: Pickable, wx: number, wy: number): boolean {
  const inBox =
    t.box !== undefined
      ? wx >= t.box.minX && wx <= t.box.maxX && wy >= t.box.minY && wy <= t.box.maxY
      : boxFallbackHit(t, wx, wy);
  if (!inBox) return false;
  // Inside the box: ask the pixel test for the exact verdict; no answer (`undefined`) keeps the box hit.
  return t.pixelHit?.(wx, wy) ?? true;
}

/** The feet-anchored per-kind fallback box test — used when the exact sprite bounds aren't known. */
function boxFallbackHit(t: Pickable, wx: number, wy: number): boolean {
  const box = PICK_BOX[t.kind === 'building' ? 'building' : 'settler'];
  return Math.abs(wx - t.x) <= box.halfW && wy >= t.y - box.up && wy <= t.y + box.down;
}

/**
 * The topmost target under a world-px point, or `null` if none. A target is hit when the point falls in
 * its clickable area ({@link hits}: the exact sprite bounds when known, else a per-kind fallback box);
 * among hits the frontmost wins (largest screen `y` = drawn last = on top), tie-broken by the higher
 * entity id (the later-drawn of two on the same row) — so a click resolves to the thing a human sees on
 * top (a unit standing in front of a building outranks it), the RTS single-click convention.
 */
export function pickTopAt(targets: readonly Pickable[], wx: number, wy: number): number | null {
  let best: number | null = null;
  let bestY = Number.NEGATIVE_INFINITY;
  let bestRef = Number.NEGATIVE_INFINITY;
  for (const t of targets) {
    if (!hits(t, wx, wy)) continue;
    if (t.y > bestY || (t.y === bestY && t.ref > bestRef)) {
      best = t.ref;
      bestY = t.y;
      bestRef = t.ref;
    }
  }
  return best;
}

/**
 * Every target whose feet anchor falls inside the world-px rectangle `(x0,y0)-(x1,y1)` (corners in any
 * order) — the drag-select ("marquee") hit-test. Anchor-in-box is the standard RTS rule: a unit is
 * grabbed when its centre is boxed, not when the box merely clips its sprite. Returns ids in the input
 * order (which the caller keeps canonical by building `targets` from the sorted draw list).
 */
export function pickInRect(
  targets: readonly Pickable[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[] {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const out: number[] = [];
  for (const t of targets) {
    if (t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY) out.push(t.ref);
  }
  return out;
}
