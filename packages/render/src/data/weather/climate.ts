import { frac } from '../effects/random.js';
import type { Viewport } from '../projection/viewport.js';
import { type WeatherField, weatherAmountAt } from './field.js';
import {
  smoothstep,
  stormOf,
  WEATHER_NODES_PER_WORLD_X,
  WEATHER_NODES_PER_WORLD_Y,
  weatherIntensity,
} from './precipitation.js';
import { type LightningStrike, WEATHER_KINDS, type WeatherConditions, type WeatherKind } from './types.js';

/**
 * The weather the view is in, stepped once per frame on game seconds. An OpenNorthland enhancement: the
 * original sampled one point at the screen centre and had no fades, wind, storms or lightning. Wind,
 * gusts and strikes come from stateless hashes of game time, so a pause freezes them and a replay
 * repeats them. Every constant is tuned by eye.
 */

/** Seconds for a smoothed amount to close about 63% of the gap to the view's current amount. */
export const WEATHER_FADE_SECONDS = 2.5;
/** A game-time step longer than this (fast-forward, load, seek) or backwards snaps instead of fading. */
export const WEATHER_SNAP_SECONDS = 3;
/** The view is sampled on this many points per axis, spread evenly across it. */
const VIEW_SAMPLES_PER_AXIS = 3;

/** Steady wind in screen px per game second: a calm breeze, the extra a full storm adds, and the extra a
 *  full sandstorm adds on top (the original's sand dashes moved 110..500 px/s sideways). */
const CALM_WIND = 22;
const STORM_WIND = 150;
const SAND_WIND = 260;
/** Screen-space wind heading in radians from +x towards +y (down the screen): the original's weather
 *  always drifted right, so the base heading blows right and slightly down. A heading above the
 *  horizontal keeps only its sideways part, so a strong wind never lifts precipitation up the screen. */
const BASE_HEADING = 0.18;
/** How far the heading drifts either side of the base, and the two drift periods in game seconds. */
const HEADING_DRIFT = 0.55;
const HEADING_PERIOD_SLOW = 173;
const HEADING_PERIOD_FAST = 47;
/** A sandstorm flattens the heading to horizontal by this share. */
const SAND_FLATTEN = 0.85;
/** Gust noise: value-noise buckets of two octaves, how much of the second, and the level gusts start at. */
const GUST_SECONDS = 1.9;
const GUST_DETAIL_SECONDS = 0.55;
const GUST_DETAIL_WEIGHT = 0.35;
const GUST_THRESHOLD = 0.4;
/** Share of gust strength a calm day keeps; a full storm gusts at full strength. */
const GUST_CALM_SHARE = 0.35;
/** A full gust adds this share of the steady wind speed. */
const GUST_GAIN = 0.9;

/** Lightning: strike chances are rolled per bucket of game seconds, and at most one strike per bucket. */
export const LIGHTNING_BUCKET_SECONDS = 3;
/** Rain storm strength where lightning starts, and the per-bucket chance in a full thunderstorm: about
 *  one strike in ten seconds, most of them distant. */
const LIGHTNING_MIN_STORM = 0.3;
const LIGHTNING_MAX_CHANCE = 0.3;
/** A strike lands in the first part of its bucket, so consecutive strikes are at least
 *  {@link LIGHTNING_MIN_GAP_SECONDS} apart: with two pulses per strike, no second of play holds more than
 *  three flashes (the WCAG 2.3.1 general flash limit). */
const STRIKE_BUCKET_SHARE = 0.5;
export const LIGHTNING_MIN_GAP_SECONDS = LIGHTNING_BUCKET_SECONDS * (1 - STRIKE_BUCKET_SHARE);
/** Strike ground points spread past the screen edges, so some bolts are off screen. */
const STRIKE_SPREAD_X = { min: -0.3, max: 1.3 } as const;
const STRIKE_SPREAD_Y = { min: -0.15, max: 1.0 } as const;
/** How far past the screen edge (in screen fractions) a strike reads as fully distant. */
const STRIKE_OFFSCREEN_FAR = 0.3;
/** Flash pulses after a strike: offset in seconds and peak; the second (a re-strike down the same
 *  channel) only on some strikes. */
