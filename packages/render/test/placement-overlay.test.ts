import { describe, expect, it } from 'vitest';
import { PlacementOverlayLayer } from '../src/gpu/placement-overlay.js';
import { TILE_HALF_H, TILE_HALF_W, makeElevationField, tileToScreen } from '../src/index.js';

/**
 * The build-placement wash is a pure projection of the blocked-cell set the sim hands it — like the
 * selection rings, it must ride the terrain lift and it must clear when build mode ends. Pixi
 * `Graphics` builds its geometry without a GL context, so the diamonds' world-space bounds are
 * agent-checkable here (the DIM colour + human "does this read as blocked?" still need the browser).
 */
function graphicsOf(layer: PlacementOverlayLayer): {
  getLocalBounds(): { width: number; height: number; minY: number };
} {
  const g = layer.container.children[0];
  if (g === undefined) throw new Error('overlay graphics missing');
  return g as unknown as { getLocalBounds(): { width: number; height: number; minY: number } };
}

const FLAT = makeElevationField(undefined, 0, 0);

describe('PlacementOverlayLayer', () => {
  it('has no geometry until given blocked cells, and one cell spans exactly one diamond', () => {
    const layer = new PlacementOverlayLayer();
    expect(graphicsOf(layer).getLocalBounds().width).toBe(0);

    layer.set([{ col: 3, row: 4 }], FLAT);
    const b = graphicsOf(layer).getLocalBounds();
    expect(b.width).toBeCloseTo(2 * TILE_HALF_W, 3); // left↔right diamond points
    expect(b.height).toBeCloseTo(2 * TILE_HALF_H, 3); // top↔bottom diamond points
  });

  it('clears the wash when build mode ends (null / empty)', () => {
    const layer = new PlacementOverlayLayer();
    layer.set([{ col: 3, row: 4 }], FLAT);
    expect(graphicsOf(layer).getLocalBounds().width).toBeGreaterThan(0);
    layer.set(null, FLAT);
    expect(graphicsOf(layer).getLocalBounds().width).toBe(0);
    layer.set([], FLAT);
    expect(graphicsOf(layer).getLocalBounds().width).toBe(0);
  });

  it('lifts a blocked diamond by the terrain height under it (sits on the ground, like the rings)', () => {
    const W = 4;
    const H = 12;
    const elev = new Array<number>(W * H).fill(0);
    elev[8 * W + 1] = 160; // a hill under cell (col 1, row 8)
    const field = makeElevationField(elev, W, H);

    const flatLayer = new PlacementOverlayLayer();
    flatLayer.set([{ col: 1, row: 8 }], FLAT);
    const liftedLayer = new PlacementOverlayLayer();
    liftedLayer.set([{ col: 1, row: 8 }], field);

    // The lifted diamond's top edge sits a full `liftAt` above the flat one (smaller y = higher).
    const flatTop = graphicsOf(flatLayer).getLocalBounds().minY;
    const liftedTop = graphicsOf(liftedLayer).getLocalBounds().minY;
    expect(flatTop - liftedTop).toBeCloseTo(field.liftAt(1, 8), 3);
    // The projected feet y confirms the lift is the real hill height (160), not a rounding wobble.
    expect(tileToScreen(1, 8).y - TILE_HALF_H - liftedTop).toBeCloseTo(field.liftAt(1, 8), 3);
  });
});
