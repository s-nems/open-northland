import { type Camera, type EntityBounds, TILE_HALF_H, TILE_HALF_W, tileToScreen } from '@vinland/render';

/**
 * Pure PICKING math — the screen→world→tile inverse of the render projection, plus the point/box
 * hit-tests the selection controller runs over the on-screen units. No DOM, no Pixi, no sim: plain
 * geometry, so it is unit-tested headless (see `packages/app/test/picking.test.ts`) exactly like the
 * render-side `viewport.ts` cull math. The controller (`view/unit-controls.ts`) is the impure half that
 * reads the mouse and calls these.
 *
 * Three coordinate spaces (mirroring `render`): screen/canvas px → WORLD px (pre-camera, what
 * `tileToScreen` and a `DrawItem.x/y` live in) → TILE (col,row). The camera transform is
 * `screen = world*scale + offset`, so its inverse is `world = (screen - offset)/scale`.
 */

/** A pickable on-screen target: an entity id + its WORLD-space feet anchor (a `DrawItem.x/y`). */
export interface Pickable {
  readonly ref: number;
  readonly x: number;
  readonly y: number;
  /** The drawable kind, so a click hit-box can be sized per kind when exact bounds aren't available. */
  readonly kind?: 'settler' | 'building';
  /**
   * The entity's EXACT rendered sprite bounds (world px), from the renderer's per-entity bounds. When
   * present the hit test uses this box — so a click anywhere on the actual graphic selects, a big building
   * getting a big box and a small one a small box. Absent (off-screen / no renderer) → the kind fallback.
   */
  readonly box?: EntityBounds | undefined;
}

/** A tile coordinate (integer col,row), the target of a move order. */
export interface Tile {
  readonly col: number;
  readonly row: number;
}

/**
 * Invert the camera: a screen/canvas-px point → the WORLD-px point under it. The exact inverse the
 * camera controller uses to zoom toward the cursor (`world = (screen - offset)/scale`).
 */
export function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  const scale = camera.scale ?? 1;
  return { x: (sx - camera.offsetX) / scale, y: (sy - camera.offsetY) / scale };
}

/**
 * Invert the staggered-raster projection: a WORLD-px point → the tile (col,row) whose interlocking
 * diamond contains it. `tileToScreen(col,row) = ((2·col + (row&1))·HALF_W, row·HALF_H)`; rows overlap
 * (a diamond spans ±HALF_H, a full row step each way), so the point's row band admits three candidate
 * rows — for each, the nearest column on that row's parity is scored by the diamond norm
 * `|dx|/HALF_W + |dy|/HALF_H` (≤ 1 inside a diamond) and the closest wins. Deterministic: strict
 * `<` keeps the lowest candidate row on the knife-edge of a shared diamond edge.
 */
export function worldToTile(wx: number, wy: number): Tile {
  const rowGuess = Math.round(wy / TILE_HALF_H);
  let best: Tile = { col: 0, row: 0 };
  let bestD = Number.POSITIVE_INFINITY;
  for (const row of [rowGuess - 1, rowGuess, rowGuess + 1]) {
    const parity = row & 1;
    const col = Math.round((wx / TILE_HALF_W - parity) / 2);
    const dx = Math.abs(wx - (2 * col + parity) * TILE_HALF_W) / TILE_HALF_W;
    const dy = Math.abs(wy - row * TILE_HALF_H) / TILE_HALF_H;
    const d = dx + dy;
    if (d < bestD) {
      best = { col, row };
      bestD = d;
    }
  }
  return best;
}

/** Clamp a tile to the map bounds `[0,width) × [0,height)` (a click off the map still yields a legal cell). */
export function clampTile(tile: Tile, width: number, height: number): Tile {
  return {
    col: Math.max(0, Math.min(width - 1, tile.col)),
    row: Math.max(0, Math.min(height - 1, tile.row)),
  };
}

/**
 * Horizontal half-width / upward / downward reach (WORLD px) of a target's clickable box around its feet
 * anchor. A standing sprite's body extends UP from the feet, so the box reaches further up than down —
 * a click on the body (not just the feet) still selects. In world px, so it scales with zoom for free.
 * A **building** is a much larger, taller sprite than a settler, so a settler-sized box makes it nearly
 * unclickable (only a pixel at the base registers); it gets a generous box so a click anywhere on the
 * house body selects it. (Fixed magnitudes, not the exact per-type footprint — a click-usability box,
 * generous by design; a footprint-accurate box is a later refinement.)
 */
const PICK_BOX = {
  settler: { halfW: 18, up: 42, down: 12 },
  building: { halfW: 44, up: 104, down: 22 },
} as const;

/** Whether a WORLD-px point falls within a target's clickable area: its exact sprite {@link Pickable.box}
 *  when known, else its feet-anchored kind fallback box ({@link PICK_BOX}). */
