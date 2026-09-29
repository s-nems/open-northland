import { seededRandom } from '../../data/weather/thunder.js';

/**
 * Procedural source buffers for the weather soundscape. Nothing is sampled: every sound is shaped
 * noise, generated once per context from fixed seeds, so the game ships no weather audio files.
 * Every buffer loops without a seam, and the bed buffers are stereo so rain and wind surround the
 * listener instead of sitting in the middle.
 */

/** Noise loop lengths. Different, non-multiple lengths keep the layers from repeating in step. */
export const WHITE_NOISE_S = 3.1;
export const PINK_NOISE_S = 3.7;
export const BROWN_NOISE_S = 4.3;
/** Soft drop bursts of light rain: loop length and density. Approximation. */
export const DROPS_S = 5.3;
export const DROPS_PER_S = 30;
/** Sand grit: a hail of tiny broadband ticks. Approximation. */
export const GRIT_S = 2.9;
export const GRIT_TICKS_PER_S = 900;
/** The swell control curve: one loop is this long in samples-worth of seconds, played slowed down by
 *  {@link SWELL_PLAYBACK_RATE} so a cycle lasts about half a minute. Approximation. */
export const SWELL_S = 2;
export const SWELL_PLAYBACK_RATE = 1 / 16;
/** Random control points per swell loop, coarse and fine, so the movement is irregular. */
const SWELL_COARSE_POINTS = 11;
const SWELL_FINE_POINTS = 29;
const SWELL_FINE_SHARE = 0.5;

/** Every noise buffer is normalised to this RMS so layer gains compare directly. */
const NOISE_RMS = 0.25;
/** Texture buffers are normalised to this peak; their RMS then follows their density. */
const TEXTURE_PEAK = 0.9;
/** Correlation between the two channels of a bed buffer: a little shared noise keeps the image from
 *  splitting into two separate sides. Approximation. */
const STEREO_CORRELATION = 0.25;
/** Each loop crossfades this much of its generated tail into its head, so the wrap has no seam. */
const LOOP_CROSSFADE_S = 0.05;

/** A drop is a short noise burst band-passed round a random centre: no tone, just a soft tap. */
const DROP_LOW_HZ = 900;
const DROP_HIGH_HZ = 4500;
/** Band-pass sharpness of a drop: wide, so it never rings as a pitch. */
const DROP_Q = 0.9;
/** A drop's parabolic pulse length range. Approximation. */
const DROP_MIN_S = 0.002;
const DROP_MAX_S = 0.007;
/** Samples of filter ring kept after the pulse, in pulse lengths. */
const DROP_RING_LENGTHS = 2;
/** Softest drop relative to the loudest. */
const DROP_MIN_LEVEL = 0.1;
/** A grit tick decays over this time constant range. */
const GRIT_MIN_DECAY_S = 0.0002;
const GRIT_MAX_DECAY_S = 0.0008;
/** Envelope tail kept per event, in decay time constants (e^-6 is inaudible). */
const DECAY_TAIL_CONSTANTS = 6;

/** Leak of the brown-noise integrator per sample: keeps it from wandering off to DC. */
const BROWN_LEAK = 0.02;

/** Paul Kellet's economy pink-noise filter: three one-pole sections and their white-noise weights. */
const PINK_POLES = [0.99765, 0.963, 0.57] as const;
const PINK_WEIGHTS = [0.099046, 0.2965164, 1.0526913] as const;
const PINK_DIRECT = 0.1848;

const SEED_WHITE = 1;
const SEED_PINK = 2;
const SEED_BROWN = 3;
const SEED_DROPS = 4;
const SEED_GRIT = 5;
const SEED_SWELL = 6;
/** The right channel's independent noise is seeded this far from the left one's. */
const SEED_RIGHT_OFFSET = 100;
const STEREO_CHANNELS = 2;

export interface WeatherBuffers {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly drops: AudioBuffer;
  readonly grit: AudioBuffer;
  /** Mono control curve in -1..1 for slow irregular swells. */
  readonly swell: AudioBuffer;
}

