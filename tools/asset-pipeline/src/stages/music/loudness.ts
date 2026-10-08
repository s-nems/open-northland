/**
 * Integrated loudness after ITU-R BS.1770-4: K-weighting, 400 ms blocks on a 100 ms hop, an absolute
 * gate at -70 LKFS and a relative gate 10 LU under the absolute-gated level. Left and right weigh 1.0.
 * The K-weighting biquads are derived for any rate from the analog prototype the standard tabulates
 * at 48 kHz; the tests pin them to that table.
 */

/** Biquad coefficients normalised to `a0 = 1`. */
export interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** Stage 1 shelf (the head's acoustic effect): centre, gain and Q of the standard's prefilter. */
const SHELF_HZ = 1681.974450955533;
const SHELF_GAIN_DB = 3.999843853973347;
const SHELF_Q = 0.7071752369554196;
/** The shelf's band-gain exponent: the share of the shelf gain at the band edge. */
const SHELF_BAND_EXPONENT = 0.4996667741545416;
/** Stage 2 high-pass (the RLB curve). */
const HIGHPASS_HZ = 38.13547087602444;
const HIGHPASS_Q = 0.5003270373238773;

/** The standard's offset putting a 997 Hz full-scale sine at 0 LKFS after K-weighting. */
const LOUDNESS_OFFSET = -0.691;
const BLOCK_S = 0.4;
/** Hops per block: 75 % overlap. */
const HOPS_PER_BLOCK = 4;
const ABSOLUTE_GATE_LKFS = -70;
const RELATIVE_GATE_LU = -10;

function shelf(sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * SHELF_HZ) / sampleRate);
  const vh = 10 ** (SHELF_GAIN_DB / 20);
  const vb = vh ** SHELF_BAND_EXPONENT;
  const a0 = 1 + k / SHELF_Q + k * k;
  return {
    b0: (vh + (vb * k) / SHELF_Q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / SHELF_Q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / SHELF_Q + k * k) / a0,
  };
}

function highpass(sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * HIGHPASS_HZ) / sampleRate);
  const a0 = 1 + k / HIGHPASS_Q + k * k;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / HIGHPASS_Q + k * k) / a0 };
}

/** The two K-weighting stages at `sampleRate`, in filtering order. */
export function kWeighting(sampleRate: number): readonly [Biquad, Biquad] {
  return [shelf(sampleRate), highpass(sampleRate)];
}

/** Direct form I state of one biquad on one channel. */
class BiquadState {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private readonly f: Biquad) {}
  step(x: number): number {
    const { b0, b1, b2, a1, a2 } = this.f;
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const blockLoudness = (meanSquare: number): number => LOUDNESS_OFFSET + 10 * Math.log10(meanSquare);

/**
 * Gated integrated loudness of the first `frames` frames, in LUFS; `-Infinity` when no block clears
 * the absolute gate (silence, or audio shorter than one block).
 */
export function integratedLoudness(
  channels: readonly Float32Array[],
  frames: number,
  sampleRate: number,
): number {
  const hop = Math.round((BLOCK_S * sampleRate) / HOPS_PER_BLOCK);
  const hops = Math.floor(frames / hop);
  // Per-hop sum of K-weighted squares over every channel; a block is the sum of four hops.
  const hopEnergy = new Float64Array(hops);
  for (const channel of channels) {
    const [first, second] = kWeighting(sampleRate).map((f) => new BiquadState(f)) as [
      BiquadState,
      BiquadState,
    ];
    for (let h = 0; h < hops; h++) {
      let sum = 0;
      for (let i = h * hop, end = i + hop; i < end; i++) {
        const y = second.step(first.step(channel[i] ?? 0));
        sum += y * y;
      }
      hopEnergy[h] = (hopEnergy[h] ?? 0) + sum;
    }
  }
  const blockFrames = hop * HOPS_PER_BLOCK;
  const blocks: number[] = [];
  for (let h = 0; h + HOPS_PER_BLOCK <= hops; h++) {
    let sum = 0;
    for (let j = 0; j < HOPS_PER_BLOCK; j++) sum += hopEnergy[h + j] ?? 0;
    blocks.push(sum / blockFrames);
  }
  const mean = (values: readonly number[]): number =>
    values.reduce((total, value) => total + value, 0) / values.length;
  const audible = blocks.filter((z) => blockLoudness(z) > ABSOLUTE_GATE_LKFS);
  if (audible.length === 0) return Number.NEGATIVE_INFINITY;
  const relativeGate = blockLoudness(mean(audible)) + RELATIVE_GATE_LU;
  const gated = audible.filter((z) => blockLoudness(z) > relativeGate);
  return blockLoudness(mean(gated));
}

/** Highest absolute sample over every channel's first `frames` frames, in dBFS. Sample peak, not true
 *  peak: inter-sample overs of up to a few tenths of a dB go unseen. */
export function samplePeakDb(channels: readonly Float32Array[], frames: number): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
  }
  return 20 * Math.log10(peak);
}

/** Integrated loudness every track is levelled toward. Approximation: the middle of the rendered set's
 *  measured spread (-14.9 to -28.7 LUFS), so the set moves about as far down as up. */
export const MUSIC_LOUDNESS_TARGET_LUFS = -20;

/**
 * Highest sample peak a boost may raise a track to, in dBFS. The music bus plays a file 2 dB under its
 * own level at a full slider (the original's -5 dB music offset less the stage's 3 dB headroom), so a
 * peak here meets the master limiter's -3 dB threshold at a full master and music alone never drives
 * the limiter. Approximation.
 */
export const MUSIC_BOOST_PEAK_CEILING_DBFS = -1;

/**
 * Decibels that take a track toward {@link MUSIC_LOUDNESS_TARGET_LUFS}. A cut is never limited; a boost
 * stops where the peak reaches {@link MUSIC_BOOST_PEAK_CEILING_DBFS}, so a quiet track with loud peaks
 * stays a little under the target. An unmeasurable track keeps its level.
 */
export function levellingGainDb(loudnessLufs: number, peakDb: number): number {
  if (!Number.isFinite(loudnessLufs)) return 0;
  const toTarget = MUSIC_LOUDNESS_TARGET_LUFS - loudnessLufs;
  if (toTarget <= 0) return toTarget;
  return Math.min(toTarget, Math.max(0, MUSIC_BOOST_PEAK_CEILING_DBFS - peakDb));
}
