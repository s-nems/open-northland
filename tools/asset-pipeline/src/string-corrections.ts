import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MAP_TEXT_LANGUAGES } from '@open-northland/data';
import type { MapStringTables } from '@open-northland/map-import';
import { errorMessage } from './errors.js';
import { GUI_LANGS } from './stages/gui/paths.js';
import { EXPORTED_TABLES, OBJECT_HELP_TABLES } from './stages/gui/strings.js';

/** The committed fixes to decoded display strings; this package's AGENTS.md sets the rules. */
export const STRING_CORRECTIONS_FILE = fileURLToPath(
  new URL('../corrections/strings/tables.json', import.meta.url),
);

/** The committed fixes to decoded map strings (`maps/<map>.strings.json`), under the same rules. */
export const MAP_STRING_CORRECTIONS_FILE = fileURLToPath(
  new URL('../corrections/strings/maps.json', import.meta.url),
);

/** One display string replaced while it reads `from`, a phrase of a help text, or a missing map string
 *  added with `from: null`. */
export interface StringCorrection {
  /** The text folder, e.g. `rus`. */
  readonly lang: string;
  /** The table key in `gui/strings/<lang>.json`, a help table's scope, or the map id for a map string. */
  readonly scope: string;
  /** The string id within that table. */
  readonly id: number;
  readonly from: string | null;
  readonly to: string;
  readonly reason: string;
}

/** One pipeline run's string corrections, and which of them the decoded tables took. */
export interface StringCorrections {
  readonly list: readonly StringCorrection[];
  /** `byId` with every correction naming `lang`/`scope` applied where the text still matches. */
  correct(lang: string, scope: string, byId: Readonly<Record<number, string>>): Record<number, string>;
  /** Every correction the tables decoded so far did not take, and why; a run that decoded only part
   *  of the data filters it to the scopes it decoded. */
  unapplied(): readonly UnappliedStringCorrection[];
  /** Throws naming every correction the run did not apply, and why. */
  assertApplied(): void;
}

export interface UnappliedStringCorrection {
  readonly entry: StringCorrection;
  readonly why: string;
}

/** What one corrections file keys its entries by besides `lang` and `id`. */
interface CorrectionKind {
  /** The entry key naming the scope: `table` or `map`. */
  readonly scopeKey: string;
  readonly langs: readonly string[];
  /** Why a scope value is invalid, or undefined when it is valid. */
  checkScope(value: string): string | undefined;
  /** This scope's `from` is a phrase of the text rather than the whole text. */
  isPhrased(scope: string): boolean;
}

const CORRECTABLE_TABLES: readonly string[] = [...EXPORTED_TABLES, ...OBJECT_HELP_TABLES];

const TABLE_KIND: CorrectionKind = {
  scopeKey: 'table',
  langs: GUI_LANGS,
  checkScope: (table) =>
    CORRECTABLE_TABLES.includes(table) ? undefined : `table must be one of ${CORRECTABLE_TABLES.join(', ')}`,
  isPhrased: (table) => (OBJECT_HELP_TABLES as readonly string[]).includes(table),
};

const MAP_KIND: CorrectionKind = {
  scopeKey: 'map',
  langs: MAP_TEXT_LANGUAGES,
  checkScope: (map) => (map.trim() === '' ? 'map must name a map id' : undefined),
  isPhrased: () => false,
};

/** How many times `phrase` occurs in `text`, overlaps included. */
function occurrences(text: string, phrase: string): number {
  let count = 0;
  for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + 1)) count += 1;
  return count;
}

/** Loads the display-table corrections at `path`; a missing file holds none, a malformed one throws. */
export function loadStringCorrections(path: string): Promise<StringCorrections> {
  return loadCorrections(path, TABLE_KIND);
}

/** Loads the map-string corrections at `path`; a missing file holds none, a malformed one throws. */
export function loadMapStringCorrections(path: string): Promise<StringCorrections> {
  return loadCorrections(path, MAP_KIND);
}

/** Map `id`'s decoded tables with every correction naming that map applied. */
export function correctMapStrings(
  corrections: StringCorrections,
  id: string,
  tables: MapStringTables,
): MapStringTables {
  const corrected: MapStringTables = {};
  for (const lang of MAP_TEXT_LANGUAGES) {
    const table = tables[lang];
    if (table !== undefined) corrected[lang] = corrections.correct(lang, id, table);
  }
  return corrected;
}

