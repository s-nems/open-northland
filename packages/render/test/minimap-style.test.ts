import { describe, expect, it } from 'vitest';
import { tileToScreen } from '../src/data/projection/index.js';
import { terrainWorldBounds } from '../src/data/terrain/minimap.js';
import { buildMinimapCellField, FIELD_LAND_R, FIELD_STRIDE } from '../src/data/terrain/minimap-cells.js';
import { minimapFeatureOfGood, minimapObjectLanes } from '../src/data/terrain/minimap-features.js';
import { SAMPLE_LANES, sampleField } from '../src/data/terrain/minimap-sampler.js';
import { MINIMAP_DEPOSIT_KINDS, type MinimapScene, minimapScene } from '../src/data/terrain/minimap-scene.js';
import { rasterizeMinimap } from '../src/data/terrain/minimap-style.js';
import { waterCellFractions } from '../src/data/terrain/water.js';

const GREY = 0x808080;
const SAND = 0xc8a060;
const SIZE = 24;
const PX_W = 240;
const PX_H = 160;
/** Half a cell diamond's width in world px: the coast sits between two cell centres. */
const TILE_EDGE = tileToScreen(1, 0).x / 2;
/** How far past the coast, in px, the surf's brightest pixel may sit. */
const COAST_SEARCH_PX = 6;
/** More colours than land, water and a handful of grain variants. */
const MIN_BLENDED_COLOURS = 40;

function flatScene(overrides: Partial<MinimapScene> = {}): MinimapScene {
  return {
    width: SIZE,
    height: SIZE,
    typeIds: new Array<number>(SIZE * SIZE).fill(0),
    colourOfCell: () => GREY,
    ...overrides,
  };
}

/** Per-cell lane from a function of the cell's column and row. */
function lane(fn: (col: number, row: number) => number): number[] {
  return Array.from({ length: SIZE * SIZE }, (_, i) => fn(i % SIZE, Math.floor(i / SIZE)));
}

/** The pixel over cell `(col, row)`'s centre. */
function pixelAtCell(rgba: Uint8Array, col: number, row: number): readonly [number, number, number] {
  const bounds = terrainWorldBounds(SIZE, SIZE);
  const centre = tileToScreen(col, row);
  const px = Math.floor(((centre.x - bounds.minX) / bounds.width) * PX_W);
  const py = Math.floor(((centre.y - bounds.minY) / bounds.height) * PX_H);
  const o = (py * PX_W + px) * 4;
  return [rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0];
}

const luma = ([r, g, b]: readonly [number, number, number]): number => r + g + b;

/** Mean luma over the cells a predicate picks, away from the grid edge. */
function meanLuma(rgba: Uint8Array, pick: (col: number, row: number) => boolean): number {
  let sum = 0;
  let n = 0;
  for (let row = 4; row < SIZE - 4; row++) {
    for (let col = 2; col < SIZE - 2; col++) {
      if (!pick(col, row)) continue;
      sum += luma(pixelAtCell(rgba, col, row));
      n++;
    }
  }
  return sum / n;
}

