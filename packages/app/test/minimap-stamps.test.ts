import { describe, expect, it } from 'vitest';
import { type DotRaster, type MinimapMark, stampMark } from '../src/hud/minimap/stamps.js';

const SIDE = 16;
const CENTRE = SIDE / 2;
const COLOUR = 0x3366cc;

function stamped(mark: MinimapMark, pxPerMinimapPx = 2, cx = CENTRE, cy = CENTRE): DotRaster {
  const raster = { rgba: new Uint8Array(SIDE * SIDE * 4), width: SIDE, height: SIDE };
  stampMark(raster, cx, cy, mark, COLOUR, pxPerMinimapPx);
  return raster;
}

function colourAt(raster: DotRaster, x: number, y: number): number | null {
  const o = (y * raster.width + x) * 4;
  if (raster.rgba[o + 3] === 0) return null;
  return ((raster.rgba[o] ?? 0) << 16) | ((raster.rgba[o + 1] ?? 0) << 8) | (raster.rgba[o + 2] ?? 0);
}

function painted(raster: DotRaster): number {
  let count = 0;
  for (let i = 3; i < raster.rgba.length; i += 4) if (raster.rgba[i] !== 0) count++;
  return count;
}

describe('stampMark', () => {
  it('draws a soldier as a player-coloured diamond inside a dark rim, larger than a civilian', () => {
    const soldier = stamped('soldier');
    expect(colourAt(soldier, CENTRE, CENTRE)).toBe(COLOUR);
    const rim = colourAt(soldier, CENTRE, CENTRE - 4);
    expect(rim).not.toBeNull();
    expect(rim).not.toBe(COLOUR);
    expect(colourAt(soldier, CENTRE - 4, CENTRE - 4)).toBeNull(); // a diamond leaves its corners empty
    expect(painted(soldier)).toBeGreaterThan(painted(stamped('civilian')));
  });

  it('rims a vehicle in a pale outline around its own colour', () => {
    const cart = stamped('vehicle');
    expect(colourAt(cart, CENTRE, CENTRE)).toBe(COLOUR);
    const rim = colourAt(cart, CENTRE - 3, CENTRE - 3);
    expect(rim).not.toBeNull();
    expect(rim).not.toBe(COLOUR);
  });

  it('stands a signpost taller than wide', () => {
    const post = stamped('signpost', 4);
    expect(colourAt(post, CENTRE, CENTRE - 4)).toBe(COLOUR);
    expect(colourAt(post, CENTRE - 3, CENTRE)).toBeNull();
  });

  it('keeps every mark at least one px when zoomed far in, and clips at the edges', () => {
    for (const mark of [
      'civilian',
      'soldier',
      'building',
      'vehicle',
      'animal',
      'road',
      'signpost',
    ] as const) {
      expect(painted(stamped(mark, 0.01))).toBeGreaterThan(0);
      expect(() => stamped(mark, 2, -1, SIDE)).not.toThrow();
    }
    expect(painted(stamped('building', 2, -10, -10))).toBe(0);
  });
});
