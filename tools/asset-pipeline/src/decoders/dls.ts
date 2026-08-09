/**
 * DLS collection decoder for the slices the music stage needs: the bank-level INFO name and the
 * regions whose authored loop extends past their wave's PCM. The retail synth validates instrument
 * downloads and refuses such regions, so their keys stay silent (byte evidence: `015.dls` authors
 * loops past every wave above key 68, one of them a 273-frame wave carrying mangled header text as
 * PCM; keeping them audible was rejected by ear against an in-game recording). Layouts from the
 * published DLS Level 2 specification.
 */
import { viewOf } from './byte-cursor.js';

/** Inclusive MIDI key range of one instrument region. */
export interface DlsKeyRange {
  readonly lo: number;
  readonly hi: number;
}

/** One instrument's rejected key ranges, addressed the way bands address instruments. */
export interface DlsInstrumentRejects {
  readonly bankLo: number;
  readonly bankHi: number;
  readonly patch: number;
  readonly ranges: readonly DlsKeyRange[];
}

const RIFF_HEADER_BYTES = 8;
const FORM_TYPE_BYTES = 4;
/** `WSMPL.cSampleLoops`, then `WLOOP` start/length offsets inside the loop record. */
const WSMP_LOOP_COUNT_OFFSET = 16;
const LOOP_START_OFFSET = 8;
const LOOP_LENGTH_OFFSET = 12;
/** `INSH.Locale`: ulBank at +4 (bits 0-6 CC32, 8-14 CC0), ulInstrument at +8. */
const INSH_BANK_OFFSET = 4;
const INSH_INSTRUMENT_OFFSET = 8;
const MIDI_7BIT_MASK = 0x7f;
const INSH_BANK_MSB_SHIFT = 8;
/** `WLINK.ulTableIndex`: the wave's pool-table cue. */
const WLNK_TABLE_INDEX_OFFSET = 8;
const FMT_BITS_OFFSET = 14;
const FIRST_PRINTABLE = 0x20;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

function fourCc(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off] ?? 0, bytes[off + 1] ?? 0, bytes[off + 2] ?? 0, bytes[off + 3] ?? 0);
}

/**
 * Depth-first visit of every chunk. Containers report their form type and the body after it;
 * `bodyStart` is the absolute offset into `bytes` either way.
 */
function walkChunks(
  bytes: Uint8Array,
  visit: (id: string, formType: string | undefined, bodyStart: number, bodyEnd: number) => void,
): void {
  const view = viewOf(bytes);
  const walk = (start: number, end: number): void => {
    let off = start;
    while (off + RIFF_HEADER_BYTES <= end) {
      const id = fourCc(bytes, off);
      const size = view.getUint32(off + 4, true);
      const body = off + RIFF_HEADER_BYTES;
      if (body + size > end) break;
      if (id === 'RIFF' || id === 'LIST') {
        visit(id, fourCc(bytes, body), body + FORM_TYPE_BYTES, body + size);
        walk(body + FORM_TYPE_BYTES, body + size);
      } else {
        visit(id, undefined, body, body + size);
      }
      off = body + size + (size & 1);
    }
  };
  walk(0, bytes.length);
}

/** The collection-level `INFO`/`INAM` name, or undefined without one. */
export function decodeBankName(bytes: Uint8Array): string | undefined {
  const view = viewOf(bytes);
  let off = RIFF_HEADER_BYTES + FORM_TYPE_BYTES;
  const end = Math.min(bytes.length, RIFF_HEADER_BYTES + view.getUint32(4, true));
  while (off + RIFF_HEADER_BYTES <= end) {
    const id = fourCc(bytes, off);
    const size = view.getUint32(off + 4, true);
    const body = off + RIFF_HEADER_BYTES;
    if (id === 'LIST' && fourCc(bytes, body) === 'INFO') {
      let sub = body + FORM_TYPE_BYTES;
      while (sub + RIFF_HEADER_BYTES <= body + size) {
        const subId = fourCc(bytes, sub);
        const subSize = view.getUint32(sub + 4, true);
        if (subId === 'INAM') {
          const raw = bytes.subarray(sub + RIFF_HEADER_BYTES, sub + RIFF_HEADER_BYTES + subSize);
          // Same normalization as the event dump's identity rows: drop control, quote, backslash.
          return [...raw]
            .filter((c) => c >= FIRST_PRINTABLE && c !== QUOTE && c !== BACKSLASH)
            .map((c) => String.fromCharCode(c))
            .join('')
            .trim();
        }
        sub += RIFF_HEADER_BYTES + subSize + (subSize & 1);
      }
    }
    off = body + size + (size & 1);
  }
  return undefined;
}

