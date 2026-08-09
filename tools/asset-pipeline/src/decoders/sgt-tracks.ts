/**
 * Segment track-list decoder for the music performance interpreter: tempo, DX8 pattern, band,
 * chord, and sequence tracks in file order. Layouts follow the published DirectX structures
 * (`DMUS_IO_TRACK_HEADER`, `DMUS_IO_TEMPO_ITEM`, `DMUS_IO_STYLE*`, `DMUS_IO_INSTRUMENT`,
 * `DMUS_IO_SEQ_ITEM`); all are byte-packed in the files.
 */
import { viewOf } from './byte-cursor.js';
import { fourCc, type RiffChild, riffChildren } from './riff.js';

export interface DmTimeSignature {
  readonly beatsPerMeasure: number;
  readonly beat: number;
  readonly gridsPerBeat: number;
}

export interface DmTempoItem {
  readonly time: number;
  readonly bpm: number;
}

export interface DmStyleNote {
  readonly gridStart: number;
  readonly variation: number;
  readonly duration: number;
  readonly timeOffset: number;
  readonly musicValue: number;
  readonly velocity: number;
  readonly playMode: number;
}

export interface DmStyleCurve {
  readonly gridStart: number;
  readonly variation: number;
  readonly duration: number;
  readonly timeOffset: number;
  readonly startValue: number;
  readonly endValue: number;
  readonly eventType: number;
  readonly shape: number;
  readonly ccData: number;
}

export interface DmStylePart {
  readonly timeSig: DmTimeSignature;
  readonly variationChoices: readonly number[];
  readonly playMode: number;
  readonly notes: readonly DmStyleNote[];
  readonly curves: readonly DmStyleCurve[];
}

export interface DmPartRef {
  readonly partId: string;
  readonly logicalPartId: number;
}

export interface DmPattern {
  readonly timeSig: DmTimeSignature;
  readonly measures: number;
  readonly partRefs: readonly DmPartRef[];
  readonly parts: ReadonlyMap<string, DmStylePart>;
  readonly band?: DmBand;
}

export interface DmBandInstrument {
  /** `dwPatch`: bank MSB, bank LSB, and program packed into the low three bytes. */
  readonly patch: number;
  readonly pChannel: number;
  readonly pan: number;
  readonly volume: number;
  /** DLS collection file the `DMRF` reference names; absent for GM-preset instruments. */
  readonly file?: string;
}

export interface DmBand {
  readonly instruments: readonly DmBandInstrument[];
}

export interface DmBandChange {
  /** `lBandTimePhysical` as authored (unsigned; the player clamps negatives to zero). */
  readonly time: number;
  readonly band: DmBand;
}

export interface DmSequenceItem {
  readonly time: number;
  readonly duration: number;
  readonly pChannel: number;
  readonly offset: number;
  readonly status: number;
  readonly byte1: number;
  readonly byte2: number;
}

export type DmTrack =
  | { readonly kind: 'tempo'; readonly items: readonly DmTempoItem[] }
  | { readonly kind: 'pattern'; readonly tempo: number; readonly pattern?: DmPattern }
  | { readonly kind: 'band'; readonly changes: readonly DmBandChange[] }
  | { readonly kind: 'chord'; readonly times: readonly number[] }
  | { readonly kind: 'sequence'; readonly items: readonly DmSequenceItem[] };

export interface DmSegment {
  /** `dwRepeats` (0xffffffff = infinite). */
  readonly repeats: number;
  /** `mtLength` in music-time ticks. */
  readonly length: number;
  readonly tracks: readonly DmTrack[];
}

