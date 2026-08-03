import { describe, expect, it } from 'vitest';
import { depthKey } from '../src/data/projection/index.js';
import { PlacementGhostLayer } from '../src/gpu/overlays/placement-ghost.js';
import { overlayBounds } from '../src/gpu/overlays/placement-overlay.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { halfCellToScreen, makeElevationField, TILE_HALF_H, TILE_HALF_W } from '../src/index.js';

const FLAT = makeElevationField(undefined, 0, 0);

describe('overlayBounds', () => {
  it('covers the band nodes and their overlap-grown diamonds on every side', () => {
    const frame = { minCol: 2, maxCol: 6, minRow: 3, maxRow: 9 };
    const b = overlayBounds(frame, 0);
    // Frame cells are half-cell nodes whose diamonds have half-extents (TILE_HALF_W, TILE_HALF_H/2)
    // grown by a few-px fusing pad, so the box clears every border node's centre by a half-extent and
    // the strict comparison is the pad's own room. The node lattice is rectangular, with no overhang.
    const topLeft = halfCellToScreen(frame.minCol, frame.minRow);
    const bottomRight = halfCellToScreen(frame.maxCol, frame.maxRow);
    expect(b.x).toBeLessThan(topLeft.x - TILE_HALF_W);
    expect(b.x + b.width).toBeGreaterThan(bottomRight.x + TILE_HALF_W);
    expect(b.y).toBeLessThan(topLeft.y - TILE_HALF_H / 2);
    expect(b.y + b.height).toBeGreaterThan(bottomRight.y + TILE_HALF_H / 2);
  });

  it('grows upward by the max terrain lift so a hilltop diamond stays inside the composite', () => {
    const frame = { minCol: 0, maxCol: 3, minRow: 0, maxRow: 3 };
    const LIFT = 160;
    const flat = overlayBounds(frame, 0);
    const lifted = overlayBounds(frame, LIFT);
    expect(flat.y - lifted.y).toBeCloseTo(LIFT, 3);
    expect(lifted.height - flat.height).toBeCloseTo(LIFT, 3);
  });
});

describe('PlacementGhostLayer', () => {
  // No sheet, so this takes the placeholder diamond path.
  function makeLayer(): PlacementGhostLayer {
    return new PlacementGhostLayer(undefined, new TextureCache());
  }

  it('is hidden until given a ghost, snaps to the node anchor, and hides again on null', () => {
    const layer = makeLayer();
    expect(layer.container.visible).toBe(false);

    // Ghost col/row are half-cell node coords.
    layer.set({ kind: 'building', col: 5, row: 8, buildingType: 2 }, FLAT);
    expect(layer.container.visible).toBe(true);
    const p = halfCellToScreen(5, 8);
    expect(layer.container.position.x).toBeCloseTo(p.x, 3);
    expect(layer.container.position.y).toBeCloseTo(p.y, 3);
    // Depth-sorts like a real house standing there, on the pre-lift feet anchor.
    expect(layer.container.zIndex).toBeCloseTo(depthKey(p.x, p.y), 6);

    layer.set(null, FLAT);
    expect(layer.container.visible).toBe(false);
  });

  it('rides the terrain lift at the hovered node (draws up the hill, depth stays pre-lift)', () => {
    const W = 4;
    const H = 12;
    const elev = new Array<number>(W * H).fill(0);
    elev[8 * W + 1] = 160; // a hill under cell (1, 8), which is node (2, 16)'s cell-space point
    const field = makeElevationField(elev, W, H);

    const layer = makeLayer();
    layer.set({ kind: 'building', col: 2, row: 16, buildingType: 2 }, field);
    const p = halfCellToScreen(2, 16);
    // The lift samples cell space at (col/2, row/2) = the hill cell (1, 8).
    expect(p.y - layer.container.position.y).toBeCloseTo(field.liftAt(1, 8), 3);
    expect(layer.container.zIndex).toBeCloseTo(depthKey(p.x, p.y), 6);
  });
});
