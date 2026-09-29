import type { WeatherField } from './field.js';
import { WEATHER_KINDS } from './types.js';

/**
 * Ground cover left by the weather, an Open Northland enhancement: the original draws weather only in
 * the air. Each weather sector carries a wetness, snow and dust amount 0..1 that chase the sector's
 * equilibrium for its current field, so rain wets the ground over a minute and it dries over minutes
 * after. Presentation only: the state lives in the renderer, starts at the equilibrium whenever a map
 * opens, and never enters a save. Every rate and response below is an approximation tuned by eye.
 */

const KIND_COUNT = WEATHER_KINDS.length;
const RAIN = WEATHER_KINDS.indexOf('rain');
const SNOW = WEATHER_KINDS.indexOf('snow');
const SAND = WEATHER_KINDS.indexOf('sand');

/** Field amounts that saturate each cover. Real maps script amounts of 0.05 to 0.3 and write sand at
 *  0.02 to 0.07, so a light shower only darkens the ground and the full cover takes a heavy one.
 *  Tuned by eye; the ground reactions share them. */
export const RAIN_SATURATING_AMOUNT = 0.35;
export const SNOW_SATURATING_AMOUNT = 0.4;
export const SAND_SATURATING_AMOUNT = 0.1;
/** How much of the melting snow shows as wet ground while it thaws. Tuned by eye. */
const MELT_WETNESS = 0.8;

/** Exponential time constants in game seconds: the cover closes 63% of its gap per constant. */
const WET_RISE_SECONDS = 20;
const WET_DRY_SECONDS = 180;
const SNOW_BUILD_SECONDS = 120;
const SNOW_MELT_SECONDS = 480;
/** Snow under rain turns to slush far sooner than it melts on a dry day. */
const SNOW_RAIN_MELT_SECONDS = 90;
const DUST_RISE_SECONDS = 45;
const DUST_SETTLE_SECONDS = 150;
/** Rain washes dust out of the air and off the ground. */
const DUST_WASH_SECONDS = 30;

/** Cover advances in steps of this many game seconds, a few times per second at normal speed. */
export const COVER_STEP_SECONDS = 0.25;
/** A longer gap (a hidden tab, fast-forward) is integrated in sub-steps no longer than this, so thaw
 *  wetness follows the melting snow instead of the snow at the gap's start. Tuned against the
 *  shortest time constant; an approximation. */
const COVER_MAX_STEP_SECONDS = 5;
/** A clock that jumps back, or forward by more than this (a load, a seek, a long fast-forward),
 *  snaps the cover to its equilibrium instead of integrating the gap. */
export const COVER_SNAP_SECONDS = 600;
/** Below this gap from its target everywhere, the cover stops stepping until its field changes. */
const SETTLE_EPSILON = 1 / 512;

const BYTE_MAX = 255;

/** A cover amount's response to a field amount: linear onset easing into saturation. */
function response(amount: number, saturating: number): number {
  const t = Math.min(1, Math.max(0, amount / saturating));
  return 1 - (1 - t) * (1 - t);
}

/** One sector's equilibrium: `[wet, snow, dust]`, each 0..1. */
export interface CoverTargets {
  readonly wet: number;
  readonly snow: number;
  readonly dust: number;
}

type MutableTargets = { -readonly [K in keyof CoverTargets]: number };

function writeEquilibrium(out: MutableTargets, rain: number, snow: number, sand: number): void {
  const wet = response(rain, RAIN_SATURATING_AMOUNT);
  out.wet = wet;
  // Rain and snow in one sector fall as sleet, which does not settle.
  out.snow = response(snow, SNOW_SATURATING_AMOUNT) * (1 - wet);
  out.dust = response(sand, SAND_SATURATING_AMOUNT) * (1 - wet);
}

