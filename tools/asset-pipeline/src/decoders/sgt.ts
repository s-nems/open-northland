/**
 * DirectMusic segment timing decoder: the `segh` header and `tetr` tempo track of a `.sgt` RIFF, the
 * two chunks that place the loop point in seconds. Layouts from the published DirectX headers
 * (`DMUS_IO_SEGMENT_HEADER`, `DMUS_IO_TEMPO_ITEM`), byte-verified against the owned copy's segments.
 */
import { viewOf } from './byte-cursor.js';

/** Music-time ticks per quarter note (`DMUS_PPQ`). */
export const DMUS_PPQ = 768;

/** One `DMUS_IO_TEMPO_ITEM`: the tempo in force from `time` (music-time ticks) on. */
export interface TempoItem {
  readonly time: number;
  readonly bpm: number;
}

/** The loop-relevant slice of a segment: play starts at 0, the region [loopStart, length] repeats. */
export interface SegmentTiming {
  /** `dwRepeats` (0xffffffff = infinite). */
  readonly repeats: number;
  /** `mtLength` in music-time ticks (== `mtLoopEnd` across the owned corpus). */
  readonly lengthTicks: number;
  /** `mtLoopStart` in music-time ticks - the one-shot intro ends here. */
  readonly loopStartTicks: number;
  /** Tempo map in file order; empty falls back to the DirectMusic default 120 bpm. */
  readonly tempos: readonly TempoItem[];
}

const RIFF_HEADER_BYTES = 8;
const LIST_ID_BYTES = 4;
/** `DMUS_IO_SEGMENT_HEADER`: dwRepeats, mtLength, mtPlayStart, mtLoopStart, mtLoopEnd. */
const SEGH_MIN_BYTES = 20;
/** `DMUS_IO_TEMPO_ITEM`: lTime at +0, dblTempo at +8 (4 bytes of struct padding between). */
const TEMPO_ITEM_TIME_OFFSET = 0;
const TEMPO_ITEM_BPM_OFFSET = 8;
const TEMPO_ITEM_MIN_BYTES = 16;
const DEFAULT_BPM = 120;

/** Every chunk with `id` anywhere in the RIFF tree, as subarray views of the chunk data. */
function findChunks(bytes: Uint8Array, id: string): Uint8Array[] {
  const view = viewOf(bytes);
  const out: Uint8Array[] = [];
  const walk = (start: number, end: number): void => {
    let off = start;
    while (off + RIFF_HEADER_BYTES <= end) {
      const chunkId = String.fromCharCode(
        bytes[off] ?? 0,
        bytes[off + 1] ?? 0,
        bytes[off + 2] ?? 0,
        bytes[off + 3] ?? 0,
      );
      const size = view.getUint32(off + 4, true);
      const body = off + RIFF_HEADER_BYTES;
      if (body + size > end) break; // truncated container: stop at the last complete chunk
      if (chunkId === id) out.push(bytes.subarray(body, body + size));
      if (chunkId === 'RIFF' || chunkId === 'LIST') walk(body + LIST_ID_BYTES, body + size);
      off = body + size + (size & 1); // chunks are word-aligned
    }
  };
  walk(0, bytes.length);
  return out;
}

/** The segment's timing, or undefined when no complete `segh` chunk exists. */
export function decodeSegmentTiming(bytes: Uint8Array): SegmentTiming | undefined {
  const segh = findChunks(bytes, 'segh')[0];
  if (segh === undefined || segh.length < SEGH_MIN_BYTES) return undefined;
  const view = viewOf(segh);
  const repeats = view.getUint32(0, true);
  const lengthTicks = view.getInt32(4, true);
  const loopStartTicks = view.getInt32(12, true);
  const tempos: TempoItem[] = [];
  for (const tetr of findChunks(bytes, 'tetr')) {
    if (tetr.length < 4) continue;
    const tetrView = viewOf(tetr);
    const itemSize = tetrView.getUint32(0, true);
    if (itemSize < TEMPO_ITEM_MIN_BYTES) continue;
    for (let off = 4; off + itemSize <= tetr.length; off += itemSize) {
      tempos.push({
        time: tetrView.getInt32(off + TEMPO_ITEM_TIME_OFFSET, true),
        bpm: tetrView.getFloat64(off + TEMPO_ITEM_BPM_OFFSET, true),
      });
    }
  }
  tempos.sort((a, b) => a.time - b.time);
  return { repeats, lengthTicks, loopStartTicks, tempos };
}

/** Seconds from music-time 0 to `ticks`, integrating the piecewise-constant tempo map. */
export function musicTimeToSeconds(ticks: number, tempos: readonly TempoItem[]): number {
  let seconds = 0;
  let at = 0;
  let bpm = tempos[0]?.bpm ?? DEFAULT_BPM;
  for (const item of tempos) {
    if (item.time >= ticks) break;
    if (item.time > at) {
      seconds += ((item.time - at) * 60) / (DMUS_PPQ * bpm);
      at = item.time;
    }
    bpm = item.bpm;
  }
  return seconds + ((ticks - at) * 60) / (DMUS_PPQ * bpm);
}
