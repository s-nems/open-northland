import { clamp01 } from '../math.js';
import { hashBits, smoothstep } from './minimap-noise.js';

/**
 * Pure helpers of the minimap's sub-cell texture and final tone. Every amplitude, period and curve is a
 * named approximation tuned by eye, not a measured value.
 */

/** A texture's period in px below which it fades out instead of aliasing, and the span of the fade. */
const TEXTURE_MIN_PERIOD_PX = 2;
const TEXTURE_FADE_SPAN_PX = 2.5;

/**
 * How much of a texture with this period (in cells) a picture at `cellPx` px per cell shows: 0 while
 * the period is too short to draw without aliasing, rising to 1 once it spans a few px.
 */
export function textureFade(periodCells: number, cellPx: number): number {
  return clamp01((periodCells * cellPx - TEXTURE_MIN_PERIOD_PX) / TEXTURE_FADE_SPAN_PX);
}

/** How far a dome's centre strays from its lattice cell's middle, in lattice units; with radii up to
 *  {@link DOME_MAX_RADIUS} every dome over a point sits in the 2×2 cells nearest it. */
const DOME_JITTER = 0.25;
export const DOME_MAX_RADIUS = 0.75;
/** Ten-bit fields of one lattice hash: centre x, centre y, radius. */
const FIELD_BITS = 10;
const FIELD_MAX = (1 << FIELD_BITS) - 1;

/** The dome over a point: its anti-aliased cover in [0, 1] and its light relative to flat ground. */
export interface Dome {
  cover: number;
  light: number;
}

/**
 * Round domes on a jittered unit lattice, as tree crowns or rocks seen from above: `radius` in lattice
 * units (at most {@link DOME_MAX_RADIUS}), shrunk per dome by up to `radiusJitter` of itself; `edge`
 * the anti-aliasing width in lattice units; `(lx, ly, lz)` the unit vector toward the light. The
 * highest dome over `(u, v)` wins, lit as a hemisphere. Writes `out`; off every dome, cover is 0.
 */
export function sampleDomes(
  u: number,
  v: number,
  seed: number,
  radius: number,
  radiusJitter: number,
  edge: number,
  lx: number,
  ly: number,
  lz: number,
  out: Dome,
): void {
  const i0 = Math.floor(u - 0.5);
  const j0 = Math.floor(v - 0.5);
  let top = 0;
  let cover = 0;
  let light = 1;
  for (let j = j0; j <= j0 + 1; j++) {
    for (let i = i0; i <= i0 + 1; i++) {
      const h = hashBits(i, j, seed);
      const r = radius * (1 - radiusJitter * (((h >>> (2 * FIELD_BITS)) & FIELD_MAX) / FIELD_MAX));
      const dx = u - (i + 0.5 + DOME_JITTER * (2 * ((h & FIELD_MAX) / FIELD_MAX) - 1));
      const dy = v - (j + 0.5 + DOME_JITTER * (2 * (((h >>> FIELD_BITS) & FIELD_MAX) / FIELD_MAX) - 1));
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      const z = Math.sqrt(r * r - d2) / r;
      if (z <= top) continue;
      top = z;
      cover = Math.max(cover, smoothstep(clamp01((r - Math.sqrt(d2)) / edge)));
      light = Math.max(0, (dx * lx + dy * ly) / r + z * lz) / lz;
    }
  }
  out.cover = cover;
  out.light = light;
}

/** Saturation below which ground reads as rock (grey, brown-grey) and the span of its fade to soil. */
const ROCK_SATURATION = 0.18;
const ROCK_SATURATION_SPAN = 0.14;
/** Green's lead over red and blue, as a share of the brightest channel, for ground to read as grass. */
const GRASS_GREEN_LEAD = 0.12;

/** The ground classes the micro-texture tells apart by colour, as weights summing to 1. */
export interface GroundClass {
  grass: number;
  soil: number;
  rock: number;
}

/** Classify a ground colour (0..255 channels) into grass, soil/sand and rock weights, writing `out`. */
export function classifyGround(r: number, g: number, b: number, out: GroundClass): void {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const scale = max > 0 ? 1 / max : 0;
  const saturation = (max - min) * scale;
  const rock = 1 - smoothstep(clamp01((saturation - ROCK_SATURATION) / ROCK_SATURATION_SPAN));
  const lead = (g - Math.max(r, b)) * scale;
  const grass = (1 - rock) * clamp01(lead / GRASS_GREEN_LEAD);
  out.rock = rock;
  out.grass = grass;
  out.soil = 1 - rock - grass;
}

/** The final tone: saturation around the pixel's luma, then a contrast S-curve. */
const SATURATION = 1.06;
const CONTRAST = 0.18;
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
const BYTE_LEVELS = 256;

/** The contrast curve as a byte lookup: a blend of identity and smoothstep, so mid-grey stays put. */
export function contrastCurve(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(BYTE_LEVELS);
  const top = BYTE_LEVELS - 1;
  for (let v = 0; v < BYTE_LEVELS; v++) {
    const x = v / top;
    lut[v] = (x + (smoothstep(x) - x) * CONTRAST) * top;
  }
  return lut;
}

/** Saturate one channel `c` of a pixel with luma `y`. */
export function saturate(c: number, y: number): number {
  return y + (c - y) * SATURATION;
}

export function luma(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

/** A mutable colour scratch, channels 0..255 as floats. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Blend `rgb` toward the packed `0xRRGGBB` colour by `t` in [0, 1]. */
export function mixToward(rgb: Rgb, colour: number, t: number): void {
  rgb.r += (((colour >> 16) & 0xff) - rgb.r) * t;
  rgb.g += (((colour >> 8) & 0xff) - rgb.g) * t;
  rgb.b += ((colour & 0xff) - rgb.b) * t;
}

/** The unit vector toward the minimap light, and its down-light direction in the picture plane. */
export interface LightFrame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly downX: number;
  readonly downY: number;
}

export function lightFrame(light: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): LightFrame {
  const norm = Math.hypot(light.x, light.y, light.z);
  const flat = Math.hypot(light.x, light.y);
  return {
    x: light.x / norm,
    y: light.y / norm,
    z: light.z / norm,
    downX: -light.x / flat,
    downY: -light.y / flat,
  };
}