const FLASH_PULSES: readonly { readonly at: number; readonly peak: number }[] = [
  { at: 0, peak: 1 },
  { at: 0.14, peak: 0.5 },
];
const SECOND_PULSE_CHANCE = 0.45;
const FLASH_ATTACK_SECONDS = 0.02;
const FLASH_DECAY_SECONDS = 0.05;
/** A pulse is spent after this many decay constants. */
const FLASH_TAIL_DECAYS = 6;
const LAST_PULSE_AT = FLASH_PULSES.reduce((last, pulse) => Math.max(last, pulse.at), 0);
export const LIGHTNING_FLASH_SECONDS =
  LAST_PULSE_AT + FLASH_ATTACK_SECONDS + FLASH_TAIL_DECAYS * FLASH_DECAY_SECONDS;
/** A distant strike's flash keeps this share of an overhead one. */
const FLASH_DISTANT_SHARE = 0.3;
/** Thunder from the farthest strike arrives this long after its flash; audio delays by `distance` of it. */
export const THUNDER_MAX_DELAY_SECONDS = 6;
/** Strikes stay listed until their thunder could still start. */
export const LIGHTNING_RETAIN_SECONDS = LIGHTNING_FLASH_SECONDS + THUNDER_MAX_DELAY_SECONDS;

/** Hash salts keep the wind, gust and strike streams independent for one seed. */
const SALT_HEADING = 0x51ed27;
const SALT_GUST = 0x7a3b91;
const SALT_GUST_DETAIL = 0x2c9e45;
const SALT_STRIKE = 0x6d2f13;
/** Hash draws per strike bucket: chance, time, x, y, distance, second pulse. */
const STRIKE_DRAWS = 6;
const TWO_PI = 2 * Math.PI;

export interface ClimateInput {
  /** `null` before a map loads, or on a map without weather. */
  readonly field: WeatherField | null;
  /** World-space (pre-camera) rectangle the camera frames: `cameraViewport(camera, screenW, screenH)`. */
  readonly viewport: Viewport;
  /** Game seconds; hold it still while paused. */
  readonly gameSeconds: number;
  /** The Weather graphics setting. Off returns calm conditions and forgets the fades. */
  readonly enabled: boolean;
}

/** The field's mean amount of each kind over evenly spread points of `viewport`, written into `out`. */
export function viewWeatherAmounts(
  field: WeatherField,
  viewport: Viewport,
  out: Record<WeatherKind, number> = { rain: 0, snow: 0, sand: 0 },
): Record<WeatherKind, number> {
  for (const kind of WEATHER_KINDS) out[kind] = 0;
  if (!field.any) return out;
  const samples = VIEW_SAMPLES_PER_AXIS * VIEW_SAMPLES_PER_AXIS;
  for (let iy = 0; iy < VIEW_SAMPLES_PER_AXIS; iy++) {
    const y = viewport.minY + ((iy + 0.5) / VIEW_SAMPLES_PER_AXIS) * (viewport.maxY - viewport.minY);
    for (let ix = 0; ix < VIEW_SAMPLES_PER_AXIS; ix++) {
      const x = viewport.minX + ((ix + 0.5) / VIEW_SAMPLES_PER_AXIS) * (viewport.maxX - viewport.minX);
      const hx = x * WEATHER_NODES_PER_WORLD_X;
      const hy = y * WEATHER_NODES_PER_WORLD_Y;
      for (const kind of WEATHER_KINDS) out[kind] += weatherAmountAt(field, kind, hx, hy) / samples;
    }
  }
  return out;
}

/** Smooth 0..1 value noise over game seconds: a hashed value per bucket, eased between buckets. */
function valueNoise(seed: number, seconds: number, bucketSeconds: number): number {
  const position = seconds / bucketSeconds;
  const bucket = Math.floor(position);
  return lerpSmooth(frac(seed, bucket), frac(seed, bucket + 1), position - bucket);
}

function lerpSmooth(a: number, b: number, t: number): number {
  return a + (b - a) * t * t * (3 - 2 * t);
}

/** 0..1 gust at `seconds`, before the storm scaling: mostly zero with occasional swells. */
export function gustAt(seed: number, seconds: number): number {
  const noise =
    (valueNoise(seed ^ SALT_GUST, seconds, GUST_SECONDS) +
      GUST_DETAIL_WEIGHT * valueNoise(seed ^ SALT_GUST_DETAIL, seconds, GUST_DETAIL_SECONDS)) /
    (1 + GUST_DETAIL_WEIGHT);
  return smoothstep(GUST_THRESHOLD, 1, noise);
}

