import {
  type FiledObjectTableOverlay,
  isSourceLanguage,
  type Language,
  type ObjectTableOverlay,
  objectTableSourceDigest,
  type PersonalNameOverlay,
} from '@open-northland/data';
import {
  cifBytesToSections,
  decodeCifStringTable,
  decodeDisplayText,
  decodeIni,
  extractStringnNames,
  parseIniSections,
  type RuleSection,
} from '@open-northland/formats/ini';
import { textEncoding } from '@open-northland/formats/text-encoding';
import { errorMessage } from '../../errors.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { readShippedSourceFile } from '../source-files.js';
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
 * object's type id in `stringn <typeId> "<singular>"`. Every table but `experiences` follows each with a
 * bare `string` plural.
 */
export const GAME_OBJECT_TABLES = ['goods', 'houses', 'jobs', 'experiences', 'tribes'] as const;

/** The game-object tables whose plurals are exported too, each beside its singulars under this key. */
const PLURAL_TABLES: Readonly<Partial<Record<(typeof GAME_OBJECT_TABLES)[number], string>>> = {
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
  return { [table]: decodeCifStringTable(await readShippedSourceFile(roots, rel), textEncoding(lang)) };
}

/** Some shipped names carry a trailing space or a doubled one, which no label wants. */
function normalizeName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizedNames(table: Readonly<StringTable>): StringTable {
  return Object.fromEntries(Object.entries(table).map(([id, text]) => [Number(id), normalizeName(text)]));
}

export type GameObjectTable = (typeof GAME_OBJECT_TABLES)[number];

/** One game-object table as the language ships it: names and plurals by type id, decoded, not normalised. */
export interface GameObjectNames {
  readonly names: StringTable;
  readonly plurals: StringTable;
}

const decodedNames = (table: StringTable, decode: (text: string) => string): StringTable =>
  Object.fromEntries(Object.entries(table).map(([id, text]) => [Number(id), decode(text)]));

/** Reads the readable `.ini` when the language ships one (Polish, some English and German tables),
 *  else the encrypted `.cif`. */
export async function readGameObjectNames(
  roots: SourceRoots,
  lang: string,
  table: GameObjectTable,
): Promise<GameObjectNames> {
  const stem = `Data/text/${lang}/strings/gameobjects/${table}`;
  const encoding = textEncoding(lang);
  let sections: RuleSection[];
  let decode: (text: string) => string;
  if ((await resolveSourceFile(roots, `${stem}.ini`)) !== undefined) {
    sections = parseIniSections(decodeIni(await readShippedSourceFile(roots, `${stem}.ini`), encoding));
    decode = (text) => text;
  } else {
    sections = cifBytesToSections(await readShippedSourceFile(roots, `${stem}.cif`));
    decode = (text) => decodeDisplayText(text, encoding);
  }
  const { singular, plural } = extractStringnNames(sections);
  return { names: decodedNames(singular, decode), plurals: decodedNames(plural, decode) };
}

/** One game-object table's names, and its plurals where {@link PLURAL_TABLES} exports them, normalised. */
function exportedNames(table: GameObjectTable, { names, plurals }: GameObjectNames): DecodedTables {
  const pluralKey = PLURAL_TABLES[table];
  return {
    [table]: normalizedNames(names),
    ...(pluralKey === undefined ? {} : { [pluralKey]: normalizedNames(plurals) }),
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
    read: async (roots: SourceRoots, lang: string) =>
      exportedNames(table, await readGameObjectNames(roots, lang, table)),
  })),
];

/**
 * Decodes each language's {@link STRING_TABLES} and {@link GAME_OBJECT_TABLES} (with the
 * {@link PLURAL_TABLES}) into one
 * `content/gui/strings/<lang>.json` of `{ <table>: { <stringId>: <displayText> } }`, with the string
 * corrections applied. A missing table is absent from that language's JSON, and a language with no
 * tables at all emits nothing. An overlay language's object-table overlays become its own JSON.
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
  for (const [lang, overlays] of roots.overlays?.objects ?? []) {
    const written = await writeObjectOverlays(roots, outDir, lang, overlays);
    if (written !== undefined) done.push(written);
  }
  for (const [lang, overlays] of roots.overlays?.names ?? []) {
    const written = await writePersonalNameOverlays(outDir, lang, overlays);
    if (written !== undefined) done.push(written);
  }
  return done;
}

/** `overlay` with `edit`'s names over its own when the edit's basis is still the shipped table of its
 *  language; otherwise the edit is left out with a warning. */
