import { clamp01 } from '../math.js';
import { TILE_HALF_W } from '../projection/iso.js';
import { FIELD_COVER, FIELD_DEPTH, FIELD_WATER_B, FIELD_WATER_G, FIELD_WATER_R } from './minimap-cells.js';
import { valueNoise } from './minimap-noise.js';
import { type LightFrame, mixToward, type Rgb, textureFade } from './minimap-texture.js';

/**
 * The minimap's water at sub-cell scale: a pale shallows band along the coast, swell ripples and a
 * specular hint on the faces toward the light. Every value is a named approximation tuned by eye.
 */

/** The water coverage the coast contour sits at. */
export const COAST = 0.5;

/** The shallows band: its colour and strength at the coast, fading over this much smoothed coverage. */
const SHALLOWS = 0x86cfc0;
const SHALLOWS_ALPHA = 0.5;
const SHALLOWS_COVER_SPAN = 0.35;
/** Swell ripples in two octaves (the fine one this many times shorter, at this weight), stronger in
 *  deep water; this share of the deep swell remains in the shallows. */
const WAVE_LENGTH_CELLS = 1.1;
const WAVE_HEIGHT_CELLS = 0.3;
const FINE_WAVE_RATIO = 2.6;
const FINE_WAVE_WEIGHT = 0.5;
const WAVE = 0.14;
const WAVE_SHALLOW_SHARE = 0.4;
/** The specular hint: a ripple's rise toward the light (probed this far down-light), scaled by the
 *  gain and squared, so only the steeper faces catch it; strongest over deep water. */
const WAVE_PROBE_CELLS = 0.06;
const SPECULAR = 0.5;
const SPECULAR_GAIN = 6;
const SPECULAR_COLOUR = 0xdcefee;

const SEED_RIPPLE = 0x5851f42d;
const SEED_FINE_RIPPLE = 0x14057b7e;

const CELL_W = 2 * TILE_HALF_W;

/** Paints a water sample for one picture size; `textured` is false when the picture supersamples. */
export class SeaPainter {
  private readonly waveFade: number;
  private readonly fineWaveFade: number;
  private readonly rippleX = 1 / (WAVE_LENGTH_CELLS * CELL_W);
  private readonly rippleY = 1 / (WAVE_HEIGHT_CELLS * CELL_W);
  private readonly probeX: number;
  private readonly probeY: number;

  constructor(cellPx: number, textured: boolean, light: LightFrame) {
    this.waveFade = textured ? textureFade(WAVE_HEIGHT_CELLS, cellPx) : 0;
    this.fineWaveFade = textured ? textureFade(WAVE_HEIGHT_CELLS / FINE_WAVE_RATIO, cellPx) : 0;
    this.probeX = light.downX * WAVE_PROBE_CELLS * CELL_W;
    this.probeY = light.downY * WAVE_PROBE_CELLS * CELL_W;
  }

  /** The water colour of sample `s` at world px `(x, y)`, into `out`. */
  paint(s: Float64Array, x: number, y: number, out: Rgb): void {
    out.r = s[FIELD_WATER_R] ?? 0;
    out.g = s[FIELD_WATER_G] ?? 0;
    out.b = s[FIELD_WATER_B] ?? 0;
    const shore = 1 - clamp01(((s[FIELD_COVER] ?? 0) - COAST) / SHALLOWS_COVER_SPAN);
    mixToward(out, SHALLOWS, SHALLOWS_ALPHA * shore * shore);
    if (this.waveFade <= 0) return;
    const depth = s[FIELD_DEPTH] ?? 0;
    const { rippleX, rippleY, probeX, probeY } = this;
    let wave = valueNoise(x * rippleX, y * rippleY, SEED_RIPPLE);
    let downhill = valueNoise((x + probeX) * rippleX, (y + probeY) * rippleY, SEED_RIPPLE);
    if (this.fineWaveFade > 0) {
      const fx = FINE_WAVE_RATIO * rippleX;
      const fy = FINE_WAVE_RATIO * rippleY;
      const fine = FINE_WAVE_WEIGHT * this.fineWaveFade;
      wave += fine * valueNoise(x * fx, y * fy, SEED_FINE_RIPPLE);
      downhill += fine * valueNoise((x + probeX) * fx, (y + probeY) * fy, SEED_FINE_RIPPLE);
    }
    const facing = clamp01((downhill - wave) * SPECULAR_GAIN);
    mixToward(out, SPECULAR_COLOUR, SPECULAR * this.waveFade * facing * facing * depth);
    const swell =
      1 + WAVE * this.waveFade * (WAVE_SHALLOW_SHARE + (1 - WAVE_SHALLOW_SHARE) * depth) * (wave - 0.5);
    out.r *= swell;
    out.g *= swell;
    out.b *= swell;
  }
}
