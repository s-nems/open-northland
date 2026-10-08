import { halfCellToScreen } from '@open-northland/render';
import { formationNodes, pairBySpace } from '@open-northland/sim';
import type { Tile } from '../picking.js';

/**
 * Pure formation assignment: one group move order becomes per-unit destination nodes on the half-cell
 * lattice, preserving nearby neighbours when pairing the army with its destination layout.
 */

export interface FormationOrder {
  readonly ref: number;
  readonly tile: Tile;
}

/** A group member at its world-px feet anchor. */
export interface FormationUnit {
  readonly ref: number;
  readonly x: number;
  readonly y: number;
}

/**
 * `count` distinct nodes clustered around `target`, spiralling outward by square (Chebyshev) ring and
 * collected nearest-first, skipping nodes outside `[0,width) x [0,height)` or reported `blocked`. On the
 * half-cell lattice a ring-1 slot is 34/19 px away, matching the observed packing density of the
 * original. Military rows use spacing 2, giving 34×38 px instead of 34×19 px between feet anchors.
 * The ring order is fixed, so the same click always yields the same slots.
 */
export function formationTiles(
  target: Tile,
  count: number,
  width: number,
  height: number,
  blocked: (col: number, row: number) => boolean,
  rowSpacing: 1 | 2 = 1,
): Tile[] {
  return formationNodes({ hx: target.col, hy: target.row }, count, width, height, blocked, rowSpacing).map(
    ({ hx, hy }) => ({ col: hx, row: hy }),
  );
}

/**
 * The pairing of `n` units to `n` slots minimising the total of `cost[unit][slot]`: Hungarian assignment
 * (Kuhn-Munkres with dual potentials), O(n^3) over the precomputed n x n matrix. Returns
 * `slotOf[unit] = slot`, with an equal-cost tie resolving to the lower index. Throws on a malformed or
 * non-finite matrix, which would silently corrupt the dual potentials.
 */
function minTotalCostPairing(cost: ReadonlyArray<ReadonlyArray<number>>): number[] {
  const n = cost.length;
  for (const row of cost) {
    if (row.length !== n) throw new Error('formation pairing: cost matrix must be square');
    for (const c of row) {
      if (!Number.isFinite(c)) throw new Error('formation pairing: costs must be finite');
    }
  }
  // 1-based arrays, with index 0 the algorithm's virtual "unmatched" column: `unitOnSlot[j]` seats a
  // unit on slot j, `u`/`v` are the dual potentials, `way[j]` the alternating-path back-pointer.
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
 * Above this group size the O(n^3) optimal pairing would visibly stall the click handler: 500 units is
 * about 1.25e8 inner steps, while the cap costs about 2.7e7 matrix reads. Bigger groups use spatial
 * partition pairing, which preserves neighbourhoods in O(n log² n).
 */
const OPTIMAL_PAIRING_MAX_UNITS = 300;

/**
 * Assign each unit a slot around `target`. Small groups minimise total squared travel; larger groups
 * pair corresponding spatial partitions so nearby units remain nearby rather than folding into the
 * centre in distance-to-target order. Returns fewer orders than units only when the ground is
 * too boxed-in to seat everyone, in which case the nearest units march and the surplus stands.
 */
export function assignFormation(
  units: readonly FormationUnit[],
  target: Tile,
  width: number,
  height: number,
  blocked: (col: number, row: number) => boolean,
  rowSpacing: 1 | 2 = 1,
): FormationOrder[] {
  return pairFormation(
    units,
    target,
    formationTiles(target, units.length, width, height, blocked, rowSpacing),
  );
}

/** Pair an already validated destination group, keeping terrain components separate at the caller. */
export function pairFormation(
  units: readonly FormationUnit[],
  target: Tile,
  availableSlots: readonly Tile[],
): FormationOrder[] {
  const slots = availableSlots.slice(0, units.length);
  if (slots.length === 0) return [];

  const t = halfCellToScreen(target.col, target.row);
  const d2 = (u: FormationUnit): number => (u.x - t.x) ** 2 + (u.y - t.y) ** 2;

  // Too boxed-in to seat everyone, so the units nearest the target take the slots.
  let movers = [...units];
  if (movers.length > slots.length) {
    movers.sort((a, b) => d2(a) - d2(b) || a.ref - b.ref);
    movers = movers.slice(0, slots.length);
  }

  if (movers.length > OPTIMAL_PAIRING_MAX_UNITS) {
    return spatialPairing(movers, slots);
  }

  // Built once: the pairing search reads these n^2 cells O(n^3) times.
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

/** Pair corresponding spatial partitions of the army and its slots ({@link pairBySpace}). */
function spatialPairing(units: readonly FormationUnit[], slots: readonly Tile[]): FormationOrder[] {
  const assigned = pairBySpace(
    units.map((unit) => ({ key: unit.ref, x: unit.x, y: unit.y })),
    slots.map((slot, index) => ({ ...halfCellToScreen(slot.col, slot.row), key: index })),
  );
  return units.flatMap((unit) => {
    const tile = slots[assigned.get(unit.ref) ?? -1];
    return tile === undefined ? [] : [{ ref: unit.ref, tile }];
  });
}
