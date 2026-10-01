import { describe, expect, it } from 'vitest';
import {
  buildMinimapCellField,
  canopyShadow,
  FIELD_COVER,
  FIELD_DEPTH,
  FIELD_FOREST,
  FIELD_LAND_B,
  FIELD_LAND_G,
  FIELD_LAND_R,
  FIELD_STRIDE,
  FIELD_WATER_B,
  FIELD_WATER_G,
  FIELD_WATER_R,
  waterRamp,
} from '../src/data/terrain/minimap-cells.js';
import { LandPainter } from '../src/data/terrain/minimap-land.js';
import { cellLight, MINIMAP_LIGHT } from '../src/data/terrain/minimap-light.js';
import { valueNoisePair } from '../src/data/terrain/minimap-noise.js';
import { SAMPLE_LANES } from '../src/data/terrain/minimap-sampler.js';
import type { MinimapScene } from '../src/data/terrain/minimap-scene.js';
import { SeaPainter } from '../src/data/terrain/minimap-sea.js';
import {
  classifyGround,
  contrastCurve,
  type Dome,
  type GroundClass,
  lightFrame,
  luma,
  type Rgb,
  sampleDomes,
  textureFade,
} from '../src/data/terrain/minimap-texture.js';

const SIZE = 24;
const GREY = 0x808080;
const SAND = 0xc8a060;
const GRASS = 0x5a9a32;
/** Channel shifts of a packed `0xRRGGBB` colour. */
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const BLUE_SHIFT = 0;
/** Picture pitches, in px per cell: an old one-px-per-cell picture and a full-detail in-game bake. */
const SMALL_CELL_PX = 1.6;
const LARGE_CELL_PX = 12;
const WORLD_STEP = 37;
const PROBES = 40;

const light = lightFrame(MINIMAP_LIGHT);

function scene(overrides: Partial<MinimapScene> = {}): MinimapScene {
  return {
    width: SIZE,
    height: SIZE,
    typeIds: new Array<number>(SIZE * SIZE).fill(0),
    colourOfCell: () => GREY,
    ...overrides,
  };
}

function lane(fn: (col: number, row: number) => number): number[] {
  return Array.from({ length: SIZE * SIZE }, (_, i) => fn(i % SIZE, Math.floor(i / SIZE)));
}

function fieldAt(field: Float32Array, col: number, row: number, lane: number): number {
  return field[(row * SIZE + col) * FIELD_STRIDE + lane] ?? 0;
}

const rgbLuma = (rgb: Rgb): number => luma(rgb.r, rgb.g, rgb.b);

describe('textureFade', () => {
  const period = 0.5;
  /** Pitches at which a half-cell period spans one and two px: too short to draw. */
  const onePxPitch = 2;
  const twoPxPitch = 4;
  const fullPitch = 20;

  it('is zero while the period is too short to draw, then rises to one', () => {
    expect(textureFade(period, onePxPitch)).toBe(0);
    expect(textureFade(period, twoPxPitch)).toBe(0);
    let previous = 0;
    for (let cellPx = 1; cellPx <= fullPitch; cellPx++) {
      const fade = textureFade(period, cellPx);
      expect(fade).toBeGreaterThanOrEqual(previous);
      previous = fade;
    }
    expect(textureFade(period, fullPitch)).toBe(1);
  });
});

describe('classifyGround', () => {
  const out: GroundClass = { grass: 0, soil: 0, rock: 0 };
  const classify = (colour: number): GroundClass => {
    classifyGround((colour >> RED_SHIFT) & 0xff, (colour >> GREEN_SHIFT) & 0xff, colour & 0xff, out);
    return { ...out };
  };

  it('tells grey rock, green grass and sand apart, weights summing to one', () => {
    expect(classify(GREY).rock).toBeCloseTo(1);
    expect(classify(GRASS).grass).toBeGreaterThan(0.9);
    const sand = classify(SAND);
    expect(sand.soil).toBeGreaterThan(0.9);
    expect(sand.grass + sand.soil + sand.rock).toBeCloseTo(1);
  });
});

