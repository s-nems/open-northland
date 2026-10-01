import { clamp01 } from '../math.js';
import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import { forEachStaggerNeighbour, laneOf, staggerBlur } from './minimap-grid.js';
import { cellLight } from './minimap-light.js';
import { valueNoise } from './minimap-noise.js';
import { MINIMAP_DEPOSIT_KINDS, type MinimapDepositKind, type MinimapScene } from './minimap-scene.js';

/**
 * The per-cell half of the minimap style: every term that varies slower than a cell (relief light,
 * valley shade, water depth, canopy and ore tone) is folded into one interleaved lane, so the pixel pass only
 * interpolates it. All tuning values here are named approximations chosen by eye on the owned maps,
 * not measured from the original, whose minimap is a flat per-cell picture.
 */

/** Interleaved per-cell lane layout; the ore colour is premultiplied by its density. */
export const FIELD_WATER = 0;
export const FIELD_LAND_R = 1;
export const FIELD_LAND_G = 2;
export const FIELD_LAND_B = 3;
export const FIELD_WATER_R = 4;
export const FIELD_WATER_G = 5;
export const FIELD_WATER_B = 6;
export const FIELD_FOREST = 7;
export const FIELD_ORE_R = 8;
export const FIELD_ORE_G = 9;
export const FIELD_ORE_B = 10;
export const FIELD_ORE = 11;
/** The smoothed water coverage the coast contour follows; {@link FIELD_WATER} stays the raw fraction. */
export const FIELD_COVER = 12;
export const FIELD_STRIDE = 13;

/** A cell counts as water when at least half of it draws water. */
const WATER_CELL = 0.5;
/** How far past the contour the smoothed coverage keeps a cell centre on its own side. */
const COAST_KEEP = 0.12;

/** Water depth: hops from land at which the depth term reaches 1 - 1/e. */
const DEPTH_FALLOFF_HOPS = 2.5;
/** Floor on the depth term of the painter's deep-water patterns. */
const DEEP_PATTERN_DEPTH = 0.6;
/** The depth ramp's tints, and how much of the texture's own colour each keeps. */
const SHALLOW_WATER = 0x3b7f8a;
const DEEP_WATER = 0x173f66;
const WATER_TEXTURE_WEIGHT = 0.3;

/** Broad mottling, so a plain of one pattern or an open sea does not read as a flat fill. */
const MOTTLE = 0.08;
const WATER_MOTTLE = 0.1;
const MOTTLE_PERIOD_CELLS = 3.5;
/** A slight lift of the land, which the relief and valley terms otherwise leave a little darker. */
const LAND_EXPOSURE = 1.06;
const SEED_MOTTLE = 0x7f4a7c15;

/** The canopy tint and how much of a fully wooded cell it covers. */
const CANOPY = 0x23401f;
const CANOPY_COVER = 0.72;

/** Ore tints. */
const ORE_COLOURS: Readonly<Record<MinimapDepositKind, number>> = {
  stone: 0xa9a69b,
  clay: 0xc9733f,
  iron: 0xb05a4a,
  gold: 0xf5c842,
};

/** The cell-colour channels as floats 0..255. */
function channel(colour: number, shift: number): number {
  return (colour >> shift) & 0xff;
}

