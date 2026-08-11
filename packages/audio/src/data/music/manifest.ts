/**
 * The pipeline's rendered-music manifest. A checkout without rendered music parses to nothing and
 * degrades to silence.
 */

/** One playable music track: a file under the music route and its loop-back point. */
export interface MusicTrack {
  /** The audio file, relative to the music root (e.g. `theme_viking_neutral.ogg`). */
  readonly file: string;
  /** Where the infinite loop restarts, in seconds - the segment's one-shot intro ends here.
   *  Absent or 0, the whole file loops. */
  readonly loopStartS?: number;
}

/** The pipeline's `music/manifest.json`: rendered tracks keyed by lower-cased segment stem. */
export interface MusicManifest {
  readonly tracks: Readonly<Record<string, MusicTrack>>;
}

/** Tolerantly parses a fetched `music/manifest.json`; null when the shape is unusable. */
export function parseMusicManifest(raw: unknown): MusicManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { tracks } = raw as Record<string, unknown>;
  if (typeof tracks !== 'object' || tracks === null) return null;
  const parsed: Record<string, MusicTrack> = {};
  for (const [stem, entry] of Object.entries(tracks)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { file, loopStartS } = entry as Record<string, unknown>;
    if (typeof file !== 'string' || file.length === 0) continue;
    parsed[stem] = typeof loopStartS === 'number' && loopStartS > 0 ? { file, loopStartS } : { file };
  }
  return { tracks: parsed };
}