describe('sampleDomes', () => {
  const seed = 7;
  const radius = 0.6;
  const edge = 0.01;
  /** A step down-light, in lattice units, and the lattice spacing of the probes. */
  const step = 0.05;
  const probeU = 0.13;
  const probeV = 0.11;
  const domeAt = (u: number, v: number, jitter: number, out: Dome): void =>
    sampleDomes(u, v, seed, radius, jitter, edge, light.x, light.y, light.z, out);

  it('lights a dome on the side facing the light', () => {
    const dome: Dome = { cover: 0, light: 1 };
    const probe: Dome = { cover: 0, light: 1 };
    let litSide = 0;
    let pairs = 0;
    for (let i = 0; i < PROBES; i++) {
      for (let j = 0; j < PROBES; j++) {
        domeAt(i * probeU, j * probeV, 0, dome);
        domeAt(i * probeU + light.downX * step, j * probeV + light.downY * step, 0, probe);
        if (dome.cover < 1 || probe.cover < 1) continue;
        litSide += dome.light - probe.light;
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(0);
    expect(litSide / pairs).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const jitter = 0.3;
    const first: Dome = { cover: 0, light: 1 };
    const again: Dome = { cover: 0, light: 1 };
    domeAt(probeU * 10, probeV * 20, jitter, first);
    domeAt(probeU * 10, probeV * 20, jitter, again);
    expect(again).toEqual(first);
  });
});

describe('valueNoisePair', () => {
  it('gives two independent values in [0, 1), the same for the same input', () => {
    const a = new Float64Array(2);
    const b = new Float64Array(2);
    let differ = false;
    const seed = 3;
    const stepX = 0.37;
    const stepY = 0.21;
    const distinct = 0.05;
    for (let i = 0; i < PROBES; i++) {
      valueNoisePair(i * stepX, i * stepY, seed, a);
      valueNoisePair(i * stepX, i * stepY, seed, b);
      expect(b).toEqual(a);
      for (const v of a) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      if (Math.abs((a[0] ?? 0) - (a[1] ?? 0)) > distinct) differ = true;
    }
    expect(differ).toBe(true);
  });
});

describe('contrastCurve', () => {
  it('keeps black, white and mid-grey, darkens the shadows and lifts the highlights monotonically', () => {
    const white = 255;
    const mid = 128;
    const shadow = 64;
    const highlight = 192;
    const lut = contrastCurve();
    expect(lut[0]).toBe(0);
    expect(lut[white]).toBe(white);
    expect(Math.abs((lut[mid] ?? 0) - mid)).toBeLessThanOrEqual(1);
    expect(lut[shadow]).toBeLessThan(shadow);
    expect(lut[highlight]).toBeGreaterThan(highlight);
    for (let v = 1; v < lut.length; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1] ?? 0);
  });
});

describe('water depth', () => {
  it('darkens the ramp monotonically from the shallows to open water', () => {
    let previous = Number.POSITIVE_INFINITY;
    const step = 0.05;
    for (let t = 0; t <= 1; t += step) {
      const y = luma(waterRamp(t, RED_SHIFT), waterRamp(t, GREEN_SHIFT), waterRamp(t, BLUE_SHIFT));
      expect(y).toBeLessThan(previous);
      previous = y;
    }
  });

  it('deepens with the distance from the shore, and the water colour with it', () => {
    const coastCol = 4;
    const field = buildMinimapCellField(scene({ water: lane((col) => (col >= coastCol ? 1 : 0)) }));
    const row = SIZE / 2;
    let previousDepth = 0;
    let previousLuma = Number.POSITIVE_INFINITY;
    for (let col = coastCol; col < SIZE - 1; col++) {
      const depth = fieldAt(field, col, row, FIELD_DEPTH);
      const y = luma(
        fieldAt(field, col, row, FIELD_WATER_R),
        fieldAt(field, col, row, FIELD_WATER_G),
        fieldAt(field, col, row, FIELD_WATER_B),
      );
      expect(depth).toBeGreaterThan(previousDepth);
      expect(y).toBeLessThan(previousLuma);
      previousDepth = depth;
      previousLuma = y;
    }
  });
});

describe('canopyShadow', () => {
  it('falls on open ground down-light of a stand, never up-light of it or under it', () => {
    // A stand over the middle of the grid; the light comes from the upper left.
    const first = 8;
    const last = 13;
    const inStand = (col: number, row: number): boolean =>
      col >= first && col <= last && row >= first && row <= last;
    const shadow = canopyShadow(
      lane((col, row) => (inStand(col, row) ? 1 : 0)),
      SIZE,
      SIZE,
    );
    const at = (col: number, row: number): number => shadow[row * SIZE + col] ?? 0;
    // Row last + 1 is even, so its up-left touching cell is one column left, inside the stand.
    expect(at(last + 1, last + 1)).toBeGreaterThan(0);
    expect(at(first - 1, first - 1)).toBe(0);
    expect(at(first + 2, first + 2)).toBe(0);
    expect(at(last, first - 1)).toBe(0);
  });
});

describe('cell colour', () => {
  const middle = SIZE / 2;
  const landOf = (field: Float32Array, col: number, row: number): Rgb => ({
    r: fieldAt(field, col, row, FIELD_LAND_R),
    g: fieldAt(field, col, row, FIELD_LAND_G),
    b: fieldAt(field, col, row, FIELD_LAND_B),
  });
  const channelOf = (colour: number, shift: number): number => (colour >> shift) & 0xff;
  const greenOverRed = (colour: number): number =>
    channelOf(colour, GREEN_SHIFT) / channelOf(colour, RED_SHIFT);

  it('eases bright saturated greens toward grey and keeps dark greens and sand as they are', () => {
    const lime = 0x508a14;
    const darkGreen = 0x1c300a;
    const sand = 0x907048;
    const colours = [lime, darkGreen, sand];
    const field = buildMinimapCellField(
      scene({ colourOfCell: (cell) => colours[cell % colours.length] ?? GREY }),
    );
    const ratioAt = (col: number): number => {
      const land = landOf(field, col, middle);
      return land.g / land.r;
    };
    const near = 1e-4;
    expect(ratioAt(0)).toBeLessThan(greenOverRed(lime) * (1 - near));
    expect(ratioAt(1)).toBeCloseTo(greenOverRed(darkGreen), 4);
    expect(ratioAt(2)).toBeCloseTo(greenOverRed(sand), 4);
  });

  it('stretches the light on rock and cools its lit faces, unlike soil', () => {
    const rock = 0x606060;
    const soil = 0x907048;
    const ridge = lane((col) => 60 - 6 * Math.abs(col - middle));
    const litCol = middle - 4;
    const shadedCol = middle + 4;
    const contrast = (colour: number): { readonly ratio: number; readonly lit: Rgb } => {
      const field = buildMinimapCellField(scene({ colourOfCell: () => colour, elevation: ridge }));
      const lit = landOf(field, litCol, middle);
      return { ratio: rgbLuma(lit) / rgbLuma(landOf(field, shadedCol, middle)), lit };
    };
    const rockFaces = contrast(rock);
    expect(rockFaces.ratio).toBeGreaterThan(contrast(soil).ratio);
    expect(rockFaces.lit.b).toBeGreaterThan(rockFaces.lit.r);
  });

  it('smooths the fine relief under a closed canopy', () => {
    const bumps = scene({ elevation: lane((col, row) => ((col * 7 + row * 3) % 5) * 8) });
    const swing = (light: Float32Array): number => light.reduce((sum, v) => sum + Math.abs(v - 1), 0);
    const bare = cellLight(bumps).light;
    const wooded = cellLight(bumps, undefined, new Array<number>(SIZE * SIZE).fill(1)).light;
    expect(swing(wooded)).toBeLessThan(swing(bare));
  });
});

describe('sub-cell texture', () => {
  const water = 0x1e5a82;
  /** The luma spread, 0..255, from which a texture counts as visible. */
  const visibleSpread = 5;
  /** The probes walk a diagonal across many texture periods. */
  const slope = 0.7;
  const coastCover = 0.55;

  /** A sample of uniform ground or water: `colour` in the lanes from `firstLane`. */
  function sampleOf(colour: number, firstLane: number): Float64Array {
    const sample = new Float64Array(SAMPLE_LANES);
    sample[firstLane] = (colour >> RED_SHIFT) & 0xff;
    sample[firstLane + 1] = (colour >> GREEN_SHIFT) & 0xff;
    sample[firstLane + 2] = (colour >> BLUE_SHIFT) & 0xff;
    return sample;
  }

  /** The luma spread of `paint` over probes along a diagonal of the world. */
  function spread(paint: (x: number, y: number, i: number, out: Rgb) => void): number {
    const out: Rgb = { r: 0, g: 0, b: 0 };
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (let i = 0; i < PROBES; i++) {
      paint(i * WORLD_STEP, i * WORLD_STEP * slope, i, out);
      min = Math.min(min, rgbLuma(out));
      max = Math.max(max, rgbLuma(out));
    }
    return max - min;
  }

  function landSpread(cellPx: number, colour: number, forest: number): number {
    const painter = new LandPainter(cellPx, true, light);
    const sample = sampleOf(colour, FIELD_LAND_R);
    sample[FIELD_FOREST] = forest;
    return spread((x, y, i, out) => painter.paint(sample, x, y, i, i, out));
  }

  function seaSpread(cellPx: number): number {
    const painter = new SeaPainter(cellPx, true, light);
    const sample = sampleOf(water, FIELD_WATER_R);
    sample[FIELD_COVER] = 1;
    sample[FIELD_DEPTH] = 1;
    return spread((x, y, _, out) => painter.paint(sample, x, y, out));
  }

  it('textures grass, rock and canopy at full detail and fades out on a small picture', () => {
    for (const [colour, forest] of [
      [GRASS, 0],
      [GREY, 0],
      [SAND, 1],
    ] as const) {
      expect(landSpread(LARGE_CELL_PX, colour, forest)).toBeGreaterThan(visibleSpread);
      expect(landSpread(SMALL_CELL_PX, colour, forest)).toBe(0);
    }
  });

  it('ripples the water at full detail only', () => {
    expect(seaSpread(LARGE_CELL_PX)).toBeGreaterThan(visibleSpread);
    expect(seaSpread(SMALL_CELL_PX)).toBe(0);
  });

  it('pales the water at the coast into the shallows band', () => {
    const painter = new SeaPainter(SMALL_CELL_PX, false, light);
    const sample = sampleOf(water, FIELD_WATER_R);
    const out: Rgb = { r: 0, g: 0, b: 0 };
    sample[FIELD_COVER] = coastCover;
    painter.paint(sample, 0, 0, out);
    const shore = rgbLuma(out);
    sample[FIELD_COVER] = 1;
    painter.paint(sample, 0, 0, out);
    expect(shore).toBeGreaterThan(rgbLuma(out));
  });
});
