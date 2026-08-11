/**
 * Approximation: Freeverb-topology reverb standing in for the DirectSound Waves Reverb DMO that
 * the segments' embedded audiopath routes all channels through. Mix and decay time come from the
 * authored `DSFXWavesReverb` params; the fixed input gain calibrates the comb bank so the wet
 * level of sustained material lands near the authored mix.
 */

import type { SegmentReverb } from '../../decoders/sgt.js';

/** Freeverb comb/allpass tunings, in samples at the rate they were designed for. */
const TUNING_RATE = 44100;
const COMB_DELAYS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617] as const;
const ALLPASS_DELAYS = [556, 441, 341, 225] as const;
/** Right-channel delay offset decorrelating the two tails. */
const STEREO_SPREAD = 23;
const ALLPASS_FEEDBACK = 0.5;
/**
 * Comb feedback lowpass. Approximation: no segment authors `fHighFreqRTRatio`, so this stands in for
 * the DMO default of 0.001, which would decay high frequencies far faster than the value chosen here.
 * The resulting wet path is not flat: measured octave gains span about 5 dB, and above 2 kHz the tail
 * is gone within ~150 ms while below 200 Hz it runs the authored RT60. The coefficient is the one
 * tuning here that does not scale with `sampleRate`, so it only holds at the stage's publish rate.
 */
const DAMPING = 0.95;
/** Comb-bank input level putting sustained wet output near the dry level at 0 dB mix. */
const INPUT_GAIN = 0.07;
const RT60_DECAY_DB = 60;

/** Mix the wet reverb into every channel in place. */
export function applyWavesReverb(
  channels: readonly Float32Array[],
  sampleRate: number,
  params: SegmentReverb,
): void {
  const frames = channels[0]?.length ?? 0;
  if (frames === 0 || channels.length === 0) return;
  // One non-finite authored float would otherwise spread NaN across every sample of the track.
  if (!Number.isFinite(params.reverbTimeMs + params.inGainDb + params.reverbMixDb)) return;
  const rt60S = Math.max(params.reverbTimeMs, 1) / 1000;
  const inputGain = INPUT_GAIN * 10 ** (params.inGainDb / 20);
  const wetGain = 10 ** (params.reverbMixDb / 20);
  const scale = sampleRate / TUNING_RATE;

  const mono = new Float32Array(frames);
  for (const channel of channels) {
    for (let i = 0; i < frames; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0);
  }
  const monoNorm = inputGain / channels.length;
  for (let i = 0; i < frames; i++) mono[i] = (mono[i] ?? 0) * monoNorm;

  for (const [c, channel] of channels.entries()) {
    const spread = c === 0 ? 0 : STEREO_SPREAD;
    const combs = COMB_DELAYS.map((d) => {
      const delay = Math.max(1, Math.round((d + spread) * scale));
      // Feedback giving a 60 dB decay over rt60 across this comb's recirculation period.
      const feedback = 10 ** ((-(RT60_DECAY_DB / 20) * (delay / sampleRate)) / rt60S);
      return { buf: new Float32Array(delay), idx: 0, filt: 0, feedback };
    });
    const allpasses = ALLPASS_DELAYS.map((d) => ({
      buf: new Float32Array(Math.max(1, Math.round((d + spread) * scale))),
      idx: 0,
    }));

    for (let i = 0; i < frames; i++) {
      const input = mono[i] ?? 0;
      let wet = 0;
      for (const comb of combs) {
        const out = comb.buf[comb.idx] ?? 0;
        comb.filt = out * (1 - DAMPING) + comb.filt * DAMPING;
        comb.buf[comb.idx] = input + comb.filt * comb.feedback;
        comb.idx = comb.idx + 1 === comb.buf.length ? 0 : comb.idx + 1;
        wet += out;
      }
      for (const allpass of allpasses) {
        const buffered = allpass.buf[allpass.idx] ?? 0;
        allpass.buf[allpass.idx] = wet + buffered * ALLPASS_FEEDBACK;
        allpass.idx = allpass.idx + 1 === allpass.buf.length ? 0 : allpass.idx + 1;
        wet = buffered - wet;
      }
      channel[i] = (channel[i] ?? 0) + wet * wetGain;
    }
  }
}
