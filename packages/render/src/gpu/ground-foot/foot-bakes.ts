import { type FootAnalysis, NO_CONTACT } from './foot-analysis.js';
import { type FootGround, type GroundKinds, groundAt, groundKinds } from './foot-ground.js';
import { hash2, noise1 } from './noise.js';

/**
 * The bakes that set a building's foot into the ground, all in the frame's pixel space. Every look here is
 * an invented approximation tuned by eye on the maps' grass, soil and snow, not the original's.
 */

const CHANNEL_MAX = 0xff;
const RGB = 3;
const RGBA = 4;
const ALPHA = 3;
/** The shortest run a fade divides by, in px, so a vanishing drift or toe cannot divide by zero. */
const MIN_FADE_PX = 0.5;
/** Light falls off as `exp(-FALLOFF_E_FOLDS * d / reach)`, about 5% at its reach. */
const FALLOFF_E_FOLDS = 3;

/** A baked overlay: `width`×`height` straight-alpha RGBA pixels at `resolution` pixels per frame px,
 *  whose top-left sits at `(left, top)` in frame px. */
export interface FootBake {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

/** How dark the wall gets right at its contact with the ground. */
const WALL_SHADE = 0.52;
/** px up the wall that shade reaches. */
const WALL_SHADE_REACH_PX = 6.5;

/**
 * Sink the body's foot and shade its walls toward every ground contact, in place, on the frame at
 * `(offsetX, offsetY)` in an RGBA image `stride` wide.
 */
export function sinkBody(
  image: Uint8ClampedArray,
  stride: number,
  offsetX: number,
  offsetY: number,
  a: FootAnalysis,
): void {
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = y * a.width + x;
      const pixel = ((y + offsetY) * stride + x + offsetX) * RGBA;
      const h = a.above[i] ?? NO_CONTACT;
      if (h !== NO_CONTACT) {
        const shade = 1 - WALL_SHADE * Math.exp((-FALLOFF_E_FOLDS * h) / WALL_SHADE_REACH_PX);
        for (let c = 0; c < RGB; c++) image[pixel + c] = (image[pixel + c] ?? 0) * shade;
      }
      image[pixel + ALPHA] = a.alpha[i] ?? 0;
    }
  }
}

/** The ground shade's opacity right at the wall. */
const GROUND_SHADE_PEAK = 0.65;
/** How far the shade spreads across the ground from a contact, and down the screen, in px: half as far
 *  down as across, since the ground lies flat under the camera's tilt. */
const GROUND_SHADE_ACROSS_PX = 10;
const GROUND_SHADE_DOWN_PX = 4.5;
/** px the shade rises behind a contact, closing the seam under the sunk edge. */
const GROUND_SHADE_UP_PX = 1;
const GROUND_SHADE_FALLOFF_POWER = 1.5;
/** The shade's colour as a share of the ground's own: darker ground on soil and grass, a lighter blue-grey
 *  on snow, which scatters light into its shadows. */
const GROUND_SHADE_TONE = 0.3;
const SNOW_SHADE_TONE = 0.85;
/** Frame px per baked pixel of the shade: a soft gradient keeps its look at half resolution, in a quarter
 *  of the memory. */
const GROUND_SHADE_DOWNSAMPLE = 2;
/** Even, so the shade's half-resolution cells line up with the frame's pixel pairs. */
const GROUND_SHADE_PAD =
  Math.ceil(Math.max(GROUND_SHADE_ACROSS_PX, GROUND_SHADE_DOWN_PX) / GROUND_SHADE_DOWNSAMPLE) *
  GROUND_SHADE_DOWNSAMPLE;

