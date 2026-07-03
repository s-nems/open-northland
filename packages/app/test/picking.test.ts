import { type Camera, tileToScreen } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import {
  type FormationUnit,
  assignFormation,
  clampTile,
  formationTiles,
  pickInRect,
  pickTopAt,
  screenToWorld,
  worldToTile,
} from '../src/view/picking.js';

const NONE = (): boolean => false;

/**
 * Headless tests for the pure PICKING math (screen→world→tile + the point/box hit-tests). This is the
 * agent-verifiable half of selection — the DOM/mouse controller that calls it is human-judged in the
 * browser. The load-bearing property is the round-trip: `worldToTile(tileToScreen(t)) === t`, so a
 * click lands on the tile a human aimed at.
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
  it('is the exact inverse of tileToScreen for a range of tiles', () => {
    for (const [col, row] of [
      [0, 0],
      [3, 1],
      [7, 4],
      [12, 0],
      [0, 9],
      [5, 5],
    ] as const) {
      const s = tileToScreen(col, row);
      expect(worldToTile(s.x, s.y)).toEqual({ col, row });
    }
  });

  it('rounds a point inside a diamond to that diamond cell', () => {
    const centre = tileToScreen(4, 2);
    // A few px off-centre (well within the 32×16 half-diamond) still resolves to (4,2).
    expect(worldToTile(centre.x + 6, centre.y - 3)).toEqual({ col: 4, row: 2 });
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

  it('pairs the nearest unit with the nearest slot (the group keeps its shape, no criss-cross)', () => {
    // Two units; the one physically at the target tile's world centre should take the target (ring-0) slot.
    const centre = tileToScreen(4, 4);
    const far = tileToScreen(9, 9);
    const units: FormationUnit[] = [
      { ref: 1, x: far.x, y: far.y },
      { ref: 2, x: centre.x, y: centre.y },
    ];
    const orders = assignFormation(units, { col: 4, row: 4 }, 20, 20, NONE);
    const forRef2 = orders.find((o) => o.ref === 2);
    expect(forRef2?.tile).toEqual({ col: 4, row: 4 }); // the unit already there keeps the centre slot
  });
});