/** The strike rolled for `bucket`, or `null`; pure in (seed, bucket, chance). */
export function strikeInBucket(seed: number, bucket: number, chance: number): LightningStrike | null {
  const draw = (k: number): number => frac(seed ^ SALT_STRIKE, bucket * STRIKE_DRAWS + k);
  if (draw(0) >= chance) return null;
  const screenX = STRIKE_SPREAD_X.min + draw(2) * (STRIKE_SPREAD_X.max - STRIKE_SPREAD_X.min);
  const screenY = STRIKE_SPREAD_Y.min + draw(3) * (STRIKE_SPREAD_Y.max - STRIKE_SPREAD_Y.min);
  const outside = Math.max(0, -screenX, screenX - 1, -screenY, screenY - 1);
  const distance = Math.min(1, Math.max(Math.sqrt(draw(4)), outside / STRIKE_OFFSCREEN_FAR));
  return {
    id: bucket,
    atSeconds: (bucket + draw(1) * STRIKE_BUCKET_SHARE) * LIGHTNING_BUCKET_SECONDS,
    screenX,
    screenY,
    distance,
  };
}

function hasSecondPulse(seed: number, strike: LightningStrike): boolean {
  return frac(seed ^ SALT_STRIKE, strike.id * STRIKE_DRAWS + 5) < SECOND_PULSE_CHANCE;
}

/** 0..1 flash brightness of one strike at `seconds`: a fast rise and decay per pulse, dimmer when far. */
export function strikeFlash(seed: number, strike: LightningStrike, seconds: number): number {
  const age = seconds - strike.atSeconds;
  if (age < 0 || age > LIGHTNING_FLASH_SECONDS) return 0;
  const pulses = hasSecondPulse(seed, strike) ? FLASH_PULSES.length : FLASH_PULSES.length - 1;
  let flash = 0;
  for (let i = 0; i < pulses; i++) {
    const pulse = FLASH_PULSES[i];
    if (pulse === undefined) continue;
    const t = age - pulse.at;
    if (t < 0) continue;
    const envelope =
      t < FLASH_ATTACK_SECONDS
        ? t / FLASH_ATTACK_SECONDS
        : Math.exp(-(t - FLASH_ATTACK_SECONDS) / FLASH_DECAY_SECONDS);
    flash = Math.max(flash, pulse.peak * envelope);
  }
  return flash * (1 - (1 - FLASH_DISTANT_SHARE) * strike.distance);
}

/** Seconds from a strike's flash to its thunder. */
export function thunderDelaySeconds(strike: LightningStrike): number {
  return strike.distance * THUNDER_MAX_DELAY_SECONDS;
}

interface MutableConditions {
  amounts: Record<WeatherKind, number>;
  storm: number;
  windX: number;
  windY: number;
  gust: number;
  flash: number;
  strikes: LightningStrike[];
}

function calmConditions(): MutableConditions {
  return {
    amounts: { rain: 0, snow: 0, sand: 0 },
    storm: 0,
    windX: 0,
    windY: 0,
    gust: 0,
    flash: 0,
    strikes: [],
  };
}

/**
 * Steps {@link WeatherConditions} once per frame. The returned object is reused and valid until the next
 * `step`; copy what must outlive it.
 */
export class WeatherClimate {
  private readonly out = calmConditions();
  private readonly target: Record<WeatherKind, number> = { rain: 0, snow: 0, sand: 0 };
  private lastSeconds: number | null = null;
  /** The first lightning bucket not yet rolled or emitted. */
  private nextBucket = 0;

  constructor(private readonly seed = 0) {}

  step(input: ClimateInput): WeatherConditions {
    if (!input.enabled) {
      if (this.lastSeconds !== null) this.reset();
      return this.out;
    }
    const now = input.gameSeconds;
    const dt = this.lastSeconds === null ? Number.POSITIVE_INFINITY : now - this.lastSeconds;
    const snap = dt < 0 || dt > WEATHER_SNAP_SECONDS;
    this.lastSeconds = now;
    this.stepAmounts(input, snap ? null : dt);
    this.stepWind(now);
    this.stepLightning(now, snap);
    return this.out;
  }

  /** Forget fades and strikes: the next step snaps to the view's weather. */
  reset(): void {
    Object.assign(this.out, calmConditions());
    this.lastSeconds = null;
    this.nextBucket = 0;
  }

