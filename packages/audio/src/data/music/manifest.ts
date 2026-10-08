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

/** A fetched manifest as read: its tracks, or no manifest and why, for the caller to log. */
export type MusicManifestRead =
  | { readonly manifest: MusicManifest }
  | { readonly manifest: null; readonly rejected: string };

/** Parses a fetched `music/manifest.json`; no manifest when it is not this build's layout. */
export function parseMusicManifest(raw: unknown): MusicManifestRead {
  const parsed = MusicManifestDocument.safeParse(raw);
  if (!parsed.success) {
    return { manifest: null, rejected: parsed.error.issues[0]?.message ?? 'unknown shape' };
  }
  return { manifest: { tracks: parsed.data.tracks } };
}