describe('rasterizeMinimap', () => {
  it('fills an opaque picture of the requested size, the same bytes for the same scene', () => {
    const scene = flatScene({ elevation: lane((col, row) => (col * 7 + row * 3) % 40) });
    const first = rasterizeMinimap(scene, PX_W, PX_H);
    expect(first.length).toBe(PX_W * PX_H * 4);
    for (let o = 3; o < first.length; o += 4) expect(first[o]).toBe(0xff);
    expect(rasterizeMinimap(scene, PX_W, PX_H)).toEqual(first);
  });

  it('returns an empty picture for a degenerate size or grid', () => {
    expect(rasterizeMinimap(flatScene(), 0, PX_H).length).toBe(0);
    expect(rasterizeMinimap({ ...flatScene(), width: 0, typeIds: [] }, 4, 4)).toEqual(
      new Uint8Array(4 * 4 * 4),
    );
  });

  it('skips a lane that is not one value per cell', () => {
    const plain = rasterizeMinimap(flatScene(), PX_W, PX_H);
    expect(rasterizeMinimap(flatScene({ elevation: [1, 2, 3], water: [1] }), PX_W, PX_H)).toEqual(plain);
  });

  it('lights slopes facing the upper-left light and shades the opposite ones', () => {
    // A ridge along the middle column, and one along the middle row.
    const ridgeCol = SIZE / 2;
    const eastWest = rasterizeMinimap(
      flatScene({ elevation: lane((col) => 60 - 6 * Math.abs(col - ridgeCol)) }),
      PX_W,
      PX_H,
    );
    expect(meanLuma(eastWest, (col) => col < ridgeCol - 2)).toBeGreaterThan(
      meanLuma(eastWest, (col) => col > ridgeCol + 2),
    );
    const ridgeRow = SIZE / 2;
    const northSouth = rasterizeMinimap(
      flatScene({ elevation: lane((_, row) => 60 - 4 * Math.abs(row - ridgeRow)) }),
      PX_W,
      PX_H,
    );
    expect(meanLuma(northSouth, (_, row) => row < ridgeRow - 2)).toBeGreaterThan(
      meanLuma(northSouth, (_, row) => row > ridgeRow + 2),
    );
  });

  it('paints water blue, deeper away from the shore, with a light surf line at the coast', () => {
    const coastCol = SIZE / 2;
    const water = lane((col) => (col >= coastCol ? 1 : 0));
    const rgba = rasterizeMinimap(flatScene({ colourOfCell: () => SAND, water }), PX_W, PX_H);
    const row = SIZE / 2;
    const land = pixelAtCell(rgba, 2, row);
    const shallow = pixelAtCell(rgba, coastCol + 1, row);
    const deep = pixelAtCell(rgba, SIZE - 3, row);
    expect(land[0]).toBeGreaterThan(land[2]);
    expect(deep[2]).toBeGreaterThan(deep[0]);
    expect(luma(deep)).toBeLessThan(luma(shallow));

    // Along the pixel row through the coast, the water side's brightest pixel is the surf beside the shore.
    const bounds = terrainWorldBounds(SIZE, SIZE);
    const py = Math.floor(((tileToScreen(0, row).y - bounds.minY) / bounds.height) * PX_H);
    const coastX = Math.floor(
      ((tileToScreen(coastCol, row).x - TILE_EDGE - bounds.minX) / bounds.width) * PX_W,
    );
    let brightest = 0;
    let brightestAt = 0;
    for (let px = coastX - 2; px < PX_W - 4; px++) {
      const o = (py * PX_W + px) * 4;
      const value = (rgba[o] ?? 0) + (rgba[o + 1] ?? 0) + (rgba[o + 2] ?? 0);
      const isWater = (rgba[o + 2] ?? 0) > (rgba[o] ?? 0);
      if (isWater && value > brightest) {
        brightest = value;
        brightestAt = px;
      }
    }
    expect(brightestAt).toBeLessThan(coastX + COAST_SEARCH_PX);
  });

  it('anti-aliases the coast: pixels between land and water take blended colours', () => {
    const water = lane((col, row) => (col + row / 2 >= SIZE / 2 ? 1 : 0));
    const rgba = rasterizeMinimap(flatScene({ colourOfCell: () => SAND, water }), PX_W, PX_H);
    const distinct = new Set<number>();
    for (let o = 0; o < rgba.length; o += 4) distinct.add(((rgba[o] ?? 0) << 16) | (rgba[o + 2] ?? 0));
    // A hard two-colour coast would leave only the land and water families.
    expect(distinct.size).toBeGreaterThan(MIN_BLENDED_COLOURS);
  });

  it('darkens and greens wooded ground', () => {
    const forest = lane((col) => (col < SIZE / 2 ? 1 : 0));
    const rgba = rasterizeMinimap(flatScene({ colourOfCell: () => SAND, forest }), PX_W, PX_H);
    const wooded = pixelAtCell(rgba, 4, SIZE / 2);
    const open = pixelAtCell(rgba, SIZE - 4, SIZE / 2);
    expect(luma(wooded)).toBeLessThan(luma(open));
    expect(wooded[1]).toBeGreaterThan(wooded[0]);
  });

  it('tints a deposit field with its kind', () => {
    const gold = MINIMAP_DEPOSIT_KINDS.indexOf('gold') + 1;
    const depositKind = lane((col) => (col < SIZE / 2 ? gold : 0));
    const depositDensity = lane((col) => (col < SIZE / 2 ? 1 : 0));
    const rgba = rasterizeMinimap(flatScene({ depositKind, depositDensity }), PX_W, PX_H);
    const [r, , b] = pixelAtCell(rgba, 4, SIZE / 2);
    expect(r).toBeGreaterThan(b);
  });
});

