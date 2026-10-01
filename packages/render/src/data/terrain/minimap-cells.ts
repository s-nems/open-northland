import { clamp, clamp01 } from '../math.js';
import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import { forEachStaggerNeighbour, laneOf, staggerBlur } from './minimap-grid.js';
import { cellLight } from './minimap-light.js';
import { valueNoise } from './minimap-noise.js';
import { MINIMAP_DEPOSIT_KINDS, type MinimapDepositKind, type MinimapScene } from './minimap-scene.js';
import { classifyGround, type GroundClass, luma } from './minimap-texture.js';

/**
 * The per-cell half of the minimap style: every term that varies slower than a cell (relief light,
 * occlusion, water depth, canopy shade and ore tone) is folded into one interleaved lane, so the pixel
 * pass only interpolates it. All tuning values here are named approximations chosen by eye on the owned maps,
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
/** The water's depth term in [0, 1]: 0 at the shore, toward 1 in open water. */
export const FIELD_DEPTH = 7;
export const FIELD_FOREST = 8;
export const FIELD_ORE_R = 9;
export const FIELD_ORE_G = 10;
export const FIELD_ORE_B = 11;
export const FIELD_ORE = 12;
/** The smoothed water coverage the coast contour follows; {@link FIELD_WATER} stays the raw fraction. */
export const FIELD_COVER = 13;
export const FIELD_STRIDE = 14;

/** A cell counts as water when at least half of it draws water. */
const WATER_CELL = 0.5;
/** How far past the contour the smoothed coverage keeps a cell centre on its own side. */
const COAST_KEEP = 0.12;

/** Water depth: hops from land at which the depth term reaches 1 - 1/e. */
const DEPTH_FALLOFF_HOPS = 4.5;
/** Floor on the depth term of the painter's deep-water patterns. */
const DEEP_PATTERN_DEPTH = 0.5;
/** Floor on the depth term of a lake (a water body off the map edge), so a narrow lake is not all shallows. */
const LAKE_DEPTH = 0.3;
/** The depth ramp: turquoise shallows, a teal-blue shelf at {@link SHELF_DEPTH}, navy open water; and
 *  how much of the texture's own colour each keeps. */
const SHALLOW_WATER = 0x3a9ca4;
const SHELF_WATER = 0x1b6488;
const DEEP_WATER = 0x0d2f55;
const SHELF_DEPTH = 0.4;
const WATER_TEXTURE_WEIGHT = 0.2;

/** Broad mottling, so a plain of one pattern or an open sea does not read as a flat fill. */
const MOTTLE = 0.08;
const WATER_MOTTLE = 0.08;
const MOTTLE_PERIOD_CELLS = 3.5;
/** A slight lift of the land, which the relief and occlusion terms otherwise leave a little darker. */
const LAND_EXPOSURE = 1.1;
/** Lighting soft-clips into this gain range around the base colour, so no ridge blows out to white and
 *  no valley crushes to black; wooded ground has a higher floor, so canopy in shade stays green. */
const LIGHT_GAIN_MIN = 0.5;
const LIGHT_GAIN_MAX = 1.4;
const CANOPY_GAIN_MIN = 0.72;
/** Channel values above the knee roll off toward the ceiling instead of clipping at a byte. */
const HIGHLIGHT_KNEE = 185;
const HIGHLIGHT_CEILING = 238;
const SEED_MOTTLE = 0x7f4a7c15;
/** Bright, highly saturated greens (the lime grass of some maps) read as neon once lit: their lit colour
 *  eases toward its luma by up to {@link GREEN_TAME}, gated by saturation, brightness and green's lead
 *  over red and blue, so darker or duller greens, sand and rock keep their colour. */
const GREEN_TAME = 0.25;
const TAME_SATURATION_FROM = 0.6;
const TAME_SATURATION_SPAN = 0.2;
const TAME_VALUE_FROM = 80;
const TAME_VALUE_SPAN = 50;
const TAME_GREEN_LEAD = 0.1;
/** Rock relief: on ground that classifies as rock, the light's swing around flat is stretched by this
 *  much on lit faces and on shaded ones, and lit faces turn cooler (red down, blue up by this share,
 *  in full at {@link ROCK_COOL_FULL_GAIN} gain over flat), so ridges read as rock instead of a
 *  grey-brown smear. */
const ROCK_LIT_BOOST = 0.3;
const ROCK_SHADE_BOOST = 0.3;
const ROCK_COOL = 0.08;
const ROCK_COOL_FULL_GAIN = 0.25;

