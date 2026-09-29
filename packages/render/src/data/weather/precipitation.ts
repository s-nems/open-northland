import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import type { WeatherKind } from './types.js';

/**
 * How strong a weather amount looks and how many airborne particles it takes. An OpenNorthland
 * enhancement over the original's linear drop count; every constant here is tuned by eye against real
 * maps, whose script weather writes amounts 0.05..0.3 and whose ini sand writes 0.02..0.07.
 */

/** World px (pre-camera) to half-cell nodes: `halfCellToScreen` inverted, elevation ignored. */
export const WEATHER_NODES_PER_WORLD_X = 1 / TILE_HALF_W;
export const WEATHER_NODES_PER_WORLD_Y = 2 / TILE_HALF_H;

/** The amount that reads as the heaviest weather of its kind: sand is written about ten times thinner. */
export const WEATHER_FULL_AMOUNT: Readonly<Record<WeatherKind, number>> = {
  rain: 0.35,
  snow: 0.35,
  sand: 0.08,
};

/** Below 1 lifts light weather a little: 5% rain shows about a quarter of the heaviest density, a light
 *  shower rather than a downpour. */
export const WEATHER_INTENSITY_GAMMA = 0.75;

/** 0..1 visual strength of `amount` of `kind`. */
export function weatherIntensity(kind: WeatherKind, amount: number): number {
  if (amount <= 0) return 0;
  return Math.min(1, (amount / WEATHER_FULL_AMOUNT[kind]) ** WEATHER_INTENSITY_GAMMA);
}

/** Amounts where a kind starts turning into a storm and where it is a full storm (thunderstorm,
 *  blizzard, sandstorm). The busiest real maps reach about half a storm; the heaviest scripts a full one. */
export const WEATHER_STORM_RANGE: Readonly<
  Record<WeatherKind, { readonly start: number; readonly full: number }>
> = {
  rain: { start: 0.18, full: 0.35 },
  snow: { start: 0.25, full: 0.5 },
  sand: { start: 0.045, full: 0.085 },
};

export function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** 0..1 storm strength of `amount` of `kind`. */
export function stormOf(kind: WeatherKind, amount: number): number {
  const range = WEATHER_STORM_RANGE[kind];
  return smoothstep(range.start, range.full, amount);
}

/** Screen px² per particle at full intensity and zoom 1. Rain and sand count streaks, snow flakes. Fewer,
 *  fainter particles keep the ground readable; most are far, small and slow, a few near, large and fast. */
export const PARTICLE_AREA_PX: Readonly<Record<WeatherKind, number>> = { rain: 700, snow: 260, sand: 700 };

/** Particles wrap in a box this much larger than the screen on every side, so a long streak or a swaying
 *  flake never pops at the edge. */
export const PARTICLE_WRAP_MARGIN_PX = 96;

/** The instance buffer grows in steps of this many particles so a window resize does not rebuild it. */
export const PARTICLE_CAPACITY_STEP = 2048;

/** A wider view (zoomed out) shows more, smaller particles, within these bounds of the zoom-1 density. */
const ZOOM_DENSITY_MIN = 0.75;
const ZOOM_DENSITY_MAX = 1.5;

/** Density multiplier for a camera zoom: the square root of the world area gain, clamped. */
export function zoomDensity(zoom: number): number {
  const safe = zoom > 0 ? zoom : 1;
  return Math.min(ZOOM_DENSITY_MAX, Math.max(ZOOM_DENSITY_MIN, Math.sqrt(1 / safe)));
}

/** Particle size multiplier for a camera zoom: sizes follow zoom only by its square root, so rain stays a
 *  crisp streak when zoomed in and does not vanish into single pixels when zoomed out. */
export function zoomSize(zoom: number): number {
  const safe = zoom > 0 ? zoom : 1;
  return Math.min(ZOOM_DENSITY_MAX, Math.max(ZOOM_DENSITY_MIN, Math.sqrt(safe)));
}

/** The wrap box area in screen px² for a `screenW` by `screenH` screen. */
export function particleWrapArea(screenW: number, screenH: number): number {
  return (screenW + 2 * PARTICLE_WRAP_MARGIN_PX) * (screenH + 2 * PARTICLE_WRAP_MARGIN_PX);
}

