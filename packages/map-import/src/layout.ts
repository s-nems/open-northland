import { MAP_TEXT_LANGUAGES } from '@open-northland/data';

/** The names a map folder's files go by, matched lower-cased. One owner, so the readers and the
 *  filter that keeps an archive's map files agree on what a map folder holds. */
export const MAP_DAT_FILE = 'map.dat';
export const MAP_CIF_FILE = 'map.cif';
export const MAP_INI_FILE = 'map.ini';
export const MISC_INC_FILE = 'misc.inc';
export const STATIC_OBJECTS_INC_FILE = 'staticobjects.inc';

/**
 * Where an unpacked map (no `map.cif`) keeps its `[StaticObjects]` placements, in lookup order: the
 * `staticobjects.inc` its `map.ini` includes, or, in a few flattened folders, `map.ini` itself.
 */
export const STATIC_OBJECT_FILES = [STATIC_OBJECTS_INC_FILE, MAP_INI_FILE] as const;

/** The plaintext headers `[misc_mapname]`, `[misc_music]` and `[misc_maptype]` live in, readable first. */
export const HEADER_FILES = [MISC_INC_FILE, MAP_INI_FILE] as const;

/**
 * The plaintext script files an unpacked map folder ships: `player.inc` usually carries
 * `[playerdata]`/`[playermisc]`/`[multiplayer]`, `mission.inc` the repeated `[MissionData]` triggers,
 * `ai.inc` the `[aidata]` seat toggles, while `misc.inc` and `map.ini` sometimes host those sections
 * instead of `#include`ing the others. The order matches the maps' `map.ini` include order: a few
 * maps author `[multiplayer]` in two files with differing `playeroption` rows, and keeping the first
 * row per slot is a named approximation.
 */
export const SCRIPT_FILES = ['player.inc', 'mission.inc', 'ai.inc', MISC_INC_FILE, MAP_INI_FILE] as const;

/** The authored menu picture, `minimap/minimap.pcx`. */
export const PICTURE_PATH = ['minimap', 'minimap.pcx'] as const;

/** The per-map string-table subfolder (`<map>/text/<lang>/strings.*`), not a map folder itself. */
export const STRING_TABLE_DIR = 'text';
/** A language's table forms, the readable one first. */
export const STRING_TABLE_FILES = ['strings.ini', 'strings.cif'] as const;
export const BRIEFINGS_DIR = 'briefings';
export const BRIEFINGS_FILE = 'briefings.txt';
/** The dir a page's `$local$\graphics\<file>` argument resolves against, beside its text files. */
export const HYPERTEXT_GRAPHICS_DIR = 'graphics';
/** The window opens cutscene `id` as the page `%4.4d.hlt`, which includes its text from `briefings.txt`. */
export const HLT_PAGE_DIGITS = 4;
const HLT_EXTENSION = '.hlt';
/** A briefing's spoken lines, `sfx/<lang>/NNNN.wav` beside `text/`. */
export const VOICE_DIR = 'sfx';
const VOICE_FILE = /^\d{4,}\.wav$/;

/** The `NNNN.hlt` page file name of one cutscene id. */
export function hltPageFile(id: number): string {
  return `${String(id).padStart(HLT_PAGE_DIGITS, '0')}${HLT_EXTENSION}`;
}

const MAP_FOLDER_FILES: ReadonlySet<string> = new Set([
  MAP_DAT_FILE,
  MAP_CIF_FILE,
  ...STATIC_OBJECT_FILES,
  ...HEADER_FILES,
  ...SCRIPT_FILES,
]);
const LANGUAGES: ReadonlySet<string> = new Set(MAP_TEXT_LANGUAGES);
const STRING_TABLES: ReadonlySet<string> = new Set(STRING_TABLE_FILES);
const HLT_PAGE = new RegExp(`^\\d{${HLT_PAGE_DIGITS},}\\${HLT_EXTENSION}$`);

/** Whether a lower-cased, `/`-separated path names a file some map folder's conversion reads. */
export function isMapFile(path: string): boolean {
  const parts = path.split('/');
  const n = parts.length;
  if (MAP_FOLDER_FILES.has(parts[n - 1] ?? '')) return true;
  if (parts[n - 2] === PICTURE_PATH[0] && parts[n - 1] === PICTURE_PATH[1]) return true;
  if (parts[n - 3] === VOICE_DIR && LANGUAGES.has(parts[n - 2] ?? ''))
    return VOICE_FILE.test(parts[n - 1] ?? '');
  const text = parts.lastIndexOf(STRING_TABLE_DIR);
  if (text < 0 || !LANGUAGES.has(parts[text + 1] ?? '')) return false;
  const rest = parts.slice(text + 2);
  if (rest.length === 1) return STRING_TABLES.has(rest[0] ?? '');
  if (rest[0] !== BRIEFINGS_DIR) return false;
  if (rest.length === 2) return rest[1] === BRIEFINGS_FILE || HLT_PAGE.test(rest[1] ?? '');
  return rest.length === 3 && rest[1] === HYPERTEXT_GRAPHICS_DIR;
}
