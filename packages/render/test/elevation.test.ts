import type { WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import {
  ONE,
  TILE_HALF_H,
  buildSpriteScene,
  cellNode,
  elevationLiftPerUnit,
  makeElevationField,
  tileToScreen,
} from '../src/index.js';

/**
 * Headless tests for the terrain-elevation seam (`data/elevation.ts`) — the one bilinear sampler every
 * projection consumer lifts through. Pixels are still human-gated, but the load-bearing DATA decisions
 * are agent-checkable: the engine's lift-per-unit (elevation/16 half-row-steps — source basis,
 * docs/SOURCES.md "terrain tessellation"), the sampler's bilinear+clamp, the cull pad, and the DEPTH
 * rule (a lifted-up sprite on a nearer row still occludes one behind it — the painter key stays the
 * PRE-LIFT feet row, not the lifted screen y).
 */

const LIFT = elevationLiftPerUnit();

describe('elevationLiftPerUnit — the engine tessellation divisor', () => {
  it('is one 16th of a half row step (1.1875 px at the measured 38 px row step)', () => {
    expect(LIFT).toBeCloseTo(TILE_HALF_H / 2 / 16, 9);
    expect(LIFT).toBeCloseTo(1.1875, 9);
  });
});

describe('makeElevationField.liftAt', () => {
  // 3×2 grid, row-major: row0 = [0,10,20], row1 = [30,40,50].
  const field = makeElevationField([0, 10, 20, 30, 40, 50], 3, 2);

  it('returns the cell height × lift-per-unit at integer coordinates (the mesh-node value)', () => {
    expect(field.liftAt(0, 0)).toBe(0);
    expect(field.liftAt(1, 0)).toBeCloseTo(10 * LIFT, 6);
    expect(field.liftAt(2, 1)).toBeCloseTo(50 * LIFT, 6);
  });

  it('bilinearly interpolates fractional positions (a walking settler between cell centres)', () => {
    // Along a row: halfway between col 0 (0) and col 1 (10) → 5.
    expect(field.liftAt(0.5, 0)).toBeCloseTo(5 * LIFT, 6);
    // Down a column: halfway between row0 col0 (0) and row1 col0 (30) → 15.
    expect(field.liftAt(0, 0.5)).toBeCloseTo(15 * LIFT, 6);
    // Centre of the 2×2 block {0,10,30,40} → mean 20.
    expect(field.liftAt(0.5, 0.5)).toBeCloseTo(20 * LIFT, 6);
  });

  it('clamps to the map edge (a sample past an edge repeats the boundary cell, never wraps/OOBs)', () => {
    expect(field.liftAt(-1, 0)).toBe(field.liftAt(0, 0)); // left of the west edge
    expect(field.liftAt(5, 0)).toBeCloseTo(20 * LIFT, 6); // right of the east edge → col 2
    expect(field.liftAt(0, 5)).toBeCloseTo(30 * LIFT, 6); // below the south edge → row 1
    expect(field.liftAt(-3, -3)).toBe(0); // past the NW corner → cell (0,0)
  });

  it('exposes maxLift = max(elevation) × lift-per-unit — the map-wide-max cull pad, computed once', () => {
    expect(field.maxLift).toBeCloseTo(50 * LIFT, 6);
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

describe('makeElevationField.liftAtNode — parity-aware on cell rows', () => {
  // 4×4 grid, elevation(col,row) = col·10 + row — every cell distinct so a parity slip is visible.
  const W = 4;
  const H = 4;
  const elev: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) elev.push(c * 10 + r);
  const field = makeElevationField(elev, W, H);

  it("a cell-centre node lifts by its OWN cell's value on BOTH row parities (the mesh-vertex match)", () => {
    for (const [col, row] of [
      [2, 2],
      [1, 3], // odd row — the staggered hx = 2·col+1 must not blend into the east neighbour
      [2, 1],
    ] as const) {
      const [hx, hy] = cellNode(col, row);
      expect(field.liftAtNode(hx, hy)).toBeCloseTo((col * 10 + row) * LIFT, 6);
    }
  });

  it('a mid-edge node on a cell row blends the two straddling cells exactly (the mesh edge midpoint)', () => {
    // Between centres (1,3) and (2,3): centres at hx 3 and 5 → the node at hx 4, hy 6.
    expect(field.liftAtNode(4, 6)).toBeCloseTo(((13 + 23) / 2) * LIFT, 6);
  });

  it('a between-row node keeps the plain bilinear stand-in (the named approximation)', () => {
    // hy = 5 lies between rows 2 and 3 — inside the mesh triangles, sampled at (hx/2, 2.5).
    expect(field.liftAtNode(4, 5)).toBeCloseTo((20 + 2.5) * LIFT, 6);
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
    expect(nearItem?.lift).toBeCloseTo(200 * LIFT, 6);
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
