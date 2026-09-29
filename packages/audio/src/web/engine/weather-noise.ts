import { seededRandom } from '../../data/weather/thunder.js';

/**
 * Procedural source buffers for the weather soundscape. Nothing is sampled: every sound is shaped
 * noise, generated once per context from fixed seeds, so the game ships no weather audio files.
 */

/** Noise loop lengths. Different, non-multiple lengths keep the layers from repeating in step. */
export const WHITE_NOISE_S = 3.1;
export const PINK_NOISE_S = 3.7;
export const BROWN_NOISE_S = 4.3;
/** Droplet texture lengths and densities: a light patter and a heavy one. Approximation. */
export const PATTER_SPARSE_S = 5.3;
export const PATTER_SPARSE_DROPS_PER_S = 14;
export const PATTER_DENSE_S = 4.7;
export const PATTER_DENSE_DROPS_PER_S = 70;
/** Sand grit: a hail of tiny broadband ticks. Approximation. */
export const GRIT_S = 2.9;
export const GRIT_TICKS_PER_S = 900;

/** Every noise buffer is normalised to this RMS so layer gains compare directly. */
const NOISE_RMS = 0.25;
/** Texture buffers are normalised to this peak; their RMS then follows their density. */
const TEXTURE_PEAK = 0.9;

/** A droplet rings as a decaying tone in this band, over this decay time constant. Approximation. */
const DROP_LOW_HZ = 1400;
const DROP_HIGH_HZ = 5200;
const DROP_MIN_DECAY_S = 0.002;
const DROP_MAX_DECAY_S = 0.012;
/** Share of each droplet that is a noisy click rather than a tone. */
const DROP_CLICK_SHARE = 0.35;
/** Softest droplet relative to the loudest. */
const DROP_MIN_LEVEL = 0.15;
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
const SEED_PATTER_SPARSE = 4;
const SEED_PATTER_DENSE = 5;
const SEED_GRIT = 6;

export interface WeatherBuffers {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly patterSparse: AudioBuffer;
  readonly patterDense: AudioBuffer;
  readonly grit: AudioBuffer;
}

export function createWeatherBuffers(ctx: BaseAudioContext): WeatherBuffers {
  const rate = ctx.sampleRate;
  const make = (seconds: number, fill: (data: Float32Array, rate: number) => void): AudioBuffer => {
    const buffer = ctx.createBuffer(1, Math.round(seconds * rate), rate);
    fill(buffer.getChannelData(0), rate);
    return buffer;
  };
  return {
    white: make(WHITE_NOISE_S, (d) => fillWhite(d, SEED_WHITE)),
    pink: make(PINK_NOISE_S, (d) => fillPink(d, SEED_PINK)),
    brown: make(BROWN_NOISE_S, (d) => fillBrown(d, SEED_BROWN)),
    patterSparse: make(PATTER_SPARSE_S, (d, r) =>
      fillPatter(d, r, PATTER_SPARSE_DROPS_PER_S, SEED_PATTER_SPARSE),
    ),
    patterDense: make(PATTER_DENSE_S, (d, r) =>
      fillPatter(d, r, PATTER_DENSE_DROPS_PER_S, SEED_PATTER_DENSE),
    ),
    grit: make(GRIT_S, (d, r) => fillGrit(d, r, SEED_GRIT)),
  };
}

export function fillWhite(data: Float32Array, seed: number): void {
  const random = seededRandom(seed);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  normaliseRms(data, NOISE_RMS);
}

export function fillPink(data: Float32Array, seed: number): void {
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
  removeDc(data);
  normaliseRms(data, NOISE_RMS);
}

export function fillBrown(data: Float32Array, seed: number): void {
  const random = seededRandom(seed);
  let level = 0;
  for (let i = 0; i < data.length; i++) {
    level = (level + (random() * 2 - 1) * BROWN_LEAK) / (1 + BROWN_LEAK);
    data[i] = level;
  }
  removeDc(data);
  normaliseRms(data, NOISE_RMS);
}

/** Scatter decaying droplet pings at `perSecond` on average, wrapping round the loop seam. */
export function fillPatter(data: Float32Array, rate: number, perSecond: number, seed: number): void {
  const random = seededRandom(seed);
  const count = Math.round((data.length / rate) * perSecond);
  for (let n = 0; n < count; n++) {
    const start = Math.floor(random() * data.length);
    const hz = DROP_LOW_HZ * (DROP_HIGH_HZ / DROP_LOW_HZ) ** random();
    const decayS = DROP_MIN_DECAY_S + (DROP_MAX_DECAY_S - DROP_MIN_DECAY_S) * random();
    const level = DROP_MIN_LEVEL + (1 - DROP_MIN_LEVEL) * random() ** 2;
    const length = Math.ceil(decayS * DECAY_TAIL_CONSTANTS * rate);
    const step = (2 * Math.PI * hz) / rate;
    for (let k = 0; k < length; k++) {
      const envelope = level * Math.exp(-k / (decayS * rate));
      const tone = Math.sin(step * k);
      const click = random() * 2 - 1;
      const i = (start + k) % data.length;
      data[i] = (data[i] ?? 0) + envelope * (tone * (1 - DROP_CLICK_SHARE) + click * DROP_CLICK_SHARE);
    }
  }
  normalisePeak(data, TEXTURE_PEAK);
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
  normalisePeak(data, TEXTURE_PEAK);
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