const TRKH_CKID_OFFSET = 24;
const TRKH_FCCTYPE_OFFSET = 28;
const GUID_BYTES = 16;
const STYH_TEMPO_OFFSET = 4;
const PTNH_MEASURES_OFFSET = 8;
const PRFC_LOGICAL_PART_OFFSET = 16;
const PRTH_VARIATION_CHOICES_OFFSET = 4;
const VARIATION_COUNT = 32;
const PRTH_GUID_OFFSET = 132;
const PRTH_PLAYMODE_OFFSET = 150;
const NOTE_TIME_OFFSET = 12;
const NOTE_MUSIC_VALUE_OFFSET = 14;
const NOTE_VELOCITY_OFFSET = 16;
const NOTE_PLAYMODE_OFFSET = 21;
const CURVE_DURATION_OFFSET = 8;
const CURVE_TIME_OFFSET = 16;
const CURVE_START_OFFSET = 18;
const CURVE_END_OFFSET = 20;
const CURVE_EVENT_TYPE_OFFSET = 24;
const CURVE_SHAPE_OFFSET = 25;
const CURVE_CC_OFFSET = 26;
const BD2H_PHYSICAL_TIME_OFFSET = 4;
const BINS_PCHANNEL_OFFSET = 24;
const BINS_PAN_OFFSET = 32;
const BINS_VOLUME_OFFSET = 33;
const CHORD_TIME_OFFSET = 32;
const SEQ_ITEM_OFFSET_OFFSET = 12;
const SEQ_ITEM_STATUS_OFFSET = 14;
/** `DMUS_IO_TEMPO_ITEM` on disk: `lTime` at +0, four pad bytes, `dblTempo` at +8. */
const TEMPO_ITEM_BPM_OFFSET = 8;

function guidHex(bytes: Uint8Array, off: number): string {
  let out = '';
  for (let i = 0; i < GUID_BYTES; i++) out += (bytes[off + i] ?? 0).toString(16).padStart(2, '0');
  return out;
}

function timeSigAt(bytes: Uint8Array, off: number): DmTimeSignature {
  const view = viewOf(bytes);
  return {
    beatsPerMeasure: bytes[off] ?? 0,
    beat: bytes[off + 1] ?? 0,
    gridsPerBeat: view.getUint16(off + 2, true),
  };
}

/** ASCII slice of a UTF-16LE string chunk, non-ASCII code units dropped as unrepresentable. */
function utf16Ascii(bytes: Uint8Array, start: number, end: number): string {
  const view = viewOf(bytes);
  let out = '';
  for (let off = start; off + 1 < end; off += 2) {
    const unit = view.getUint16(off, true);
    if (unit === 0) break;
    if (unit < 0x80) out += String.fromCharCode(unit);
  }
  return out;
}

function decodeTempoItems(bytes: Uint8Array, chunk: RiffChild): DmTempoItem[] {
  const view = viewOf(bytes);
  const structSize = view.getUint32(chunk.bodyStart, true);
  const items: DmTempoItem[] = [];
  if (structSize < TEMPO_ITEM_BPM_OFFSET + 8) return items;
  const count = Math.floor((chunk.bodyEnd - chunk.bodyStart - 4) / structSize);
  for (let i = 0; i < count; i++) {
    const rec = chunk.bodyStart + 4 + i * structSize;
    items.push({ time: view.getUint32(rec, true), bpm: view.getFloat64(rec + TEMPO_ITEM_BPM_OFFSET, true) });
  }
  return items;
}