/** PCM frame counts of the pool waves, keyed by their pool-table cue index. */
function waveFramesByCue(bytes: Uint8Array): Map<number, number> {
  const view = viewOf(bytes);
  let wvplDataStart: number | undefined;
  const waveStarts: number[] = [];
  const frames: number[] = [];
  walkChunks(bytes, (id, formType, bodyStart, bodyEnd) => {
    if (id === 'LIST' && formType === 'wvpl') {
      wvplDataStart = bodyStart;
      return;
    }
    if (id !== 'LIST' || formType !== 'wave') return;
    let bits = 16;
    let dataBytes = 0;
    walkChunks(bytes.subarray(bodyStart, bodyEnd), (subId, _form, subStart, subEnd) => {
      if (subId === 'fmt ') bits = viewOf(bytes).getUint16(bodyStart + subStart + FMT_BITS_OFFSET, true);
      if (subId === 'data') dataBytes = subEnd - subStart;
    });
    waveStarts.push(bodyStart - RIFF_HEADER_BYTES - FORM_TYPE_BYTES);
    frames.push(bits >= 8 ? Math.floor(dataBytes / (bits >> 3)) : 0);
  });
  const byCue = new Map<number, number>();
  if (wvplDataStart === undefined) return byCue;
  const offsetToWave = new Map<number, number>();
  for (const [i, start] of waveStarts.entries()) offsetToWave.set(start - wvplDataStart, i);
  walkChunks(bytes, (id, _form, bodyStart) => {
    if (id !== 'ptbl') return;
    const cbSize = view.getUint32(bodyStart, true);
    const cues = view.getUint32(bodyStart + 4, true);
    for (let i = 0; i < cues; i++) {
      const wave = offsetToWave.get(view.getUint32(bodyStart + cbSize + 4 * i, true));
      const count = wave === undefined ? undefined : frames[wave];
      if (count !== undefined) byCue.set(i, count);
    }
  });
  return byCue;
}

/** The one region's key range when its authored loop extends past its wave, else undefined. */
function rejectedRange(
  bytes: Uint8Array,
  bodyStart: number,
  bodyEnd: number,
  framesByCue: ReadonlyMap<number, number>,
): DlsKeyRange | undefined {
  const view = viewOf(bytes);
  let keys: DlsKeyRange | undefined;
  let loop: { start: number; length: number } | undefined;
  let cue: number | undefined;
  walkChunks(bytes.subarray(bodyStart, bodyEnd), (subId, _form, subStart) => {
    const at = bodyStart + subStart;
    if (subId === 'rgnh') {
      keys = { lo: view.getUint16(at, true), hi: view.getUint16(at + 2, true) };
    } else if (subId === 'wsmp') {
      const cbSize = view.getUint32(at, true);
      if (view.getUint32(at + WSMP_LOOP_COUNT_OFFSET, true) > 0) {
        loop = {
          start: view.getUint32(at + cbSize + LOOP_START_OFFSET, true),
          length: view.getUint32(at + cbSize + LOOP_LENGTH_OFFSET, true),
        };
      }
    } else if (subId === 'wlnk') {
      cue = view.getUint32(at + WLNK_TABLE_INDEX_OFFSET, true);
    }
  });
  if (keys === undefined || cue === undefined || loop === undefined) return undefined;
  const frames = framesByCue.get(cue);
  return frames !== undefined && loop.start + loop.length > frames ? keys : undefined;
}

/** Per instrument, the key ranges of regions whose authored loop extends past their wave. */
export function decodeRejectedRegions(bytes: Uint8Array): readonly DlsInstrumentRejects[] {
  const view = viewOf(bytes);
  const framesByCue = waveFramesByCue(bytes);
  const rejected: DlsInstrumentRejects[] = [];
  walkChunks(bytes, (id, formType, bodyStart, bodyEnd) => {
    if (id !== 'LIST' || formType !== 'ins ') return;
    let locale: { bankLo: number; bankHi: number; patch: number } | undefined;
    const ranges: DlsKeyRange[] = [];
    walkChunks(bytes.subarray(bodyStart, bodyEnd), (subId, subForm, subStart, subEnd) => {
      const at = bodyStart + subStart;
      if (subId === 'insh') {
        const bank = view.getUint32(at + INSH_BANK_OFFSET, true);
        locale = {
          bankLo: bank & MIDI_7BIT_MASK,
          bankHi: (bank >>> INSH_BANK_MSB_SHIFT) & MIDI_7BIT_MASK,
          patch: view.getUint32(at + INSH_INSTRUMENT_OFFSET, true) & MIDI_7BIT_MASK,
        };
      } else if (subId === 'LIST' && (subForm === 'rgn ' || subForm === 'rgn2')) {
        const range = rejectedRange(bytes, at, bodyStart + subEnd, framesByCue);
        if (range !== undefined) ranges.push(range);
      }
    });
    if (locale !== undefined && ranges.length > 0) rejected.push({ ...locale, ranges });
  });
  return rejected;
}
