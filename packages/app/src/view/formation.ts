import { halfCellToScreen } from '@open-northland/render';
import type { Tile } from './picking.js';

/**
 * Pure FORMATION assignment — turning one group move order (a clicked target node + the units' on-screen
 * feet anchors) into per-unit destination nodes that spread into the target's vicinity without the paths
 * crossing. No DOM, no Pixi, no sim: plain geometry over the half-cell node lattice, unit-tested headless
 * (see `packages/app/test/formation.test.ts`). The controller (`view/unit-controls.ts`) reads the mouse
 * and turns each {@link FormationOrder} into a `moveUnit` command; the picking inverse that produces the
 * clicked {@link Tile} lives beside this in `view/picking.ts`.
 */

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
 * `count` distinct NODES clustered around `target`, spiralling outward by square (Chebyshev) ring so a
 * group sent to one point spreads into the VICINITY of it instead of all stacking on the single clicked
 * node. On the half-cell lattice a ring-1 slot is 34/19 px away — matching the OBSERVED packing
 * density of the original (no readable formation code; the lattice pitch is the data-pinned part).
 * Slots are collected nearest-first (ring 0 = the target itself, then the 8 nodes of ring 1, then
 * ring 2's 16, …), each kept only if it is in `[0,width)×[0,height)` (NODE dims) and `blocked(col,row)`
 * is false (an occupied/unwalkable node is skipped). A single-unit order (`count === 1`) returns just
 * the target node when it is free, so one unit still goes EXACTLY where clicked. Deterministic + pure
 * (no DOM/sim) — unit-tested like the rest of the picking math; the ring order is fixed, so the same
 * click always yields the same slots.
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

  const t = halfCellToScreen(target.col, target.row);
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
  const slotPts = slots.map((slot) => halfCellToScreen(slot.col, slot.row));
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