/** The canopy tint and how much of a fully wooded cell it covers; a denser stand is a darker one. */
const CANOPY = 0x2c4f24;
const CANOPY_COVER = 0.88;
const CANOPY_DENSE_SHADE = 0.18;
/** The canopy's height in elevation units for the fine relief, so a stand's edges catch the light. */
const CANOPY_HEIGHT = 10;
/** The shadow a stand casts on open ground beside it, away from the light: the share of the canopy
 *  one and two cells toward the light that falls on a cell, and the darkening of a full shadow. */
const CANOPY_SHADOW_NEAR = 1;
const CANOPY_SHADOW_FAR = 0.6;
const CANOPY_SHADOW = 0.3;

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

/** Build the interleaved cell field. */
export function buildMinimapCellField(scene: MinimapScene): Float32Array {
  const { width, height } = scene;
  const cells = width * height;
  const field = new Float32Array(cells * FIELD_STRIDE);
  const forestInput = laneOf(scene.forest, cells);
  // One more blur than the caller's density, so per-cell tree counts do not tile the canopy into a mosaic.
  const forestLane = forestInput === undefined ? undefined : staggerBlur(forestInput, width, height);
  const canopyHeight = forestLane?.map((f) => clamp01(f) * CANOPY_HEIGHT);
  const { light, edge } = cellLight(scene, canopyHeight, forestLane);
  const shadow = forestLane === undefined ? undefined : canopyShadow(forestLane, width, height);
  const depth = waterDepth(scene);
  const water = laneOf(scene.water, cells);
  const oreKind = laneOf(scene.depositKind, cells);
  const oreDensity = laneOf(scene.depositDensity, cells);
  const ground: GroundClass = { grass: 0, soil: 0, rock: 0 };
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
    const lit = (light[cell] ?? 1) * LAND_EXPOSURE * (1 + MOTTLE * mottle);
    const floor = LIGHT_GAIN_MIN + (CANOPY_GAIN_MIN - LIGHT_GAIN_MIN) * forest;
    classifyGround(channel(colour, 16), channel(colour, 8), channel(colour, 0), ground);
    const rock = ground.rock * (1 - forest);
    const gain = softClip(lit, floor, LIGHT_GAIN_MAX);
    const rockGain = 1 + (gain - 1) * (1 + rock * (gain >= 1 ? ROCK_LIT_BOOST : ROCK_SHADE_BOOST));
    const cool = ROCK_COOL * rock * clamp01((gain - 1) / ROCK_COOL_FULL_GAIN);
    const shade =
      rockGain * (edge[cell] ?? 1) * (1 - CANOPY_DENSE_SHADE * forest * forest) * (1 - (shadow?.[cell] ?? 0));
    const waterShade = (1 + WATER_MOTTLE * mottle) * (edge[cell] ?? 1);
    const t = depth[cell] ?? 0;
    const kind = MINIMAP_DEPOSIT_KINDS[(oreKind?.[cell] ?? 0) - 1];
    const ore = kind === undefined ? 0 : clamp01(oreDensity?.[cell] ?? 0);
    const oreColour = kind === undefined ? 0 : ORE_COLOURS[kind];
    field[o + FIELD_WATER] = clamp01(water?.[cell] ?? 0);
    field[o + FIELD_FOREST] = forest;
    field[o + FIELD_ORE] = ore;
    field[o + FIELD_DEPTH] = t;
    for (let ch = 0; ch < 3; ch++) {
      const shift = 16 - 8 * ch;
      const base = channel(colour, shift);
      // Red down, green kept, blue up.
      const land = base * (1 + (ch - 1) * cool);
      field[o + FIELD_LAND_R + ch] = rollOff((land + (channel(CANOPY, shift) - land) * canopy) * shade);
      const ramp = waterRamp(t, shift);
      field[o + FIELD_WATER_R + ch] = (ramp + (base - ramp) * WATER_TEXTURE_WEIGHT) * waterShade;
      field[o + FIELD_ORE_R + ch] = channel(oreColour, shift) * ore * shade;
    }
    tameNeonGreen(field, o + FIELD_LAND_R);
  }
  if (oreKind !== undefined && oreDensity !== undefined) blurOre(field, width, height);
  smoothCoast(field, width, height);
  return field;
}

/** One channel of the water colour at depth term `t`: shallows to shelf, then shelf to open water. */
export function waterRamp(t: number, shift: number): number {
  if (t <= SHELF_DEPTH) {
    const shallow = channel(SHALLOW_WATER, shift);
    return shallow + (channel(SHELF_WATER, shift) - shallow) * (t / SHELF_DEPTH);
  }
  const shelf = channel(SHELF_WATER, shift);
  return shelf + (channel(DEEP_WATER, shift) - shelf) * ((t - SHELF_DEPTH) / (1 - SHELF_DEPTH));
}

