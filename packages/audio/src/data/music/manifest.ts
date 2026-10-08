import { MusicManifestDocument, type MusicManifestTrack } from '@open-northland/data';

/**
 * The pipeline's rendered-music manifest. A checkout without rendered music, or with music rendered
 * for another manifest layout, parses to nothing and degrades to silence.
 */

/** One playable music track. */
export type MusicTrack = MusicManifestTrack;

/** The pipeline's `music/manifest.json`: rendered tracks keyed by lower-cased segment stem. */
export interface MusicManifest {
  readonly tracks: Readonly<Record<string, MusicTrack>>;
}

/** Parses a fetched `music/manifest.json`; null when it is not this build's layout. */
export function parseMusicManifest(raw: unknown): MusicManifest | null {
  const parsed = MusicManifestDocument.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[audio] music manifest rejected: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`);
    return null;
  }
  return { tracks: parsed.data.tracks };
}
