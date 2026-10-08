import { FNV_OFFSET_BASIS, fnvHex, fnvMixWord, MUSIC_MANIFEST_VERSION } from '@open-northland/data';
import type { MusicTrack } from '../../src/index.js';

/** Builders for manifest documents in the layout the pipeline writes. */

/** A stand-in segment digest: distinct per `audio` name, so two stems share one only when asked to. */
export function digestOf(audio: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < audio.length; i++) hash = fnvMixWord(hash, audio.charCodeAt(i));
  return fnvHex(hash).repeat(8);
}

/** A 4 s two-pass track for `stem`, its own audio unless `sameAudioAs` names another stem. */
export function musicTrack(stem: string, overrides: Partial<MusicTrack> & { sameAudioAs?: string } = {}) {
  const { sameAudioAs, ...rest } = overrides;
  return {
    file: `${stem}.ogg`,
    loopStartS: 2,
    loopEndS: 4,
    loudnessLufs: -20,
    gainDb: 0,
    segmentSha256: digestOf(sameAudioAs ?? stem),
    ...rest,
  } satisfies MusicTrack;
}

/** A whole manifest document over `tracks`, keyed by stem. */
export function manifestDocument(tracks: Readonly<Record<string, MusicTrack>>) {
  return { version: MUSIC_MANIFEST_VERSION, renderVersion: 1, sources: 'test', tracks };
}

/** A document whose every stem is a default {@link musicTrack}. */
export function manifestOf(stems: readonly string[]) {
  return manifestDocument(Object.fromEntries(stems.map((stem) => [stem, musicTrack(stem)])));
}