  private stepAmounts(input: ClimateInput, dt: number | null): void {
    const target = input.field === null ? null : viewWeatherAmounts(input.field, input.viewport, this.target);
    // A still clock (a pause) follows the view at once, so panning a paused game keeps the sky, sound
    // and sway in step with the particles, which read the field directly.
    const blend = dt === null || dt === 0 ? 1 : 1 - Math.exp(-dt / WEATHER_FADE_SECONDS);
    let storm = 0;
    for (const kind of WEATHER_KINDS) {
      const current = this.out.amounts[kind];
      const next = current + ((target?.[kind] ?? 0) - current) * blend;
      this.out.amounts[kind] = next;
      storm = Math.max(storm, stormOf(kind, next));
    }
    this.out.storm = storm;
  }

  private stepWind(now: number): void {
    const { amounts, storm } = this.out;
    const sand = weatherIntensity('sand', amounts.sand);
    const phaseSlow = frac(this.seed ^ SALT_HEADING, 0) * TWO_PI;
    const phaseFast = frac(this.seed ^ SALT_HEADING, 1) * TWO_PI;
    const drift =
      (2 / 3) * Math.sin((TWO_PI * now) / HEADING_PERIOD_SLOW + phaseSlow) +
      (1 / 3) * Math.sin((TWO_PI * now) / HEADING_PERIOD_FAST + phaseFast);
    const heading = (BASE_HEADING + HEADING_DRIFT * drift) * (1 - SAND_FLATTEN * sand);
    const gust = gustAt(this.seed, now) * (GUST_CALM_SHARE + (1 - GUST_CALM_SHARE) * storm);
    const speed = (CALM_WIND + STORM_WIND * storm + SAND_WIND * sand) * (1 + GUST_GAIN * gust);
    this.out.windX = speed * Math.cos(heading);
    this.out.windY = speed * Math.max(0, Math.sin(heading));
    this.out.gust = gust;
  }

  private stepLightning(now: number, snap: boolean): void {
    const bucketNow = Math.floor(now / LIGHTNING_BUCKET_SECONDS);
    const strikes = this.out.strikes;
    if (snap) {
      strikes.length = 0;
      this.nextBucket = bucketNow + 1;
    }
    const chance =
      LIGHTNING_MAX_CHANCE * smoothstep(LIGHTNING_MIN_STORM, 1, stormOf('rain', this.out.amounts.rain));
    for (; this.nextBucket <= bucketNow; this.nextBucket++) {
      const strike = strikeInBucket(this.seed, this.nextBucket, chance);
      if (strike === null) continue;
      if (strike.atSeconds > now) break; // rolled again next frame; the roll is pure, so it repeats
      strikes.push(strike);
    }
    let kept = 0;
    let flash = 0;
    for (const strike of strikes) {
      if (now - strike.atSeconds > LIGHTNING_RETAIN_SECONDS) continue;
      strikes[kept++] = strike;
      flash = Math.max(flash, strikeFlash(this.seed, strike, now));
    }
    strikes.length = kept;
    this.out.flash = flash;
  }
}

/** The weather's wind for sway consumers (vegetation, smoke, sails): `strength` 0..1 of the wind the
 *  weather adds over the calm breeze, a signed -1..1 screen `direction` (positive blows right) and the
 *  0..1 `gust`. A clear sky has strength 0, which consumers draw exactly as they would with no weather. */
export interface WindSway {
  readonly strength: number;
  readonly direction: number;
  readonly gust: number;
}

export const CALM_WIND_SWAY: WindSway = { strength: 0, direction: 0, gust: 0 };

export function sameWindSway(a: WindSway, b: WindSway): boolean {
  return a.strength === b.strength && a.direction === b.direction && a.gust === b.gust;
}

/** Weather wind in screen px/s, over the calm breeze, that reads as full sway. Tuned by eye. */
const SWAY_FULL_WIND = 260;

export function windSway(conditions: WeatherConditions): WindSway {
  const speed = Math.hypot(conditions.windX, conditions.windY);
  const sand = weatherIntensity('sand', conditions.amounts.sand);
  // The calm breeze is left out: the world's own breeze already stands for it.
  const weatherWind = (STORM_WIND * conditions.storm + SAND_WIND * sand) * (1 + GUST_GAIN * conditions.gust);
  if (speed === 0 || weatherWind === 0) return CALM_WIND_SWAY;
  return {
    strength: Math.min(1, weatherWind / SWAY_FULL_WIND),
    direction: conditions.windX / speed,
    gust: conditions.gust,
  };
}
