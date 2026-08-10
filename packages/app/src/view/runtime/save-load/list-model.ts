import { TICKS_PER_SECOND } from '@open-northland/sim';

/** Pure formatting and naming rules shared by the in-game save panels and the menu's load screen. */

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Game-clock playtime of a tick count: `m:ss` under an hour, `h:mm:ss` from there. */
export function formatPlaytime(tick: number): string {
  const totalSeconds = Math.floor(tick / TICKS_PER_SECOND);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const mmss = `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : mmss;
}

export function formatSavedAt(savedAt: number | null, localeTag: string): string {
  if (savedAt === null) return '-';
  return new Intl.DateTimeFormat(localeTag, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(savedAt),
  );
}

/** Mirrors the desktop shell's filename guard, so a sanitized title is accepted verbatim there. */
const INVALID_SAVE_NAME_CHARS = /[\\/:*?"<>|]/g;
const CONTROL_CHAR_CEILING = 0x20;
export const MAX_SAVE_NAME_LENGTH = 120;

/** A typed title as a cross-platform save name; null when nothing usable is left. */
export function sanitizedSaveName(raw: string): string | null {
  const printable = [...raw].filter((ch) => (ch.codePointAt(0) ?? 0) >= CONTROL_CHAR_CEILING).join('');
  const name = printable.replace(INVALID_SAVE_NAME_CHARS, '-').trim().slice(0, MAX_SAVE_NAME_LENGTH);
  return name.length === 0 ? null : name;
}

/** The first free autoname: `template`'s `{n}` starts past the list size and skips taken names. A
 *  template that lost its `{n}` in translation numbers by suffix instead of never terminating. */
export function autoSaveName(template: string, taken: readonly string[]): string {
  const names = new Set(taken);
  const numbered = template.includes('{n}') ? template : `${template} {n}`;
  for (let n = taken.length + 1; ; n++) {
    const candidate = numbered.replace('{n}', String(n));
    if (!names.has(candidate)) return candidate;
  }
}

/** Suffixes a save file may carry; `.json.gz` is what the game writes. The desktop main process
 *  keeps its own boundary-forced mirror of this list. */
export const SAVE_FILE_SUFFIXES = ['.json.gz', '.json', '.gz'] as const;

export function hasSaveSuffix(name: string): boolean {
  return SAVE_FILE_SUFFIXES.some((suffix) => name.length > suffix.length && name.endsWith(suffix));
}

/** The list's display name: a file basename without its save suffix. */
export function displayNameOf(file: string): string {
  for (const suffix of SAVE_FILE_SUFFIXES) {
    if (file.length > suffix.length && file.endsWith(suffix)) return file.slice(0, -suffix.length);
  }
  return file;
}