function hits(t: Pickable, wx: number, wy: number): boolean {
  if (t.box !== undefined) {
    return wx >= t.box.minX && wx <= t.box.maxX && wy >= t.box.minY && wy <= t.box.maxY;
  }
  const box = PICK_BOX[t.kind === 'building' ? 'building' : 'settler'];
  return Math.abs(wx - t.x) <= box.halfW && wy >= t.y - box.up && wy <= t.y + box.down;
}

/**
 * The topmost target under a WORLD-px point, or `null` if none. A target is hit when the point falls in
 * its clickable area ({@link hits}: the exact sprite bounds when known, else a per-kind fallback box);
 * among hits the FRONTMOST wins (largest screen `y` = drawn last = on top), tie-broken by the higher
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
 * A move target for one unit in a group order — the unit's entity id + the tile it should walk to.
 * The controller turns each into a `moveUnit` command; a single-unit order yields one entry aimed at
 * the clicked tile exactly (the array-of-one case of {@link assignFormation}).
 */
export interface FormationOrder {
  readonly ref: number;
  readonly tile: Tile;
}

/**
 * A group of units at these WORLD-px feet anchors — the input the formation assigner keeps together so
 * the nearest unit takes the nearest slot (no criss-cross). Just the fields {@link assignFormation} needs.
 */
export interface FormationUnit {
  readonly ref: number;
  readonly x: number;
  readonly y: number;
}

/**
 * `count` distinct tiles clustered around `target`, spiralling outward by square (Chebyshev) ring so a
 * group sent to one point spreads into the VICINITY of it instead of all stacking on the single clicked
 * cell. Tiles are collected nearest-first (ring 0 = the target itself, then the 8 cells of ring 1, then
 * ring 2's 16, …), each kept only if it is in `[0,width)×[0,height)` and `blocked(col,row)` is false (an
 * occupied/unwalkable
 * cell is skipped). A single-unit order (`count === 1`) returns just the target tile when it is free, so
 * one unit still goes EXACTLY where clicked. Deterministic + pure (no DOM/sim) — unit-tested like the
 * rest of the picking math; the ring order is fixed, so the same click always yields the same slots.
 */
export function formationTiles(
  target: Tile,
  count: number,
  width: number,
  height: number,
  blocked: (col: number, row: number) => boolean,
): Tile[] {
  const out: Tile[] = [];
  const inBounds = (c: number, r: number): boolean => c >= 0 && c < width && r >= 0 && r < height;
  const take = (c: number, r: number): void => {
    if (out.length < count && inBounds(c, r) && !blocked(c, r)) out.push({ col: c, row: r });
  };
  // Spiral out ring by ring (Chebyshev radius) until we have `count` tiles or run out of room to search.
  const maxRadius = Math.max(width, height);
  for (let radius = 0; out.length < count && radius <= maxRadius; radius++) {
    if (radius === 0) {
      take(target.col, target.row);
      continue;
    }
    // The ring's border cells, walked clockwise from the top edge — a fixed, history-independent order.
    for (let dc = -radius; dc <= radius; dc++) take(target.col + dc, target.row - radius); // top edge
    for (let dr = -radius + 1; dr <= radius; dr++) take(target.col + radius, target.row + dr); // right edge
    for (let dc = radius - 1; dc >= -radius; dc--) take(target.col + dc, target.row + radius); // bottom edge
    for (let dr = radius - 1; dr >= -radius + 1; dr--) take(target.col - radius, target.row + dr); // left edge
  }
  return out;
}

/**
 * Assign each unit in `units` to one {@link formationTiles} slot around `target`, greedily pairing the
 * slot nearest the target with the still-unassigned unit nearest THAT slot — so the group keeps its
 * shape and units don't cross paths to reach the cluster. A single unit is aimed at the target tile
 * exactly. Returns one {@link FormationOrder} per assignable unit (fewer than `units.length` only if the
 * area around the target is too boxed-in to seat everyone; the surplus units get no order). Pure: the
 * distance tie-break is by ascending unit id, so the pairing is deterministic.
 */
export function assignFormation(
  units: readonly FormationUnit[],
  target: Tile,
  width: number,
  height: number,
  blocked: (col: number, row: number) => boolean,
): FormationOrder[] {
  const slots = formationTiles(target, units.length, width, height, blocked);
  const remaining = new Set(units.map((u) => u.ref));
  const byRef = new Map(units.map((u) => [u.ref, u] as const));
  const orders: FormationOrder[] = [];
  for (const slot of slots) {
    // World-px centre of the slot tile, to measure each candidate unit's distance to it.
    const { x: sx, y: sy } = tileToScreen(slot.col, slot.row);
    let best: number | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const ref of remaining) {
      const u = byRef.get(ref);
      if (u === undefined) continue;
      const d = (u.x - sx) ** 2 + (u.y - sy) ** 2;
      if (d < bestD || (d === bestD && (best === null || ref < best))) {
        best = ref;
        bestD = d;
      }
    }
    if (best === null) break; // no units left to seat
    remaining.delete(best);
    orders.push({ ref: best, tile: slot });
  }
  return orders;
}

/**
 * Every target whose feet anchor falls inside the WORLD-px rectangle `(x0,y0)-(x1,y1)` (corners in any
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