function decodeStylePart(bytes: Uint8Array, part: RiffChild): { id: string; part: DmStylePart } {
  const view = viewOf(bytes);
  let id = '';
  let timeSig: DmTimeSignature = { beatsPerMeasure: 0, beat: 0, gridsPerBeat: 0 };
  let playMode = 0;
  const variationChoices: number[] = [];
  const notes: DmStyleNote[] = [];
  const curves: DmStyleCurve[] = [];
  for (const c of riffChildren(bytes, part.bodyStart, part.bodyEnd)) {
    if (c.id === 'prth') {
      timeSig = timeSigAt(bytes, c.bodyStart);
      for (let i = 0; i < VARIATION_COUNT; i++) {
        variationChoices.push(view.getUint32(c.bodyStart + PRTH_VARIATION_CHOICES_OFFSET + 4 * i, true));
      }
      id = guidHex(bytes, c.bodyStart + PRTH_GUID_OFFSET);
      playMode = bytes[c.bodyStart + PRTH_PLAYMODE_OFFSET] ?? 0;
    } else if (c.id === 'note') {
      const structSize = view.getUint32(c.bodyStart, true);
      const count = structSize > 0 ? Math.floor((c.bodyEnd - c.bodyStart - 4) / structSize) : 0;
      for (let i = 0; i < count; i++) {
        const rec = c.bodyStart + 4 + i * structSize;
        notes.push({
          gridStart: view.getUint32(rec, true),
          variation: view.getUint32(rec + 4, true),
          duration: view.getUint32(rec + 8, true),
          timeOffset: view.getInt16(rec + NOTE_TIME_OFFSET, true),
          musicValue: view.getUint16(rec + NOTE_MUSIC_VALUE_OFFSET, true),
          velocity: bytes[rec + NOTE_VELOCITY_OFFSET] ?? 0,
          playMode: bytes[rec + NOTE_PLAYMODE_OFFSET] ?? 0,
        });
      }
    } else if (c.id === 'crve') {
      const structSize = view.getUint32(c.bodyStart, true);
      const count = structSize > 0 ? Math.floor((c.bodyEnd - c.bodyStart - 4) / structSize) : 0;
      for (let i = 0; i < count; i++) {
        const rec = c.bodyStart + 4 + i * structSize;
        curves.push({
          gridStart: view.getUint32(rec, true),
          variation: view.getUint32(rec + 4, true),
          duration: view.getUint32(rec + CURVE_DURATION_OFFSET, true),
          timeOffset: view.getInt16(rec + CURVE_TIME_OFFSET, true),
          startValue: view.getUint16(rec + CURVE_START_OFFSET, true),
          endValue: view.getUint16(rec + CURVE_END_OFFSET, true),
          eventType: bytes[rec + CURVE_EVENT_TYPE_OFFSET] ?? 0,
          shape: bytes[rec + CURVE_SHAPE_OFFSET] ?? 0,
          ccData: bytes[rec + CURVE_CC_OFFSET] ?? 0,
        });
      }
    }
  }
  return { id, part: { timeSig, variationChoices, playMode, notes, curves } };
}

function decodeBand(bytes: Uint8Array, band: RiffChild): DmBand {
  const view = viewOf(bytes);
  const instruments: DmBandInstrument[] = [];
  for (const c of riffChildren(bytes, band.bodyStart, band.bodyEnd)) {
    if (!(c.id === 'LIST' && c.form === 'lbil')) continue;
    for (const inst of riffChildren(bytes, c.bodyStart, c.bodyEnd)) {
      if (!(inst.id === 'LIST' && inst.form === 'lbin')) continue;
      let header: { patch: number; pChannel: number; pan: number; volume: number } | undefined;
      let file: string | undefined;
      for (const x of riffChildren(bytes, inst.bodyStart, inst.bodyEnd)) {
        if (x.id === 'bins') {
          header = {
            patch: view.getUint32(x.bodyStart, true),
            pChannel: view.getUint32(x.bodyStart + BINS_PCHANNEL_OFFSET, true),
            pan: bytes[x.bodyStart + BINS_PAN_OFFSET] ?? 0,
            volume: bytes[x.bodyStart + BINS_VOLUME_OFFSET] ?? 0,
          };
        } else if (x.id === 'LIST' && x.form === 'DMRF') {
          for (const r of riffChildren(bytes, x.bodyStart, x.bodyEnd)) {
            if (r.id === 'file') file = utf16Ascii(bytes, r.bodyStart, r.bodyEnd);
          }
        }
      }
      if (header === undefined) throw new Error('band instrument without a bins header');
      instruments.push(file === undefined ? header : { ...header, file });
    }
  }
  return { instruments };
}

