import { TILE_HALF_H, TILE_HALF_W, tileToScreen } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import { PLAYER_COLOR_COUNT, PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import {
  MINIMAP_CELL_UNRESOLVED,
  averagePatternColour,
  cellColoursFromGround,
} from '../src/content/minimap-ground.js';
import {
  keyEdgeConnectedNearBlack,
  outlineOpaqueSilhouette,
} from '../src/hud/minimap/frame-keying.js';
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
import { cameraCenteredOnWorld } from '../src/view/camera.js';

/**
 * The headless half of the minimap: layout/projection/raster math and the ground-lane colour join are
 * pure, so they're unit-tested here. The Pixi mount, the braided frame art and the click feel are
 * human-gated in the browser check.
 */

/** A map grid whose four typeIds paint distinguishable raster colours. */
const GRID_4 = { width: 4, height: 4, typeIds: Array.from({ length: 16 }, (_, i) => i % 4) };
const FLAT = (typeId: number): number => [0xaa0000, 0x00bb00, 0x0000cc, 0xdddddd][typeId] ?? 0;
const UISCALE = 1.4;

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

  it('pins the fixed-size framed window flush to the bottom-left corner', () => {
    const l = minimapLayout(bounds, 800, UISCALE);
    expect(l.panel.x).toBe(0);
    expect(l.panel.y + l.panel.h).toBe(800);
    // The frame keeps the art's native aspect at the uiscale-driven size.
    expect(l.panel.w / l.panel.h).toBeCloseTo(FRAME_NATIVE.w / FRAME_NATIVE.h);
    expect(l.panel.w).toBeCloseTo(FRAME_NATIVE.w * l.artScale);
  });

  it('letterboxes a non-square map inside the hole, aspect preserved and centred', () => {
    const l = minimapLayout(bounds, 800, UISCALE);
    expect(l.map.w / l.map.h).toBeCloseTo(bounds.width / bounds.height);
    // The wide map fills the hole's width; the leftover height splits into equal bars.
    expect(l.map.w).toBeCloseTo(l.inner.w);
    expect(l.map.y - l.inner.y).toBeCloseTo(l.inner.y + l.inner.h - (l.map.y + l.map.h));
    // The map never leaves the hole.
    expect(l.map.x).toBeGreaterThanOrEqual(l.inner.x);
    expect(l.map.y).toBeGreaterThanOrEqual(l.inner.y);
  });

  it('scales the whole window with the UI scale and clamps it at 1', () => {
    const one = minimapLayout(bounds, 800, 1);
    const half = minimapLayout(bounds, 800, 0.5); // sub-1 clamps
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
    const w0 = tileToScreen(17, 42);
    const m = worldToMinimap(layout, bounds, w0.x, w0.y);
    const w1 = minimapToWorld(layout, bounds, m.x, m.y);
    expect(w1.x).toBeCloseTo(w0.x);
    expect(w1.y).toBeCloseTo(w0.y);
  });

  it('maps the world corners onto the map picture corners (inside the hole)', () => {
    const tl = worldToMinimap(layout, bounds, bounds.minX, bounds.minY);
    expect(tl.x).toBeCloseTo(layout.map.x);
    expect(tl.y).toBeCloseTo(layout.map.y);
    const br = worldToMinimap(layout, bounds, bounds.minX + bounds.width, bounds.minY + bounds.height);
    expect(br.x).toBeCloseTo(layout.map.x + layout.map.w);
    expect(br.y).toBeCloseTo(layout.map.y + layout.map.h);
  });

  it('claims the framed window; only the hole is a jump surface', () => {
    expect(pointOverMinimap(layout, layout.panel.x + 1, layout.panel.y + 1)).toBe(true);
    expect(pointOverMinimap(layout, layout.panel.x + layout.panel.w + 1, layout.panel.y + 1)).toBe(false);
    // A point on the braid (right of the hole, still in the panel) claims but does not jump.
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
  const layout = minimapLayout(bounds, 800, UISCALE);

  it('clamps a view hanging off the map edge to a partial frame inside the picture', () => {
    const r = viewportRectOnMinimap(layout, bounds, {
      minX: bounds.minX - 500,
      minY: bounds.minY - 500,
      maxX: bounds.minX + 500,
      maxY: bounds.minY + 500,
    });
    expect(r).not.toBeNull();
    expect(r?.x).toBeCloseTo(layout.map.x);
    expect(r?.y).toBeCloseTo(layout.map.y);
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
    const rgba = rasterizeTerrain(GRID_4, (_cell, typeId) => FLAT(typeId), pxW, pxH);
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

  it('feeds the winning cell index alongside its typeId (per-cell colour tables key on it)', () => {
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
    expect(seen.size).toBe(GRID_4.typeIds.length); // every cell of the 4×4 grid sampled at least once
  });
});

describe('minimap ground-lane colours', () => {
  it('averages a page rect skipping transparent texels', () => {
    // A 2×2 page: two opaque pixels (red, blue) + two fully transparent ones.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0, 9, 9, 9, 0]);
    const avg = averagePatternColour(rgba, 2, 2, { x: 0, y: 0, w: 2, h: 2 });
    expect(avg).toBe((128 << 16) | (0 << 8) | 128);
  });

  it('returns undefined for an all-transparent or out-of-bounds rect', () => {
    const rgba = new Uint8ClampedArray([9, 9, 9, 0]);
    expect(averagePatternColour(rgba, 1, 1, { x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    expect(averagePatternColour(rgba, 1, 1, { x: 5, y: 5, w: 2, h: 2 })).toBeUndefined();
  });

  it('mixes the two triangle patterns per cell and marks unresolved cells', () => {
    const ground = { patterns: ['water', 'grass', 'missing'], a: [0, 2], b: [1, 2] };
    const colour = (i: number): number | undefined => [0x000080, 0x008000, undefined][i];
    const cells = cellColoursFromGround(ground, 2, colour);
    expect(cells[0]).toBe((0 << 16) | (0x40 << 8) | 0x40); // mean of water+grass
    expect(cells[1]).toBe(MINIMAP_CELL_UNRESOLVED); // neither triangle resolved
  });

  it('falls back to the single resolved triangle when the other pattern is unknown', () => {
    const ground = { patterns: ['water', 'missing'], a: [0], b: [1] };
    const cells = cellColoursFromGround(ground, 1, (i) => (i === 0 ? 0x123456 : undefined));
    expect(cells[0]).toBe(0x123456);
  });
});

describe('keyEdgeConnectedNearBlack', () => {
  const BLACK = [8, 8, 8, 255];
  const WOOD = [180, 140, 90, 255];
  const CLEAR = [0, 0, 0, 0];
  const grid = (cells: number[][][]): Uint8ClampedArray => new Uint8ClampedArray(cells.flat(2));
  const alphaAt = (rgba: Uint8ClampedArray, w: number, x: number, y: number): number =>
    rgba[(y * w + x) * 4 + 3] ?? -1;

  it('keys the edge-connected near-black outside but keeps enclosed shadows opaque', () => {
    // A wood ring encloses a near-black pocket; near-black background surrounds the ring.
    const rgba = grid([
      [BLACK, BLACK, BLACK, BLACK, BLACK],
      [BLACK, WOOD, WOOD, WOOD, BLACK],
      [BLACK, WOOD, BLACK, WOOD, BLACK],
      [BLACK, WOOD, WOOD, WOOD, BLACK],
      [BLACK, BLACK, BLACK, BLACK, BLACK],
    ]);
    keyEdgeConnectedNearBlack(rgba, 5, 5);
    expect(alphaAt(rgba, 5, 0, 0)).toBe(0); // background cleared…
    expect(alphaAt(rgba, 5, 4, 2)).toBe(0);
    expect(alphaAt(rgba, 5, 2, 2)).toBe(255); // …the enclosed crevice shadow stays
    expect(alphaAt(rgba, 5, 1, 1)).toBe(255); // the braid itself is untouched
  });

  it('flows through already-transparent pixels into a black region they connect to the edge', () => {
    const rgba = grid([
      [WOOD, CLEAR, WOOD],
      [WOOD, BLACK, WOOD],
      [WOOD, WOOD, WOOD],
    ]);
    keyEdgeConnectedNearBlack(rgba, 3, 3);
    expect(alphaAt(rgba, 3, 1, 1)).toBe(0); // reached via the transparent conduit above it
    expect(alphaAt(rgba, 3, 0, 1)).toBe(255);
  });
});

describe('outlineOpaqueSilhouette', () => {
  const W = [180, 140, 90, 255]; // an opaque silhouette pixel
  const C = [0, 0, 0, 0]; // transparent
  const grid = (cells: number[][][]): Uint8ClampedArray => new Uint8ClampedArray(cells.flat(2));
  const px = (rgba: Uint8ClampedArray, w: number, x: number, y: number): number[] =>
    Array.from(rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

  it('paints a black rim on the transparent side, growing by 4-connected distance', () => {
    const rgba = grid([
      [C, C, C, C, C],
      [C, C, C, C, C],
      [C, C, W, C, C],
      [C, C, C, C, C],
      [C, C, C, C, C],
    ]);
    outlineOpaqueSilhouette(rgba, 5, 5, 1);
    expect(px(rgba, 5, 2, 2)).toEqual(W); // the silhouette itself is untouched
    expect(px(rgba, 5, 1, 2)).toEqual([0, 0, 0, 255]); // 4-neighbours get the rim…
    expect(px(rgba, 5, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(px(rgba, 5, 1, 1)).toEqual(C); // …diagonals (distance 2) stay clear at thickness 1
    expect(px(rgba, 5, 0, 2)).toEqual(C);
  });

  it('grows the rim to the requested thickness', () => {
    const rgba = grid([
      [C, C, C, C, C],
      [C, C, C, C, C],
      [C, C, W, C, C],
      [C, C, C, C, C],
      [C, C, C, C, C],
    ]);
    outlineOpaqueSilhouette(rgba, 5, 5, 2);
    expect(px(rgba, 5, 0, 2)).toEqual([0, 0, 0, 255]); // distance 2 joins…
    expect(px(rgba, 5, 1, 1)).toEqual([0, 0, 0, 255]);
    expect(px(rgba, 5, 0, 0)).toEqual(C); // …distance 4 does not
  });
});

describe('PLAYER_SWATCH_COLORS', () => {
  it('carries one distinct swatch per player colour slot', () => {
    expect(PLAYER_SWATCH_COLORS.length).toBe(PLAYER_COLOR_COUNT);
    expect(new Set(PLAYER_SWATCH_COLORS).size).toBe(PLAYER_COLOR_COUNT);
  });
});
