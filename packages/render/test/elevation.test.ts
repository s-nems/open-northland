import type { WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import {
  ELEVATION_LIFT,
  ONE,
  buildSpriteScene,
  diamondCornerLifts,
  makeElevationField,
  tileToScreen,
} from '../src/index.js';

/**
 * Headless tests for the terrain-elevation seam (`data/elevation.ts`) — the one bilinear sampler every
 * projection consumer lifts through. Pixels are still human-gated, but the load-bearing DATA decisions
 * are agent-checkable: the sampler's bilinear+clamp, the WATERTIGHT per-corner lift (a shared diamond
 * corner must lift identically from every cell that meets it, or the mesh cracks), the cull pad, and the
 * DEPTH rule (a lifted-up sprite on a nearer row still occludes one behind it — the painter key stays
 * the PRE-LIFT feet row, not the lifted screen y).
 */

describe('makeElevationField.liftAt', () => {
  // 3×2 grid, row-major: row0 = [0,10,20], row1 = [30,40,50].
  const field = makeElevationField([0, 10, 20, 30, 40, 50], 3, 2);

  it('returns the cell height × LIFT at integer coordinates', () => {
    expect(field.liftAt(0, 0)).toBe(0);
    expect(field.liftAt(1, 0)).toBeCloseTo(10 * ELEVATION_LIFT, 6);
    expect(field.liftAt(2, 1)).toBeCloseTo(50 * ELEVATION_LIFT, 6);
  });

  it('bilinearly interpolates fractional positions (a walking settler, a diamond corner)', () => {
    // Along a row: halfway between col 0 (0) and col 1 (10) → 5.
    expect(field.liftAt(0.5, 0)).toBeCloseTo(5 * ELEVATION_LIFT, 6);
    // Down a column: halfway between row0 col0 (0) and row1 col0 (30) → 15.
    expect(field.liftAt(0, 0.5)).toBeCloseTo(15 * ELEVATION_LIFT, 6);
    // Cell centre of the 2×2 block {0,10,30,40} → mean 20.
    expect(field.liftAt(0.5, 0.5)).toBeCloseTo(20 * ELEVATION_LIFT, 6);
  });

  it('clamps to the map edge (a sample past an edge repeats the boundary cell, never wraps/OOBs)', () => {
    expect(field.liftAt(-1, 0)).toBe(field.liftAt(0, 0)); // left of the west edge
    expect(field.liftAt(5, 0)).toBeCloseTo(20 * ELEVATION_LIFT, 6); // right of the east edge → col 2
    expect(field.liftAt(0, 5)).toBeCloseTo(30 * ELEVATION_LIFT, 6); // below the south edge → row 1
    expect(field.liftAt(-3, -3)).toBe(0); // past the NW corner → cell (0,0)
  });

  it('exposes maxLift = max(elevation) × LIFT — the map-wide-max cull pad, computed once', () => {
    expect(field.maxLift).toBeCloseTo(50 * ELEVATION_LIFT, 6);
  });

  it('is FLAT (zero lift everywhere) when there is no elevation lane — the byte-identical path', () => {
    const flat = makeElevationField(undefined, 3, 2);
    expect(flat.maxLift).toBe(0);
    expect(flat.liftAt(1.5, 0.5)).toBe(0);
    // An empty lane, or a zero-size map, is flat too.
    expect(makeElevationField([], 3, 2).maxLift).toBe(0);
    expect(makeElevationField([5, 5], 0, 0).maxLift).toBe(0);
  });
});

describe('diamondCornerLifts — watertight shared corners', () => {
  // A field that varies in BOTH axes so every corner has a distinct lift (a constant field would pass
  // trivially). elevation(col,row) = col*10 + row.
  const W = 6;
  const H = 6;
  const elev: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) elev.push(c * 10 + r);
  const field = makeElevationField(elev, W, H);
  // Corner order is [top, right, bottom, left].
  const [TOP, RIGHT, BOTTOM, LEFT] = [0, 1, 2, 3];

  it("a cell's RIGHT corner == its east neighbour's LEFT corner (no horizontal crack)", () => {
    for (const [col, row] of [
      [2, 2],
      [3, 3],
      [1, 4],
    ] as const) {
      expect(diamondCornerLifts(field, col, row)[RIGHT]).toBe(diamondCornerLifts(field, col + 1, row)[LEFT]);
    }
  });

  it("a cell's TOP corner == the cell two rows up's BOTTOM corner (no vertical crack)", () => {
    for (const [col, row] of [
      [2, 3],
      [3, 4],
      [4, 5],
    ] as const) {
      expect(diamondCornerLifts(field, col, row)[TOP]).toBe(diamondCornerLifts(field, col, row - 2)[BOTTOM]);
    }
  });

  it("a cell's TOP corner == the diagonal neighbour's LEFT corner (no diagonal crack)", () => {
    // Top corner of (col,row) is the LEFT corner of cell (col + (row&1), row-1) — the fourth cell that
    // meets at that vertex. Both must sample identically for the mesh to be a single height field.
    for (const [col, row] of [
      [2, 3],
      [3, 4],
      [2, 2],
    ] as const) {
      const s = row & 1;
      expect(diamondCornerLifts(field, col, row)[TOP]).toBe(
        diamondCornerLifts(field, col + s, row - 1)[LEFT],
      );
    }
  });

  it('lifts a corner to the mean of the cells straddling it (a linear blend at an integer row)', () => {
    // RIGHT corner of (2,2) sits between cells (2,2)=22 and (3,2)=32 → mean 27.
    expect(diamondCornerLifts(field, 2, 2)[RIGHT]).toBeCloseTo(27 * ELEVATION_LIFT, 6);
  });
});

