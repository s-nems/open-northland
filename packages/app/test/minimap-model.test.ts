import {
  FOG_EXPLORED_ALPHA,
  FOG_UNEXPLORED_ALPHA,
  terrainWorldBounds,
  tileToScreen,
} from '@open-northland/render';
import { FOG_STATE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { PLAYER_COLOR_COUNT, PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import {
  ATLAS_WIDTHS,
  FOG_UNEXPLORED_TINT,
  fillFogMask,
  minimapLayout,
  minimapPanelWidth,
  minimapToWorld,
  pointOverMinimap,
  pointOverMinimapHole,
  stampDot,
  viewportRectOnMinimap,
  visibleMinimapRect,
  worldToMinimap,
  zoomMinimapLayout,
} from '../src/hud/minimap/model.js';
import { navBeamRect } from '../src/hud/nav-beam.js';
import { MIN_UI_SCALE } from '../src/hud/ui-scale.js';
import { cameraCenteredOnWorld } from '../src/view/camera/index.js';

const UISCALE = 1.4;

describe('minimapLayout', () => {
  const bounds = terrainWorldBounds(256, 256);

  it('limits frame trimming and preserves anchors across sizes, UI scales and constrained viewports', () => {
    for (const size of ['s', 'm', 'l', 'xl'] as const) {
      for (const scale of [0.75, 1, 1.4, 1.875]) {
        for (const screen of [
          { w: 1366, h: 768 },
          { w: 1920, h: 1080 },
          { w: 640, h: 480 },
          { w: 800, h: 300 },
        ]) {
          const layout = minimapLayout(bounds, screen.h, scale, size, screen.w);
          expect(layout.panel.w).toBeGreaterThanOrEqual(layout.panel.h);
          expect(layout.panel.w).toBeLessThanOrEqual(layout.panel.h * 1.5 + 1e-8);
          expect(layout.panel.x).toBe(0);
          expect(layout.panel.y + layout.panel.h).toBeCloseTo(screen.h);
          expect(layout.panel.y).toBeGreaterThanOrEqual(70 * scale - 1e-8);
          if (layout.panel.w > 0) {
            expect(layout.panel.w + 6 * scale).toBeLessThanOrEqual(
              navBeamRect({ width: screen.w, height: screen.h }, scale).x,
            );
            expect(layout.panel.w + 12 * scale).toBeLessThanOrEqual(screen.w - 318 * scale);
          }
          expect(layout.map.x).toBeGreaterThanOrEqual(layout.inner.x - 1e-8);
          expect(layout.map.y).toBeGreaterThanOrEqual(layout.inner.y - 1e-8);
          expect(layout.map.x + layout.map.w).toBeLessThanOrEqual(layout.inner.x + layout.inner.w + 1e-8);
          expect(layout.map.y + layout.map.h).toBeLessThanOrEqual(layout.inner.y + layout.inner.h + 1e-8);
        }
      }
    }
  });

  it('uses the selected longest side with fixed frame thickness on every edge', () => {
    for (const size of ['s', 'm', 'l', 'xl'] as const) {
      const layout = minimapLayout(bounds, 900, 1, size, 1600);
      expect(layout.panel.w).toBe(ATLAS_WIDTHS[size]);
      expect(layout.panel.h).toBeLessThan(ATLAS_WIDTHS[size]);
      expect(layout.inner).toEqual({
        x: layout.panel.x + 20,
        y: layout.panel.y + 20,
        w: layout.panel.w - 40,
        h: layout.panel.h - 40,
      });
      expect(minimapPanelWidth(1, size)).toBe(layout.panel.w);
    }
  });

  it('preserves world-view proportions without stretching either axis', () => {
    const layout = minimapLayout(bounds, 900, 1);
    const origin = worldToMinimap(layout, bounds, 0, 0);
    const horizontal = worldToMinimap(layout, bounds, 100, 0);
    const vertical = worldToMinimap(layout, bounds, 0, 100);
    expect(horizontal.x - origin.x).toBeCloseTo(vertical.y - origin.y);
    expect(layout.scaleX).toBe(layout.scaleY);
    expect(layout.map.w / layout.map.h).toBeCloseTo(bounds.width / bounds.height);
    expect(layout.map.w).toBeCloseTo(layout.inner.w);
  });

  it('preserves a rectangular map’s projected world ratio inside the trimmed frame', () => {
    const wide = minimapLayout(terrainWorldBounds(128, 32), 900, 1);
    const tall = minimapLayout(terrainWorldBounds(32, 128), 900, 1);
    expect(wide.map.w / wide.map.h).toBeCloseTo(
      terrainWorldBounds(128, 32).width / terrainWorldBounds(128, 32).height,
    );
    expect(tall.map.w / tall.map.h).toBeCloseTo(
      terrainWorldBounds(32, 128).width / terrainWorldBounds(32, 128).height,
    );
    expect(wide.map.w).toBeCloseTo(wide.inner.w);
    expect(tall.map.h).toBeCloseTo(tall.inner.h);
    expect(wide.map.y - wide.inner.y).toBeCloseTo(wide.inner.y + wide.inner.h - wide.map.y - wide.map.h);
    expect(tall.map.x - tall.inner.x).toBeCloseTo(tall.inner.x + tall.inner.w - tall.map.x - tall.map.w);
  });

  it('floors a too-small UI scale and shrinks both axes beside the bottom navigation', () => {
    expect(minimapLayout(bounds, 800, 0.5)).toEqual(minimapLayout(bounds, 800, MIN_UI_SCALE));
    const layout = minimapLayout(bounds, 768, 1.5, 'l', 1024);
    expect(layout.panel.w).toBe(188);
    expect(layout.panel.h).toBe(186);
    expect(layout.panel.w + 6 * 1.5).toBe(navBeamRect({ width: 1024, height: 768 }, 1.5).x);
  });

  it('limits the frame on a short screen while keeping room for all controls', () => {
    const layout = minimapLayout(bounds, 480, 1.5, 'l', 1600);
    expect(layout.panel.w).toBe(375);
    expect(layout.panel.h).toBe(250);
    expect(layout.panel.y).toBe(230);
    expect(layout.inner.w).toBe(315);
  });

  it('trims only the short axis for extreme maps and keeps square maps square', () => {
    for (const size of ['s', 'm', 'l', 'xl'] as const) {
      const side = ATLAS_WIDTHS[size];
      const wide = minimapLayout({ ...bounds, width: 10000, height: 100 }, 900, 1, size, 1600);
      const tall = minimapLayout({ ...bounds, width: 100, height: 10000 }, 900, 1, size, 1600);
      const square = minimapLayout({ ...bounds, width: 1000, height: 1000 }, 900, 1, size, 1600);
      expect(wide.panel.w).toBe(side);
      expect(wide.panel.h).toBeCloseTo(side / 1.5);
      expect(tall.panel.w).toBeCloseTo(side / 1.5);
      expect(tall.panel.h).toBe(side);
      expect(square.panel.w).toBe(side);
      expect(square.panel.h).toBe(side);
      for (const layout of [wide, tall, square]) {
        expect(layout.scaleX).toBe(layout.scaleY);
        expect(layout.inner.x - layout.panel.x).toBe(20);
        expect(layout.inner.y - layout.panel.y).toBe(20);
      }
    }
  });

  it('collapses a square too small to contain the frame controls', () => {
    const layout = minimapLayout(bounds, 300, 1.5, 'l', 800);
    expect(layout.panel.w).toBe(0);
    expect(layout.panel.h).toBe(0);
    expect(layout.scaleX).toBe(0);
    expect(layout.scaleY).toBe(0);
  });

  it('keeps collapsed geometry finite when the window cannot fit the HUD', () => {
    const layout = minimapLayout(bounds, 100, 2, 'l', 30);
    expect(layout.panel.w).toBe(layout.panel.h);
    expect(layout.panel.y).toBeGreaterThanOrEqual(0);
    expect(layout.panel.y + layout.panel.h).toBeLessThanOrEqual(100);
    expect(layout.scaleX).toBe(0);
    expect(layout.scaleY).toBe(0);
    const world = minimapToWorld(layout, bounds, 0, 0);
    expect(Number.isFinite(world.x) && Number.isFinite(world.y)).toBe(true);
  });

  it('tracks screen height without resizing while enough space remains', () => {
    const tall = minimapLayout(bounds, 1000, UISCALE);
    const short = minimapLayout(bounds, 700, UISCALE);
    expect(tall.panel.w).toBe(short.panel.w);
    expect(tall.panel.h).toBe(short.panel.h);
    expect(tall.panel.y - short.panel.y).toBeCloseTo(300);
  });
});

describe('parchment opening', () => {
  it('meets the terrain edges for wide and tall maps at every size and zoom', () => {
    const bounds = terrainWorldBounds(240, 190);
    for (const shape of [bounds, { ...bounds, width: bounds.height, height: bounds.width }]) {
      for (const size of ['s', 'm', 'l', 'xl'] as const) {
        const base = minimapLayout(shape, 900, 1.25, size, 1600);
        const center = { x: shape.minX + shape.width / 2, y: shape.minY + shape.height / 2 };
        let previousArea = 0;
        for (const zoom of [1, Math.SQRT2, 2, 4]) {
          const layout = zoomMinimapLayout(base, shape, zoom, center);
          const opening = visibleMinimapRect(layout);
          expect(opening.w * opening.h).toBeGreaterThanOrEqual(previousArea);
          previousArea = opening.w * opening.h;
          for (const rect of [layout.inner, layout.map]) {
            expect(opening.x).toBeGreaterThanOrEqual(rect.x - 1e-8);
            expect(opening.y).toBeGreaterThanOrEqual(rect.y - 1e-8);
            expect(opening.x + opening.w).toBeLessThanOrEqual(rect.x + rect.w + 1e-8);
            expect(opening.y + opening.h).toBeLessThanOrEqual(rect.y + rect.h + 1e-8);
          }
          const fullWorld = viewportRectOnMinimap(layout, shape, {
            minX: shape.minX,
            minY: shape.minY,
            maxX: shape.minX + shape.width,
            maxY: shape.minY + shape.height,
          });
          expect(fullWorld).toEqual(opening);
          expect(layout.panel).toEqual(base.panel);
        }
      }
    }
  });

  it('keeps a parchment margin on an extreme map even at maximum zoom', () => {
    const bounds = { minX: 0, minY: 0, width: 10000, height: 100 };
    const base = minimapLayout(bounds, 900, 1, 'm', 1600);
    const zoomed = zoomMinimapLayout(base, bounds, 4, { x: 5000, y: 50 });
    const opening = visibleMinimapRect(zoomed);
    expect(opening.h).toBeCloseTo(zoomed.map.h);
    expect(opening.h).toBeLessThan(base.inner.h);
    expect(opening.y - base.inner.y).toBeCloseTo((base.inner.h - opening.h) / 2);
  });

  it('collapses the opening with the panel when the HUD cannot fit', () => {
    const layout = minimapLayout(terrainWorldBounds(64, 64), 100, 2, 'l', 30);
    const opening = visibleMinimapRect(layout);
    expect(opening.w).toBe(0);
    expect(opening.h).toBe(0);
    expect(Number.isFinite(opening.x) && Number.isFinite(opening.y)).toBe(true);
  });
});

describe('world↔minimap projection', () => {
  const bounds = terrainWorldBounds(64, 64);
  const layout = minimapLayout(bounds, 800, UISCALE);

  it('round-trips a world point through the minimap and back', () => {
    const before = tileToScreen(17, 42);
    const minimap = worldToMinimap(layout, bounds, before.x, before.y);
    const after = minimapToWorld(layout, bounds, minimap.x, minimap.y);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('maps the world corners onto the map picture corners', () => {
    const topLeft = worldToMinimap(layout, bounds, bounds.minX, bounds.minY);
    expect(topLeft.x).toBeCloseTo(layout.map.x);
    expect(topLeft.y).toBeCloseTo(layout.map.y);
    const bottomRight = worldToMinimap(
      layout,
      bounds,
      bounds.minX + bounds.width,
      bounds.minY + bounds.height,
    );
    expect(bottomRight.x).toBeCloseTo(layout.map.x + layout.map.w);
    expect(bottomRight.y).toBeCloseTo(layout.map.y + layout.map.h);
  });

  it('claims the framed window; only the hole is a jump surface', () => {
    expect(pointOverMinimap(layout, layout.panel.x + 1, layout.panel.y + 1)).toBe(true);
    expect(pointOverMinimap(layout, layout.panel.x + layout.panel.w + 1, layout.panel.y + 1)).toBe(false);
    const chromeX = layout.inner.x + layout.inner.w + 1;
    expect(pointOverMinimap(layout, chromeX, layout.inner.y + 1)).toBe(true);
    expect(pointOverMinimapHole(layout, chromeX, layout.inner.y + 1)).toBe(false);
    expect(pointOverMinimapHole(layout, layout.inner.x + 1, layout.inner.y + 1)).toBe(true);
  });
});

describe('zoomMinimapLayout', () => {
  const bounds = terrainWorldBounds(64, 64);
  const base = minimapLayout(bounds, 800, 1);
  const center = { x: bounds.minX + bounds.width / 2, y: bounds.minY + bounds.height / 2 };

  it('keeps the panel fixed and round-trips targets through the cropped projection', () => {
    const zoomed = zoomMinimapLayout(base, bounds, 4, center);
    expect(zoomed.panel).toBe(base.panel);
    expect(zoomed.inner).toBe(base.inner);
    expect(zoomed.scaleX).toBe(base.scaleX * 4);
    expect(zoomed.scaleY).toBe(base.scaleY * 4);
    const point = worldToMinimap(zoomed, bounds, center.x + 100, center.y - 50);
    const inverse = minimapToWorld(zoomed, bounds, point.x, point.y);
    expect(inverse.x).toBeCloseTo(center.x + 100);
    expect(inverse.y).toBeCloseTo(center.y - 50);
    expect(worldToMinimap(zoomed, bounds, center.x, center.y).x).toBeCloseTo(base.inner.x + base.inner.w / 2);
    expect(worldToMinimap(zoomed, bounds, center.x, center.y).y).toBeCloseTo(base.inner.y + base.inner.h / 2);
  });

  it('pans the zoomed map by the requested world distance on each ground axis', () => {
    const start = zoomMinimapLayout(base, bounds, 2, center);
    const panned = zoomMinimapLayout(base, bounds, 2, { x: center.x + 68, y: center.y + 38 });
    expect(start.map.x - panned.map.x).toBeCloseTo(68 * start.scaleX);
    expect(start.map.y - panned.map.y).toBeCloseTo(38 * start.scaleY);
    const target = minimapToWorld(
      panned,
      bounds,
      panned.inner.x + panned.inner.w / 2,
      panned.inner.y + panned.inner.h / 2,
    );
    expect(target.x).toBeCloseTo(center.x + 68);
    expect(target.y).toBeCloseTo(center.y + 38);
  });

  it('clamps out-of-world centres so zooming exposes no blank border', () => {
    for (const edge of [-100000, 100000]) {
      const zoomed = zoomMinimapLayout(base, bounds, 2, { x: edge, y: edge });
      expect(zoomed.map.x).toBeLessThanOrEqual(base.inner.x);
      expect(zoomed.map.y).toBeLessThanOrEqual(base.inner.y);
      expect(zoomed.map.x + zoomed.map.w).toBeGreaterThanOrEqual(base.inner.x + base.inner.w);
      expect(zoomed.map.y + zoomed.map.h).toBeGreaterThanOrEqual(base.inner.y + base.inner.h);
    }
  });

  it('centres the letterboxed axis until zoom makes the map larger than the hole', () => {
    const tallBounds = terrainWorldBounds(8, 256);
    const tallBase = minimapLayout(tallBounds, 800, 1);
    const zoomed = zoomMinimapLayout(tallBase, tallBounds, 2, { x: -1000, y: -1000 });
    expect(zoomed.map.w).toBeLessThan(zoomed.inner.w);
    expect(zoomed.map.x + zoomed.map.w / 2).toBeCloseTo(zoomed.inner.x + zoomed.inner.w / 2);
  });

  it('restores the whole map and limits zoom to the supported range', () => {
    expect(zoomMinimapLayout(base, bounds, -1, center)).toBe(base);
    expect(zoomMinimapLayout(base, bounds, Number.NaN, center)).toBe(base);
    expect(zoomMinimapLayout(base, bounds, 100, center)).toEqual(zoomMinimapLayout(base, bounds, 4, center));
  });

  it('clips a camera crossing the crop to the hole and omits a camera outside the crop', () => {
    const zoomed = zoomMinimapLayout(base, bounds, 4, center);
    const viewport = {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.minX + bounds.width,
      maxY: bounds.minY + bounds.height,
    };
    const clipped = viewportRectOnMinimap(zoomed, bounds, viewport);
    if (clipped === null) throw new Error('Expected a camera crossing the map');
    for (const key of ['x', 'y', 'w', 'h'] as const) expect(clipped[key]).toBeCloseTo(base.inner[key]);
    expect(
      viewportRectOnMinimap(zoomed, bounds, {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.minX + 20,
        maxY: bounds.minY + 20,
      }),
    ).toBeNull();
  });
});

describe('click-to-jump camera', () => {
  it('centres the clicked world point at the viewport centre, keeping the zoom', () => {
    const bounds = terrainWorldBounds(64, 64);
    const layout = minimapLayout(bounds, 800, UISCALE);
    const target = tileToScreen(30, 12);
    const minimap = worldToMinimap(layout, bounds, target.x, target.y);
    const world = minimapToWorld(layout, bounds, minimap.x, minimap.y);
    const camera = cameraCenteredOnWorld(world.x, world.y, 2, 1280, 800);
    expect(target.x * 2 + camera.offsetX).toBeCloseTo(640);
    expect(target.y * 2 + camera.offsetY).toBeCloseTo(400);
    expect(camera.scale).toBe(2);
  });
});

describe('viewportRectOnMinimap', () => {
  const bounds = terrainWorldBounds(64, 64);
  const layout = minimapLayout(bounds, 800, UISCALE);

  it('keeps an unclipped camera rectangle in screen aspect at every minimap zoom', () => {
    for (const factor of [1, Math.SQRT2, 2, 4]) {
      const center = { x: bounds.minX + bounds.width / 2, y: bounds.minY + bounds.height / 2 };
      const zoomed = zoomMinimapLayout(layout, bounds, factor, center);
      const rect = viewportRectOnMinimap(zoomed, bounds, {
        minX: center.x - 320,
        maxX: center.x + 320,
        minY: center.y - 180,
        maxY: center.y + 180,
      });
      if (rect === null) throw new Error('Expected the centered camera rectangle');
      expect(rect.w / rect.h).toBeCloseTo(16 / 9);
    }
  });

  it('clamps a view hanging off the map edge to a partial frame inside the picture', () => {
    const rect = viewportRectOnMinimap(layout, bounds, {
      minX: bounds.minX - 500,
      minY: bounds.minY - 500,
      maxX: bounds.minX + 500,
      maxY: bounds.minY + 500,
    });
    expect(rect).not.toBeNull();
    expect(rect?.x).toBeCloseTo(layout.map.x);
    expect(rect?.y).toBeCloseTo(layout.map.y);
  });

  it('returns null for a view entirely off the map', () => {
    expect(
      viewportRectOnMinimap(layout, bounds, {
        minX: -9000,
        minY: -9000,
        maxX: -8000,
        maxY: -8000,
      }),
    ).toBeNull();
  });
});

describe('PLAYER_SWATCH_COLORS', () => {
  it('carries one distinct swatch per player colour slot', () => {
    expect(PLAYER_SWATCH_COLORS.length).toBe(PLAYER_COLOR_COUNT);
    expect(new Set(PLAYER_SWATCH_COLORS).size).toBe(PLAYER_COLOR_COUNT);
  });
});

describe('stampDot', () => {
  const W = 8;
  const H = 6;
  const pixel = (rgba: Uint8Array, x: number, y: number): readonly number[] => {
    const o = (y * W + x) * 4;
    return [rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0, rgba[o + 3] ?? 0];
  };

  it('stamps an opaque square of the colour bytes around the centre', () => {
    const rgba = new Uint8Array(W * H * 4);
    stampDot(rgba, W, H, 4, 3, 1, 0x123456); // 2×2 px: [3,5) × [2,4)
    expect(pixel(rgba, 3, 2)).toEqual([0x12, 0x34, 0x56, 0xff]);
    expect(pixel(rgba, 4, 3)).toEqual([0x12, 0x34, 0x56, 0xff]);
    expect(pixel(rgba, 2, 2)).toEqual([0, 0, 0, 0]); // one left of the square
    expect(pixel(rgba, 5, 4)).toEqual([0, 0, 0, 0]); // one past its far corner
  });

  it('clips a dot straddling the buffer edge instead of wrapping', () => {
    const rgba = new Uint8Array(W * H * 4);
    stampDot(rgba, W, H, 0, 0, 1.5, 0xffffff); // 3×3 block centred on the corner
    expect(pixel(rgba, 0, 0)[3]).toBe(0xff);
    expect(pixel(rgba, 1, 1)[3]).toBe(0xff);
    // Nothing wrapped to the right edge of the rows above/below.
    expect(pixel(rgba, W - 1, 0)[3]).toBe(0);
    expect(pixel(rgba, W - 1, 1)[3]).toBe(0);
  });

  it('draws nothing for a dot entirely outside the buffer', () => {
    const rgba = new Uint8Array(W * H * 4);
    stampDot(rgba, W, H, -5, -5, 1, 0xffffff);
    stampDot(rgba, W, H, W + 5, H + 5, 1, 0xffffff);
    expect(rgba.every((b) => b === 0)).toBe(true);
  });
});

describe('fillFogMask', () => {
  /** A 3×2 grid: the three states across the top row, all-visible below - so a row-major write is
   *  distinguishable from a transposed or wrongly strided one. */
  const GRID = {
    cellsWide: 3,
    cellsHigh: 2,
    stateAt: (c: number, r: number): number =>
      r > 0
        ? FOG_STATE.VISIBLE
        : ([FOG_STATE.VISIBLE, FOG_STATE.EXPLORED, FOG_STATE.UNEXPLORED][c] ?? FOG_STATE.UNEXPLORED),
  };
  const alphaLane = (rgba: Uint8Array): number[] =>
    Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3] ?? 0);

  it('grades the alpha lane by fog state, row-major, and tints only unexplored ground', () => {
    const rgba = new Uint8Array(GRID.cellsWide * GRID.cellsHigh * 4);
    fillFogMask(GRID, rgba);

    expect(alphaLane(rgba)).toEqual([0, FOG_EXPLORED_ALPHA, FOG_UNEXPLORED_ALPHA, 0, 0, 0]);
    // Visible ground is clear and explored ground dims under black; unexplored takes the opaque tint.
    expect(Array.from(rgba.subarray(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(rgba.subarray(4, 7))).toEqual([0, 0, 0]);
    expect(Array.from(rgba.subarray(8, 11))).toEqual([
      (FOG_UNEXPLORED_TINT >> 16) & 0xff,
      (FOG_UNEXPLORED_TINT >> 8) & 0xff,
      FOG_UNEXPLORED_TINT & 0xff,
    ]);
  });

  it('clears a cell that turned visible again on the next fill', () => {
    const rgba = new Uint8Array(4);
    fillFogMask({ cellsWide: 1, cellsHigh: 1, stateAt: () => FOG_STATE.UNEXPLORED }, rgba);
    expect(rgba[3]).toBe(FOG_UNEXPLORED_ALPHA);
    fillFogMask({ cellsWide: 1, cellsHigh: 1, stateAt: () => FOG_STATE.VISIBLE }, rgba);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 0]);
  });
});
