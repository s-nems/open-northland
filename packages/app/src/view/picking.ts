import {
  badgeAnchor,
  type Camera,
  type DoorBadge,
  type DrawItem,
  type ElevationField,
  type EntityBounds,
  hitsGarrisonFlag,
  signRowAt,
  TILE_HALF_H,
  TILE_HALF_W,
} from '@open-northland/render';

/**
 * Pure picking math: the screen to world to half-cell-node inverse of the render projection, plus the
 * point and box hit tests over on-screen targets. World px are pre-camera, the space a `DrawItem.x/y`
 * lives in; nodes are the sim's `2W x 2H` lattice.
 */

/** A pickable on-screen target: an entity id + its world-space feet anchor (a `DrawItem.x/y`). */
export interface Pickable {
  readonly ref: number;
  readonly x: number;
  readonly y: number;
  /** The drawable kind, so a click hit-box can be sized per kind when exact bounds aren't available. */
  readonly kind?: 'settler' | 'building' | 'signpost' | 'chest';
  /** Exact rendered sprite bounds in world px; absent off-screen or without a renderer, which falls back
   *  to the kind box. */
  readonly box?: EntityBounds | undefined;
  /**
   * Solid-texel refinement of a box hit; `undefined` means no exact answer, so the box verdict stands.
   * Wired for buildings, whose box swallows transparent corner; settlers keep the generous box.
   */
  readonly pixelHit?: ((wx: number, wy: number) => boolean | undefined) | undefined;
}

/**
 * Whether a drawn item is something the cursor can be over: a fog ghost is a remembered static rather
 * than the live entity, a portrait-only item was force-drawn through the frame's culls, and a worker
 * drawn at its craft is scenery inside its workshop - it stands over the house's own anchor, so
 * targeting it would take every click and marquee meant for the workshop.
 */
export function isHitTarget(item: DrawItem): boolean {
  return item.ghost !== true && item.portraitOnly !== true && item.inHouse !== true;
}

/** A half-cell node coordinate (integer col,row on the `2W×2H` lattice), the target of a move order. */
export interface Tile {
  readonly col: number;
  readonly row: number;
}

/** Invert the camera: a screen-px point to the world-px point under it. */
export function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  const scale = camera.scale ?? 1;
  return { x: (sx - camera.offsetX) / scale, y: (sy - camera.offsetY) / scale };
}

/**
 * Invert the flat half-cell projection: `halfCellToScreen(col,row) = (col*HALF_W, row*HALF_H/2)` is a
 * rectangular lattice, so the inverse is an independent half-up rounding per axis.
 */
function worldToTileFlat(wx: number, wy: number): Tile {
  return { col: Math.round(wx / TILE_HALF_W), row: Math.round(wy / (TILE_HALF_H / 2)) };
}

/** Correction passes the elevation-aware inverse takes before giving up; it also stops once the estimate settles. */
const PICK_ELEVATION_PASSES = 8;

/**
 * Invert the projection to the tile drawn under a world-px point. Ground for cell `(col,row)` is drawn at
 * `y = projected_y - liftAt(col,row)`, and the lift cannot be known before the cell, so the flat inverse
 * is iterated to a fixed point.
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

/** Clamp a tile to `[0,width) x [0,height)`, so a click off the map still yields a legal cell. */
export function clampTile(tile: Tile, width: number, height: number): Tile {
  return {
    col: Math.max(0, Math.min(width - 1, tile.col)),
    row: Math.max(0, Math.min(height - 1, tile.row)),
  };
}

/**
 * The half-cell node bounds of a cell map: cell `(c, r)` owns the 2x2 node block `(2c..2c+1, 2r..2r+1)`,
 * so the node grid spans `[0, 2*cells)` per axis. The app-side owner of that convention.
 */
export function nodeBounds(mapSize: { readonly width: number; readonly height: number }): {
  width: number;
  height: number;
} {
  return { width: mapSize.width * 2, height: mapSize.height * 2 };
}

/** The node band covering an inclusive cell range; each cell contributes its whole 2x2 node block. */
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
 * Half-width, upward and downward reach (world px) of the fallback click box around a target's feet
 * anchor; a standing sprite reaches further up than down. Approximation: generous click-usability
 * magnitudes, not the per-type footprint.
 */
const PICK_BOX = {
  settler: { halfW: 18, up: 42, down: 12 },
  building: { halfW: 44, up: 104, down: 22 },
  // The guidepost bob is 22x72 native px; a slim box keeps it clickable without swallowing the ground beside it.
  signpost: { halfW: 14, up: 76, down: 8 },
  // The magical chest bob is 78x53 native px, the wooden one smaller; the larger sizes the box.
  chest: { halfW: 39, up: 53, down: 10 },
} as const;

function hits(t: Pickable, wx: number, wy: number): boolean {
  const inBox =
    t.box !== undefined
      ? wx >= t.box.minX && wx <= t.box.maxX && wy >= t.box.minY && wy <= t.box.maxY
      : boxFallbackHit(t, wx, wy);
  if (!inBox) return false;
  return t.pixelHit?.(wx, wy) ?? true;
}

function boxFallbackHit(t: Pickable, wx: number, wy: number): boolean {
  const box = PICK_BOX[t.kind ?? 'settler'];
  return Math.abs(wx - t.x) <= box.halfW && wy >= t.y - box.up && wy <= t.y + box.down;
}

/**
 * The topmost target under a world-px point, or `null` if none. Frontmost wins (largest screen `y` is
 * drawn last), tie-broken by the higher entity id, so a click resolves to what a human sees on top.
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
 * The settler whose door-badge sign row sits under a world-px point, or `null` if none. Overlapping
 * stacks tie-break on the BUILDING's projected `y`, the key the badge layer sorts drawn stacks by;
 * tiebreaking on the post would hand the click to a chain the front house paints over.
 */
export function pickDoorBadgeRow(
  badges: readonly DoorBadge[],
  wx: number,
  wy: number,
  elevation?: ElevationField,
): number | null {
  let best: number | null = null;
  let bestY = Number.NEGATIVE_INFINITY;
  for (const badge of badges) {
    if (badge.rows.length === 0) continue;
    const anchor = badgeAnchor(badge, elevation);
    const row = signRowAt(badge.rows.length, wx - anchor.x, wy - anchor.y);
    if (row === null) continue;
    const settler = badge.rows[row]?.settler;
    if (settler === undefined) continue;
    if (anchor.depthY > bestY) {
      best = settler;
      bestY = anchor.depthY;
    }
  }
  return best;
}

/**
 * The building whose garrison flag sits under a world-px point, or `null` if none. The flag picks its
 * building: it hangs some 230 px above the tower's own pick box, so a click through it would otherwise
 * land on empty ground.
 */
export function pickGarrisonFlag(
  badges: readonly DoorBadge[],
  wx: number,
  wy: number,
  elevation?: ElevationField,
): number | null {
  let best: number | null = null;
  let bestY = Number.NEGATIVE_INFINITY;
  for (const badge of badges) {
    const { mast, depthY } = badgeAnchor(badge, elevation);
    if (mast === undefined || depthY <= bestY) continue;
    if (!hitsGarrisonFlag(wx - mast.x, wy - mast.y)) continue;
    best = badge.id;
    bestY = depthY;
  }
  return best;
}

/**
 * Every target whose feet anchor falls inside the world-px rectangle `(x0,y0)-(x1,y1)`, corners in any
 * order. Anchor-in-box is the RTS rule: a unit is grabbed when its centre is boxed, not when the box
 * merely clips its sprite. Ids come back in input order.
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