/** Hand-build a snapshot entity with a Position (Fixed = whole tiles) + a marker component. */
function entity(id: number, tileX: number, tileY: number, marker: Record<string, unknown>) {
  return { id, components: { Position: { x: tileX * ONE, y: tileY * ONE }, ...marker } };
}
function snapshotOf(entities: WorldSnapshot['entities']): WorldSnapshot {
  return { tick: 1, entities, events: [] };
}

describe('elevation lift on sprites — draw up, but sort by PRE-LIFT row', () => {
  // A tall hill on the near cell (col 1, row 8); everything else at sea level. Only that cell is 200, so
  // its bilinear lift is exactly 200×LIFT.
  const W = 3;
  const H = 10;
  const elev = new Array<number>(W * H).fill(0);
  elev[8 * W + 1] = 200; // cell (col 1, row 8)
  const field = makeElevationField(elev, W, H);

  const far = entity(1, 1, 2, { Settler: { tribe: 0 } }); // FAR: smaller row
  const near = entity(2, 1, 8, { Settler: { tribe: 0 } }); // NEAR: larger row, on the hill

  it('sets the feet lift on the item drawn on the hill, none on flat ground', () => {
    const items = buildSpriteScene(snapshotOf([far, near]), undefined, field);
    const nearItem = items.find((d) => d.ref === 2);
    const farItem = items.find((d) => d.ref === 1);
    expect(nearItem?.lift).toBeCloseTo(200 * ELEVATION_LIFT, 6);
    expect(farItem?.lift).toBeUndefined(); // sea level → omitted (byte-identical to the flat path)
  });

  it('draws the lifted-up NEAR sprite ABOVE the far one yet still sorts it in FRONT (depth = pre-lift row)', () => {
    const items = buildSpriteScene(snapshotOf([far, near]), undefined, field);
    const nearItem = items.find((d) => d.ref === 2);
    const farItem = items.find((d) => d.ref === 1);
    if (nearItem === undefined || farItem === undefined) throw new Error('missing item');
    // Drawn screen y = anchor y − lift. The near sprite is lifted so high it draws ABOVE the far one.
    const nearDrawY = nearItem.y - (nearItem.lift ?? 0);
    const farDrawY = farItem.y - (farItem.lift ?? 0);
    expect(nearDrawY).toBeLessThan(farDrawY);
    // …but the painter key is the PRE-LIFT feet row, so the nearer sprite still sorts LATER (in front).
    expect(nearItem.depth).toBeGreaterThan(farItem.depth);
    expect(items.indexOf(nearItem)).toBeGreaterThan(items.indexOf(farItem));
    // And the anchor y itself is the PRE-LIFT projected feet (the lift lives only in `lift`).
    expect(nearItem.y).toBe(tileToScreen(1, 8).y);
  });

  it('adds NO lift field when the map is flat (the elevation-free render is unchanged)', () => {
    const items = buildSpriteScene(snapshotOf([far, near]));
    expect(items.every((d) => d.lift === undefined)).toBe(true);
  });
});
