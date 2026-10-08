import { z } from 'zod';

/** Layout version of the music stage's `music/manifest.json`. A reader accepts only this one; a
 *  layout change bumps it and the stage re-renders every track. */
export const MUSIC_MANIFEST_VERSION = 2 as const;

/** One rendered segment: the ogg, its ring-loop region and its loudness correction. */
export const MusicManifestTrack = z.strictObject({
  /** The ogg, relative to the music root (e.g. `theme_viking_neutral.ogg`). */
  file: z.string().min(1),
  /** Seconds into the file the loop region opens, which is also the first pass's end. */
  loopStartS: z.number().nonnegative(),
  /** Seconds into the file the loop region closes, the second pass's end and the file's end. */
  loopEndS: z.number().positive(),
  /** Integrated loudness of the file as rendered, in LUFS; null when no block cleared the gate. */
  loudnessLufs: z.number().nullable(),
  /** Decibels the player applies so the track sits near the stage's common loudness target. */
  gainDb: z.number(),
  /** SHA-256 of the source segment's bytes: two stems with the same digest play the same audio. */
  segmentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type MusicManifestTrack = z.infer<typeof MusicManifestTrack>;

/** The whole manifest, tracks keyed by lower-cased segment stem. `renderVersion` and `sources` are the
 *  stage's own cache identity. */
export const MusicManifestDocument = z.strictObject({
  version: z.literal(MUSIC_MANIFEST_VERSION),
  renderVersion: z.number().int(),
  sources: z.string(),
  tracks: z.record(
    z.string(),
    MusicManifestTrack.refine((track) => track.loopStartS < track.loopEndS, {
      message: 'loop region must open before it closes',
    }),
  ),
});
export type MusicManifestDocument = z.infer<typeof MusicManifestDocument>;
