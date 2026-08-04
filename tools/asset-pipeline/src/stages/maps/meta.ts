import { readFile } from 'node:fs/promises';
import {
  decodeCifStringTable,
  extractStringTable,
  iniBytesToSections,
  type RuleSection,
} from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitiveInDirs } from '../../roots.js';
import { STRING_TABLE_DIR } from './info.js';

/** The emitted `maps/<id>.meta.json` sidecar: the map's menu-facing display strings, one language. */
export interface MapMetaFile {
  /** The map's display name (the string at the header's `mapnamestringid`). */
  readonly name?: string;
  /** The map's flavor/mission description (the string at `mapdescriptionstringid`). */
  readonly description?: string;
}

/** The menu shows one language, and the culturesnation mod is Polish-authored, so `pol` wins. */
const MAP_TEXT_LANGS = ['pol', 'eng'] as const;

/**
 * String-table ids of the map name/description when no header names them. Source basis: observed -
 * most readable `[misc_mapname]` headers say `0`/`1`, and the overriding minority is why the header
 * is consulted first.
 */
const DEFAULT_NAME_STRING_ID = 0;
const DEFAULT_DESCRIPTION_STRING_ID = 1;

/** The resolved `[misc_mapname]` header: which string-table ids carry the map's name/description. */
interface MapNameStringIds {
  readonly nameStringId: number;
  readonly descriptionStringId: number;
}

/** Reads one int off a `[misc_mapname]` section prop, or undefined when absent/malformed. */
function sectionInt(sections: readonly RuleSection[], key: string): number | undefined {
  const section = sections.find((s) => s.name === 'misc_mapname');
  const raw = section?.props.find((p) => p.key === key)?.values[0];
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Resolves which string-table ids carry the map's name/description. The `[misc_mapname]` header ships
 * in three forms and the readable ones win: the split `misc.inc`, the monolithic `map.ini`, then the
 * encrypted `map.cif`'s sections, passed in already decoded so this module never re-decodes the cif.
 */
async function resolveMapNameStringIds(
  mapDirs: readonly string[],
  rel: string,
  cifSections: readonly RuleSection[] | undefined,
): Promise<MapNameStringIds> {
  let nameStringId: number | undefined;
  let descriptionStringId: number | undefined;
  const consider = (sections: readonly RuleSection[]): void => {
    nameStringId ??= sectionInt(sections, 'mapnamestringid');
    descriptionStringId ??= sectionInt(sections, 'mapdescriptionstringid');
  };
  for (const file of ['misc.inc', 'map.ini']) {
    if (nameStringId !== undefined && descriptionStringId !== undefined) break;
    const path = await findPathCaseInsensitiveInDirs(mapDirs, [file]);
    if (path === undefined) continue;
    try {
      consider(iniBytesToSections(await readFile(path)));
    } catch (err) {
      console.warn(`[pipeline] map ${rel}: ${file} unreadable: ${errorMessage(err)}`);
    }
  }
  if (cifSections !== undefined) consider(cifSections);
  return {
    nameStringId: nameStringId ?? DEFAULT_NAME_STRING_ID,
    descriptionStringId: descriptionStringId ?? DEFAULT_DESCRIPTION_STRING_ID,
  };
}

/**
 * Loads one map folder's string table (`<mapDir>/text/<lang>/strings.*`) as `{ <stringId>: <text> }`,
 * preferring the readable `strings.ini` over its encrypted `strings.cif` twin per language. An
 * unreadable or empty table falls through to the next form, then the next language.
 */
export async function loadMapStringTable(
  mapDirs: readonly string[],
  rel: string,
): Promise<Record<number, string> | undefined> {
  for (const lang of MAP_TEXT_LANGS) {
    for (const form of ['strings.ini', 'strings.cif'] as const) {
      const path = await findPathCaseInsensitiveInDirs(mapDirs, [STRING_TABLE_DIR, lang, form]);
      if (path === undefined) continue;
      let table: Record<number, string>;
      try {
        const bytes = await readFile(path);
        table =
          form === 'strings.ini'
            ? extractStringTable(iniBytesToSections(bytes))
            : decodeCifStringTable(bytes);
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: text/${lang}/${form} undecodable: ${errorMessage(err)}`);
        continue;
      }
      if (Object.keys(table).length > 0) return table;
    }
  }
  return undefined;
}

/**
 * Resolves one map folder's display strings: the `[misc_mapname]` header's ids looked up in the
 * folder's string table. Returns undefined when neither a name nor a description resolves.
 * `cifSections` and `strings` come from the caller so each map decodes its cif and loads its table
 * once.
 */
export async function resolveMapMeta(
  mapDirs: readonly string[],
  rel: string,
  cifSections: readonly RuleSection[] | undefined,
  strings?: Record<number, string>,
): Promise<MapMetaFile | undefined> {
  strings ??= await loadMapStringTable(mapDirs, rel);
  if (strings === undefined) return undefined;
  const { nameStringId, descriptionStringId } = await resolveMapNameStringIds(mapDirs, rel, cifSections);
  const name = strings[nameStringId];
  const description = strings[descriptionStringId];
  if (name === undefined && description === undefined) return undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}