/** A full storm draws this share more particles than the heaviest calm weather; the rest of a storm's
 *  weight comes from wind, speed and gust fronts, not from covering the ground. */
export const PARTICLE_STORM_BONUS: Readonly<Record<WeatherKind, number>> = {
  rain: 0.35,
  snow: 0.7,
  sand: 0.25,
};

/** Particles of `kind` to draw for the strongest `intensity` on screen and the view's `storm`. */
export function particleCount(
  kind: WeatherKind,
  screenW: number,
  screenH: number,
  intensity: number,
  zoom: number,
  storm = 0,
): number {
  if (intensity <= 0) return 0;
  const full = (particleWrapArea(screenW, screenH) / PARTICLE_AREA_PX[kind]) * zoomDensity(zoom);
  const stormGain = 1 + PARTICLE_STORM_BONUS[kind] * Math.min(1, Math.max(0, storm));
  return Math.min(PARTICLE_CAP[kind], Math.ceil(full * Math.min(1, intensity) * stormGain));
}

/** Instance buffer needed for {@link particleCount} at full intensity, full storm and any zoom. */
function uncappedCapacity(kind: WeatherKind, screenW: number, screenH: number): number {
  const full = (particleWrapArea(screenW, screenH) / PARTICLE_AREA_PX[kind]) * ZOOM_DENSITY_MAX;
  const needed = Math.ceil(full * (1 + PARTICLE_STORM_BONUS[kind]));
  return Math.ceil(needed / PARTICLE_CAPACITY_STEP) * PARTICLE_CAPACITY_STEP;
}

/** The largest screen the particle caps cover at every zoom and a full storm. On a larger screen the
 *  cap holds, and the density gate's ranks then shift as the on-screen amount changes. */
export const PARTICLE_CAP_SCREEN = { width: 2560, height: 1440 } as const;

/** Hard ceiling per kind, whatever the screen. Snow is densest: about 44 000 flakes at 1440p zoomed out. */
export const PARTICLE_CAP: Readonly<Record<WeatherKind, number>> = {
  rain: uncappedCapacity('rain', PARTICLE_CAP_SCREEN.width, PARTICLE_CAP_SCREEN.height),
  snow: uncappedCapacity('snow', PARTICLE_CAP_SCREEN.width, PARTICLE_CAP_SCREEN.height),
  sand: uncappedCapacity('sand', PARTICLE_CAP_SCREEN.width, PARTICLE_CAP_SCREEN.height),
};

/** Instance-buffer size that covers {@link particleCount} at full intensity, full storm and any zoom,
 *  rounded up to a step, so neither zoom nor a storm rebuilds the buffer. */
export function particleCapacity(kind: WeatherKind, screenW: number, screenH: number): number {
  return Math.min(PARTICLE_CAP[kind], uncappedCapacity(kind, screenW, screenH));
}

/** Game seconds and particle travel reach the shader split into a coarse whole number of steps and the
 *  fine rest, each wrapped on its own, so float32 keeps sub-pixel motion however long a game runs. Sway
 *  and tumble cycle a whole number of times per time step, so they stay continuous across it. */
export const PRECIPITATION_TIME_SPLIT_SECONDS = 64;
export const PRECIPITATION_WIND_SPLIT_PX = 4096;

/** The coarse part of `value`: a whole number of `step`s. */
export function splitCoarse(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

/**
 * Particle travel integrated on game seconds. Speeds that follow the zoom are integrated here, so a zoom
 * change only alters motion from then on instead of rescaling the whole distance travelled since the
 * game began. The shader multiplies each by a particle's own zoom-1 constants.
 */
export class PrecipitationTravel {
  /** Wind px at zoom 1: gust fronts and the mist ride it. */
  windX = 0;
  windY = 0;
  /** Game seconds times the zoom size scale, for a particle's zoom-1 fall speed. */
  fall = 0;
  /** Wind px times the zoom size scale, for a particle's wind share. */
  scaledWindX = 0;
  scaledWindY = 0;

  advance(dt: number, windX: number, windY: number, sizeScale: number): void {
    this.windX += windX * dt;
    this.windY += windY * dt;
    this.fall += sizeScale * dt;
    this.scaledWindX += windX * sizeScale * dt;
    this.scaledWindY += windY * sizeScale * dt;
  }
}
