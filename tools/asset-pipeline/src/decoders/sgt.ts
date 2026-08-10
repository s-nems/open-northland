/**
 * DirectMusic segment decoder for the chunks the music stage needs: timing (`segh` header, `tetr`
 * tempo track) and the embedded audiopath's synth port rate and Waves Reverb effect. Layouts from
 * the published DirectX headers (`DMUS_IO_SEGMENT_HEADER`, `DMUS_IO_TEMPO_ITEM`,
 * `DMUS_PORTPARAMS8`, `DSFXWavesReverb`), byte-verified against the owned copy's segments.
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

function fourCc(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off] ?? 0, bytes[off + 1] ?? 0, bytes[off + 2] ?? 0, bytes[off + 3] ?? 0);
}

/**
 * Depth-first visit of every chunk in the RIFF tree. Leaves pass their data; RIFF/LIST containers
 * pass their form type and the body after it, then recurse.
 */
function walkRiff(
  bytes: Uint8Array,
  visit: (chunkId: string, body: Uint8Array, formType?: string) => void,
): void {
  const view = viewOf(bytes);
  const walk = (start: number, end: number): void => {
    let off = start;
    while (off + RIFF_HEADER_BYTES <= end) {
      const chunkId = fourCc(bytes, off);
      const size = view.getUint32(off + 4, true);
      const body = off + RIFF_HEADER_BYTES;
      if (body + size > end) break; // truncated container: stop at the last complete chunk
      if (chunkId === 'RIFF' || chunkId === 'LIST') {
        visit(chunkId, bytes.subarray(body + LIST_ID_BYTES, body + size), fourCc(bytes, body));
        walk(body + LIST_ID_BYTES, body + size);
      } else {
        visit(chunkId, bytes.subarray(body, body + size));
      }
      off = body + size + (size & 1); // chunks are word-aligned
    }
  };
  walk(0, bytes.length);
}

/** Every non-container chunk with `id` anywhere in the tree, as subarray views of the chunk data. */
function findChunks(bytes: Uint8Array, id: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  walkRiff(bytes, (chunkId, body) => {
    if (chunkId === id) out.push(body);
  });
  return out;
}

/** Bodies (after the 4-byte form type) of every RIFF/LIST container with the given form type. */
function findForms(bytes: Uint8Array, formType: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  walkRiff(bytes, (_chunkId, body, form) => {
    if (form === formType) out.push(body);
  });
  return out;
}

/**
 * `DSFXWavesReverb`, minus the high-frequency decay ratio: every segment authors 0.001 (the DMO
 * minimum), which the render's fixed reverb damping realizes.
 */
export interface SegmentReverb {
  readonly inGainDb: number;
  readonly reverbMixDb: number;
  readonly reverbTimeMs: number;
}

/** Audiopath facts that shape the rendered sound. */
export interface SegmentAudiopath {
  /**
   * `DMUS_PORTPARAMS8.dwSampleRate`, when its valid flag is set: the rate the segment requests of
   * the synth port, which the music stage deliberately does not adopt as its publish rate.
   */
  readonly sampleRate?: number;
  readonly reverb?: SegmentReverb;
}

/** `CLSID_DirectSoundFXWavesReverb` as stored (little-endian GUID fields). */
const WAVES_REVERB_CLSID = [
  0x68, 0x02, 0xfc, 0x87, 0x55, 0x9a, 0x60, 0x43, 0x95, 0xaa, 0x00, 0x4a, 0x1d, 0x9d, 0xe2, 0x6c,
] as const;
/** `DMUS_IO_EFFECT_HEADER`: the effect CLSID sits after the leading flags dword. */
const EFFECT_CLSID_OFFSET = 4;
const PORTPARAMS_VALID_OFFSET = 4;
const PORTPARAMS_SAMPLE_RATE_OFFSET = 20;
const PORTPARAMS_MIN_BYTES = 24;
/** `DMUS_PORTPARAMS_SAMPLERATE` valid-params flag. */
const PORTPARAMS_SAMPLERATE_FLAG = 0x08;
const REVERB_PARAMS_BYTES = 16;

/** The audiopath's port rate and reverb, or undefined when the segment embeds neither. */
export function decodeSegmentAudiopath(bytes: Uint8Array): SegmentAudiopath | undefined {
  let sampleRate: number | undefined;
  let reverb: SegmentReverb | undefined;
  const pprh = findChunks(bytes, 'pprh')[0];
  if (pprh !== undefined && pprh.length >= PORTPARAMS_MIN_BYTES) {
    const view = viewOf(pprh);
    if ((view.getUint32(PORTPARAMS_VALID_OFFSET, true) & PORTPARAMS_SAMPLERATE_FLAG) !== 0) {
      sampleRate = view.getUint32(PORTPARAMS_SAMPLE_RATE_OFFSET, true);
    }
  }
  for (const dsfx of findForms(bytes, 'DSFX')) {
    const fxhr = findChunks(dsfx, 'fxhr')[0];
    const data = findChunks(dsfx, 'data')[0];
    if (fxhr === undefined || fxhr.length < EFFECT_CLSID_OFFSET + WAVES_REVERB_CLSID.length) continue;
    if (data === undefined || data.length < REVERB_PARAMS_BYTES) continue;
    if (!WAVES_REVERB_CLSID.every((byte, i) => fxhr[EFFECT_CLSID_OFFSET + i] === byte)) continue;
    const view = viewOf(data);
    reverb = {
      inGainDb: view.getFloat32(0, true),
      reverbMixDb: view.getFloat32(4, true),
      reverbTimeMs: view.getFloat32(8, true),
    };
    break;
  }
  if (sampleRate === undefined && reverb === undefined) return undefined;
  return {
    ...(sampleRate === undefined ? {} : { sampleRate }),
    ...(reverb === undefined ? {} : { reverb }),
  };
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
