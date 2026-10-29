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
/** The glossary's own columns; a character name is a row whose type reads `人名`. */
const ENG_HEADER = 'eng';
const TYPE_HEADER = 'type';
const CHARACTER_TYPE = '人名';

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

/**
 * The campaign characters' names per language, keyed by their English spelling. The pools carry a
 * few of them, and the campaign strings use the glossary's wording, so a random namesake reads the
 * same as the script does.
 */
export function glossaryCharacterNames(
  rows: readonly (readonly string[])[],
): Partial<Record<OverlayLanguage, ReadonlyMap<string, string>>> {
  const header = rows[0];
  if (header === undefined) return {};
  const engAt = header.indexOf(ENG_HEADER);
  const typeAt = header.indexOf(TYPE_HEADER);
  if (engAt === -1 || typeAt === -1) return {};
  const languages: Partial<Record<OverlayLanguage, ReadonlyMap<string, string>>> = {};
  for (const lang of OVERLAY_LANGUAGES) {
    const langAt = header.indexOf(lang);
    if (langAt === -1) continue;
    const byName = new Map<string, string>();
    for (const row of rows.slice(1)) {
      if (row[typeAt] !== CHARACTER_TYPE) continue;
      const name = row[engAt];
      const text = row[langAt];
      if (name === undefined || name === '' || text === undefined || text === '') continue;
      if (!byName.has(name)) byName.set(name, text);
    }
    languages[lang] = byName;
  }
  return languages;
}

export interface PersonalNameResult {
  readonly languages: Readonly<Partial<Record<OverlayLanguage, { names: number; fromGlossary: number }>>>;
}

/**
 * Writes one overlay per personal-name pool and language. A pool keeps a name only when the pool
 * generates it; the rest of the pool shows its raw spelling, so a name this import cannot translate
 * is not an error.
 */
export async function importPersonalNames(
  textRoot: string,
  characters: Readonly<Partial<Record<OverlayLanguage, ReadonlyMap<string, string>>>>,
  files: OverlayFile[],
  pools: readonly PersonalNamePool[] = PERSONAL_NAMES,
): Promise<PersonalNameResult> {
  const english = await readNameLines(textRoot, ENGLISH_FOLDER);
  const languages: Partial<Record<OverlayLanguage, { names: number; fromGlossary: number }>> = {};
  for (const lang of OVERLAY_LANGUAGES) {
    const translated = await readNameLines(textRoot, LOCALIZATION_SOURCES[lang].textFolder);
    // A name may sit on the male line of one tribe and the female line of another, so keep each.
    const byName = new Map<string, readonly Translation[]>();
    for (const [index, line] of english.entries()) {
      const twin = translated[index];
      // The translation is the same table, so its line must repeat the English line's sex tag. A
      // shifted or retagged line is not this name's translation.
      if (twin === undefined || twin.sex !== line.sex) continue;
      const entries = [...(byName.get(line.name) ?? []), { sex: line.sex, text: twin.name }];
      byName.set(line.name, entries);
    }

    let written = 0;
    let fromGlossary = 0;
    for (const pool of pools) {
      const names: Record<string, string> = {};
      for (const name of pool.names) {
        const candidates = byName.get(name);
        const matching =
          pool.sex === 'neutral'
            ? candidates?.[0]
            : (candidates?.find((entry) => entry.sex === pool.sex) ?? soleTranslation(candidates));
        let text = matching?.text;
        if (text === undefined || text === '') {
          text = characters[lang]?.get(name);
          if (text === undefined) continue;
          fromGlossary++;
        }
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
    languages[lang] = { names: written, fromGlossary };
  }
  return { languages };
}