/** Fills a looped channel: `raw` is the loop plus a crossfade tail, generated as one stretch. */
type Generator = (raw: Float32Array, rate: number, seed: number) => void;

export function createWeatherBuffers(ctx: BaseAudioContext): WeatherBuffers {
  const rate = ctx.sampleRate;
  const stereo = (seconds: number, generate: Generator, seed: number, level: Level): AudioBuffer => {
    const length = Math.round(seconds * rate);
    const buffer = ctx.createBuffer(STEREO_CHANNELS, length, rate);
    const [left, right] = stereoLoop(length, rate, generate, seed, level);
    buffer.getChannelData(0).set(left);
    buffer.getChannelData(1).set(right);
    return buffer;
  };
  const swell = ctx.createBuffer(1, Math.round(SWELL_S * rate), rate);
  fillSwell(swell.getChannelData(0), SEED_SWELL);
  return {
    white: stereo(WHITE_NOISE_S, fillWhite, SEED_WHITE, 'rms'),
    pink: stereo(PINK_NOISE_S, fillPink, SEED_PINK, 'rms'),
    brown: stereo(BROWN_NOISE_S, fillBrown, SEED_BROWN, 'rms'),
    drops: stereo(DROPS_S, fillDrops, SEED_DROPS, 'peak'),
    grit: stereo(GRIT_S, fillGrit, SEED_GRIT, 'peak'),
    swell,
  };
}

/** How a buffer is levelled: steady noise by RMS, sparse textures by peak. */
type Level = 'rms' | 'peak';

/** Two partly correlated seamless loops of `generate`, levelled by `level`. */
export function stereoLoop(
  length: number,
  rate: number,
  generate: Generator,
  seed: number,
  level: Level,
): [Float32Array, Float32Array] {
  const left = seamlessLoop(length, rate, generate, seed);
  const other = seamlessLoop(length, rate, generate, seed + SEED_RIGHT_OFFSET);
  const own = Math.sqrt(1 - STEREO_CORRELATION ** 2);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) right[i] = STEREO_CORRELATION * (left[i] ?? 0) + own * (other[i] ?? 0);
  for (const channel of [left, right]) {
    removeDc(channel);
    if (level === 'rms') normaliseRms(channel, NOISE_RMS);
    else normalisePeak(channel, TEXTURE_PEAK);
  }
  return [left, right];
}

/**
 * Generate `length` samples plus a crossfade tail, then fold the tail over the head with an
 * equal-power fade: the first sample continues the last one, so the loop wraps without a click.
 */
export function seamlessLoop(length: number, rate: number, generate: Generator, seed: number): Float32Array {
  const fade = Math.min(Math.round(LOOP_CROSSFADE_S * rate), Math.floor(length / 2));
  const raw = new Float32Array(length + fade);
  generate(raw, rate, seed);
  const out = raw.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const angle = ((i / fade) * Math.PI) / 2;
    out[i] = (raw[length + i] ?? 0) * Math.cos(angle) + (raw[i] ?? 0) * Math.sin(angle);
  }
  return out;
}

export function fillWhite(data: Float32Array, _rate: number, seed: number): void {
  const random = seededRandom(seed);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
}

export function fillPink(data: Float32Array, _rate: number, seed: number): void {
  const random = seededRandom(seed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    b0 = PINK_POLES[0] * b0 + white * PINK_WEIGHTS[0];
    b1 = PINK_POLES[1] * b1 + white * PINK_WEIGHTS[1];
    b2 = PINK_POLES[2] * b2 + white * PINK_WEIGHTS[2];
    data[i] = b0 + b1 + b2 + white * PINK_DIRECT;
  }
}

export function fillBrown(data: Float32Array, _rate: number, seed: number): void {
  const random = seededRandom(seed);
  let level = 0;
  for (let i = 0; i < data.length; i++) {
    level = (level + (random() * 2 - 1) * BROWN_LEAK) / (1 + BROWN_LEAK);
    data[i] = level;
  }
}