function decodePatternTrack(bytes: Uint8Array, track: RiffChild): DmTrack {
  const view = viewOf(bytes);
  let tempo = 0;
  let pattern: DmPattern | undefined;
  for (const c of riffChildren(bytes, track.bodyStart, track.bodyEnd)) {
    if (c.id === 'styh') {
      tempo = view.getFloat64(c.bodyStart + STYH_TEMPO_OFFSET, true);
    } else if (c.id === 'LIST' && c.form === 'pttn') {
      let timeSig: DmTimeSignature = { beatsPerMeasure: 0, beat: 0, gridsPerBeat: 0 };
      let measures = 0;
      let band: DmBand | undefined;
      const partRefs: DmPartRef[] = [];
      const parts = new Map<string, DmStylePart>();
      for (const p of riffChildren(bytes, c.bodyStart, c.bodyEnd)) {
        if (p.id === 'ptnh') {
          timeSig = timeSigAt(bytes, p.bodyStart);
          measures = view.getUint16(p.bodyStart + PTNH_MEASURES_OFFSET, true);
        } else if (p.id === 'LIST' && p.form === 'pref') {
          for (const r of riffChildren(bytes, p.bodyStart, p.bodyEnd)) {
            if (r.id === 'prfc') {
              partRefs.push({
                partId: guidHex(bytes, r.bodyStart),
                logicalPartId: view.getUint16(r.bodyStart + PRFC_LOGICAL_PART_OFFSET, true),
              });
            }
          }
        } else if (p.id === 'LIST' && p.form === 'part') {
          const decoded = decodeStylePart(bytes, p);
          parts.set(decoded.id, decoded.part);
        } else if (p.id === 'RIFF' && p.form === 'DMBD') {
          band = decodeBand(bytes, p);
        }
      }
      pattern = { timeSig, measures, partRefs, parts, ...(band === undefined ? {} : { band }) };
    }
  }
  return pattern === undefined ? { kind: 'pattern', tempo } : { kind: 'pattern', tempo, pattern };
}

function decodeBandTrack(bytes: Uint8Array, track: RiffChild): DmTrack {
  const view = viewOf(bytes);
  const changes: DmBandChange[] = [];
  for (const c of riffChildren(bytes, track.bodyStart, track.bodyEnd)) {
    if (!(c.id === 'LIST' && c.form === 'lbdl')) continue;
    for (const item of riffChildren(bytes, c.bodyStart, c.bodyEnd)) {
      if (!(item.id === 'LIST' && item.form === 'lbnd')) continue;
      let time: number | undefined;
      for (const x of riffChildren(bytes, item.bodyStart, item.bodyEnd)) {
        if (x.id === 'bdih') {
          time = view.getUint32(x.bodyStart, true);
        } else if (x.id === 'bd2h') {
          time = view.getUint32(x.bodyStart + BD2H_PHYSICAL_TIME_OFFSET, true);
        } else if (x.id === 'RIFF' && x.form === 'DMBD') {
          if (time === undefined) throw new Error('band item without a time header');
          changes.push({ time, band: decodeBand(bytes, x) });
          break;
        }
      }
    }
  }
  return { kind: 'band', changes };
}

function decodeChordTrack(bytes: Uint8Array, track: RiffChild): DmTrack {
  const view = viewOf(bytes);
  const times: number[] = [];
  for (const c of riffChildren(bytes, track.bodyStart, track.bodyEnd)) {
    if (c.id === 'crdb') {
      // Only the chord's time matters: the DX8 path resolves notes at schedule time, so the
      // runtime chord state a chord message writes is never read back.
      times.push(view.getUint32(c.bodyStart + 4 + CHORD_TIME_OFFSET, true));
    }
  }
  return { kind: 'chord', times };
}

