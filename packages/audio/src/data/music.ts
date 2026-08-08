/**
 * Pure music selection: `DM_MUSIC_TYPE_*` map codes to rendered track files. Codes from the owned
 * copy's `logicdefines.inc`; segment names from `DataX/DM2/*.sgt`. The pipeline's music manifest
 * carries what was actually rendered, so a checkout without rendered music degrades to silence.
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

/**
 * `DM_MUSIC_TYPE_*` code → the base-mood segment stem: `Theme_*` plays `Neutral`, `Mission_*` plays
 * `Standard`, `Attack_*` has one variant. Mood switching (diplomacy themes, Wealthy/Danger missions)
 * is not modelled yet; jingle codes (22-30) are wav one-shots, not segments.
 */
export const DEFAULT_MUSIC_STEMS: Readonly<Record<number, string>> = {
  2: 'theme_viking_neutral',
  3: 'theme_franken_neutral',
  4: 'theme_byzanz_neutral',
  5: 'theme_arabs_neutral',
  6: 'attack_viking',
  7: 'attack_franken',
  8: 'attack_byzanz',
  9: 'attack_arabs',
  10: 'mission_viking1_standard',
  11: 'mission_franken1_standard',
  12: 'mission_franken2_standard',
  13: 'mission_byzanz1_standard',
  14: 'mission_byzanz2_standard',
  15: 'mission_byzanz3_standard',
  16: 'mission_byzanz4_standard',
  17: 'mission_arabs1_standard',
  18: 'mission_arabs2_standard',
  19: 'mission_arabs3_standard',
  20: 'mission_midgard1_standard',
  21: 'mission_midgard2_standard',
  31: 'mission_addon_arabs1_standard',
  32: 'mission_addon_arabs2_standard',
  33: 'mission_addon_franken1_standard',
  34: 'mission_addon_franken2_standard',
  35: 'mission_addon_franken3_standard',
  36: 'mission_addon_nordland_standard',
  37: 'mission_addon_underworld_standard',
  38: 'mission_addon_asgard_standard',
};

/** The `Theme_Viking_*` code - what the original main menu plays (`StartTrack(2)` in `Game.exe`). */
export const MENU_MUSIC_TYPE = 2;

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

/** The track a map's `musictype` should play, or null when the code has no rendered track. */
export function musicTrackForType(
  code: number | undefined,
  manifest: MusicManifest | null,
): MusicTrack | null {
  if (code === undefined || manifest === null) return null;
  const stem = DEFAULT_MUSIC_STEMS[code];
  if (stem === undefined) return null;
  return manifest.tracks[stem] ?? null;
}
