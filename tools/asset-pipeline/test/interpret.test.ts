import { describe, expect, it } from 'vitest';
import { interpretSegment } from '../src/stages/music/interpret.js';
import { LibcxxPriorityQueue } from '../src/stages/music/priority-queue.js';
import { bandTrack, CHORD_SCALE_MODE, patternTrack, segment, tempoTrack } from './segment-fixture.js';

const INFINITE = 0xffffffff;
const OPTIONS = { sampleRate: 44100, audioChannels: 2, renderSeconds: 3 };

/** 4/4 at 120 bpm: one measure is 3072 ticks and plays for two seconds. */
const MEASURE_TICKS = 3072;
const HALF_SECOND_FRAMES = 22050;

function oneNoteSegment(): Uint8Array {
  return segment(INFINITE, MEASURE_TICKS, [
    tempoTrack([{ time: 0, bpm: 120 }]),
    patternTrack(120, 1, [
      {
        guidSeed: 1,
        playMode: CHORD_SCALE_MODE,
        variations: 0b1,
        logicalPartId: 2,
        notes: [{ gridStart: 0, variation: 1, duration: 768, musicValue: 0x3000, velocity: 100 }],
      },
    ]),
    bandTrack([
      { time: INFINITE, instruments: [{ patch: 0, pChannel: 2, pan: 63, volume: 127, file: 'test.dls' }] },
    ]),
  ]);
}

