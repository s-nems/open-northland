import { describe, expect, it } from 'vitest';
import { MINIMAP_MARKER_SIZES } from '../src/hud/minimap/filters.js';
import { MARKER_RIM_COLOUR } from '../src/hud/minimap/palette.js';
import {
  type DotRaster,
  MARKER_SIZE_SCALES,
  type MinimapMark,
  stampMark,
} from '../src/hud/minimap/stamps.js';

const SIDE = 24;
const CENTRE = SIDE / 2;
const COLOUR = 0x3366cc;

/** Large enough that each size step crosses a whole raster px even for the smallest mark. */
const SIZE_TEST_PX_PER_MINIMAP_PX = 5;
const OWNED_MARKS = ['civilian', 'soldier', 'building', 'vehicle', 'signpost'] as const;

function stamped(
  mark: MinimapMark,
  pxPerMinimapPx = 2,
  cx = CENTRE,
  cy = CENTRE,
  markerScale = 1,
): DotRaster {
  const raster = { rgba: new Uint8Array(SIDE * SIDE * 4), width: SIDE, height: SIDE };
  stampMark(raster, cx, cy, mark, COLOUR, pxPerMinimapPx, markerScale);
  return raster;
}

function colourAt(raster: DotRaster, x: number, y: number): number | null {
  const o = (y * raster.width + x) * 4;
  if (raster.rgba[o + 3] === 0) return null;
  return ((raster.rgba[o] ?? 0) << 16) | ((raster.rgba[o + 1] ?? 0) << 8) | (raster.rgba[o + 2] ?? 0);
}

function painted(raster: DotRaster, colour?: number): number {
  let count = 0;
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++) {
      const at = colourAt(raster, x, y);
      if (at !== null && (colour === undefined || at === colour)) count++;
    }
  return count;
}

/** The painted colours other than the fill. */
function rimColours(raster: DotRaster): Set<number> {
  const colours = new Set<number>();
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++) {
      const at = colourAt(raster, x, y);
      if (at !== null && at !== COLOUR) colours.add(at);
    }
  return colours;
}

describe('stampMark', () => {
  it('draws a soldier as a player-coloured diamond inside a dark rim, larger than a civilian', () => {
    const soldier = stamped('soldier');
    expect(colourAt(soldier, CENTRE, CENTRE)).toBe(COLOUR);
    const rim = colourAt(soldier, CENTRE, CENTRE - 4);
    expect(rim).not.toBeNull();
    expect(rim).not.toBe(COLOUR);
    expect(colourAt(soldier, CENTRE - 4, CENTRE - 4)).toBeNull(); // a diamond leaves its corners empty
    expect(painted(soldier, COLOUR)).toBeGreaterThan(painted(stamped('civilian'), COLOUR));
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
    expect(colourAt(post, CENTRE - 3, CENTRE)).not.toBe(COLOUR);
  });

  it('rims every owned mark, in dark but for the pale vehicle rim, and leaves animals and roads bare', () => {
    for (const mark of OWNED_MARKS) {
      const rims = [...rimColours(stamped(mark))];
      expect(rims, mark).toHaveLength(1);
      if (mark === 'vehicle') expect(rims[0]).not.toBe(MARKER_RIM_COLOUR);
      else expect(rims[0], mark).toBe(MARKER_RIM_COLOUR);
    }
    for (const mark of ['animal', 'road', 'roadSite'] as const)
      expect(rimColours(stamped(mark)).size).toBe(0);
  });

  it('scales the marker body with the size choice, never the rim', () => {
    for (const mark of [...OWNED_MARKS, 'animal'] as const) {
      const fills = MINIMAP_MARKER_SIZES.map((size) =>
        painted(stamped(mark, SIZE_TEST_PX_PER_MINIMAP_PX, CENTRE, CENTRE, MARKER_SIZE_SCALES[size]), COLOUR),
      );
      expect(fills[0], mark).toBeLessThan(fills[1] ?? 0);
      expect(fills[1], mark).toBeLessThan(fills[2] ?? 0);
    }
    // The rim keeps one width: a civilian's ring grows only by the body's perimeter.
    const ringOf = (scale: number): number => {
      const raster = stamped('civilian', 2, CENTRE, CENTRE, scale);
      return Math.sqrt(painted(raster)) - Math.sqrt(painted(raster, COLOUR));
    };
    expect(ringOf(MARKER_SIZE_SCALES.small)).toBe(ringOf(MARKER_SIZE_SCALES.large));
  });

  it('keeps every mark at least one px when zoomed far in, and clips at the edges', () => {
    for (const mark of [...OWNED_MARKS, 'animal', 'road'] as const) {
      const tiny = stamped(mark, 0.01, CENTRE, CENTRE, MARKER_SIZE_SCALES.small);
      expect(painted(tiny, COLOUR), mark).toBeGreaterThan(0);
      if (mark !== 'animal' && mark !== 'road') expect(rimColours(tiny).size, mark).toBe(1);
      expect(() => stamped(mark, 2, -1, SIDE)).not.toThrow();
    }
    expect(painted(stamped('building', 2, -10, -10))).toBe(0);
  });
});