function decodeSequenceTrack(bytes: Uint8Array, chunk: RiffChild): DmTrack {
  const view = viewOf(bytes);
  const items: DmSequenceItem[] = [];
  for (const c of riffChildren(bytes, chunk.bodyStart, chunk.bodyEnd)) {
    if (c.id !== 'evtl') continue;
    const structSize = view.getUint32(c.bodyStart, true);
    if (structSize === 0) continue;
    // Strict `<`: a record ending exactly at the chunk end is dropped. Approximation carried over
    // from the parser the shipped renders were validated against.
    for (
      let rec = c.bodyStart + 4;
      rec - c.bodyStart + structSize < c.bodyEnd - c.bodyStart;
      rec += structSize
    ) {
      items.push({
        time: view.getUint32(rec, true),
        duration: view.getUint32(rec + 4, true),
        pChannel: view.getUint32(rec + 8, true),
        offset: view.getInt16(rec + SEQ_ITEM_OFFSET_OFFSET, true),
        status: bytes[rec + SEQ_ITEM_STATUS_OFFSET] ?? 0,
        byte1: bytes[rec + SEQ_ITEM_STATUS_OFFSET + 1] ?? 0,
        byte2: bytes[rec + SEQ_ITEM_STATUS_OFFSET + 2] ?? 0,
      });
    }
  }
  return { kind: 'sequence', items };
}

/** The segment header and its performance-relevant tracks in file order. */
export function decodeSegmentTracks(bytes: Uint8Array): DmSegment {
  const view = viewOf(bytes);
  const root = riffChildren(bytes, 0, bytes.length)[0];
  if (root === undefined || root.form !== 'DMSG') throw new Error('not a DirectMusic segment');
  let repeats = 0;
  let length = 0;
  const tracks: DmTrack[] = [];
  for (const seg of riffChildren(bytes, root.bodyStart, root.bodyEnd)) {
    if (seg.id === 'segh') {
      repeats = view.getUint32(seg.bodyStart, true);
      length = view.getUint32(seg.bodyStart + 4, true);
    }
    if (!(seg.id === 'LIST' && seg.form === 'trkl')) continue;
    for (const trk of riffChildren(bytes, seg.bodyStart, seg.bodyEnd)) {
      if (!(trk.id === 'RIFF' && trk.form === 'DMTK')) continue;
      const children = riffChildren(bytes, trk.bodyStart, trk.bodyEnd);
      const trkh = children.find((c) => c.id === 'trkh');
      if (trkh === undefined) throw new Error('track without a trkh header');
      const ckid = fourCc(bytes, trkh.bodyStart + TRKH_CKID_OFFSET);
      const fccType = fourCc(bytes, trkh.bodyStart + TRKH_FCCTYPE_OFFSET);
      const isList = ckid.charCodeAt(0) === 0;
      const last = (id: string, form?: string): RiffChild | undefined =>
        children.filter((c) => c.id === id && (form === undefined || c.form === form)).at(-1);
      if (ckid === 'tetr') {
        const data = last('tetr');
        if (data !== undefined) tracks.push({ kind: 'tempo', items: decodeTempoItems(bytes, data) });
      } else if (ckid === 'seqt') {
        const data = last('seqt');
        if (data !== undefined) tracks.push(decodeSequenceTrack(bytes, data));
      } else if (ckid === 'cmnd' || (isList && fccType === 'sttr')) {
        throw new Error(`unsupported track type ${isList ? fccType : ckid} in segment`);
      } else if (isList && fccType === 'DMPT') {
        const data = last('RIFF', 'DMPT');
        if (data !== undefined) tracks.push(decodePatternTrack(bytes, data));
      } else if (isList && fccType === 'DMBT') {
        const data = last('RIFF', 'DMBT');
        if (data !== undefined) tracks.push(decodeBandTrack(bytes, data));
      } else if (isList && fccType === 'cord') {
        const data = last('LIST', 'cord');
        if (data !== undefined) tracks.push(decodeChordTrack(bytes, data));
      }
    }
  }
  return { repeats, length, tracks };
}