/** The ground's shade next to every contact, darkest right at the wall. */
export function bakeGroundShade(a: FootAnalysis, ground: FootGround): FootBake | null {
  const pad = GROUND_SHADE_PAD;
  const width = a.width + pad * 2;
  const height = a.height + pad * 2;
  const field = new Float32Array(width * height);
  const reachX = Math.ceil(GROUND_SHADE_ACROSS_PX);
  const reachY = Math.ceil(GROUND_SHADE_DOWN_PX);
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (a.contact[y * a.width + x] !== 1) continue;
      for (let dy = -GROUND_SHADE_UP_PX; dy <= reachY; dy++) {
        const down = Math.max(0, dy) / GROUND_SHADE_DOWN_PX;
        for (let dx = -reachX; dx <= reachX; dx++) {
          const r = Math.hypot(dx / GROUND_SHADE_ACROSS_PX, down);
          if (r >= 1) continue;
          const v = GROUND_SHADE_PEAK * (1 - r) ** GROUND_SHADE_FALLOFF_POWER;
          const j = (y + dy + pad) * width + x + dx + pad;
          if ((field[j] ?? 0) < v) field[j] = v;
        }
      }
    }
  }
  const out = new BakeCanvas(width, height, -pad, -pad);
  const rgb = new Float32Array(RGB);
  const kinds: GroundKinds = { grass: 0, snow: 0 };
  const tone = new Float32Array(RGB);
  for (let x = 0; x < width; x++) {
    groundAt(ground, x - pad, rgb);
    groundKinds(rgb, kinds);
    const dark = GROUND_SHADE_TONE + (SNOW_SHADE_TONE - GROUND_SHADE_TONE) * kinds.snow;
    for (let c = 0; c < RGB; c++) tone[c] = (rgb[c] ?? 0) * dark;
    for (let y = 0; y < height; y++) {
      const v = field[y * width + x] ?? 0;
      if (v > 0) out.put(x, y, tone, 1, v);
    }
  }
  return out.finish(GROUND_SHADE_DOWNSAMPLE);
}

/** Opacity of the ground's stain up the wall at its foot, and px up the wall it reaches. */
const STAIN = 0.15;
const STAIN_REACH_PX = 10;
/** The stain's colour as a share of the ground's. */
const STAIN_TONE = 0.7;

/** Tallest tuft on full grass, in px, and the share of that the shortest blade keeps. */
const TUFT_HEIGHT_PX = 14;
const TUFT_MIN_SHARE = 0.35;
/** Wavelength of the clumps tufts grow in along the foot, in px, and the share of it that grows any. */
const TUFT_CLUMP_PX = 8;
const TUFT_CLUMP_DENSITY = 0.75;
/** A blade's colour at its root and its tip, as a share of the ground's, and each blade's own spread. */
const TUFT_ROOT_TONE = 0.7;
const TUFT_TIP_TONE = 1.4;
const TUFT_BLADE_TONE_LO = 0.85;
const TUFT_BLADE_TONE_SPREAD = 0.3;
/** Ground channels are capped here so the brightest blade tip stays in range instead of clipping. */
const GROUND_CHANNEL_CAP = CHANNEL_MAX / (TUFT_TIP_TONE * (TUFT_BLADE_TONE_LO + TUFT_BLADE_TONE_SPREAD));

/** Tallest drift on full snow, in px, and the share of that its lowest hollow keeps. */
const DRIFT_HEIGHT_PX = 10;
const DRIFT_MIN_SHARE = 0.25;
/** The drift's swell along the wall: a slow wave of this many px, with this share of small bumps. */
const DRIFT_SWELL_PX = 16;
const DRIFT_BUMP_PX = 4;
const DRIFT_BUMP_SHARE = 0.4;
/** px either way the drift's top is smoothed over the sunk foot's ragged cut. */
const DRIFT_TOP_SMOOTH_PX = 3;
/** How far toward white the drift's top runs from the ground's own colour, and the share of that its
 *  bottom keeps, so the drift grows out of the snow on the ground. */
const DRIFT_WHITEN = 0.6;
const DRIFT_FOOT_WHITEN_SHARE = 0.2;
/** Brightening of a bump's slope facing the light, per px of rise per px across. */
const DRIFT_SLOPE_LIGHT = 0.14;
/** The drift face's tone at its bottom, rising to 1 at its top. */
const DRIFT_FACE_BOTTOM_TONE = 0.9;
/** px over which the drift's top edge fades in, so it reads as powder rather than a cut plate. */
const DRIFT_SOFT_TOP_PX = 2;
/** Per-pixel grain of the drift's tone. */
const DRIFT_GRAIN = 0.08;
/** px the drift's toe runs onto the ground in front of the wall on full snow. */
const DRIFT_TOE_PX = 6;
/** How far a contact may sit off its column's lowest one and still belong to the front foot line. */
const FRONT_LINE_PX = 3;
/** How far what covers a wall's foot follows that wall's light: 1 takes it whole. */
const WALL_LIGHT_FOLLOW = 0.85;

const TUFT_CLUMP_SEED = 3;
const TUFT_BLADE_SEED = 7919;
const TUFT_TONE_SEED = 104729;
const DRIFT_SWELL_SEED = 29;
const DRIFT_BUMP_SEED = 41;
const DRIFT_GRAIN_ROW_STRIDE = 7;
const DRIFT_GRAIN_SEED = 3;

