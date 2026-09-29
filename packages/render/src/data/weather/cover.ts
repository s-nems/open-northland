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
 *  0.02 to 0.07, so the ground reads clearly at typical densities. Tuned by eye. */
const RAIN_SATURATING_AMOUNT = 0.15;
const SNOW_SATURATING_AMOUNT = 0.1;
const SAND_SATURATING_AMOUNT = 0.05;
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

/** The cover a sector settles at under steady `rain`, `snow` and `sand` field amounts (0..1). */
export function coverEquilibrium(rain: number, snow: number, sand: number): CoverTargets {
  const wet = response(rain, RAIN_SATURATING_AMOUNT);
  // Rain and snow in one sector fall as sleet, which does not settle.
  const snowCover = response(snow, SNOW_SATURATING_AMOUNT) * (1 - wet);
  return { wet, snow: snowCover, dust: response(sand, SAND_SATURATING_AMOUNT) * (1 - wet) };
}

function approach(value: number, target: number, dt: number, seconds: number): number {
  return value + (target - value) * (1 - Math.exp(-dt / seconds));
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
  snapToEquilibrium(): void {
    const field = this.field;
    if (field === null) return;
    for (let i = 0; i < this.wet.length; i++) {
      const t = this.targetsAt(field, i, 0);
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
    if (last === null || gameSeconds < last || gameSeconds - last > COVER_SNAP_SECONDS) {
      this.stepped = gameSeconds;
      if (last === null) return true;
      this.snapToEquilibrium();
      return true;
    }
    const dt = gameSeconds - last;
    if (dt < COVER_STEP_SECONDS) return false;
    this.stepped = gameSeconds;
    if (this.settled) return false;
    let gap = 0;
    for (let i = 0; i < this.wet.length; i++) {
      const snow = this.snow[i] ?? 0;
      const t = this.targetsAt(field, i, snow);
      const rain = field.amounts[i * KIND_COUNT + RAIN] ?? 0;
      const wet = this.wet[i] ?? 0;
      const dust = this.dust[i] ?? 0;
      const nextWet = approach(wet, t.wet, dt, t.wet > wet ? WET_RISE_SECONDS : WET_DRY_SECONDS);
      const snowSeconds =
        t.snow > snow ? SNOW_BUILD_SECONDS : rain > 0 ? SNOW_RAIN_MELT_SECONDS : SNOW_MELT_SECONDS;
      const nextSnow = approach(snow, t.snow, dt, snowSeconds);
      const dustSeconds =
        t.dust > dust ? DUST_RISE_SECONDS : rain > 0 ? DUST_WASH_SECONDS : DUST_SETTLE_SECONDS;
      const nextDust = approach(dust, t.dust, dt, dustSeconds);
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
    return true;
  }

  /** RGBA8 per sector (r wet, g snow, b dust), row-major like `weatherFieldTexels`: texel centres sit
   *  on sector centres. The returned buffer is reused by the next call. */
  texels(): Uint8Array {
    const count = this.wet.length;
    if (this.out.data.length !== count * 4) this.out.data = new Uint8Array(count * 4);
    const data = this.out.data;
    for (let i = 0; i < count; i++) {
      data[i * 4] = Math.round((this.wet[i] ?? 0) * BYTE_MAX);
      data[i * 4 + 1] = Math.round((this.snow[i] ?? 0) * BYTE_MAX);
      data[i * 4 + 2] = Math.round((this.dust[i] ?? 0) * BYTE_MAX);
      data[i * 4 + 3] = BYTE_MAX;
    }
    return data;
  }

  /** Sector `i`'s cover as `[wet, snow, dust]`, for tests and diagnostics. */
  sector(i: number): CoverTargets {
    return { wet: this.wet[i] ?? 0, snow: this.snow[i] ?? 0, dust: this.dust[i] ?? 0 };
  }

  /** Sector `i`'s target; `snow` is its current snow, whose thaw wets the ground. */
  private targetsAt(field: WeatherField, i: number, snow: number): CoverTargets {
    const base = i * KIND_COUNT;
    const t = coverEquilibrium(
      field.amounts[base + RAIN] ?? 0,
      field.amounts[base + SNOW] ?? 0,
      field.amounts[base + SAND] ?? 0,
    );
    const thaw = Math.max(0, snow - t.snow) * MELT_WETNESS;
    return thaw > t.wet ? { ...t, wet: thaw, dust: t.dust * (1 - thaw) } : t;
  }

  private resize(count: number): void {
    this.wet = new Float32Array(count);
    this.snow = new Float32Array(count);
    this.dust = new Float32Array(count);
    this.stepped = null;
  }
}
