/**
 * The pipeline's rendered-music manifest. A checkout without rendered music parses to nothing and
 * degrades to silence.
 */

/** One playable music track. */
export interface MusicTrack {
  /** The audio file, relative to the music root (e.g. `theme_viking_neutral.ogg`). */
  readonly file: string;
  /** Seconds into the file the loop region opens, which is also the first pass's end. Absent in an
   *  older manifest; the player then loops the whole file. */
  readonly loopStartS?: number;
  /** Seconds into the file the loop region closes. */
  readonly loopEndS?: number;
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
    const { file, loopStartS, loopEndS } = entry as Record<string, unknown>;
    if (typeof file !== 'string' || file.length === 0) continue;
    if (
      typeof loopStartS === 'number' &&
      typeof loopEndS === 'number' &&
      Number.isFinite(loopStartS) &&
      Number.isFinite(loopEndS) &&
      loopStartS >= 0 &&
      loopStartS < loopEndS
    ) {
      parsed[stem] = { file, loopStartS, loopEndS };
    } else {
      parsed[stem] = { file };
    }
  }
  return { tracks: parsed };
}