/**
 * What of the ground covers the wall's foot, drawn over the body in the ground's colours and in the light
 * of the wall it lies against: a stain of ground colour up the wall, tufts on grass, and on snow a drift
 * banked against the wall whose toe lies on the ground in front of it.
 */
export function bakeFootCover(a: FootAnalysis, ground: FootGround): FootBake | null {
  const out = new BakeCanvas(a.width, a.height, 0, 0);
  const foot = smoothFoot(a.footRow);
  const kinds: GroundKinds = { grass: 0, snow: 0 };
  const rgb = new Float32Array(RGB);
  const capped = new Float32Array(RGB);
  const snowColour = new Float32Array(RGB);
  const drift = new Float32Array(a.width);
  const grass = new Float32Array(a.width);
  const snow = new Float32Array(a.width);
  for (let x = 0; x < a.width; x++) {
    groundAt(ground, x, rgb);
    groundKinds(rgb, kinds);
    grass[x] = kinds.grass;
    snow[x] = kinds.snow;
    const swell =
      (1 - DRIFT_BUMP_SHARE) * noise1(x / DRIFT_SWELL_PX, DRIFT_SWELL_SEED) +
      DRIFT_BUMP_SHARE * noise1(x / DRIFT_BUMP_PX, DRIFT_BUMP_SEED);
    drift[x] = DRIFT_HEIGHT_PX * kinds.snow * (DRIFT_MIN_SHARE + (1 - DRIFT_MIN_SHARE) * swell);
  }
  for (let x = 0; x < a.width; x++) {
    groundAt(ground, x, rgb);
    for (let c = 0; c < RGB; c++) capped[c] = Math.min(GROUND_CHANNEL_CAP, rgb[c] ?? 0);
    const light = 1 - WALL_LIGHT_FOLLOW * (1 - (a.wallLight[x] ?? 1));
    const clump = Math.max(
      0,
      (noise1(x / TUFT_CLUMP_PX, TUFT_CLUMP_SEED) - (1 - TUFT_CLUMP_DENSITY)) / TUFT_CLUMP_DENSITY,
    );
    const bladeHeight =
      TUFT_HEIGHT_PX *
      (grass[x] ?? 0) *
      clump *
      (TUFT_MIN_SHARE + (1 - TUFT_MIN_SHARE) * hash2(x, TUFT_BLADE_SEED));
    const bladeTone = TUFT_BLADE_TONE_LO + TUFT_BLADE_TONE_SPREAD * hash2(x, TUFT_TONE_SEED);
    const driftHeight = drift[x] ?? 0;
    const slope = ((drift[Math.min(a.width - 1, x + 1)] ?? 0) - (drift[Math.max(0, x - 1)] ?? 0)) / 2;
    const slopeLight = 1 + DRIFT_SLOPE_LIGHT * Math.max(-1, Math.min(1, slope));
    const front = a.footRow[x] ?? -1;
    const footY = foot[x] ?? front;
    const toe = DRIFT_TOE_PX * (snow[x] ?? 0);
    for (let y = 0; y < a.height; y++) {
      const i = y * a.width + x;
      const body = (a.alpha[i] ?? 0) / CHANNEL_MAX;
      const grain = 1 + DRIFT_GRAIN * (hash2(x, y * DRIFT_GRAIN_ROW_STRIDE + DRIFT_GRAIN_SEED) - 0.5);
      if (body === 0) {
        // The drift's toe lies on the ground in front of the wall, over the ground's shade, and leaves
        // the wall's light as it runs out onto the open ground.
        if (front < 0 || driftHeight <= 0 || y < footY) continue;
        const below = y - footY;
        if (below >= toe) continue;
        const k = 1 - below / Math.max(MIN_FADE_PX, toe);
        whitened(rgb, DRIFT_WHITEN * DRIFT_FOOT_WHITEN_SHARE * k, snowColour);
        out.put(x, y, snowColour, grain * (1 + (light - 1) * k), k * k);
        continue;
      }
      const h = a.above[i] ?? NO_CONTACT;
      if (h === NO_CONTACT) continue;
      // Along the front foot the drift banks to the smoothed foot line, not the ragged cut.
      const lift = front >= 0 && Math.abs(y + h - front) <= FRONT_LINE_PX ? footY - y : h;
      if (h < bladeHeight) {
        const tone = TUFT_ROOT_TONE + (TUFT_TIP_TONE - TUFT_ROOT_TONE) * (h / bladeHeight);
        out.put(x, y, capped, tone * bladeTone * light, body);
      } else if (lift < driftHeight && lift > -driftHeight) {
        const rise = Math.max(0, lift);
        const t = Math.min(1, rise / Math.max(MIN_FADE_PX, driftHeight));
        whitened(
          rgb,
          DRIFT_WHITEN * (DRIFT_FOOT_WHITEN_SHARE + (1 - DRIFT_FOOT_WHITEN_SHARE) * t),
          snowColour,
        );
        const face = DRIFT_FACE_BOTTOM_TONE + (1 - DRIFT_FACE_BOTTOM_TONE) * t;
        const soft = Math.min(1, (driftHeight - rise) / DRIFT_SOFT_TOP_PX);
        out.put(x, y, snowColour, slopeLight * face * grain * light, body * soft);
      } else {
        const alpha = STAIN * Math.exp((-FALLOFF_E_FOLDS * h) / STAIN_REACH_PX) * body * (1 - (snow[x] ?? 0));
        if (alpha > 0) out.put(x, y, capped, STAIN_TONE * light, alpha);
      }
    }
  }
  return out.finish();
}

