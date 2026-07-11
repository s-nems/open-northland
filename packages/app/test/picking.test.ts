import { type Camera, halfCellToScreen, makeElevationField, tileToScreen } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import {
  assignFormation,
  clampTile,
  type FormationUnit,
  formationTiles,
  pickInRect,
  pickTopAt,
  screenToWorld,
  type Tile,
  worldToTile,
} from '../src/view/picking.js';

const NONE = (): boolean => false;

/**
 * Headless tests for the pure PICKING math (screen→world→node + the point/box hit-tests). This is the
 * agent-verifiable half of selection — the DOM/mouse controller that calls it is human-judged in the
 * browser. A picked Tile is a HALF-CELL node on the `2W×2H` lattice; the load-bearing property is the
 * round-trip: `worldToTile(halfCellToScreen(t)) === t`, so a click lands on the node a human aimed at.
 */

describe('screenToWorld', () => {
  it('inverts the camera transform (world = (screen - offset)/scale)', () => {
    const camera: Camera = { offsetX: 100, offsetY: 50, scale: 2 };
    expect(screenToWorld(camera, 140, 90)).toEqual({ x: 20, y: 20 });
  });

  it('defaults scale to 1 when the camera omits it', () => {
    expect(screenToWorld({ offsetX: 10, offsetY: 5 }, 30, 25)).toEqual({ x: 20, y: 20 });
  });
});

describe('worldToTile', () => {
  it('is the exact inverse of halfCellToScreen for a range of nodes', () => {
    for (const [col, row] of [
      [0, 0],
      [3, 1],
      [7, 4],
      [12, 0],
      [0, 9],
      [5, 5],
    ] as const) {
      const s = halfCellToScreen(col, row);
      expect(worldToTile(s.x, s.y)).toEqual({ col, row });
    }
  });

  it('resolves a cell centre to its ANCHOR node (2c + (r&1), 2r)', () => {
    // A click on a visual tile's centre lands on the node the sim anchors that cell on.
    const s = tileToScreen(3, 1);
    expect(worldToTile(s.x, s.y)).toEqual({ col: 7, row: 2 });
  });

  it('rounds a point inside a node catchment to that node', () => {
    const centre = halfCellToScreen(9, 5);
    // A few px off-centre (within the node's 34×19 px per-axis rounding catchment) still resolves to (9,5).
    expect(worldToTile(centre.x + 6, centre.y - 3)).toEqual({ col: 9, row: 5 });
  });
});

describe('worldToTile — elevation-aware inverse', () => {
  // Elevation lives on the CELL grid (W×H); node coordinates run 0..2W-1 / 0..2H-1 and sample the
  // field at (col/2, row/2) — the same cell-space point the renderer lifts a node by.
  const W = 20;
  const H = 20;

  /** The screen point the renderer draws node (col,row)'s ground centre at: projected feet lifted up
   *  by the elevation at its cell-space point. `worldToTile` of this must recover (col,row). */
  const liftedCentre = (
    field: ReturnType<typeof makeElevationField>,
    col: number,
    row: number,
  ): { x: number; y: number } => {
    const s = halfCellToScreen(col, row);
    return { x: s.x, y: s.y - field.liftAt(col / 2, row / 2) };
  };

  it('round-trips every node on a STEEP east-rising ramp (lift up to ~15 node rows)', () => {
    // elevation = col·12 → the east edge lifts ~228·1.24 ≈ 282 px ≈ 14.9 node rows above the flat inverse.
    const elev: number[] = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) elev.push(c * 12);
    const field = makeElevationField(elev, W, H);
    for (let row = 1; row < 2 * H - 1; row += 5) {
      for (let col = 1; col < 2 * W - 1; col += 5) {
        const p = liftedCentre(field, col, row);
        expect(worldToTile(p.x, p.y, field)).toEqual({ col, row });
      }
    }
  });

  it('round-trips a hill that varies in BOTH axes (the iterated correction converges)', () => {
    const elev: number[] = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) elev.push(c * 6 + r * 5);
    const field = makeElevationField(elev, W, H);
    for (const [col, row] of [
      [6, 6],
      [20, 17],
      [31, 30],
      [36, 5],
      [3, 36],
    ] as const) {
      const p = liftedCentre(field, col, row);
      expect(worldToTile(p.x, p.y, field)).toEqual({ col, row });
    }
  });

  it('is EXACTLY the flat inverse for a flat field (no elevation lane)', () => {
    const flat = makeElevationField(undefined, W, H);
    for (const [col, row] of [
      [0, 0],
      [14, 8],
      [25, 19],
    ] as const) {
      const s = halfCellToScreen(col, row);
      expect(worldToTile(s.x, s.y, flat)).toEqual(worldToTile(s.x, s.y));
      expect(worldToTile(s.x, s.y, flat)).toEqual({ col, row });
    }
  });
});