/** The cover a sector settles at under steady `rain`, `snow` and `sand` field amounts (0..1). */
export function coverEquilibrium(rain: number, snow: number, sand: number): CoverTargets {
  const out = { wet: 0, snow: 0, dust: 0 };
  writeEquilibrium(out, rain, snow, sand);
  return out;
}

/** The share of its gap a cover closes in `dt` under time constant `seconds`. */
function blend(dt: number, seconds: number): number {
  return 1 - Math.exp(-dt / seconds);
}

/**
 * The per-sector ground cover of one map, advanced by game seconds. Call {@link setField} on every
 * field change and {@link advance} once per frame; {@link texels} is the GPU upload.
 */
export class WeatherCover {
  private field: WeatherField | null = null;
  private wet = new Float32Array(0);
  private snow = new Float32Array(0);
  private dust = new Float32Array(0);
  private readonly out = { data: new Uint8Array(0) };
  /** Game seconds of the last step; null until the first {@link advance} after a field arrives. */
  private stepped: number | null = null;
  private settled = true;
  /** Scratch for the sector target being stepped. */
  private readonly target: MutableTargets = { wet: 0, snow: 0, dust: 0 };

  get sectorsX(): number {
    return this.field?.sectorsX ?? 0;
  }

  get sectorsY(): number {
    return this.field?.sectorsY ?? 0;
  }

  /** True while any sector shows any cover. */
  get any(): boolean {
    return this.wet.some((v) => v > 0) || this.snow.some((v) => v > 0) || this.dust.some((v) => v > 0);
  }

  /**
   * A new field for the map. The first field of a map, or one of other dimensions, starts at its
   * equilibrium, so a snowy map opens white; a later field keeps the cover and lets it drift.
   */
  setField(field: WeatherField | null): void {
    const previous = this.field;
    this.field = field;
    if (field === null) {
      this.resize(0);
      this.settled = true;
      return;
    }
    if (previous === null || previous.sectorsX !== field.sectorsX || previous.sectorsY !== field.sectorsY) {
      this.resize(field.sectorsX * field.sectorsY);
      this.snapToEquilibrium();
      return;
    }
    this.settled = false;
  }

  /** Jump every sector to the current field's equilibrium. */
  private snapToEquilibrium(): void {
    const field = this.field;
    if (field === null) return;
    const t = this.target;
    for (let i = 0; i < this.wet.length; i++) {
      this.writeTarget(field, i, 0);
      this.wet[i] = t.wet;
      this.snow[i] = t.snow;
      this.dust[i] = t.dust;
    }
    this.settled = true;
  }

  /**
   * Bring the cover up to `gameSeconds`, in {@link COVER_STEP_SECONDS} steps. Returns true when the
   * cover changed since the last call, so the caller re-uploads {@link texels} only then.
   */
  advance(gameSeconds: number): boolean {
    const field = this.field;
    if (field === null) return false;
    const last = this.stepped;
    // The first step of a map snaps too: a map's regions may arrive over several fields before it.
    if (last === null || gameSeconds < last || gameSeconds - last > COVER_SNAP_SECONDS) {
      this.stepped = gameSeconds;
      this.snapToEquilibrium();
      return true;
    }
    const dt = gameSeconds - last;
    if (dt < COVER_STEP_SECONDS) return false;
    this.stepped = gameSeconds;
    if (this.settled) return false;
    const steps = Math.ceil(dt / COVER_MAX_STEP_SECONDS);
    for (let s = 0; s < steps && !this.settled; s++) this.step(field, dt / steps);
    return true;
  }

