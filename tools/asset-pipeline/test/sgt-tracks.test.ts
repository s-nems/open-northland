import { describe, expect, it } from 'vitest';
import { decodeSegmentTracks } from '../src/decoders/sgt-tracks.js';
import { chunk, u32 } from './riff-fixture.js';
import {
  bandTrack,
  chordTrack,
  patternTrack,
  rawTrack,
  segment,
  sequenceTrack,
  tempoTrack,
} from './segment-fixture.js';

const INFINITE = 0xffffffff;

describe('decodeSegmentTracks', () => {
  it('decodes the header and the tracks in file order', () => {
    const bytes = segment(INFINITE, 3072, [
      tempoTrack([{ time: 6144, bpm: 110 }]),
      patternTrack(120, 1, [
        {
          guidSeed: 1,
          playMode: 14,
          variations: 0b1,
          logicalPartId: 2,
          notes: [{ gridStart: 0, variation: 1, duration: 768, musicValue: 0x3000, velocity: 100 }],
        },
      ]),
      bandTrack([
        {
          time: INFINITE,
          instruments: [{ patch: 0x00010203, pChannel: 2, pan: 70, volume: 111, file: 'x.dls' }],
        },
      ]),
    ]);
    const decoded = decodeSegmentTracks(bytes);
    expect(decoded.repeats).toBe(INFINITE);
    expect(decoded.length).toBe(3072);
    expect(decoded.tracks.map((t) => t.kind)).toEqual(['tempo', 'pattern', 'band']);

    const [tempo, pattern, band] = decoded.tracks;
    expect(tempo).toMatchObject({ items: [{ time: 6144, bpm: 110 }] });
    if (pattern?.kind !== 'pattern' || pattern.pattern === undefined) throw new Error('no pattern');
    expect(pattern.tempo).toBe(120);
    expect(pattern.pattern.measures).toBe(1);
    expect(pattern.pattern.partRefs).toHaveLength(1);
    const part = pattern.pattern.parts.get(pattern.pattern.partRefs[0]?.partId ?? '');
    expect(part?.playMode).toBe(14);
    expect(part?.notes).toEqual([
      {
        gridStart: 0,
        variation: 1,
        duration: 768,
        timeOffset: 0,
        musicValue: 0x3000,
        velocity: 100,
        playMode: 16,
      },
    ]);
    expect(band).toMatchObject({
      changes: [
        {
          time: INFINITE,
          band: { instruments: [{ patch: 0x00010203, pChannel: 2, pan: 70, volume: 111, file: 'x.dls' }] },
        },
      ],
    });
  });

  it('decodes chord change times', () => {
    const decoded = decodeSegmentTracks(segment(1, 3072, [chordTrack([768, 1536])]));
    expect(decoded.tracks).toEqual([{ kind: 'chord', times: [768, 1536] }]);
  });

  it('drops the final sequence record on an exact fit and keeps it with slack', () => {
    const items = [
      { time: 0, duration: 100, pChannel: 1, status: 0x90, byte1: 60, byte2: 90 },
      { time: 200, duration: 100, pChannel: 1, status: 0x90, byte1: 62, byte2: 90 },
    ];
    const exact = decodeSegmentTracks(segment(1, 3072, [sequenceTrack(items)]));
    expect(exact.tracks[0]).toMatchObject({ kind: 'sequence', items: [{ byte1: 60 }] });
    const slack = decodeSegmentTracks(segment(1, 3072, [sequenceTrack(items, true)]));
    if (slack.tracks[0]?.kind !== 'sequence') throw new Error('no sequence');
    expect(slack.tracks[0].items.map((i) => i.byte1)).toEqual([60, 62]);
  });

  it('throws on track types the interpreter does not support', () => {
    const cmnd = rawTrack('cmnd', '', chunk('cmnd', [...u32(8), ...new Array<number>(8).fill(0)]));
    expect(() => decodeSegmentTracks(segment(1, 3072, [cmnd]))).toThrow(/unsupported track type cmnd/);
  });
});
