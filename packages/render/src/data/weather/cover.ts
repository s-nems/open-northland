import { sectorBilinear, type WeatherField } from './field.js';
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
/** The colour of a rain splash on the ground: a drop's own, and a step's on wet ground. */
export const RAIN_SPLASH_RGB: readonly [number, number, number] = [0.84, 0.9, 0.97];
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
/** RGBA: wet, snow and dust, then the rain falling in alpha. */
const COVER_TEXEL_BYTES = 4;
const RAIN_FALLING_BYTE = 3;

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
 *
 * A step walks only the sectors still moving. One that sits exactly on its target would step to itself
 * with no gap until the field changes, so skipping it changes no sector, texel or settle test.
 */
export class WeatherCover {
  private field: WeatherField | null = null;
  private wet = new Float32Array(0);
  private snow = new Float32Array(0);
  private dust = new Float32Array(0);
  private data = new Uint8Array(0);
  /** Ascending sector indexes a step still integrates; the first {@link movingCount} are live. */
  private moving = new Int32Array(0);
  private movingCount = 0;
  /** Sectors showing any cover, so {@link any} needs no walk. */
  private showing = 0;
  /** A field arrived since the last step: its rain is not in the texels' alpha yet. */
  private alphaStale = false;
  /** A texel byte changed since the last {@link advance} reported. */
  private texelsChanged = false;
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
    return this.showing > 0;
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
    this.alphaStale = true;
    this.movingCount = this.moving.length;
    for (let i = 0; i < this.movingCount; i++) this.moving[i] = i;
  }

  /** Jump every sector to the current field's equilibrium and rewrite every texel. */
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
    this.movingCount = 0;
    this.alphaStale = false;
    this.showing = 0;
    for (let i = 0; i < this.wet.length; i++) {
      if (this.shows(i)) this.showing++;
      if (this.writeCoverTexel(i)) this.texelsChanged = true;
      if (this.writeAlphaTexel(field, i)) this.texelsChanged = true;
    }
  }

  /**
   * Bring the cover up to `gameSeconds`, in {@link COVER_STEP_SECONDS} steps. Returns true when the
   * texels or {@link any} changed since the last call, so the caller re-uploads {@link texels} only
   * then.
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
    this.texelsChanged = false;
    const shownBefore = this.showing > 0;
    if (this.alphaStale) {
      this.alphaStale = false;
      for (let i = 0; i < this.wet.length; i++) if (this.writeAlphaTexel(field, i)) this.texelsChanged = true;
    }
    const steps = Math.ceil(dt / COVER_MAX_STEP_SECONDS);
    for (let s = 0; s < steps && !this.settled; s++) this.step(field, dt / steps);
    return this.texelsChanged || this.showing > 0 !== shownBefore;
  }

  /** One integration step of `dt` game seconds over every moving sector. */
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
    const { moving, wet: wets, snow: snows, dust: dusts, data } = this;
    let kept = 0;
    let gap = 0;
    let changed = false;
    for (let k = 0; k < this.movingCount; k++) {
      const i = moving[k] ?? 0;
      const snow = snows[i] ?? 0;
      this.writeTarget(field, i, snow);
      const wet = wets[i] ?? 0;
      const dust = dusts[i] ?? 0;
      // On its target the sector's step is the identity with no gap, now and until the field changes.
      if (t.wet === wet && t.snow === snow && t.dust === dust) continue;
      moving[kept++] = i;
      const rain = field.amounts[i * KIND_COUNT + RAIN] ?? 0;
      const nextWet = wet + (t.wet - wet) * (t.wet > wet ? wetRise : wetDry);
      const snowShare = t.snow > snow ? snowBuild : rain > 0 ? snowRainMelt : snowMelt;
      const nextSnow = snow + (t.snow - snow) * snowShare;
      const dustShare = t.dust > dust ? dustRise : rain > 0 ? dustWash : dustSettle;
      const nextDust = dust + (t.dust - dust) * dustShare;
      // The stored values are the f32 roundings, which the texels and the show test read.
      const storedWet = Math.fround(nextWet);
      const storedSnow = Math.fround(nextSnow);
      const storedDust = Math.fround(nextDust);
      wets[i] = storedWet;
      snows[i] = storedSnow;
      dusts[i] = storedDust;
      const shownBefore = wet > 0 || snow > 0 || dust > 0;
      const shown = storedWet > 0 || storedSnow > 0 || storedDust > 0;
      if (shown !== shownBefore) this.showing += shown ? 1 : -1;
      const base = i * COVER_TEXEL_BYTES;
      const wetByte = Math.round(storedWet * BYTE_MAX);
      const snowByte = Math.round(storedSnow * BYTE_MAX);
      const dustByte = Math.round(storedDust * BYTE_MAX);
      if (data[base] !== wetByte || data[base + 1] !== snowByte || data[base + 2] !== dustByte) {
        data[base] = wetByte;
        data[base + 1] = snowByte;
        data[base + 2] = dustByte;
        changed = true;
      }
      gap = Math.max(
        gap,
        Math.abs(t.wet - nextWet),
        Math.abs(t.snow - nextSnow),
        Math.abs(t.dust - nextDust),
      );
    }
    this.movingCount = kept;
    if (changed) this.texelsChanged = true;
    if (gap < SETTLE_EPSILON) this.snapToEquilibrium();
  }

  /** RGBA8 per sector (r wet, g snow, b dust, a how hard rain falls there now), row-major like
   *  `weatherFieldTexels`: texel centres sit on sector centres. The buffer is kept current and reused. */
  texels(): Uint8Array {
    return this.data;
  }

  private shows(i: number): boolean {
    return (this.wet[i] ?? 0) > 0 || (this.snow[i] ?? 0) > 0 || (this.dust[i] ?? 0) > 0;
  }

  /** Writes sector `i`'s cover bytes; true when one changed. */
  private writeCoverTexel(i: number): boolean {
    const data = this.data;
    const base = i * COVER_TEXEL_BYTES;
    const wet = Math.round((this.wet[i] ?? 0) * BYTE_MAX);
    const snow = Math.round((this.snow[i] ?? 0) * BYTE_MAX);
    const dust = Math.round((this.dust[i] ?? 0) * BYTE_MAX);
    if (data[base] === wet && data[base + 1] === snow && data[base + 2] === dust) return false;
    data[base] = wet;
    data[base + 1] = snow;
    data[base + 2] = dust;
    return true;
  }

  /** Writes sector `i`'s rain-falling byte; true when it changed. */
  private writeAlphaTexel(field: WeatherField, i: number): boolean {
    const alpha = i * COVER_TEXEL_BYTES + RAIN_FALLING_BYTE;
    const rain = field.amounts[i * KIND_COUNT + RAIN] ?? 0;
    const value = Math.round(response(rain, RAIN_SATURATING_AMOUNT) * BYTE_MAX);
    if (this.data[alpha] === value) return false;
    this.data[alpha] = value;
    return true;
  }

  /** The ground's wetness 0..1 at a fractional half-cell node position, blended between sectors as the
   *  shaded cover is; 0 without a field. */
  wetAt(hx: number, hy: number): number {
    const field = this.field;
    if (field === null) return 0;
    return sectorBilinear(field.sectorsX, field.sectorsY, hx, hy, (sector) => this.wet[sector] ?? 0);
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
    this.data = new Uint8Array(count * COVER_TEXEL_BYTES);
    this.moving = new Int32Array(count);
    this.movingCount = 0;
    this.showing = 0;
    this.alphaStale = false;
    this.stepped = null;
  }
}