async function loadCorrections(path: string, kind: CorrectionKind): Promise<StringCorrections> {
  let text: string | undefined;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    text = undefined;
  }
  const list = text === undefined ? [] : parseStringCorrections(path, kind, parseJson(path, text));

  const applied = new Set<StringCorrection>();
  const failures = new Map<StringCorrection, string>();
  const unapplied = (): UnappliedStringCorrection[] =>
    list
      .filter((entry) => !applied.has(entry))
      .map((entry) => ({
        entry,
        why:
          failures.get(entry) ??
          `never read: the data lacks that ${kind.scopeKey} or language, or no stage decodes it`,
      }));
  return {
    list,
    unapplied,
    correct(lang, scope, byId) {
      const corrected: Record<number, string> = { ...byId };
      for (const entry of list) {
        if (entry.lang !== lang || entry.scope !== scope) continue;
        const actual = corrected[entry.id];
        const fixed = kind.isPhrased(scope)
          ? phraseFixed(entry, actual)
          : wholeFixed(entry, actual, Object.hasOwn(byId, entry.id));
        if (typeof fixed === 'string') {
          corrected[entry.id] = fixed;
          applied.add(entry);
        } else {
          applied.delete(entry);
          failures.set(entry, fixed.why);
        }
      }
      return corrected;
    },
    assertApplied() {
      const problems = unapplied().map(
        ({ entry, why }) => `${entry.lang}/${entry.scope}/${entry.id} ${JSON.stringify(entry.from)}: ${why}`,
      );
      if (problems.length > 0) {
        throw new Error(
          `string corrections not applied; update or delete them in ${path}:\n  ${problems.join('\n  ')}`,
        );
      }
    },
  };
}

/** Why an entry does not apply to the text it read. */
interface Refusal {
  readonly why: string;
}

function textChanged(actual: string | undefined): Refusal {
  return {
    why:
      actual === undefined
        ? 'the table has no such id'
        : `the text is now ${JSON.stringify(actual)}; check whether the mod now fixes it`,
  };
}

function wholeFixed(entry: StringCorrection, actual: string | undefined, present: boolean): string | Refusal {
  return (entry.from === null ? !present : actual === entry.from) ? entry.to : textChanged(actual);
}

/** `actual` with the entry's phrase swapped; earlier entries for the id have already changed it. */
function phraseFixed({ from, to }: StringCorrection, actual: string | undefined): string | Refusal {
  if (actual === undefined || from === null) return textChanged(actual);
  const count = occurrences(actual, from);
  if (count === 0) return textChanged(actual);
  if (count > 1) return { why: `the phrase occurs ${count} times in ${JSON.stringify(actual)}` };
  return actual.replace(from, () => to);
}

function parseJson(path: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`string corrections ${path}: ${errorMessage(err)}`);
  }
}

function parseStringCorrections(path: string, kind: CorrectionKind, raw: unknown): StringCorrection[] {
  const fail = (why: string): never => {
    throw new Error(`string corrections ${path}: ${why}`);
  };
  if (!Array.isArray(raw)) return fail('not a JSON array');
  const entryKeys = ['lang', kind.scopeKey, 'id', 'from', 'to', 'reason'];
  const seen = new Set<string>();
  return raw.map((item: unknown, index): StringCorrection => {
    const at = (why: string): never => fail(`entry ${index}: ${why}`);
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return at('not a JSON object');
    const record = item as Record<string, unknown>;
    const unknownKey = Object.keys(record).find((key) => !entryKeys.includes(key));
    if (unknownKey !== undefined) at(`unknown key "${unknownKey}"`);
    const { lang, id, from, to, reason } = record;
    const scope = record[kind.scopeKey];
    if (typeof lang !== 'string' || !kind.langs.includes(lang)) {
      return at(`lang must be one of ${kind.langs.join(', ')}`);
    }
    if (typeof scope !== 'string') return at(`${kind.scopeKey} must be a string`);
    const badScope = kind.checkScope(scope);
    if (badScope !== undefined) at(badScope);
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return at('id must be a string id');
    const addsMapString = kind.scopeKey === 'map' && from === null;
    if ((!addsMapString && typeof from !== 'string') || typeof to !== 'string' || from === to) {
      return at('"from" and "to" must be two different strings');
    }
    if (typeof reason !== 'string' || reason.trim() === '') return at('reason must say why the fix exists');
    const phrased = kind.isPhrased(scope);
    if (phrased && from === '') at('"from" must name a phrase of the text');
    const key = `${lang}/${scope}/${id}`;
    if (!phrased && seen.has(key)) at(`a second entry for ${key}`);
    seen.add(key);
    return { lang, scope, id, from, to, reason };
  });
}
