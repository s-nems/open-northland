import { describe, expect, it } from 'vitest';
import {
  DMUS_PPQ,
  decodeSegmentAudiopath,
  decodeSegmentTiming,
  musicTimeToSeconds,
} from '../src/decoders/sgt.js';

/**
 * Synthetic-fixture coverage for the segment timing decoder: fixtures are authored here (never game
 * bytes) as minimal RIFF DMSG trees - a segh header, an optional trkl-nested tetr tempo track,
 * truncation, and the piecewise tempo integration.
 */

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function f64(v: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, v, true);
  return [...new Uint8Array(buf)];
}

function chunk(id: string, body: readonly number[]): number[] {
  const padded = body.length & 1 ? [...body, 0] : [...body];
  return [...ascii(id), ...u32(body.length), ...padded];
}

function list(listId: string, body: readonly number[]): number[] {
  return chunk('LIST', [...ascii(listId), ...body]);
}

function riff(formId: string, body: readonly number[]): Uint8Array {
  return new Uint8Array(chunk('RIFF', [...ascii(formId), ...body]));
}

const INFINITE = 0xffffffff;

function seghChunk(opts: { repeats?: number; length: number; loopStart: number }): number[] {
  return chunk('segh', [
    ...u32(opts.repeats ?? INFINITE),
    ...u32(opts.length),
    ...u32(0), // mtPlayStart
    ...u32(opts.loopStart),
    ...u32(opts.length), // mtLoopEnd
    ...u32(0), // dwResolution
  ]);
}

/** A tetr chunk: item size prefix, then {lTime @0, dblTempo @8} items (4 padding bytes between). */
function tetrChunk(items: readonly { time: number; bpm: number }[]): number[] {
  const ITEM_SIZE = 16;
  return chunk('tetr', [
    ...u32(ITEM_SIZE),
    ...items.flatMap((i) => [...u32(i.time), ...u32(0), ...f64(i.bpm)]),
  ]);
}

describe('decodeSegmentTiming', () => {
  it('reads the header and a nested tempo track', () => {
    const bytes = riff('DMSG', [
      ...seghChunk({ length: 92160, loopStart: 6144 }),
      ...list('trkl', list('DMTK', tetrChunk([{ time: 0, bpm: 110 }]))),
    ]);
    expect(decodeSegmentTiming(bytes)).toEqual({
      repeats: INFINITE,
      lengthTicks: 92160,
      loopStartTicks: 6144,
      tempos: [{ time: 0, bpm: 110 }],
    });
  });

  it('sorts tempo items by time', () => {
    const bytes = riff('DMSG', [
      ...seghChunk({ length: 1000, loopStart: 0 }),
      ...tetrChunk([
        { time: 500, bpm: 60 },
        { time: 0, bpm: 120 },
      ]),
    ]);
    expect(decodeSegmentTiming(bytes)?.tempos).toEqual([
      { time: 0, bpm: 120 },
      { time: 500, bpm: 60 },
    ]);
  });

  it('returns undefined for a missing or truncated segh', () => {
    expect(decodeSegmentTiming(riff('DMSG', chunk('guid', u32(1))))).toBeUndefined();
    expect(decodeSegmentTiming(riff('DMSG', chunk('segh', u32(1))))).toBeUndefined();
    expect(decodeSegmentTiming(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

function f32(v: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v, true);
  return [...new Uint8Array(buf)];
}

const WAVES_REVERB_CLSID = [
  0x68, 0x02, 0xfc, 0x87, 0x55, 0x9a, 0x60, 0x43, 0x95, 0xaa, 0x00, 0x4a, 0x1d, 0x9d, 0xe2, 0x6c,
];
const PORTPARAMS_SAMPLERATE_FLAG = 0x08;

/** A pprh chunk: `DMUS_PORTPARAMS8` with only the sample-rate field marked valid. */
function pprhChunk(sampleRate: number, validParams = PORTPARAMS_SAMPLERATE_FLAG): number[] {
  return chunk('pprh', [
    ...u32(36),
    ...u32(validParams),
    ...u32(0), // dwVoices
    ...u32(0), // dwChannelGroups
    ...u32(0), // dwAudioChannels
    ...u32(sampleRate),
    ...u32(0), // dwEffectFlags
    ...u32(0), // fShare
    ...u32(0), // dwFeatures
  ]);
}

function dsfxForm(clsid: readonly number[], params: readonly number[]): number[] {
  return chunk('RIFF', [
    ...ascii('DSFX'),
    ...chunk('fxhr', [...u32(0), ...clsid, ...u32(0), ...u32(0)]),
    ...chunk('data', [...params]),
  ]);
}

describe('decodeSegmentAudiopath', () => {
  const reverbParams = [...f32(0), ...f32(-4.8), ...f32(2000), ...f32(0.001)];

  it('reads the port rate and the Waves Reverb params', () => {
    const bytes = riff('DMSG', [...pprhChunk(22050), ...dsfxForm(WAVES_REVERB_CLSID, reverbParams)]);
    const audiopath = decodeSegmentAudiopath(bytes);
    expect(audiopath?.sampleRate).toBe(22050);
    expect(audiopath?.reverb?.inGainDb).toBe(0);
    expect(audiopath?.reverb?.reverbMixDb).toBeCloseTo(-4.8, 4);
    expect(audiopath?.reverb?.reverbTimeMs).toBeCloseTo(2000, 4);
  });

  it('ignores an unmarked port rate and a foreign effect class', () => {
    const otherClsid = [...WAVES_REVERB_CLSID.slice(0, 15), 0x00];
    const bytes = riff('DMSG', [...pprhChunk(22050, 0), ...dsfxForm(otherClsid, reverbParams)]);
    expect(decodeSegmentAudiopath(bytes)).toBeUndefined();
  });

  it('returns undefined for a segment without an audiopath', () => {
    expect(decodeSegmentAudiopath(riff('DMSG', chunk('guid', u32(1))))).toBeUndefined();
  });
});

describe('musicTimeToSeconds', () => {
  it('converts at a constant tempo (768 ticks per quarter)', () => {
    // 8 quarters at 120 bpm = 4 seconds.
    expect(musicTimeToSeconds(8 * DMUS_PPQ, [{ time: 0, bpm: 120 }])).toBeCloseTo(4, 6);
  });

  it('integrates across a tempo change', () => {
    // 4 quarters at 120 (2s) then 4 quarters at 60 (4s).
    const tempos = [
      { time: 0, bpm: 120 },
      { time: 4 * DMUS_PPQ, bpm: 60 },
    ];
    expect(musicTimeToSeconds(8 * DMUS_PPQ, tempos)).toBeCloseTo(6, 6);
  });

  it('falls back to 120 bpm with no tempo track', () => {
    expect(musicTimeToSeconds(4 * DMUS_PPQ, [])).toBeCloseTo(2, 6);
  });
});
