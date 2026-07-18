import { TILE_HALF_H, TILE_HALF_W, tileToScreen } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { PLAYER_COLOR_COUNT, PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import {
  FRAME_NATIVE,
  minimapLayout,
  minimapToWorld,
  pointOverMinimap,
  pointOverMinimapHole,
  rasterizeTerrain,
  terrainWorldBounds,
  viewportRectOnMinimap,
  worldToMinimap,
} from '../src/hud/minimap/model.js';
import { cameraCenteredOnWorld } from '../src/view/camera/index.js';

const GRID_4 = { width: 4, height: 4, typeIds: Array.from({ length: 16 }, (_, i) => i % 4) };
const FLAT = (typeId: number): number => [0xaa0000, 0x00bb00, 0x0000cc, 0xdddddd][typeId] ?? 0;
const UISCALE = 1.4;

describe('terrainWorldBounds', () => {
  it('covers every cell diamond, including the odd-row half-cell stagger', () => {
    const bounds = terrainWorldBounds(4, 4);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const center = tileToScreen(col, row);
        expect(center.x - TILE_HALF_W).toBeGreaterThanOrEqual(bounds.minX);
        expect(center.x + TILE_HALF_W).toBeLessThanOrEqual(bounds.minX + bounds.width);
        expect(center.y - TILE_HALF_H).toBeGreaterThanOrEqual(bounds.minY);
        expect(center.y + TILE_HALF_H).toBeLessThanOrEqual(bounds.minY + bounds.height);
      }
    }
  });
});

describe('minimapLayout', () => {
  const bounds = terrainWorldBounds(256, 256);

  it('pins the fixed-size framed window flush to the bottom-left corner', () => {
    const layout = minimapLayout(bounds, 800, UISCALE);
    expect(layout.panel.x).toBe(0);
    expect(layout.panel.y + layout.panel.h).toBe(800);
    expect(layout.panel.w / layout.panel.h).toBeCloseTo(FRAME_NATIVE.w / FRAME_NATIVE.h);
    expect(layout.panel.w).toBeCloseTo(FRAME_NATIVE.w * layout.artScale);
  });

  it('letterboxes a non-square map inside the hole, aspect preserved and centred', () => {
    const layout = minimapLayout(bounds, 800, UISCALE);
    expect(layout.map.w / layout.map.h).toBeCloseTo(bounds.width / bounds.height);
    expect(layout.map.w).toBeCloseTo(layout.inner.w);
    expect(layout.map.y - layout.inner.y).toBeCloseTo(
      layout.inner.y + layout.inner.h - (layout.map.y + layout.map.h),
    );
    expect(layout.map.x).toBeGreaterThanOrEqual(layout.inner.x);
    expect(layout.map.y).toBeGreaterThanOrEqual(layout.inner.y);
  });

  it('scales the whole window with the UI scale and clamps it at 1', () => {
    const one = minimapLayout(bounds, 800, 1);
    const half = minimapLayout(bounds, 800, 0.5);
    const two = minimapLayout(bounds, 800, 2);
    expect(half.panel.w).toBe(one.panel.w);
    expect(two.panel.w).toBeCloseTo(one.panel.w * 2);
  });

  it('tracks the live screen height (a resize slides the window, never rescales it)', () => {
    const tall = minimapLayout(bounds, 1000, UISCALE);
    const short = minimapLayout(bounds, 700, UISCALE);
    expect(tall.panel.w).toBe(short.panel.w);
    expect(tall.panel.h).toBe(short.panel.h);
    expect(tall.panel.y - short.panel.y).toBe(300);
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
    const braidX = layout.inner.x + layout.inner.w + 1;
    expect(pointOverMinimap(layout, braidX, layout.inner.y + 1)).toBe(true);
    expect(pointOverMinimapHole(layout, braidX, layout.inner.y + 1)).toBe(false);
    expect(pointOverMinimapHole(layout, layout.inner.x + 1, layout.inner.y + 1)).toBe(true);
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

describe('rasterizeTerrain', () => {
  const colourAt = (rgba: Uint8Array, pxW: number, px: number, py: number): number => {
    const offset = (py * pxW + px) * 4;
    return ((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);
  };

  it('paints each pixel with its containing cell diamond and full alpha', () => {
    const pxW = 90;
    const pxH = 50;
    const rgba = rasterizeTerrain(GRID_4, (_cell, typeId) => FLAT(typeId), pxW, pxH);
    expect(rgba.length).toBe(pxW * pxH * 4);
    const bounds = terrainWorldBounds(GRID_4.width, GRID_4.height);
    for (let row = 0; row < GRID_4.height; row++) {
      for (let col = 0; col < GRID_4.width; col++) {
        const center = tileToScreen(col, row);
        const px = Math.floor(((center.x - bounds.minX) / bounds.width) * pxW);
        const py = Math.floor(((center.y - bounds.minY) / bounds.height) * pxH);
        expect(colourAt(rgba, pxW, px, py)).toBe(FLAT(GRID_4.typeIds[row * GRID_4.width + col] ?? 0));
        expect(rgba[(py * pxW + px) * 4 + 3]).toBe(0xff);
      }
    }
  });

  it('feeds the winning cell index alongside its typeId', () => {
    const seen = new Set<number>();
    rasterizeTerrain(
      GRID_4,
      (cell) => {
        seen.add(cell);
        return 0;
      },
      40,
      20,
    );
    expect(seen.size).toBe(GRID_4.typeIds.length);
  });
});

describe('PLAYER_SWATCH_COLORS', () => {
  it('carries one distinct swatch per player colour slot', () => {
    expect(PLAYER_SWATCH_COLORS.length).toBe(PLAYER_COLOR_COUNT);
    expect(new Set(PLAYER_SWATCH_COLORS).size).toBe(PLAYER_COLOR_COUNT);
  });
});
