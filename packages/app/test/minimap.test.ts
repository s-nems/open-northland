import { TILE_HALF_H, TILE_HALF_W, tileToScreen } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import { PLAYER_COLOR_COUNT, PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import {
  MINIMAP_MARGIN,
  MINIMAP_MAX_H,
  MINIMAP_MAX_W,
  minimapLayout,
  minimapToWorld,
  pointOverMinimap,
  rasterizeTerrain,
  terrainWorldBounds,
  viewportRectOnMinimap,
  worldToMinimap,
} from '../src/hud/minimap/model.js';
import { cameraCenteredOnWorld } from '../src/view/camera.js';

/**
 * The headless half of the minimap: layout/projection/raster math is pure, so it's unit-tested here.
 * The Pixi mount + the click feel (`mountMinimap`) are human-gated in the browser check.
 */

/** A map grid whose four typeIds paint distinguishable raster colours. */
const GRID_4 = { width: 4, height: 4, typeIds: Array.from({ length: 16 }, (_, i) => i % 4) };
const FLAT = (typeId: number): number => [0xaa0000, 0x00bb00, 0x0000cc, 0xdddddd][typeId] ?? 0;

describe('terrainWorldBounds', () => {
  it('covers every cell diamond, including the odd-row half-cell stagger', () => {
    const b = terrainWorldBounds(4, 4);
    // Every cell centre plus its diamond half-extents must lie inside the bounds.
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const c = tileToScreen(col, row);
        expect(c.x - TILE_HALF_W).toBeGreaterThanOrEqual(b.minX);
        expect(c.x + TILE_HALF_W).toBeLessThanOrEqual(b.minX + b.width);
        expect(c.y - TILE_HALF_H).toBeGreaterThanOrEqual(b.minY);
        expect(c.y + TILE_HALF_H).toBeLessThanOrEqual(b.minY + b.height);
      }
    }
  });
});

describe('minimapLayout', () => {
  const bounds = terrainWorldBounds(256, 256);

  it('fits the max box preserving the world aspect and anchors bottom-left', () => {
    const l = minimapLayout(bounds, 800);
    expect(l.rect.w).toBeLessThanOrEqual(MINIMAP_MAX_W);
    expect(l.rect.h).toBeLessThanOrEqual(MINIMAP_MAX_H);
    // Uniform scale: width/height ratio equals the world's.
    expect(l.rect.w / l.rect.h).toBeCloseTo(bounds.width / bounds.height);
    expect(l.rect.x).toBe(MINIMAP_MARGIN);
    expect(l.rect.y + l.rect.h).toBe(800 - MINIMAP_MARGIN);
  });

  it('tracks the live screen height (a resize slides the panel, never rescales it)', () => {
    const tall = minimapLayout(bounds, 1000);
    const short = minimapLayout(bounds, 700);
    expect(tall.rect.w).toBe(short.rect.w);
    expect(tall.rect.h).toBe(short.rect.h);
    expect(tall.rect.y - short.rect.y).toBe(300);
  });
});

describe('world↔minimap projection', () => {
  const bounds = terrainWorldBounds(64, 64);
  const layout = minimapLayout(bounds, 800);

  it('round-trips a world point through the minimap and back', () => {
    const w0 = tileToScreen(17, 42);
    const m = worldToMinimap(layout, bounds, w0.x, w0.y);
    const w1 = minimapToWorld(layout, bounds, m.x, m.y);
    expect(w1.x).toBeCloseTo(w0.x);
    expect(w1.y).toBeCloseTo(w0.y);
  });

  it('maps the world corners onto the panel corners', () => {
    const tl = worldToMinimap(layout, bounds, bounds.minX, bounds.minY);
    expect(tl).toMatchObject({ x: layout.rect.x, y: layout.rect.y });
    const br = worldToMinimap(layout, bounds, bounds.minX + bounds.width, bounds.minY + bounds.height);
    expect(br.x).toBeCloseTo(layout.rect.x + layout.rect.w);
    expect(br.y).toBeCloseTo(layout.rect.y + layout.rect.h);
  });

  it('claims exactly the panel rect', () => {
    expect(pointOverMinimap(layout, layout.rect.x + 1, layout.rect.y + 1)).toBe(true);
    expect(pointOverMinimap(layout, layout.rect.x - 1, layout.rect.y + 1)).toBe(false);
    expect(pointOverMinimap(layout, layout.rect.x + 1, layout.rect.y + layout.rect.h + 1)).toBe(false);
  });
});

