import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GAME_OBJECT_TABLES,
  type GameObjectTable,
  HISTORY_BOOK,
} from '@open-northland/asset-pipeline/sources';
import {
  BookOverlay,
  ObjectTableOverlay,
  OVERLAY_LANGUAGES,
  OVERLAY_VERSION,
  type OverlayLanguage,
} from '@open-northland/data';
import {
  type BookBlocks,
  bookSourceDigest,
  objectTableSourceDigest,
  type PackText,
  readPackText,
} from '../pack-text.js';
import { readLocalizedBook, translateBook } from './books.js';
import { BASIS_LANGUAGE, LOCALIZATION_SOURCES } from './columns.js';
import { type GermanCorrections, readGermanCorrections } from './corrected-keys.js';
import { formatCsv, glossaryFromLanguageUnion } from './glossary.js';
import { normalizeWhitespace } from './map-xml.js';
import { importMaps, type MapImport, type OverlayFile } from './maps.js';
import { driftedIds, readLocalizedObjectTable, translateObjectNames } from './object-tables.js';
import { importPersonalNames, type PersonalNameResult } from './personal-names.js';

const TEXT_DIR = ['Localization', 'text'] as const;
const GLOSSARY_SOURCE = 'language_union.csv';
/** The import's own term table, rewritten whole by each run. */
export const GLOSSARY_FILE = 'glossary.csv';
/** The project's terms, beside the import's and never written by it. */
export const PROJECT_GLOSSARY_FILE = 'glossary-project.csv';

export interface ImportOptions {
  /** A CulturesGameLocalization checkout. */
  readonly source: string;
  /** The unpacked data pack. */
  readonly dataRoot: string;
  /** The asset pipeline's corrections folder, whose German fixes the report names. */
  readonly corrections: string;
  /** The translations folder, whose German map overlays the report names like corrections. */
  readonly translations: string;
}

/** How many of the localization's German entries equal ours, of the keys both carry. */
export interface Alignment {
  readonly total: number;
  readonly equal: number;
}

export interface TableResult {
  readonly table: string;
  /** Type ids whose German name differs between the localization's table and ours, left out. */
  readonly drifted: readonly string[];
  /** Written type ids whose German our corrections change, so the translation follows the original. */
  readonly corrected: readonly string[];
  readonly languages: Readonly<
    Partial<Record<OverlayLanguage, { names: number; plurals: number; unknown: number }>>
  >;
}

export interface BookResult {
  readonly alignment: Alignment;
  readonly languages: Readonly<
    Partial<Record<OverlayLanguage, { blocks: number; unknown: readonly string[] }>>
  >;
}

export interface ImportResult {
  readonly maps: MapImport;
  readonly tables: readonly TableResult[];
  readonly book?: BookResult;
  readonly personalNames: PersonalNameResult;
  readonly glossaryTerms: number;
  readonly files: readonly OverlayFile[];
  readonly glossary: string;
}

async function importTable(
  textRoot: string,
  pack: PackText,
  table: GameObjectTable,
  corrections: GermanCorrections,
  files: OverlayFile[],
): Promise<TableResult> {
  const basis = await pack.objectNames(BASIS_LANGUAGE, table);
  const theirGerman = await readLocalizedObjectTable(textRoot, BASIS_LANGUAGE, table);
  const drifted = theirGerman === undefined ? [] : driftedIds(basis, theirGerman);
  const digest = objectTableSourceDigest(basis);
  const languages: Partial<Record<OverlayLanguage, { names: number; plurals: number; unknown: number }>> = {};
  const corrected = new Set<string>();
  for (const lang of OVERLAY_LANGUAGES) {
    const translated = await readLocalizedObjectTable(textRoot, LOCALIZATION_SOURCES[lang].textFolder, table);
    if (translated === undefined) continue;
    const { names, plurals, unknown } = translateObjectNames(translated, basis, drifted);
    for (const id of corrections.tables.get(table) ?? [])
      if (names[id] !== undefined || plurals[id] !== undefined) corrected.add(id);
    languages[lang] = { names: Object.keys(names).length, plurals: Object.keys(plurals).length, unknown };
    if (Object.keys(names).length + Object.keys(plurals).length === 0) continue;
    const overlay = ObjectTableOverlay.parse({
      version: OVERLAY_VERSION,
      basis: { lang: BASIS_LANGUAGE, digest },
      names,
      plurals,
    });
    files.push({ path: `${lang}/objects/${table}.json`, value: overlay });
  }
  return { table, drifted, corrected: [...corrected].sort((a, b) => Number(a) - Number(b)), languages };
}

/** How many of the localization's German blocks equal ours once whitespace is normalised. */
function bookAlignment(ours: BookBlocks, theirs: BookBlocks | undefined): Alignment {
  let total = 0;
  let equal = 0;
  for (const [file, labels] of theirs ?? []) {
    for (const [label, body] of labels) {
      const our = ours.get(file)?.get(label);
      if (our === undefined) continue;
      total++;
      if (normalizeWhitespace(our) === normalizeWhitespace(body)) equal++;
    }
  }
  return { total, equal };
}

async function importBook(
  textRoot: string,
  pack: PackText,
  files: OverlayFile[],
): Promise<BookResult | undefined> {
  const basis = await pack.historyBlocks(BASIS_LANGUAGE);
  if (basis === undefined) return undefined;
  const alignment = bookAlignment(basis, await readLocalizedBook(textRoot, BASIS_LANGUAGE, HISTORY_BOOK));
  const digest = bookSourceDigest(basis);
  const languages: Partial<Record<OverlayLanguage, { blocks: number; unknown: readonly string[] }>> = {};
  for (const lang of OVERLAY_LANGUAGES) {
    const translated = await readLocalizedBook(textRoot, LOCALIZATION_SOURCES[lang].textFolder, HISTORY_BOOK);
    if (translated === undefined) continue;
    const { blocks, unknown } = translateBook(translated, basis);
    const count = Object.values(blocks).reduce((sum, labels) => sum + Object.keys(labels).length, 0);
    languages[lang] = { blocks: count, unknown };
    if (count === 0) continue;
    const overlay = BookOverlay.parse({
      version: OVERLAY_VERSION,
      basis: { lang: BASIS_LANGUAGE, digest },
      blocks,
    });
    files.push({ path: `${lang}/books/${HISTORY_BOOK}.json`, value: overlay });
  }
  return { alignment, languages };
}

/**
 * Converts a CulturesGameLocalization checkout into overlay files against the pack's German text:
 * map overlays, the game-object name tables, the history book and the glossary. A pack without a
 * readable German object table fails the run, since every table overlay is written against one.
 */
export async function importCulturesLocalization(options: ImportOptions): Promise<ImportResult> {
  const textRoot = join(options.source, ...TEXT_DIR);
  const pack = await readPackText(options.dataRoot);
  const corrections = await readGermanCorrections(options.corrections, options.translations);
  const maps = await importMaps(options.source, await pack.maps(), corrections);
  const files: OverlayFile[] = [...maps.files];
  const tables: TableResult[] = [];
  for (const table of GAME_OBJECT_TABLES)
    tables.push(await importTable(textRoot, pack, table, corrections, files));
  const book = await importBook(textRoot, pack, files);
  const glossaryRows = glossaryFromLanguageUnion(
    await readFile(join(options.source, GLOSSARY_SOURCE), 'utf8'),
  );
  const personalNames = await importPersonalNames(textRoot, files);
  return {
    maps,
    tables,
    ...(book === undefined ? {} : { book }),
    personalNames,
    glossaryTerms: glossaryRows.length - 1,
    files,
    glossary: formatCsv(glossaryRows),
  };
}