describe('clampTile', () => {
  it('holds a tile inside the map bounds', () => {
    expect(clampTile({ col: -3, row: 20 }, 10, 8)).toEqual({ col: 0, row: 7 });
    expect(clampTile({ col: 5, row: 4 }, 10, 8)).toEqual({ col: 5, row: 4 });
  });
});

describe('pickTopAt', () => {
  it('picks the FRONTMOST unit when two overlap at a click point', () => {
    // Two units sharing a screen column; the one lower on screen (larger y) is drawn in front.
    const back = { ref: 1, x: 100, y: 100 };
    const front = { ref: 2, x: 100, y: 140 };
    // Click on the front unit's feet — inside both boxes (front body reaches up past the back feet).
    expect(pickTopAt([back, front], 100, 138)).toBe(2);
  });

  it('returns null when the click misses every unit box', () => {
    expect(pickTopAt([{ ref: 1, x: 100, y: 100 }], 300, 300)).toBeNull();
  });

  it('selects a unit when the click lands on its body above the feet', () => {
    // 30px above the feet anchor is within PICK_REACH_UP (42) — a body click still selects.
    expect(pickTopAt([{ ref: 5, x: 200, y: 200 }], 200, 170)).toBe(5);
  });

  it('gives a BUILDING a far larger hit box — a click anywhere on the house body selects it', () => {
    const building = { ref: 9, x: 200, y: 200, kind: 'building' as const };
    // A point 40px up + 40px to the side would MISS a settler-sized box but lands on the house body.
    expect(pickTopAt([building], 240, 160)).toBe(9);
    // ...and high up the tall sprite (90px above the feet) still selects.
    expect(pickTopAt([building], 200, 110)).toBe(9);
    // The same offsets miss a settler-kind target (its box is small) — proving the box is kind-aware.
    expect(pickTopAt([{ ref: 9, x: 200, y: 200, kind: 'settler' as const }], 240, 160)).toBeNull();
  });

  it('uses the EXACT sprite box when provided — a click anywhere inside the graphic selects', () => {
    // A big building's real rendered bounds: click any part of the graphic hits; just outside misses.
    const t = {
      ref: 3,
      x: 100,
      y: 100,
      kind: 'building' as const,
      box: { minX: 40, minY: 20, maxX: 160, maxY: 130 },
    };
    expect(pickTopAt([t], 45, 25)).toBe(3); // near the top-left corner of the sprite
    expect(pickTopAt([t], 155, 125)).toBe(3); // near the bottom-right corner
    expect(pickTopAt([t], 34, 100)).toBeNull(); // just left of the box
    expect(pickTopAt([t], 100, 140)).toBeNull(); // just below the box
  });

  it('prefers a settler standing IN FRONT of a building over the (larger-boxed) building behind it', () => {
    const building = { ref: 1, x: 100, y: 100, kind: 'building' as const };
    const settler = { ref: 2, x: 100, y: 150, kind: 'settler' as const }; // lower on screen = in front
    expect(pickTopAt([building, settler], 100, 150)).toBe(2); // the frontmost wins the overlap
  });

  it('refines a box hit to SOLID pixels when the target carries a pixelHit', () => {
    // A building whose sprite fills only the LEFT half of its box (the right half is transparent air).
    const t = {
      ref: 7,
      x: 100,
      y: 100,
      kind: 'building' as const,
      box: { minX: 40, minY: 20, maxX: 160, maxY: 130 },
      pixelHit: (wx: number, _wy: number): boolean | undefined => wx < 100,
    };
    expect(pickTopAt([t], 60, 60)).toBe(7); // on the graphic
    expect(pickTopAt([t], 140, 60)).toBeNull(); // inside the box but on transparent pixels
    expect(pickTopAt([t], 200, 60)).toBeNull(); // outside the box: pixelHit is never consulted
  });

  it('keeps the box verdict when pixelHit has no exact answer (undefined)', () => {
    const t = {
      ref: 8,
      x: 100,
      y: 100,
      kind: 'building' as const,
      box: { minX: 40, minY: 20, maxX: 160, maxY: 130 },
      pixelHit: (): boolean | undefined => undefined, // unreadable atlas / not drawn this frame
    };
    expect(pickTopAt([t], 140, 60)).toBe(8); // the pre-mask behaviour stands
  });
});

describe('pickInRect', () => {
  const targets = [
    { ref: 1, x: 10, y: 10 },
    { ref: 2, x: 50, y: 50 },
    { ref: 3, x: 90, y: 90 },
  ];

  it('returns the units whose anchor falls inside the box (corners in any order)', () => {
    expect(pickInRect(targets, 60, 60, 5, 5)).toEqual([1, 2]); // box (5,5)-(60,60) covers 1 and 2
  });

  it('returns an empty list when the box catches nothing', () => {
    expect(pickInRect(targets, 200, 200, 300, 300)).toEqual([]);
  });
});

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