describe('sampleField', () => {
  it('returns a cell centre its own value, so interpolation never drifts', () => {
    const scene = flatScene({ colourOfCell: (cell) => (cell * 37) & 0xff0000 });
    const field = buildMinimapCellField(scene);
    const out = new Float64Array(SAMPLE_LANES);
    for (const [col, row] of [
      [3, 4],
      [7, 5],
      [10, 10],
    ] as const) {
      const centre = tileToScreen(col, row);
      sampleField(field, SIZE, SIZE, centre.x, centre.y, out);
      expect(out[FIELD_LAND_R]).toBeCloseTo(field[(row * SIZE + col) * FIELD_STRIDE + FIELD_LAND_R] ?? 0, 4);
    }
  });
});

describe('minimapObjectLanes', () => {
  const featureOf = (name: string) => minimapFeatureOfGood(name);

  it('bins trees into canopy density and keeps unknown objects out', () => {
    // Cell (5, 6) has its centre node at (2·5 + 0, 2·6).
    const objects = { types: ['wood', 'decor'], placements: [10, 12, 0, 11, 12, 0, 20, 2, 1] };
    const lanes = minimapObjectLanes(SIZE, SIZE, objects, featureOf);
    expect(lanes.forest[6 * SIZE + 5]).toBeGreaterThan(0);
    expect(lanes.forest[1 * SIZE + 10]).toBe(0);
    expect(lanes.depositDensity.every((v) => v === 0)).toBe(true);
  });

  it('names a shared cell after its rarer deposit', () => {
    const objects = { types: ['stone', 'gold'], placements: [8, 8, 0, 9, 8, 1, 8, 9, 0] };
    const lanes = minimapObjectLanes(SIZE, SIZE, objects, featureOf);
    expect(lanes.depositKind[4 * SIZE + 4]).toBe(MINIMAP_DEPOSIT_KINDS.indexOf('gold') + 1);
    expect(lanes.depositDensity[4 * SIZE + 4]).toBeGreaterThan(0);
  });
});

describe('minimapScene', () => {
  it('joins the ground lanes to water fractions and passes the other lanes through', () => {
    const cells = SIZE * SIZE;
    const ground = {
      patterns: ['grass 01', 'water 01', 'block water shallow 01'],
      a: lane((col) => (col < 8 ? 0 : col < 16 ? 2 : 1)),
      b: lane((col) => (col < 8 ? 0 : col < 16 ? 2 : 1)),
    };
    const elevation = new Array<number>(cells).fill(5);
    const scene = minimapScene(
      { width: SIZE, height: SIZE, typeIds: new Array<number>(cells).fill(0), ground, elevation },
      () => GREY,
    );
    expect(scene.elevation).toBe(elevation);
    expect(scene.water?.[0]).toBe(0);
    expect(scene.water?.[10]).toBe(1);
    expect(scene.deepWater?.[10]).toBe(0);
    expect(scene.deepWater?.[20]).toBe(1);
    expect(waterCellFractions({ patterns: ['grass'], a: [0], b: [0] }, 1, 1)).toBeUndefined();
  });
});
