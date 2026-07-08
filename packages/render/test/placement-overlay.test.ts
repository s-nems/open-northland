import { describe, expect, it } from 'vitest';
import { depthKey } from '../src/data/iso.js';
import { PlacementGhostLayer } from '../src/gpu/placement-ghost.js';
import { overlayBounds } from '../src/gpu/placement-overlay.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { TILE_HALF_H, TILE_HALF_W, makeElevationField, tileToScreen } from '../src/index.js';

/**
 * The build-placement overlay's agent-checkable halves. The wash itself is a GPU composite (each
 * side's overlap-fused diamonds rendered opaque off-screen, then drawn translucent — seamless by
 * construction, no per-cell boundaries), which needs a real renderer + human eyes; what IS pinnable
 * headlessly is the pure band geometry ({@link overlayBounds} — the composite must cover every
 * diamond incl. the stagger overhang and the terrain lift) and the cursor ghost's placement contract
 * (anchor, depth, hide/show).
 */

const FLAT = makeElevationField(undefined, 0, 0);

describe('overlayBounds', () => {
  it('covers the band diamonds with the half-tile stagger overhang on every side', () => {
    const frame = { minCol: 2, maxCol: 6, minRow: 3, maxRow: 9 };
    const b = overlayBounds(frame, 0);
    // Odd rows shift half a cell right, and each diamond extends TILE_HALF_W beyond its centre — so
    // the box must start a full tile left of the min centre and end a full tile right of the max.
    const topLeft = tileToScreen(frame.minCol, frame.minRow);
    const bottomRight = tileToScreen(frame.maxCol, frame.maxRow);
    expect(b.x).toBeLessThanOrEqual(topLeft.x - TILE_HALF_W);
    expect(b.x + b.width).toBeGreaterThanOrEqual(bottomRight.x + TILE_HALF_W + TILE_HALF_W);
    expect(b.y).toBeLessThanOrEqual(topLeft.y - TILE_HALF_H);
    expect(b.y + b.height).toBeGreaterThanOrEqual(bottomRight.y + TILE_HALF_H);
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
  // No sheet → the placeholder diamond path; Pixi Graphics/Container need no GL context to position.
  function makeLayer(): PlacementGhostLayer {
    return new PlacementGhostLayer(undefined, new TextureCache());
  }

  it('is hidden until given a ghost, snaps to the tile anchor, and hides again on null', () => {
    const layer = makeLayer();
    expect(layer.container.visible).toBe(false);

    layer.set({ col: 5, row: 8, buildingType: 2 }, FLAT);
    expect(layer.container.visible).toBe(true);
    const p = tileToScreen(5, 8);
    expect(layer.container.position.x).toBeCloseTo(p.x, 3);
    expect(layer.container.position.y).toBeCloseTo(p.y, 3);
    // Depth-sorts like a real house standing there (pre-lift feet anchor).
    expect(layer.container.zIndex).toBeCloseTo(depthKey(p.x, p.y), 6);

    layer.set(null, FLAT);
    expect(layer.container.visible).toBe(false);
  });

  it('rides the terrain lift at the hovered tile (draws up the hill, depth stays pre-lift)', () => {
    const W = 4;
    const H = 12;
    const elev = new Array<number>(W * H).fill(0);
    elev[8 * W + 1] = 160; // a hill under (col 1, row 8)
    const field = makeElevationField(elev, W, H);

    const layer = makeLayer();
    layer.set({ col: 1, row: 8, buildingType: 2 }, field);
    const p = tileToScreen(1, 8);
    expect(p.y - layer.container.position.y).toBeCloseTo(field.liftAt(1, 8), 3);
    expect(layer.container.zIndex).toBeCloseTo(depthKey(p.x, p.y), 6);
  });
});
