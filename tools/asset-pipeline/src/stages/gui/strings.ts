import {
  cifBytesToSections,
  decodeCifStringTable,
  decodeDisplayText,
  decodeIni,
  extractStringnNames,
  parseIniSections,
  type RuleSection,
} from '../../decoders/ini.js';
import { textEncoding } from '../../decoders/text-encoding.js';
import { errorMessage } from '../../errors.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { readSourceFile } from '../source-files.js';
import { GUI_CONTENT_DIR, GUI_LANGS } from './paths.js';

/** The in-game GUI string tables the app reads (files are `ingamegui<table>.cif` under
 *  `Data/text/<lang>/strings/ingamegui/`). The notices are worded by the app catalog, so `messages` is not
 *  among them. */
export const STRING_TABLES = [
  'main',
  'misc',
  'miscwindow',
  'misclogic',
  'humanwindow',
  'humanlistwindow',
  'housewindow',
  'vehiclewindow',
] as const;

/**
 * The game-object name tables (`Data/text/<lang>/strings/gameobjects/<table>.{ini,cif}`), keyed by the
 * object's type id: each `stringn <typeId> "<singular>"` is followed by a bare `string` plural.
 */
export const GAME_OBJECT_TABLES = ['goods', 'houses', 'jobs', 'experiences', 'tribes'] as const;

/** The game-object tables whose plurals are exported too, each beside its singulars under this key. */
export const PLURAL_TABLES: Readonly<Partial<Record<(typeof GAME_OBJECT_TABLES)[number], string>>> = {
  jobs: 'jobsPlural',
};

/** Every table key a language's `gui/strings/<lang>.json` can hold. */
export const EXPORTED_TABLES: readonly string[] = [
  ...STRING_TABLES,
  ...GAME_OBJECT_TABLES,
  ...Object.values(PLURAL_TABLES),
];

export interface GuiStringsResult {
  readonly lang: string;
  /** Path under `content/` (served at `/gui/strings/<lang>.json`). */
  readonly path: string;
  readonly tables: number;
  readonly strings: number;
}

type StringTable = Record<number, string>;
/** The tables one source file yields, by their key in the language's JSON. */
type DecodedTables = Record<string, StringTable>;

async function readGuiTable(roots: SourceRoots, lang: string, table: string): Promise<DecodedTables> {
  const rel = `Data/text/${lang}/strings/ingamegui/ingamegui${table}.cif`;
  return { [table]: decodeCifStringTable(await readSourceFile(roots, rel), textEncoding(lang)) };
}

/** Some shipped names carry a trailing space or a doubled one, which no label wants. */
function normalizeName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizedNames(table: StringTable, decode: (text: string) => string): StringTable {
  return Object.fromEntries(
    Object.entries(table).map(([id, text]) => [Number(id), normalizeName(decode(text))]),
  );
}

/** Reads the readable `.ini` when the language ships one (Polish, some English and German tables),
 *  else the encrypted `.cif`. */
async function readGameObjectTable(
  roots: SourceRoots,
  lang: string,
  table: (typeof GAME_OBJECT_TABLES)[number],
): Promise<DecodedTables> {
  const stem = `Data/text/${lang}/strings/gameobjects/${table}`;
  const encoding = textEncoding(lang);
  let sections: RuleSection[];
  let decode: (text: string) => string;
  if ((await resolveSourceFile(roots, `${stem}.ini`)) !== undefined) {
    sections = parseIniSections(decodeIni(await readSourceFile(roots, `${stem}.ini`), encoding));
    decode = (text) => text;
  } else {
    sections = cifBytesToSections(await readSourceFile(roots, `${stem}.cif`));
    decode = (text) => decodeDisplayText(text, encoding);
  }
  const { singular, plural } = extractStringnNames(sections);
  const pluralKey = PLURAL_TABLES[table];
  return {
    [table]: normalizedNames(singular, decode),
    ...(pluralKey === undefined ? {} : { [pluralKey]: normalizedNames(plural, decode) }),
  };
}

/** Each source table, by its name in the warning a missing one logs. */
const TABLE_READS: readonly {
  readonly table: string;
  readonly read: (roots: SourceRoots, lang: string) => Promise<DecodedTables>;
}[] = [
  ...STRING_TABLES.map((table) => ({
    table,
    read: (roots: SourceRoots, lang: string) => readGuiTable(roots, lang, table),
  })),
  ...GAME_OBJECT_TABLES.map((table) => ({
    table,
    read: (roots: SourceRoots, lang: string) => readGameObjectTable(roots, lang, table),
  })),
];

/**
 * Decodes each language's {@link STRING_TABLES} and {@link GAME_OBJECT_TABLES} (with the
 * {@link PLURAL_TABLES}) into one
 * `content/gui/strings/<lang>.json` of `{ <table>: { <stringId>: <displayText> } }`, with the string
 * corrections applied. A missing table is absent from that language's JSON, and a language with no
 * tables at all emits nothing.
 */
export async function convertGuiStrings(
  roots: SourceRoots,
  outDir: string,
  langs: readonly string[] = GUI_LANGS,
): Promise<GuiStringsResult[]> {
  const done: GuiStringsResult[] = [];
  for (const lang of langs) {
    const tables: Record<string, StringTable> = {};
    let tableCount = 0;
    let stringCount = 0;
    for (const { table, read } of TABLE_READS) {
      let decoded: DecodedTables;
      try {
        decoded = await read(roots, lang);
      } catch (err) {
        console.warn(`[pipeline] gui: skipped strings ${lang}/${table}: ${errorMessage(err)}`);
        continue;
      }
      for (const [key, byId] of Object.entries(decoded)) {
        tables[key] = roots.stringCorrections?.correct(lang, key, byId) ?? byId;
        tableCount++;
        stringCount += Object.keys(byId).length;
      }
    }
    if (tableCount === 0) continue;
    const path = `${GUI_CONTENT_DIR}/strings/${lang}.json`;
    await writeJsonFile(outDir, path, tables);
    done.push({ lang, path, tables: tableCount, strings: stringCount });
  }
  return done;
}
