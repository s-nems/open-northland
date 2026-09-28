import type { AtlasFrame } from '../../data/sprites/index.js';
import type { FootAnalysis } from './foot-analysis.js';
import { smoothstep } from './noise.js';

const CHANNEL_MAX = 0xff;
const CHANNEL_BITS = 8;
const RGB = 3;
/** Frame px of foot per ground-colour sample. */
const GROUND_BUCKET_PX = 6;
const NO_GROUND = -1;
/** Frame px below a contact where its ground is read: the ground in front of the wall, not under it. */
const GROUND_SAMPLE_DROP_PX = 3;
/** Four bits a channel tell one ground's colour from another's in an overlay's cache key. */
const KEY_CHANNEL_SHIFT = 4;
const KEY_CHANNEL_LEVELS = 1 << (CHANNEL_BITS - KEY_CHANNEL_SHIFT);
/** One hex digit a quantized channel, so each sample keys as three digits. */
const KEY_RADIX = 16;

/** `0xRRGGBB` of the ground at a lifted pre-camera screen point, or undefined off the coloured map. */
export interface GroundColours {
  pointAt(x: number, y: number): number | undefined;
}

/** The ground's colour along one drawn frame's foot, sampled where each stretch meets the terrain. */
export interface FootGround {
  /** The colours quantized, so feet on like ground share one bake. */
  readonly key: string;
  /** `0xRRGGBB` per {@link GROUND_BUCKET_PX} frame columns. */
  readonly colours: Int32Array;
}

/**
 * Sample the ground under each stretch of the foot of `frame` drawn at `scale` with its feet at
 * `(feetX, feetY)`; null when none of it lies on coloured ground.
 */
export function footGround(
  a: FootAnalysis,
  frame: AtlasFrame,
  scale: number,
  feetX: number,
  feetY: number,
  ground: GroundColours,
): FootGround | null {
  const buckets = Math.ceil(a.width / GROUND_BUCKET_PX);
  const colours = new Int32Array(buckets).fill(NO_GROUND);
  let sampled = false;
  for (let b = 0; b < buckets; b++) {
    let row = -1;
    for (let x = b * GROUND_BUCKET_PX; x < Math.min(a.width, (b + 1) * GROUND_BUCKET_PX); x++) {
      row = Math.max(row, a.footRow[x] ?? -1);
    }
    if (row < 0) continue;
    const x = feetX + (frame.offsetX + (b + 0.5) * GROUND_BUCKET_PX) * scale;
    const y = feetY + (frame.offsetY + row + GROUND_SAMPLE_DROP_PX) * scale;
    const colour = ground.pointAt(x, y);
    if (colour === undefined) continue;
    colours[b] = colour;
    sampled = true;
  }
  if (!sampled) return null;
  fillGaps(colours);
  let key = '';
  for (const c of colours) {
    const r = ((c >> 16) & CHANNEL_MAX) >> KEY_CHANNEL_SHIFT;
    const g = ((c >> 8) & CHANNEL_MAX) >> KEY_CHANNEL_SHIFT;
    const b = (c & CHANNEL_MAX) >> KEY_CHANNEL_SHIFT;
    key += ((r * KEY_CHANNEL_LEVELS + g) * KEY_CHANNEL_LEVELS + b).toString(KEY_RADIX).padStart(RGB, '0');
  }
  return { key, colours };
}

/** Buckets with no sample take their nearest sampled neighbour's colour; at least one is sampled. */
export function fillGaps(colours: Int32Array): void {
  const fromLeft = new Int32Array(colours.length).fill(NO_GROUND);
  const distLeft = new Int32Array(colours.length);
  let last = NO_GROUND;
  let dist = 0;
  for (let i = 0; i < colours.length; i++) {
    const c = colours[i] ?? NO_GROUND;
    if (c !== NO_GROUND) {
      last = c;
      dist = 0;
    } else dist++;
    fromLeft[i] = last;
    distLeft[i] = dist;
  }
  last = NO_GROUND;
  dist = 0;
  for (let i = colours.length - 1; i >= 0; i--) {
    const c = colours[i] ?? NO_GROUND;
    if (c !== NO_GROUND) {
      last = c;
      dist = 0;
      continue;
    }
    dist++;
    const left = fromLeft[i] ?? NO_GROUND;
    colours[i] = left === NO_GROUND || (last !== NO_GROUND && dist < (distLeft[i] ?? 0)) ? last : left;
  }
}

/** The ground's `[r, g, b]` under frame column `x`, blended between the samples either side, into `out`. */
export function groundAt(g: FootGround, x: number, out: Float32Array): void {
  const t = Math.max(0, Math.min(g.colours.length - 1, x / GROUND_BUCKET_PX - 0.5));
  const i = Math.floor(t);
  const f = t - i;
  const a = g.colours[i] ?? 0;
  const b = g.colours[Math.min(g.colours.length - 1, i + 1)] ?? 0;
  for (let c = 0; c < RGB; c++) {
    const shift = (RGB - 1 - c) * CHANNEL_BITS;
    out[c] = ((a >> shift) & CHANNEL_MAX) * (1 - f) + ((b >> shift) & CHANNEL_MAX) * f;
  }
}

/** Green's lead over red and blue, as a share of green, over which ground turns to grass. Observed from
 *  the terrain pages' meadow and steppe colours. */
const GRASS_SHARE_LO = 0.08;
const GRASS_SHARE_HI = 0.16;
/** Mean channel over which ground turns to snow, shaded snow included, and how far blue must lead red
 *  across the turn, which keeps pale sand out. Observed from the terrain pages' snow and sand colours. */
const SNOW_LUMA_LO = 95;
const SNOW_LUMA_HI = 135;
const SNOW_COOL_LO = -4;
const SNOW_COOL_HI = 8;

/** How far the ground is grass and how far snow, each 0..1. */
export interface GroundKinds {
  grass: number;
  snow: number;
}

/**
 * Classify ground by colour, so a foot that runs from a meadow onto snow grows tufts on one side and a
 * drift on the other and blends where they meet.
 */
export function groundKinds(rgb: Float32Array, out: GroundKinds): GroundKinds {
  const r = rgb[0] ?? 0;
  const g = rgb[1] ?? 0;
  const b = rgb[2] ?? 0;
  const snow =
    smoothstep(SNOW_LUMA_LO, SNOW_LUMA_HI, (r + g + b) / 3) * smoothstep(SNOW_COOL_LO, SNOW_COOL_HI, b - r);
  out.grass = smoothstep(GRASS_SHARE_LO, GRASS_SHARE_HI, (g - Math.max(r, b)) / Math.max(1, g)) * (1 - snow);
  out.snow = snow;
  return out;
}
