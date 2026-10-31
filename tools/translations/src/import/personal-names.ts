import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  OVERLAY_LANGUAGES,
  OVERLAY_VERSION,
  type OverlayLanguage,
  PERSONAL_NAMES,
  PersonalNameOverlay,
  type PersonalNamePool,
} from '@open-northland/data';
import { LOCALIZATION_SOURCES } from './columns.js';
import type { OverlayFile } from './maps.js';

/**
 * The original's random settlers draw their names from `humannames.ini`: one `[names]` block per
 * `logictribe`, each line a name tagged `0` for the tribe's men or `1` for its women.
 */
const NAMES_FILE = ['strings', 'gameobjects', 'humannames.ini'] as const;
const NAME_LINE = /^Name ([01]) "(.*)"$/;
/** The folder the English original lives in; a translation's line sits on its line. */
const ENGLISH_FOLDER = 'eng';
/** A line the original fills for the settler it has not named yet: not a name, never translated. */
const PLACEHOLDER = /^Unnamed /;

type Sex = 'male' | 'female';

interface NameLine {
  readonly sex: Sex;
  readonly name: string;
}

interface Translation {
  readonly sex: Sex;
  readonly text: string;
}

/**
 * The one translation a name carries whatever sex the source tags it with, or undefined when the
 * source gives it two: a pool may sort a name under the other sex than the source does, and a name
 * spelled the same in both reads the same either way.
 */
function soleTranslation(candidates: readonly Translation[] | undefined): Translation | undefined {
  const [first] = candidates ?? [];
  if (first === undefined) return undefined;
  return candidates?.every((entry) => entry.text === first.text) === true ? first : undefined;
}

async function readNameLines(textRoot: string, folder: string): Promise<readonly NameLine[]> {
  const text = await readFile(join(textRoot, folder, ...NAMES_FILE), 'utf8');
  const lines: NameLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = NAME_LINE.exec(line.trim());
    if (match === null) continue;
    lines.push({ sex: match[1] === '0' ? 'male' : 'female', name: match[2] ?? '' });
  }
  return lines;
}

export interface PersonalNameResult {
  readonly languages: Readonly<Partial<Record<OverlayLanguage, { names: number }>>>;
}

/**
 * What the locale calls `name` in the reading `sex` gives it: the lines the source tags with that
 * sex, or the name's sole translation when the pool sorts it under the other one. A name the table
 * spells on two lines with two different translations is left out rather than guessed at, and a
 * pool without a sex reads whichever lines it finds.
 */
function translationFor(
  candidates: readonly Translation[] | undefined,
  sex: PersonalNamePool['sex'],
): string | undefined {
  if (candidates === undefined) return undefined;
  const same = sex === 'neutral' ? candidates : candidates.filter((entry) => entry.sex === sex);
  if (same.length === 0) return soleTranslation(candidates)?.text;
  const [first] = same;
  if (first === undefined) return undefined;
  return same.every((entry) => entry.text === first.text) ? first.text : undefined;
}

/**
 * Writes one overlay per personal-name pool and language, reading the translation the localization
 * carries in that language's own `humannames.ini` line for line. A pool keeps a name only when the
 * pool generates it; the rest of the pool shows its raw spelling, so a name this import cannot
 * translate is not an error.
 */
export async function importPersonalNames(
  textRoot: string,
  files: OverlayFile[],
  pools: readonly PersonalNamePool[] = PERSONAL_NAMES,
): Promise<PersonalNameResult> {
  const english = await readNameLines(textRoot, ENGLISH_FOLDER);
  const languages: Partial<Record<OverlayLanguage, { names: number }>> = {};
  for (const lang of OVERLAY_LANGUAGES) {
    const translated = await readNameLines(textRoot, LOCALIZATION_SOURCES[lang].textFolder);
    // A name may sit on the male line of one tribe and the female line of another, so keep each.
    const byName = new Map<string, readonly Translation[]>();
    for (const [index, line] of english.entries()) {
      if (PLACEHOLDER.test(line.name)) continue;
      const twin = translated[index];
      // The translation is the same table, so its line must repeat the English line's sex tag. A
      // shifted or retagged line is not this name's translation.
      if (twin === undefined || twin.sex !== line.sex) continue;
      const entries = [...(byName.get(line.name) ?? []), { sex: line.sex, text: twin.name }];
      byName.set(line.name, entries);
    }

    let written = 0;
    for (const pool of pools) {
      const names: Record<string, string> = {};
      for (const name of pool.names) {
        const text = translationFor(byName.get(name), pool.sex);
        if (text === undefined || text === '') continue;
        names[name] = text;
      }
      const count = Object.keys(names).length;
      if (count === 0) continue;
      written += count;
      files.push({
        path: `${lang}/names/${pool.id}.json`,
        value: PersonalNameOverlay.parse({ version: OVERLAY_VERSION, pool: pool.id, names }),
      });
    }
    languages[lang] = { names: written };
  }
  return { languages };
}