describe('interpretSegment', () => {
  it('schedules a pattern note, loops the segment, and stamps exact frames', () => {
    const { instances, events } = interpretSegment(oneNoteSegment(), OPTIONS);
    expect(instances).toEqual([
      { id: 1, dls: 'test.dls', bankLo: 0, bankHi: 0, patch: 0, vol: 1, pan: 0, transpose: 0 },
    ]);
    expect(events).toEqual([
      { e: 'on', t: 0, id: 1, note: 36, vel: 100 },
      { e: 'off', t: HALF_SECOND_FRAMES, id: 1, note: 36 },
      { e: 'on', t: 4 * HALF_SECOND_FRAMES, id: 1, note: 36, vel: 100 },
      { e: 'off', t: 5 * HALF_SECOND_FRAMES, id: 1, note: 36 },
    ]);
  });

  it('keeps GM-preset instruments silent and off the instance list', () => {
    const bytes = segment(INFINITE, MEASURE_TICKS, [
      tempoTrack([{ time: 0, bpm: 120 }]),
      patternTrack(120, 1, [
        {
          guidSeed: 1,
          playMode: CHORD_SCALE_MODE,
          variations: 0b1,
          logicalPartId: 2,
          notes: [{ gridStart: 0, variation: 1, duration: 768, musicValue: 0x3000, velocity: 100 }],
        },
      ]),
      bandTrack([{ time: 0, instruments: [{ patch: 0, pChannel: 2, pan: 63, volume: 127 }] }]),
    ]);
    const { instances, events } = interpretSegment(bytes, OPTIONS);
    expect(instances).toEqual([]);
    expect(events).toEqual([]);
  });

  it('plays authored variations sequentially across pattern repeats', () => {
    const bytes = segment(INFINITE, 2 * MEASURE_TICKS, [
      tempoTrack([{ time: 0, bpm: 120 }]),
      patternTrack(120, 1, [
        {
          guidSeed: 1,
          playMode: CHORD_SCALE_MODE,
          variations: 0b11,
          logicalPartId: 2,
          notes: [
            { gridStart: 0, variation: 0b01, duration: 768, musicValue: 0x3000, velocity: 100 },
            { gridStart: 0, variation: 0b10, duration: 768, musicValue: 0x4000, velocity: 100 },
          ],
        },
      ]),
      bandTrack([
        { time: 0, instruments: [{ patch: 0, pChannel: 2, pan: 63, volume: 127, file: 'test.dls' }] },
      ]),
    ]);
    const { events } = interpretSegment(bytes, { ...OPTIONS, renderSeconds: 5 });
    expect(events.filter((e) => e.e === 'on').map((e) => e.note)).toEqual([36, 48, 36]);
  });

  it('applies tempo changes at their authored times', () => {
    // 120 bpm for the first half measure, 60 bpm after: the note at tick 1536 starts at one
    // second and its 768-tick duration then spans a full second.
    const bytes = segment(INFINITE, MEASURE_TICKS, [
      tempoTrack([
        { time: 0, bpm: 120 },
        { time: 1536, bpm: 60 },
      ]),
      patternTrack(120, 1, [
        {
          guidSeed: 1,
          playMode: CHORD_SCALE_MODE,
          variations: 0b1,
          logicalPartId: 2,
          notes: [{ gridStart: 8, variation: 1, duration: 768, musicValue: 0x3000, velocity: 100 }],
        },
      ]),
      bandTrack([
        { time: 0, instruments: [{ patch: 0, pChannel: 2, pan: 63, volume: 127, file: 'test.dls' }] },
      ]),
    ]);
    const { events } = interpretSegment(bytes, { ...OPTIONS, renderSeconds: 4 });
    expect(events.slice(0, 2)).toEqual([
      { e: 'on', t: 2 * HALF_SECOND_FRAMES, id: 1, note: 36, vel: 100 },
      { e: 'off', t: 4 * HALF_SECOND_FRAMES, id: 1, note: 36 },
    ]);
  });

  it("carries the band transpose on the instance, leaving the performance's notes alone", () => {
    const bytes = segment(INFINITE, MEASURE_TICKS, [
      tempoTrack([{ time: 0, bpm: 120 }]),
      patternTrack(120, 1, [
        {
          guidSeed: 1,
          playMode: CHORD_SCALE_MODE,
          variations: 0b1,
          logicalPartId: 2,
          notes: [{ gridStart: 0, variation: 1, duration: 768, musicValue: 0x3000, velocity: 100 }],
        },
      ]),
      bandTrack([
        {
          time: INFINITE,
          instruments: [{ patch: 0, pChannel: 2, pan: 63, volume: 127, transpose: -12, file: 'test.dls' }],
        },
      ]),
    ]);
    const { instances, events } = interpretSegment(bytes, OPTIONS);
    expect(instances[0]).toMatchObject({ id: 1, transpose: -12 });
    expect(events[0]).toEqual({ e: 'on', t: 0, id: 1, note: 36, vel: 100 });
  });

  it('folds high percussion channels onto channel 9', () => {
    const bytes = segment(INFINITE, MEASURE_TICKS, [
      tempoTrack([{ time: 0, bpm: 120 }]),
      patternTrack(120, 1, [
        {
          guidSeed: 1,
          playMode: CHORD_SCALE_MODE,
          variations: 0b1,
          logicalPartId: 25,
          notes: [{ gridStart: 0, variation: 1, duration: 768, musicValue: 0x3000, velocity: 90 }],
        },
      ]),
      bandTrack([
        { time: 0, instruments: [{ patch: 0, pChannel: 9, pan: 63, volume: 127, file: 'test.dls' }] },
      ]),
    ]);
    const { events } = interpretSegment(bytes, OPTIONS);
    // The note routes through the fold and plays once per segment pass (the render loops once).
    expect(events.filter((e) => e.e === 'on')).toHaveLength(2);
  });
});

describe('LibcxxPriorityQueue', () => {
  it('pops equal keys in the reference heap order', () => {
    // Not insertion order: the pop order of ties comes from the exact libc++ heap algorithm the
    // corpus event parity was proven against.
    const queue = new LibcxxPriorityQueue<{ key: number; tag: string }>((a, b) => a.key > b.key);
    for (const tag of ['a', 'b', 'c', 'd']) queue.push({ key: 1, tag });
    const popped: string[] = [];
    while (queue.size > 0) {
      popped.push(queue.top()?.tag ?? '?');
      queue.pop();
    }
    expect(popped).toEqual(['a', 'b', 'd', 'c']);
  });

  it('orders differing keys as a min-heap under the greater-than comparer', () => {
    const queue = new LibcxxPriorityQueue<number>((a, b) => a > b);
    for (const v of [5, 1, 4, 2, 3]) queue.push(v);
    const popped: number[] = [];
    while (queue.size > 0) {
      popped.push(queue.top() ?? -1);
      queue.pop();
    }
    expect(popped).toEqual([1, 2, 3, 4, 5]);
  });
});
