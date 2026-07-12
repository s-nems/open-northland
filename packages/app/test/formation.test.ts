import { halfCellToScreen, tileToScreen } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import { assignFormation, type FormationUnit, formationTiles } from '../src/view/formation.js';
import type { Tile } from '../src/view/picking.js';

const NONE = (): boolean => false;

/**
 * Headless tests for the pure FORMATION math (a group move order → per-unit destination nodes). The
 * agent-verifiable half of group commands — the DOM/mouse controller that calls it is human-judged in
 * the browser. Slots are HALF-CELL nodes on the `2W×2H` lattice; the load-bearing properties are that
 * no two paths cross and the group translates rather than shuffles. The screen→node picking inverse
 * that produces the clicked {@link Tile} is tested in `picking.test.ts`.
 */

describe('formationTiles', () => {
  it('returns exactly the target tile for a single unit (a lone unit goes precisely where clicked)', () => {
    expect(formationTiles({ col: 5, row: 5 }, 1, 20, 20, NONE)).toEqual([{ col: 5, row: 5 }]);
  });

  it('spreads a group to distinct tiles nearest-first around the target (target cell first)', () => {
    const tiles = formationTiles({ col: 5, row: 5 }, 5, 20, 20, NONE);
    expect(tiles).toHaveLength(5);
    expect(tiles[0]).toEqual({ col: 5, row: 5 }); // ring 0 — the clicked cell
    // all distinct, and each within one Chebyshev ring of the target
    const keys = new Set(tiles.map((t) => `${t.col},${t.row}`));
    expect(keys.size).toBe(5);
    for (const t of tiles) expect(Math.max(Math.abs(t.col - 5), Math.abs(t.row - 5))).toBeLessThanOrEqual(1);
  });

  it('skips blocked cells (occupied ground) and keeps searching outward', () => {
    // Block the whole target cell + its 8 neighbours: the first eligible tiles must be on ring 2.
    const blocked = (c: number, r: number): boolean => Math.max(Math.abs(c - 5), Math.abs(r - 5)) <= 1;
    const tiles = formationTiles({ col: 5, row: 5 }, 3, 20, 20, blocked);
    expect(tiles).toHaveLength(3);
    for (const t of tiles) expect(Math.max(Math.abs(t.col - 5), Math.abs(t.row - 5))).toBe(2);
  });

  it('honours map bounds — never returns an off-map tile', () => {
    const tiles = formationTiles({ col: 0, row: 0 }, 6, 4, 4, NONE);
    for (const t of tiles) {
      expect(t.col).toBeGreaterThanOrEqual(0);
      expect(t.row).toBeGreaterThanOrEqual(0);
      expect(t.col).toBeLessThan(4);
      expect(t.row).toBeLessThan(4);
    }
  });
});