/**
 * The darkening a cell takes from canopy toward the light: the light comes from the upper left, so a
 * stand's shadow falls on the open ground below and right of it. Reads the touching cell up-left
 * (half a column left, one row up) and the one beyond it; a cell under its own canopy takes none.
 */
export function canopyShadow(forest: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 1; row < height; row++) {
    const left = -1 + (row & 1);
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      const nearCol = clamp(col + left, 0, width - 1);
      const near = forest[(row - 1) * width + nearCol] ?? 0;
      const far = row >= 2 ? (forest[(row - 2) * width + clamp(col - 1, 0, width - 1)] ?? 0) : 0;
      const cast = Math.max(CANOPY_SHADOW_NEAR * near, CANOPY_SHADOW_FAR * far) - (forest[cell] ?? 0);
      out[cell] = CANOPY_SHADOW * clamp01(cast);
    }
  }
  return out;
}

/** Ease a bright, highly saturated green at `field[o..o+2]` toward its luma; any other colour stays. */
function tameNeonGreen(field: Float32Array, o: number): void {
  const r = field[o] ?? 0;
  const g = field[o + 1] ?? 0;
  const b = field[o + 2] ?? 0;
  const rival = Math.max(r, b);
  if (g <= rival) return;
  const saturation = (g - Math.min(r, b)) / g;
  const t =
    GREEN_TAME *
    clamp01((saturation - TAME_SATURATION_FROM) / TAME_SATURATION_SPAN) *
    clamp01((g - TAME_VALUE_FROM) / TAME_VALUE_SPAN) *
    clamp01((g - rival) / g / TAME_GREEN_LEAD);
  if (t <= 0) return;
  const y = luma(r, g, b);
  field[o] = r + (y - r) * t;
  field[o + 1] = g + (y - g) * t;
  field[o + 2] = b + (y - b) * t;
}

/** Soft-clip a light gain into `[lo, hi]` around 1: near 1 it passes through, far out it saturates. */
function softClip(gain: number, lo: number, hi: number): number {
  return gain >= 1
    ? 1 + (hi - 1) * Math.tanh((gain - 1) / (hi - 1))
    : 1 - (1 - lo) * Math.tanh((1 - gain) / (1 - lo));
}

/** Roll a channel value off above {@link HIGHLIGHT_KNEE} so it approaches {@link HIGHLIGHT_CEILING}. */
function rollOff(v: number): number {
  if (v <= HIGHLIGHT_KNEE) return v;
  const span = HIGHLIGHT_CEILING - HIGHLIGHT_KNEE;
  return HIGHLIGHT_KNEE + span * Math.tanh((v - HIGHLIGHT_KNEE) / span);
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
  const hops = new Float32Array(cells).fill(-1);
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
  const lake = lakeCells(water, width, height);
  // One blur, so the integer hop rings do not band the ramp.
  const distance = staggerBlur(hops, width, height);
  for (let i = 0; i < cells; i++) {
    const t = 1 - Math.exp(-(distance[i] ?? 0) / DEPTH_FALLOFF_HOPS);
    const deepPattern = (deepWater?.[i] ?? 0) >= WATER_CELL;
    const floor = Math.max(deepPattern ? DEEP_PATTERN_DEPTH : 0, lake[i] === 1 ? LAKE_DEPTH : 0);
    depth[i] = (hops[i] ?? 0) > 0 ? Math.max(t, floor) : t;
  }
  return depth;
}

/** 1 for every water cell whose connected water body never touches the map edge. */
function lakeCells(water: ArrayLike<number>, width: number, height: number): Uint8Array {
  const cells = width * height;
  const lake = new Uint8Array(cells);
  const seen = new Uint8Array(cells);
  const queue = new Int32Array(cells);
  for (let seed = 0; seed < cells; seed++) {
    if (seen[seed] === 1 || (water[seed] ?? 0) < WATER_CELL) continue;
    let tail = 0;
    queue[tail++] = seed;
    seen[seed] = 1;
    let enclosed = true;
    for (let head = 0; head < tail; head++) {
      const cell = queue[head] ?? 0;
      const col = cell % width;
      const row = Math.floor(cell / width);
      if (col === 0 || row === 0 || col === width - 1 || row === height - 1) enclosed = false;
      forEachStaggerNeighbour(col, row, width, height, (n) => {
        if (seen[n] === 1 || (water[n] ?? 0) < WATER_CELL) return;
        seen[n] = 1;
        queue[tail++] = n;
      });
    }
    if (!enclosed) continue;
    for (let i = 0; i < tail; i++) lake[queue[i] ?? 0] = 1;
  }
  return lake;
}
