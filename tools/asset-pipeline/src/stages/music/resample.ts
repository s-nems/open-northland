/**
 * Exact 2:1 decimation for publishing renders at the segments' authored 22050 Hz port rate: a
 * windowed-sinc halfband lowpass, then every second sample.
 */

const TAPS = 63;
const CUTOFF = 0.25;

function halfbandTaps(): Float64Array {
  const taps = new Float64Array(TAPS);
  const center = (TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < TAPS; i++) {
    const t = i - center;
    const sinc = t === 0 ? 2 * CUTOFF : Math.sin(2 * Math.PI * CUTOFF * t) / (Math.PI * t);
    const blackman =
      0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (TAPS - 1));
    taps[i] = sinc * blackman;
    sum += taps[i] ?? 0;
  }
  for (let i = 0; i < TAPS; i++) taps[i] = (taps[i] ?? 0) / sum;
  return taps;
}

const HALFBAND = halfbandTaps();

/** Halve the sample rate; input outside the signal is treated as silence. */
export function decimateByTwo(channel: Float32Array): Float32Array {
  const outFrames = Math.floor(channel.length / 2);
  const out = new Float32Array(outFrames);
  const center = (TAPS - 1) / 2;
  for (let k = 0; k < outFrames; k++) {
    let acc = 0;
    const base = 2 * k - center;
    const from = Math.max(0, -base);
    const to = Math.min(TAPS, channel.length - base);
    for (let t = from; t < to; t++) {
      acc += (HALFBAND[t] ?? 0) * (channel[base + t] ?? 0);
    }
    out[k] = acc;
  }
  return out;
}