async function withObjectEdit(
  roots: SourceRoots,
  lang: Language,
  table: GameObjectTable,
  overlay: ObjectTableOverlay,
  edit: ObjectTableOverlay,
): Promise<ObjectTableOverlay> {
  let shipped: GameObjectNames;
  try {
    shipped = await readGameObjectNames({ data: roots.data }, edit.basis.lang, table);
  } catch (err) {
    console.warn(`[pipeline] gui: ${lang} ${table} edit left out: ${errorMessage(err)}`);
    return overlay;
  }
  if (objectTableSourceDigest(shipped) !== edit.basis.digest) {
    console.warn(`[pipeline] gui: ${lang} ${table} edit left out: its ${edit.basis.lang} basis text changed`);
    return overlay;
  }
  return {
    ...overlay,
    names: { ...overlay.names, ...edit.names },
    plurals: { ...overlay.plurals, ...edit.plurals },
  };
}

export const isGameObjectTable = (name: string): name is GameObjectTable =>
  (GAME_OBJECT_TABLES as readonly string[]).includes(name);

/** Writes an overlay language's `gui/strings/<lang>.json` from its object-table overlays, normalised like
 *  the source tables. A source language's object tables keep the corrections, so its overlay is refused. */
async function writeObjectOverlays(
  roots: SourceRoots,
  outDir: string,
  lang: Language,
  overlays: ReadonlyMap<string, FiledObjectTableOverlay>,
): Promise<GuiStringsResult | undefined> {
  if (isSourceLanguage(lang)) {
    console.warn(
      `[pipeline] gui: refused ${lang} object-table overlays: source-language text belongs in corrections`,
    );
    return undefined;
  }
  const tables: DecodedTables = {};
  let stringCount = 0;
  for (const [table, filed] of overlays) {
    if (!isGameObjectTable(table)) {
      console.warn(`[pipeline] gui: ignored ${lang} object-table overlay ${table}: no such table`);
      continue;
    }
    const { edit, ...overlay } = filed;
    const names = edit === undefined ? overlay : await withObjectEdit(roots, lang, table, overlay, edit);
    for (const [key, byId] of Object.entries(exportedNames(table, names))) {
      tables[key] = byId;
      stringCount += Object.keys(byId).length;
    }
  }
  const tableCount = Object.keys(tables).length;
  if (tableCount === 0) return undefined;
  const path = `${GUI_CONTENT_DIR}/strings/${lang}.json`;
  await writeJsonFile(outDir, path, tables);
  return { lang, path, tables: tableCount, strings: stringCount };
}

/**
 * Writes an overlay language's `gui/names/<lang>.json` from its personal-name overlays, as
 * `{ <pool>: { <rawName>: <localizedName> } }`; `tables` counts the pools and `strings` the names. A
 * pool with no entries is left out, so a locale that has translated nothing ships no file and every
 * settler keeps the raw name. A source language's overlays are refused, as the object tables': the
 * pools already spell the source text, so a file repeating it would be a copy of it.
 */
async function writePersonalNameOverlays(
  outDir: string,
  lang: Language,
  overlays: ReadonlyMap<string, PersonalNameOverlay>,
): Promise<GuiStringsResult | undefined> {
  if (isSourceLanguage(lang)) {
    console.warn(
      `[pipeline] gui: refused ${lang} personal-name overlays: source-language text belongs in corrections`,
    );
    return undefined;
  }
  const pools: Record<string, Record<string, string>> = {};
  let stringCount = 0;
  for (const [pool, overlay] of overlays) {
    if (Object.keys(overlay.names).length === 0) continue;
    pools[pool] = overlay.names;
    stringCount += Object.keys(overlay.names).length;
  }
  const poolCount = Object.keys(pools).length;
  if (poolCount === 0) return undefined;
  const path = `${GUI_CONTENT_DIR}/names/${lang}.json`;
  await writeJsonFile(outDir, path, pools);
  return { lang, path, tables: poolCount, strings: stringCount };
}