describe('click-to-jump camera', () => {
  it('centres the clicked world point at the viewport centre, keeping the zoom', () => {
    const bounds = terrainWorldBounds(64, 64);
    const layout = minimapLayout(bounds, 800);
    const target = tileToScreen(30, 12);
    const m = worldToMinimap(layout, bounds, target.x, target.y);
    const w = minimapToWorld(layout, bounds, m.x, m.y);
    const cam = cameraCenteredOnWorld(w.x, w.y, 2, 1280, 800);
    // The clicked world point projects to the screen centre: screen = world*scale + offset.
    expect(target.x * 2 + cam.offsetX).toBeCloseTo(640);
    expect(target.y * 2 + cam.offsetY).toBeCloseTo(400);
    expect(cam.scale).toBe(2);
  });
});

describe('viewportRectOnMinimap', () => {
  const bounds = terrainWorldBounds(64, 64);
  const layout = minimapLayout(bounds, 800);

  it('clamps a view hanging off the map edge to a partial frame', () => {
    const r = viewportRectOnMinimap(layout, bounds, {
      minX: bounds.minX - 500,
      minY: bounds.minY - 500,
      maxX: bounds.minX + 500,
      maxY: bounds.minY + 500,
    });
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ x: 0, y: 0 });
  });

  it('returns null for a view entirely off the map', () => {
    const r = viewportRectOnMinimap(layout, bounds, { minX: -9000, minY: -9000, maxX: -8000, maxY: -8000 });
    expect(r).toBeNull();
  });
});

describe('rasterizeTerrain', () => {
  const colourAt = (rgba: Uint8Array, pxW: number, px: number, py: number): number => {
    const o = (py * pxW + px) * 4;
    return ((rgba[o] ?? 0) << 16) | ((rgba[o + 1] ?? 0) << 8) | (rgba[o + 2] ?? 0);
  };

  it('paints each pixel with its containing cell diamond (stagger respected) and full alpha', () => {
    const pxW = 90;
    const pxH = 50;
    const rgba = rasterizeTerrain(GRID_4, () => undefined, FLAT, pxW, pxH);
    expect(rgba.length).toBe(pxW * pxH * 4);
    const bounds = terrainWorldBounds(GRID_4.width, GRID_4.height);
    // Probe every cell CENTRE: the pixel over it must carry exactly that cell's colour.
    for (let row = 0; row < GRID_4.height; row++) {
      for (let col = 0; col < GRID_4.width; col++) {
        const c = tileToScreen(col, row);
        const px = Math.floor(((c.x - bounds.minX) / bounds.width) * pxW);
        const py = Math.floor(((c.y - bounds.minY) / bounds.height) * pxH);
        const expected = FLAT(GRID_4.typeIds[row * GRID_4.width + col] ?? 0);
        expect(colourAt(rgba, pxW, px, py)).toBe(expected);
        expect(rgba[(py * pxW + px) * 4 + 3]).toBe(0xff);
      }
    }
  });

  it('prefers the injected colour table and falls back per miss', () => {
    const rgba = rasterizeTerrain(GRID_4, (t) => (t === 1 ? 0x123456 : undefined), FLAT, 40, 20);
    const seen = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4) {
      seen.add(((rgba[i] ?? 0) << 16) | ((rgba[i + 1] ?? 0) << 8) | (rgba[i + 2] ?? 0));
    }
    expect(seen.has(0x123456)).toBe(true); // typeId 1 recoloured
    expect(seen.has(FLAT(1))).toBe(false); // its fallback never used
    expect(seen.has(FLAT(0))).toBe(true); // misses fall back
  });
});

describe('PLAYER_SWATCH_COLORS', () => {
  it('carries one distinct swatch per player colour slot', () => {
    expect(PLAYER_SWATCH_COLORS.length).toBe(PLAYER_COLOR_COUNT);
    expect(new Set(PLAYER_SWATCH_COLORS).size).toBe(PLAYER_COLOR_COUNT);
  });
});
