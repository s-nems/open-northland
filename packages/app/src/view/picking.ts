import {
  type Camera,
  type ElevationField,
  type EntityBounds,
  TILE_HALF_H,
  TILE_HALF_W,
  tileToScreen,
} from '@vinland/render';

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
 * Invert the FLAT staggered-raster projection (no elevation): a WORLD-px point → the tile (col,row)
 * whose interlocking diamond contains it. `tileToScreen(col,row) = ((2·col + (row&1))·HALF_W,
 * row·HALF_H)`; rows overlap (a diamond spans ±HALF_H, a full row step each way), so the point's row
 * band admits three candidate rows — for each, the nearest column on that row's parity is scored by the
 * diamond norm `|dx|/HALF_W + |dy|/HALF_H` (≤ 1 inside a diamond) and the closest wins. Deterministic:
 * strict `<` keeps the lowest candidate row on the knife-edge of a shared diamond edge.
 */
function worldToTileFlat(wx: number, wy: number): Tile {
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

/**
 * How many correction passes the elevation-aware inverse takes before giving up. The renderer lifts a
 * cell's ground UP by `LIFT·elev` (up to ~7–8 rows on a tall map), so the flat inverse lands rows below
 * the clicked hilltop; each pass re-samples the current guess's lift and re-solves, converging to the
 * cell actually drawn under the cursor. A handful of passes reaches a fixed point for real terrain
 * (smooth slopes); the loop also breaks as soon as the estimate stops moving.
 */
const PICK_ELEVATION_PASSES = 8;

/**
 * Invert the projection to the tile drawn under a WORLD-px point, accounting for the elevation lift. The
 * renderer draws cell `(col,row)`'s ground at `y = projected_y − liftAt(col,row)`, so a click at screen
 * `wy` sits on ground whose UNLIFTED `y` is `wy + lift`. We can't know the lift without the cell, so we
 * iterate: estimate the cell with the flat inverse, sample ITS lift, add it back, re-solve — a fixed
 * point (the 2-pass the design calls for, iterated so steep slopes still round-trip). Without a field
 * (or a flat one) this is exactly {@link worldToTileFlat}. Pure + deterministic.
 */
export function worldToTile(wx: number, wy: number, elevation?: ElevationField): Tile {
  if (elevation === undefined || elevation.maxLift === 0) return worldToTileFlat(wx, wy);
  let guess = worldToTileFlat(wx, wy);
  for (let pass = 0; pass < PICK_ELEVATION_PASSES; pass++) {
    // At the integer cell the bilinear sampler returns that cell's own lift exactly (edge-clamped for an
    // out-of-bounds guess), so this re-solve targets the ground the renderer actually lifted.
    const lift = elevation.liftAt(guess.col, guess.row);
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
 * The pairing of `n` units to `n` slots that minimises the TOTAL of `cost[unit][slot]` over the
 * group — the Hungarian assignment algorithm (Kuhn–Munkres with dual potentials), O(n³) on the
 * precomputed n×n matrix. Returns `slotOf[unit] = slot`. Deterministic: fixed iteration order, an
 * equal-cost tie always resolving to the lower index. Throws on a malformed or non-finite matrix —
 * an ∞/NaN cost would silently corrupt the dual potentials (and can even unbound the search), so a
 * loud failure is strictly better. (The `?? 0` fallbacks on the internal arrays only satisfy the
 * unchecked-index rule — every index is in bounds by construction.)
 */
function minTotalCostPairing(cost: ReadonlyArray<ReadonlyArray<number>>): number[] {
  const n = cost.length;
  for (const row of cost) {
    if (row.length !== n) throw new Error('formation pairing: cost matrix must be square');
    for (const c of row) {
      if (!Number.isFinite(c)) throw new Error('formation pairing: costs must be finite');
    }
  }
  // 1-based arrays; index 0 is the algorithm's virtual "unmatched" column. unitOnSlot[j] is the unit
  // currently seated on slot j; u/v the dual potentials; way[j] the alternating-path back-pointer.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const unitOnSlot = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    unitOnSlot[0] = i;
    let j0 = 0;
    const minReduced = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const visited = new Array<boolean>(n + 1).fill(false);
    do {
      visited[j0] = true;
      const i0 = unitOnSlot[j0] ?? 0; // ≥ 1 inside the loop: slot 0 always holds the current unit
      const rowCosts = cost[i0 - 1];
      if (rowCosts === undefined) throw new Error('formation pairing: unit index out of range');
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (visited[j] === true) continue;
        const reduced = (rowCosts[j - 1] ?? 0) - (u[i0] ?? 0) - (v[j] ?? 0);
        if (reduced < (minReduced[j] ?? Number.POSITIVE_INFINITY)) {
          minReduced[j] = reduced;
          way[j] = j0;
        }
        const m = minReduced[j] ?? Number.POSITIVE_INFINITY;
        if (m < delta) {
          delta = m;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (visited[j] === true) {
          const seated = unitOnSlot[j] ?? 0;
          u[seated] = (u[seated] ?? 0) + delta;
          v[j] = (v[j] ?? 0) - delta;
        } else {
          minReduced[j] = (minReduced[j] ?? 0) - delta;
        }
      }
      j0 = j1;
    } while (unitOnSlot[j0] !== 0);
    // Unwind the alternating path, re-seating each hop's unit onto the next slot.
    while (j0 !== 0) {
      const j1 = way[j0] ?? 0;
      unitOnSlot[j0] = unitOnSlot[j1] ?? 0;
      j0 = j1;
    }
  }
  const slotOf = new Array<number>(n).fill(0);
  for (let j = 1; j <= n; j++) slotOf[(unitOnSlot[j] ?? 1) - 1] = j - 1;
  return slotOf;
}

/**
 * Above this group size the O(n³) optimal pairing would visibly stall the click handler (500 units
 * ≈ 1.25×10⁸ inner steps); at the cap it is ~2.7×10⁷ matrix reads — a few ms, imperceptible on a
 * click. Bigger groups fall back to radial rank pairing (k-th nearest unit → k-th spiral slot),
 * which is O(n log n) and close enough at a scale where individual slot choice can't be seen anyway.
 */
const OPTIMAL_PAIRING_MAX_UNITS = 300;

/**
 * Assign each unit in `units` to one {@link formationTiles} slot around `target` by the pairing that
 * minimises the group's TOTAL SQUARED travel ({@link minTotalCostPairing}). Squared distance penalises
 * one long march harder than two short ones, so the group TRANSLATES instead of shuffling: no two
 * assigned paths cross, units that differ along an axis keep their order along that axis, and
 * ordering a parked cluster back the way it came doesn't swap the front units into the rear slots
 * (a rank-based pairing mixed its axes exactly there; the old nearest-unit-per-slot greedy shuffled
 * even a straight line). A single unit is aimed at the target tile exactly (the nearest free tile
 * when the clicked one is blocked). Returns one {@link FormationOrder} per seatable unit — fewer
 * than `units.length` only when the ground around the target is too boxed-in to seat everyone; then
 * the units nearest the target march and the surplus keeps standing. Pure and deterministic. Groups
 * beyond {@link OPTIMAL_PAIRING_MAX_UNITS} use the radial fallback so a click never stalls the UI.
 */
export function assignFormation(
  units: readonly FormationUnit[],
  target: Tile,
  width: number,
  height: number,
  blocked: (col: number, row: number) => boolean,
): FormationOrder[] {
  const slots = formationTiles(target, units.length, width, height, blocked);
  if (slots.length === 0) return [];

  const t = tileToScreen(target.col, target.row);
  const d2 = (u: FormationUnit): number => (u.x - t.x) ** 2 + (u.y - t.y) ** 2;

  // Too boxed-in to seat everyone: the units nearest the target take the slots, the rest stay put.
  let movers = [...units];
  if (movers.length > slots.length) {
    movers.sort((a, b) => d2(a) - d2(b) || a.ref - b.ref);
    movers = movers.slice(0, slots.length);
  }

  if (movers.length > OPTIMAL_PAIRING_MAX_UNITS) {
    // Army-scale fallback: the k-th unit by distance-to-target takes the k-th spiral slot
    // (nearest-first by construction) — radially order-preserving, no O(n³) stall.
    const byDist = [...movers].sort((a, b) => d2(a) - d2(b) || a.ref - b.ref);
    const orders: FormationOrder[] = [];
    for (let i = 0; i < byDist.length; i++) {
      const unit = byDist[i];
      const slot = slots[i];
      if (unit === undefined || slot === undefined) break; // equal lengths by construction
      orders.push({ ref: unit.ref, tile: slot });
    }
    return orders;
  }

  // The n×n cost matrix ONCE (n² cells) — the pairing search reads it O(n³) times.
  const slotPts = slots.map((slot) => tileToScreen(slot.col, slot.row));
  const cost = movers.map((u) => slotPts.map((s) => (u.x - s.x) ** 2 + (u.y - s.y) ** 2));
  const slotOf = minTotalCostPairing(cost);
  const orders: FormationOrder[] = [];
  for (let i = 0; i < movers.length; i++) {
    const unit = movers[i];
    const slot = slots[slotOf[i] ?? -1];
    if (unit === undefined || slot === undefined) continue; // unreachable: pairing is a permutation
    orders.push({ ref: unit.ref, tile: slot });
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
