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

/** Below 1 lifts light weather: 5% rain already shows well over a third of the heaviest density. */
export const WEATHER_INTENSITY_GAMMA = 0.5;

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
  snow: { start: 0.2, full: 0.4 },
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

/** Screen px² per particle at full intensity and zoom 1. Rain and sand count streaks, snow flakes. */
export const PARTICLE_AREA_PX: Readonly<Record<WeatherKind, number>> = { rain: 360, snow: 520, sand: 300 };

/** Particles wrap in a box this much larger than the screen on every side, so a long streak or a swaying
 *  flake never pops at the edge. */
export const PARTICLE_WRAP_MARGIN_PX = 96;

/** Hard ceiling per kind, whatever the screen: a 4K screen at full intensity stays near this. */
export const PARTICLE_CAP = 24_000;

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

/** A full storm draws this share more particles than the heaviest calm weather. A sandstorm's longer,
 *  faster dashes and dust wall already fill the screen. */
export const PARTICLE_STORM_BONUS: Readonly<Record<WeatherKind, number>> = { rain: 0.6, snow: 0.8, sand: 0 };

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
  return Math.min(PARTICLE_CAP, Math.ceil(full * Math.min(1, intensity) * stormGain));
}

/** Instance-buffer size that covers {@link particleCount} at full intensity, full storm and any zoom,
 *  rounded up to a step, so neither zoom nor a storm rebuilds the buffer. */
export function particleCapacity(kind: WeatherKind, screenW: number, screenH: number): number {
  const full = (particleWrapArea(screenW, screenH) / PARTICLE_AREA_PX[kind]) * ZOOM_DENSITY_MAX;
  const needed = Math.ceil(full * (1 + PARTICLE_STORM_BONUS[kind]));
  return Math.min(PARTICLE_CAP, Math.ceil(needed / PARTICLE_CAPACITY_STEP) * PARTICLE_CAPACITY_STEP);
}
