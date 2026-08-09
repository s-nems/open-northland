/** Synthetic DirectMusic segment builders on top of the RIFF byte helpers. */
import { chunk, f64, list, riffChunk, u16, u32, utf16z } from './riff-fixture.js';

function fourCcBytes(s: string): number[] {
  const bytes = [0, 0, 0, 0];
  for (let i = 0; i < Math.min(4, s.length); i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function guidBytes(seed: number): number[] {
  return Array.from({ length: 16 }, (_, i) => (seed + i) & 0xff);
}

export function timeSig(beatsPerMeasure = 4, beat = 4, gridsPerBeat = 4): number[] {
  return [beatsPerMeasure, beat, ...u16(gridsPerBeat)];
}

export function rawTrack(ckid: string, fccType: string, data: readonly number[]): number[] {
  const header = chunk('trkh', [
    ...guidBytes(0),
    ...u32(0),
    ...u32(0),
    ...fourCcBytes(ckid),
    ...fourCcBytes(fccType),
  ]);
  return riffChunk('DMTK', [...header, ...data]);
}
const track = rawTrack;

export function tempoTrack(items: readonly { time: number; bpm: number }[]): number[] {
  const TEMPO_RECORD_BYTES = 16;
  const records = items.flatMap((i) => [...u32(i.time), ...u32(0), ...f64(i.bpm)]);
  return track('tetr', '', chunk('tetr', [...u32(TEMPO_RECORD_BYTES), ...records]));
}

export interface FixtureNote {
  readonly gridStart: number;
  readonly variation: number;
  readonly duration: number;
  readonly timeOffset?: number;
  readonly musicValue: number;
  readonly velocity: number;
  readonly playMode?: number;
}

const NOTE_RECORD_BYTES = 23;

function noteRecord(n: FixtureNote): number[] {
  return [
    ...u32(n.gridStart),
    ...u32(n.variation),
    ...u32(n.duration),
    ...u16((n.timeOffset ?? 0) & 0xffff),
    ...u16(n.musicValue),
    n.velocity,
    0,
    0,
    0,
    0,
    n.playMode ?? 16,
    0,
  ];
}

export interface FixtureCurve {
  readonly gridStart: number;
  readonly variation: number;
  readonly duration: number;
  readonly timeOffset?: number;
  readonly startValue: number;
  readonly endValue: number;
  readonly eventType: number;
  readonly shape: number;
  readonly ccData?: number;
}

const CURVE_RECORD_BYTES = 32;

function curveRecord(c: FixtureCurve): number[] {
  return [
    ...u32(c.gridStart),
    ...u32(c.variation),
    ...u32(c.duration),
    ...u32(0),
    ...u16((c.timeOffset ?? 0) & 0xffff),
    ...u16(c.startValue),
    ...u16(c.endValue),
    ...u16(0),
    c.eventType,
    c.shape,
    c.ccData ?? 0,
    0,
    ...u16(0),
    ...u16(0),
  ];
}

export interface FixturePart {
  readonly guidSeed: number;
  readonly playMode: number;
  /** Bitmask of authored variation slots (slot i nonzero when bit i is set). */
  readonly variations: number;
  readonly notes?: readonly FixtureNote[];
  readonly curves?: readonly FixtureCurve[];
  readonly logicalPartId: number;
}

const VARIATION_SLOTS = 32;

function partList(part: FixturePart): number[] {
  const choices = Array.from({ length: VARIATION_SLOTS }, (_, i) => ((part.variations >>> i) & 1 ? 1 : 0));
  const header = chunk('prth', [
    ...timeSig(),
    ...choices.flatMap((c) => u32(c)),
    ...guidBytes(part.guidSeed),
    ...u16(1),
    part.playMode,
    0,
    0,
    0,
    0,
    0,
    ...u16(0),
  ]);
  const notes = part.notes?.length
    ? chunk('note', [...u32(NOTE_RECORD_BYTES), ...part.notes.flatMap(noteRecord)])
    : [];
  const curves = part.curves?.length
    ? chunk('crve', [...u32(CURVE_RECORD_BYTES), ...part.curves.flatMap(curveRecord)])
    : [];
  return list('part', [...header, ...notes, ...curves]);
}

function partRef(part: FixturePart): number[] {
  return list(
    'pref',
    chunk('prfc', [
      ...guidBytes(part.guidSeed),
      ...u16(part.logicalPartId),
      0,
      0,
      0,
      0,
      ...u16(0),
      ...u32(0),
    ]),
  );
}

export function patternTrack(bpm: number, measures: number, parts: readonly FixturePart[]): number[] {
  const ptnh = chunk('ptnh', [...timeSig(), 0, 0, ...u16(0), ...u16(measures), 0, 0, ...u32(0)]);
  return track(
    '',
    'DMPT',
    riffChunk('DMPT', [
      ...chunk('styh', [...timeSig(), ...f64(bpm)]),
      ...list('pttn', [...ptnh, ...parts.flatMap(partRef), ...parts.flatMap(partList)]),
    ]),
  );
}

export interface FixtureInstrument {
  readonly patch: number;
  readonly pChannel: number;
  readonly pan: number;
  readonly volume: number;
  readonly file?: string;
}

function bandInstrument(inst: FixtureInstrument): number[] {
  const bins = chunk('bins', [
    ...u32(inst.patch),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(inst.pChannel),
    ...u32(0),
    inst.pan,
    inst.volume,
    ...u16(0),
    ...u32(0),
    ...u16(0),
  ]);
  const ref =
    inst.file === undefined
      ? []
      : list('DMRF', [
          ...chunk('refh', [...guidBytes(0x40), ...u32(0)]),
          ...chunk('file', utf16z(inst.file)),
        ]);
  return list('lbin', [...bins, ...ref]);
}

export function bandTrack(
  changes: readonly { time: number; instruments: readonly FixtureInstrument[] }[],
): number[] {
  const items = changes.map((change) =>
    list('lbnd', [
      ...chunk('bd2h', [...u32(change.time), ...u32(change.time)]),
      ...riffChunk('DMBD', list('lbil', change.instruments.flatMap(bandInstrument))),
    ]),
  );
  return track('', 'DMBT', riffChunk('DMBT', list('lbdl', items.flat())));
}

export interface FixtureSequenceItem {
  readonly time: number;
  readonly duration: number;
  readonly pChannel: number;
  readonly offset?: number;
  readonly status: number;
  readonly byte1: number;
  readonly byte2: number;
}

const SEQ_RECORD_BYTES = 17;

/** `slack` appends a trailing byte so the strict-< reader keeps the final record. */
export function sequenceTrack(items: readonly FixtureSequenceItem[], slack = false): number[] {
  const records = items.flatMap((i) => [
    ...u32(i.time),
    ...u32(i.duration),
    ...u32(i.pChannel),
    ...u16((i.offset ?? 0) & 0xffff),
    i.status,
    i.byte1,
    i.byte2,
  ]);
  return track(
    'seqt',
    '',
    chunk('seqt', chunk('evtl', [...u32(SEQ_RECORD_BYTES), ...records, ...(slack ? [0] : [])])),
  );
}

export function chordTrack(times: readonly number[]): number[] {
  const CHORD_STRUCT_BYTES = 40;
  const bodies = times.flatMap((time) =>
    chunk('crdb', [
      ...u32(CHORD_STRUCT_BYTES),
      ...new Array<number>(32).fill(0),
      ...u32(time),
      ...u16(0),
      0,
      0,
      ...u32(1),
      ...u32(18),
      ...new Array<number>(18).fill(0),
    ]),
  );
  return track('', 'cord', list('cord', [...chunk('crdh', u32(0)), ...bodies]));
}

export function segment(repeats: number, length: number, tracks: readonly number[][]): Uint8Array {
  const segh = chunk('segh', [...u32(repeats), ...u32(length), ...u32(0), ...u32(0), ...u32(0)]);
  return new Uint8Array(riffChunk('DMSG', [...segh, ...list('trkl', tracks.flat())]));
}