export function buildMinimapCellField(scene: MinimapScene): Float32Array {
  const { width, height } = scene;
  const cells = width * height;
  const field = new Float32Array(cells * FIELD_STRIDE);
  const light = cellLight(scene);
  const depth = waterDepth(scene);
  const water = laneOf(scene.water, cells);
  const forestLane = laneOf(scene.forest, cells);
  const oreKind = laneOf(scene.depositKind, cells);
  const oreDensity = laneOf(scene.depositDensity, cells);
  // Cell centre in world px times the mottle frequency: x = (2c + (r & 1))·TILE_HALF_W, y = r·TILE_HALF_H.
  const mottleScale = TILE_HALF_W / (MOTTLE_PERIOD_CELLS * 2 * TILE_HALF_W);
  const mottleScaleY = TILE_HALF_H / (MOTTLE_PERIOD_CELLS * 2 * TILE_HALF_W);
  for (let cell = 0; cell < cells; cell++) {
    const colour = scene.colourOfCell(cell, scene.typeIds[cell] ?? 0);
    const o = cell * FIELD_STRIDE;
    const forest = clamp01(forestLane?.[cell] ?? 0);
    const canopy = forest * CANOPY_COVER;
    const row = Math.floor(cell / width);
    const x = (2 * (cell - row * width) + (row & 1)) * mottleScale;
    const mottle = valueNoise(x, row * mottleScaleY, SEED_MOTTLE) - 0.5;
    const shade = (light[cell] ?? 1) * LAND_EXPOSURE * (1 + MOTTLE * mottle);
    const waterShade = 1 + WATER_MOTTLE * mottle;
    const t = depth[cell] ?? 0;
    const kind = MINIMAP_DEPOSIT_KINDS[(oreKind?.[cell] ?? 0) - 1];
    const ore = kind === undefined ? 0 : clamp01(oreDensity?.[cell] ?? 0);
    const oreColour = kind === undefined ? 0 : ORE_COLOURS[kind];
    field[o + FIELD_WATER] = clamp01(water?.[cell] ?? 0);
    field[o + FIELD_FOREST] = forest;
    field[o + FIELD_ORE] = ore;
    for (let ch = 0; ch < 3; ch++) {
      const shift = 16 - 8 * ch;
      const base = channel(colour, shift);
      field[o + FIELD_LAND_R + ch] = (base + (channel(CANOPY, shift) - base) * canopy) * shade;
      const shallow = channel(SHALLOW_WATER, shift);
      const ramp = shallow + (channel(DEEP_WATER, shift) - shallow) * t;
      field[o + FIELD_WATER_R + ch] = (ramp + (base - ramp) * WATER_TEXTURE_WEIGHT) * waterShade;
      field[o + FIELD_ORE_R + ch] = channel(oreColour, shift) * ore * shade;
    }
  }
  if (oreKind !== undefined && oreDensity !== undefined) blurOre(field, width, height);
  smoothCoast(field, width, height);
  return field;
}

/**
 * The coast contour's field: the water fraction blurred over the cell's neighbours, then pushed back to
 * its own side of the contour by {@link COAST_KEEP}, so diamond corners round off while every cell
 * centre keeps its land or water side and a one-cell river never vanishes.
 */
function smoothCoast(field: Float32Array, width: number, height: number): void {
  const blurred = staggerBlur(field, width, height, FIELD_STRIDE, FIELD_WATER);
  for (let cell = 0; cell < width * height; cell++) {
    const own = field[cell * FIELD_STRIDE + FIELD_WATER] ?? 0;
    const cover = blurred[cell] ?? 0;
    field[cell * FIELD_STRIDE + FIELD_COVER] =
      own >= WATER_CELL ? Math.max(cover, WATER_CELL + COAST_KEEP) : Math.min(cover, WATER_CELL - COAST_KEEP);
  }
}

/** One neighbourhood blur of the premultiplied ore lanes, so neighbouring cells of different kinds
 *  blend into one field instead of speckling. */
function blurOre(field: Float32Array, width: number, height: number): void {
  for (let lane = FIELD_ORE_R; lane <= FIELD_ORE; lane++) {
    const blurred = staggerBlur(field, width, height, FIELD_STRIDE, lane);
    for (let cell = 0; cell < width * height; cell++) field[cell * FIELD_STRIDE + lane] = blurred[cell] ?? 0;
  }
}

/** Per-cell water depth term in [0, 1]: hops to the nearest land cell, eased, floored on deep patterns. */
function waterDepth(scene: MinimapScene): Float32Array {
  const { width, height } = scene;
  const cells = width * height;
  const water = laneOf(scene.water, cells);
  const deepWater = laneOf(scene.deepWater, cells);
  const depth = new Float32Array(cells);
  if (water === undefined) return depth;
  const hops = new Int32Array(cells).fill(-1);
  const queue = new Int32Array(cells);
  let tail = 0;
  for (let i = 0; i < cells; i++) {
    if ((water[i] ?? 0) < WATER_CELL) {
      hops[i] = 0;
      queue[tail++] = i;
    }
  }
  // A map that is all water has no shore to measure from: it reads as open sea.
  if (tail === 0) return depth.fill(1);
  for (let head = 0; head < tail; head++) {
    const cell = queue[head] ?? 0;
    const next = (hops[cell] ?? 0) + 1;
    forEachStaggerNeighbour(cell % width, Math.floor(cell / width), width, height, (n) => {
      if (hops[n] === -1) {
        hops[n] = next;
        queue[tail++] = n;
      }
    });
  }
  for (let i = 0; i < cells; i++) {
    const t = 1 - Math.exp(-(hops[i] ?? 0) / DEPTH_FALLOFF_HOPS);
    const deepPattern = (deepWater?.[i] ?? 0) >= WATER_CELL;
    depth[i] = deepPattern ? Math.max(t, DEEP_PATTERN_DEPTH) : t;
  }
  return depth;
}