describe('assignFormation', () => {
  it('sends one unit exactly to the clicked tile', () => {
    const units: FormationUnit[] = [{ ref: 7, x: 100, y: 100 }];
    expect(assignFormation(units, { col: 3, row: 3 }, 20, 20, NONE)).toEqual([
      { ref: 7, tile: { col: 3, row: 3 } },
    ]);
  });

  it('gives every unit a distinct slot (no two units ordered onto the same tile)', () => {
    const units: FormationUnit[] = Array.from({ length: 8 }, (_, i) => ({
      ref: i + 1,
      x: i * 40,
      y: 0,
    }));
    const orders = assignFormation(units, { col: 6, row: 6 }, 20, 20, NONE);
    expect(orders).toHaveLength(8);
    const tiles = new Set(orders.map((o) => `${o.tile.col},${o.tile.row}`));
    expect(tiles.size).toBe(8); // all distinct
    const refs = new Set(orders.map((o) => o.ref));
    expect(refs.size).toBe(8); // every unit ordered once
  });

  it('keeps a row marching right in order — the rightmost unit takes the rightmost slot', () => {
    // Three units in a west→east row, ordered east: the arrangement must survive the move (no unit
    // crosses the formation), so the slots' screen-x order matches the units' screen-x order.
    const units: FormationUnit[] = [2, 3, 4].map((col, i) => ({
      ref: i + 1,
      ...tileToScreen(col, 5),
    }));
    const orders = assignFormation(units, { col: 10, row: 5 }, 20, 20, NONE);
    expect(orders).toHaveLength(3);
    const slotX = new Map(orders.map((o) => [o.ref, halfCellToScreen(o.tile.col, o.tile.row).x]));
    // Two of the three nearest node slots share a screen column (ring 0 plus the ring-1 node above
    // it), so the order is non-strict — but never inverted, and the extremes stay strictly apart:
    // ref 1 stood leftmost, ref 3 rightmost, and their destinations keep that left-to-right order.
    expect(slotX.get(1)).toBeLessThanOrEqual(slotX.get(2) as number);
    expect(slotX.get(2)).toBeLessThanOrEqual(slotX.get(3) as number);
    expect(slotX.get(1)).toBeLessThan(slotX.get(3) as number);
  });

  it('keeps a column marching right in order — the top unit takes the top slot', () => {
    // Three units stacked north→south, ordered east: lateral (across-the-march) order is preserved.
    const units: FormationUnit[] = [3, 4, 5].map((row, i) => ({
      ref: i + 1,
      ...tileToScreen(3, row),
    }));
    const orders = assignFormation(units, { col: 12, row: 4 }, 20, 20, NONE);
    expect(orders).toHaveLength(3);
    const slotY = new Map(orders.map((o) => [o.ref, halfCellToScreen(o.tile.col, o.tile.row).y]));
    // Two of the three slots share a screen row, so the order is non-strict — but never inverted,
    // and the extremes stay strictly apart: the top unit ends strictly above the bottom one.
    expect(slotY.get(1)).toBeLessThanOrEqual(slotY.get(2) as number);
    expect(slotY.get(2)).toBeLessThanOrEqual(slotY.get(3) as number);
    expect(slotY.get(1)).toBeLessThan(slotY.get(3) as number);
  });

  it('does not shuffle a parked cluster ordered back the way it came — the front unit keeps the front slot', () => {
    // The user-visible reversal artifact: a group parked after an "up" move, ordered back DOWN. The
    // bottom (now front) unit must take the cluster's deepest slot instead of swapping into a rear
    // one, and no unit may end up in front of a unit that started ahead of it.
    const units: FormationUnit[] = [2, 3, 4].map((row, i) => ({
      ref: i + 1,
      ...tileToScreen(5, row),
    }));
    const orders = assignFormation(units, { col: 5, row: 10 }, 20, 20, NONE);
    expect(orders).toHaveLength(3);
    const slotY = new Map(orders.map((o) => [o.ref, halfCellToScreen(o.tile.col, o.tile.row).y]));
    // ref 3 started at the bottom (the march front); it ends strictly deepest.
    expect(slotY.get(3)).toBeGreaterThan(slotY.get(1) as number);
    expect(slotY.get(3)).toBeGreaterThan(slotY.get(2) as number);
  });

  it('seats only the units nearest the target when the ground is too boxed-in for everyone', () => {
    // A 3-wide map column blocks all but 2 tiles around the target: the 2 units nearest the target
    // march, the farthest stays without an order.
    const blocked = (col: number, row: number): boolean => !(row === 0 && (col === 1 || col === 2));
    const units: FormationUnit[] = [8, 4, 2].map((col, i) => ({
      ref: i + 1,
      ...tileToScreen(col, 0),
    }));
    const orders = assignFormation(units, { col: 1, row: 0 }, 20, 20, blocked);
    expect(orders).toHaveLength(2);
    const refs = orders.map((o) => o.ref).sort((a, b) => a - b);
    expect(refs).toEqual([2, 3]); // the two units nearest the target (cols 4 and 2); col 8 stays put
  });

  it('achieves the brute-force minimum total squared travel (optimality cross-check)', () => {
    // The axis-aligned fixtures above have few competitive pairings, so a subtly broken assignment
    // core (a bad dual update or path unwind) could still pass them. Scattered, asymmetric layouts
    // cross-check the returned pairing against every permutation of the same slot set.
    const at = (ref: number, col: number, row: number): FormationUnit => ({
      ref,
      ...tileToScreen(col, row),
    });
    const layouts: FormationUnit[][] = [
      [at(1, 2, 7), at(2, 5, 3), at(3, 3, 4), at(4, 8, 6)],
      [at(1, 1, 1), at(2, 2, 9), at(3, 9, 2), at(4, 7, 7), at(5, 4, 5)],
    ];
    const target = { col: 6, row: 5 };
    const cost = (u: FormationUnit, s: Tile): number => {
      // Slots are node coords — project them exactly as the assigner does.
      const p = halfCellToScreen(s.col, s.row);
      return (u.x - p.x) ** 2 + (u.y - p.y) ** 2;
    };
    const permutations = <T>(items: readonly T[]): T[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, i) =>
            permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
          );
    for (const units of layouts) {
      const orders = assignFormation(units, target, 20, 20, NONE);
      expect(orders).toHaveLength(units.length);
      const byRef = new Map(units.map((u) => [u.ref, u] as const));
      const total = orders.reduce((sum, o) => sum + cost(byRef.get(o.ref) as FormationUnit, o.tile), 0);
      const slots = formationTiles(target, units.length, 20, 20, NONE);
      let best = Number.POSITIVE_INFINITY;
      for (const perm of permutations(slots)) {
        const sum = perm.reduce((s, slot, i) => s + cost(units[i] as FormationUnit, slot), 0);
        if (sum < best) best = sum;
      }
      expect(total).toBe(best);
    }
  });
});