  /** One integration step of `dt` game seconds over every sector. */
  private step(field: WeatherField, dt: number): void {
    const wetRise = blend(dt, WET_RISE_SECONDS);
    const wetDry = blend(dt, WET_DRY_SECONDS);
    const snowBuild = blend(dt, SNOW_BUILD_SECONDS);
    const snowRainMelt = blend(dt, SNOW_RAIN_MELT_SECONDS);
    const snowMelt = blend(dt, SNOW_MELT_SECONDS);
    const dustRise = blend(dt, DUST_RISE_SECONDS);
    const dustWash = blend(dt, DUST_WASH_SECONDS);
    const dustSettle = blend(dt, DUST_SETTLE_SECONDS);
    const t = this.target;
    let gap = 0;
    for (let i = 0; i < this.wet.length; i++) {
      const snow = this.snow[i] ?? 0;
      this.writeTarget(field, i, snow);
      const rain = field.amounts[i * KIND_COUNT + RAIN] ?? 0;
      const wet = this.wet[i] ?? 0;
      const dust = this.dust[i] ?? 0;
      const nextWet = wet + (t.wet - wet) * (t.wet > wet ? wetRise : wetDry);
      const snowShare = t.snow > snow ? snowBuild : rain > 0 ? snowRainMelt : snowMelt;
      const nextSnow = snow + (t.snow - snow) * snowShare;
      const dustShare = t.dust > dust ? dustRise : rain > 0 ? dustWash : dustSettle;
      const nextDust = dust + (t.dust - dust) * dustShare;
      this.wet[i] = nextWet;
      this.snow[i] = nextSnow;
      this.dust[i] = nextDust;
      gap = Math.max(
        gap,
        Math.abs(t.wet - nextWet),
        Math.abs(t.snow - nextSnow),
        Math.abs(t.dust - nextDust),
      );
    }
    if (gap < SETTLE_EPSILON) this.snapToEquilibrium();
  }

  /** RGBA8 per sector (r wet, g snow, b dust, a how hard rain falls there now), row-major like
   *  `weatherFieldTexels`: texel centres sit on sector centres. The returned buffer is reused by the
   *  next call. */
  texels(): Uint8Array {
    const count = this.wet.length;
    const amounts = this.field?.amounts;
    if (this.out.data.length !== count * 4) this.out.data = new Uint8Array(count * 4);
    const data = this.out.data;
    for (let i = 0; i < count; i++) {
      data[i * 4] = Math.round((this.wet[i] ?? 0) * BYTE_MAX);
      data[i * 4 + 1] = Math.round((this.snow[i] ?? 0) * BYTE_MAX);
      data[i * 4 + 2] = Math.round((this.dust[i] ?? 0) * BYTE_MAX);
      const rain = amounts?.[i * KIND_COUNT + RAIN] ?? 0;
      data[i * 4 + 3] = Math.round(response(rain, RAIN_SATURATING_AMOUNT) * BYTE_MAX);
    }
    return data;
  }

  /** Sector `i`'s cover as `[wet, snow, dust]`, for tests and diagnostics. */
  sector(i: number): CoverTargets {
    return { wet: this.wet[i] ?? 0, snow: this.snow[i] ?? 0, dust: this.dust[i] ?? 0 };
  }

  /** Writes sector `i`'s target into {@link target}; `snow` is its current snow, whose thaw wets the
   *  ground. */
  private writeTarget(field: WeatherField, i: number, snow: number): void {
    const base = i * KIND_COUNT;
    const t = this.target;
    writeEquilibrium(
      t,
      field.amounts[base + RAIN] ?? 0,
      field.amounts[base + SNOW] ?? 0,
      field.amounts[base + SAND] ?? 0,
    );
    // Lying snow holds under a clear sky and gives way only to rain.
    const lying = (field.lyingSnow ?? 0) * (1 - t.wet);
    if (lying > t.snow) {
      t.snow = lying;
      t.dust *= 1 - lying;
    }
    const thaw = Math.max(0, snow - t.snow) * MELT_WETNESS;
    if (thaw > t.wet) {
      t.wet = thaw;
      t.dust *= 1 - thaw;
    }
  }

  private resize(count: number): void {
    this.wet = new Float32Array(count);
    this.snow = new Float32Array(count);
    this.dust = new Float32Array(count);
    this.stepped = null;
  }
}