/**
 * Scatter soft drops at {@link DROPS_PER_S}: each a parabolic pulse of white noise through a wide
 * band-pass at a random centre, so drops differ in colour without ringing at a pitch.
 */
export function fillDrops(data: Float32Array, rate: number, seed: number): void {
  const random = seededRandom(seed);
  const count = Math.round((data.length / rate) * DROPS_PER_S);
  for (let n = 0; n < count; n++) {
    const start = Math.floor(random() * data.length);
    const pulse = Math.max(1, Math.round((DROP_MIN_S + (DROP_MAX_S - DROP_MIN_S) * random()) * rate));
    const level = DROP_MIN_LEVEL + (1 - DROP_MIN_LEVEL) * random() ** 2;
    const band = bandpass(DROP_LOW_HZ * (DROP_HIGH_HZ / DROP_LOW_HZ) ** random(), DROP_Q, rate);
    const length = pulse * (1 + DROP_RING_LENGTHS);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let k = 0; k < length; k++) {
      const phase = k / pulse;
      const x = phase < 1 ? 4 * phase * (1 - phase) * (random() * 2 - 1) : 0;
      const y = band.b0 * x + band.b2 * x2 - band.a1 * y1 - band.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      const i = (start + k) % data.length;
      data[i] = (data[i] ?? 0) + level * y;
    }
  }
}

/** Dense, very short broadband ticks: the rasp of sand grains. */
export function fillGrit(data: Float32Array, rate: number, seed: number): void {
  const random = seededRandom(seed);
  const count = Math.round((data.length / rate) * GRIT_TICKS_PER_S);
  for (let n = 0; n < count; n++) {
    const start = Math.floor(random() * data.length);
    const decayS = GRIT_MIN_DECAY_S + (GRIT_MAX_DECAY_S - GRIT_MIN_DECAY_S) * random();
    const level = random();
    const length = Math.ceil(decayS * DECAY_TAIL_CONSTANTS * rate);
    for (let k = 0; k < length; k++) {
      const i = (start + k) % data.length;
      data[i] = (data[i] ?? 0) + level * Math.exp(-k / (decayS * rate)) * (random() * 2 - 1);
    }
  }
}

/** A smooth periodic random curve in -1..1: cosine-interpolated coarse and fine control points. */
export function fillSwell(data: Float32Array, seed: number): void {
  const random = seededRandom(seed);
  const coarse = Array.from({ length: SWELL_COARSE_POINTS }, () => random() * 2 - 1);
  const fine = Array.from({ length: SWELL_FINE_POINTS }, () => random() * 2 - 1);
  for (let i = 0; i < data.length; i++) {
    const at = i / data.length;
    data[i] = periodicCurve(coarse, at) + SWELL_FINE_SHARE * periodicCurve(fine, at);
  }
  normalisePeak(data, 1);
}

function periodicCurve(points: readonly number[], at: number): number {
  const x = at * points.length;
  const index = Math.floor(x);
  const blend = (1 - Math.cos((x - index) * Math.PI)) / 2;
  const a = points[index % points.length] ?? 0;
  const b = points[(index + 1) % points.length] ?? 0;
  return a + (b - a) * blend;
}

/** Normalised coefficients of a constant-peak band-pass (b1 is zero). */
interface Bandpass {
  readonly b0: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

function bandpass(hz: number, q: number, rate: number): Bandpass {
  const w = (2 * Math.PI * hz) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0 };
}

function removeDc(data: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] ?? 0;
  const mean = sum / Math.max(1, data.length);
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) - mean;
}

function normaliseRms(data: Float32Array, rms: number): void {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += (data[i] ?? 0) ** 2;
  const current = Math.sqrt(sum / Math.max(1, data.length));
  if (current > 0) scale(data, rms / current);
}

function normalisePeak(data: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i] ?? 0));
  if (max > 0) scale(data, peak / max);
}

function scale(data: Float32Array, by: number): void {
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) * by;
}