/** The lowest contact row per column, averaged with its neighbours on the same foot line, so a drift's
 *  top runs smooth over the sunk foot's ragged cut. */
function smoothFoot(row: Int32Array): Float32Array {
  const out = new Float32Array(row.length).fill(-1);
  for (let x = 0; x < row.length; x++) {
    const own = row[x] ?? -1;
    if (own < 0) continue;
    let sum = 0;
    let count = 0;
    for (let k = -DRIFT_TOP_SMOOTH_PX; k <= DRIFT_TOP_SMOOTH_PX; k++) {
      const v = row[x + k] ?? -1;
      if (v < 0 || Math.abs(v - own) > FRONT_LINE_PX) continue;
      sum += v;
      count++;
    }
    out[x] = sum / count;
  }
  return out;
}

/** `rgb` whitened by `share` of the way to white, into `out`. */
function whitened(rgb: Float32Array, share: number, out: Float32Array): void {
  for (let c = 0; c < RGB; c++) out[c] = (rgb[c] ?? 0) + (CHANNEL_MAX - (rgb[c] ?? 0)) * share;
}

/** An overlay's pixels, trimmed on {@link finish} to the box anything was painted in. */
class BakeCanvas {
  private readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  private minX = Number.POSITIVE_INFINITY;
  private minY = Number.POSITIVE_INFINITY;
  private maxX = -1;
  private maxY = -1;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly left: number,
    private readonly top: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * RGBA);
  }

  put(x: number, y: number, rgb: Float32Array, tone: number, alpha: number): void {
    const p = (y * this.width + x) * RGBA;
    this.pixels[p] = (rgb[0] ?? 0) * tone;
    this.pixels[p + 1] = (rgb[1] ?? 0) * tone;
    this.pixels[p + 2] = (rgb[2] ?? 0) * tone;
    this.pixels[p + ALPHA] = alpha * CHANNEL_MAX;
    if ((this.pixels[p + ALPHA] ?? 0) === 0) return;
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }

  /** The painted box, averaged down by `downsample` frame px per baked pixel each way. */
  finish(downsample = 1): FootBake | null {
    if (this.maxX < 0) return null;
    const x0 = this.minX - (((this.minX % downsample) + downsample) % downsample);
    const y0 = this.minY - (((this.minY % downsample) + downsample) % downsample);
    const width = Math.ceil((this.maxX - x0 + 1) / downsample);
    const height = Math.ceil((this.maxY - y0 + 1) / downsample);
    const pixels = new Uint8ClampedArray(width * height * RGBA);
    const cell = downsample * downsample;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Weighted by alpha, so a cell's clear pixels do not grey its colour.
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let dy = 0; dy < downsample; dy++) {
          for (let dx = 0; dx < downsample; dx++) {
            const sx = x0 + x * downsample + dx;
            const sy = y0 + y * downsample + dy;
            if (sx >= this.width || sy >= this.height) continue;
            const p = (sy * this.width + sx) * RGBA;
            const alpha = this.pixels[p + ALPHA] ?? 0;
            r += (this.pixels[p] ?? 0) * alpha;
            g += (this.pixels[p + 1] ?? 0) * alpha;
            b += (this.pixels[p + 2] ?? 0) * alpha;
            a += alpha;
          }
        }
        if (a === 0) continue;
        const q = (y * width + x) * RGBA;
        pixels[q] = r / a;
        pixels[q + 1] = g / a;
        pixels[q + 2] = b / a;
        pixels[q + ALPHA] = a / cell;
      }
    }
    return {
      left: this.left + x0,
      top: this.top + y0,
      width,
      height,
      resolution: 1 / downsample,
      pixels,
    };
  }
}
