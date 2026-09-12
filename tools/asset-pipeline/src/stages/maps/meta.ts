import { MAP_TEXT_LANGUAGES, type MapMeta, type MapTextLanguage } from '@open-northland/data';
import type { Vfs } from '@open-northland/vfs';
import {
  decodeCifStringTable,
  extractMapTypes,
  extractMusicType,
  extractStringTable,
  iniBytesToSections,
  type MapTypeHeader,
  parseIniSections,
  type RuleSection,
} from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitiveInDirs } from '../../roots.js';
import { STRING_TABLE_DIR } from './info.js';

/** The emitted `maps/<id>.meta.json` sidecar: the map's menu-facing strings and music binding. */
export type MapMetaFile = MapMeta;

/** One map folder's string tables, keyed by the language subfolder they were read from. */
export type MapStringTables = Partial<Record<MapTextLanguage, Record<number, string>>>;

/**
 * String-table ids of the map name/description when no header names them. Source basis: observed -
 * most readable `[misc_mapname]` headers say `0`/`1`, and the overriding minority is why the header
 * is consulted first.
 */
const DEFAULT_NAME_STRING_ID = 0;
const DEFAULT_DESCRIPTION_STRING_ID = 1;

/** The resolved map header: name/description string-table ids, the `[misc_music]` code and the
 *  `[misc_maptype]` listing. */
interface MapHeader {
  readonly nameStringId: number;
  readonly descriptionStringId: number;
  readonly musicType?: number;
  readonly mapTypes?: MapTypeHeader;
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
 * Resolves the map's `[misc_mapname]` string ids, `[misc_music]` code and `[misc_maptype]` listing.
 * The headers ship in three forms and the readable ones win: the split `misc.inc`, the monolithic
 * `map.ini`, then the encrypted `map.cif`'s sections, passed in already decoded so this module never
 * re-decodes the cif.
 */
async function resolveMapHeader(
  fs: Vfs,
  mapDirs: readonly string[],
  rel: string,
  cifSections: readonly RuleSection[] | undefined,
): Promise<MapHeader> {
  let nameStringId: number | undefined;
  let descriptionStringId: number | undefined;
  let musicType: number | undefined;
  let mapTypes: MapTypeHeader | undefined;
  const consider = (sections: readonly RuleSection[]): void => {
    nameStringId ??= sectionInt(sections, 'mapnamestringid');
    descriptionStringId ??= sectionInt(sections, 'mapdescriptionstringid');
    musicType ??= extractMusicType(sections);
    mapTypes ??= extractMapTypes(sections);
  };
  for (const file of ['misc.inc', 'map.ini']) {
    if (
      nameStringId !== undefined &&
      descriptionStringId !== undefined &&
      musicType !== undefined &&
      mapTypes !== undefined
    )
      break;
    const path = await findPathCaseInsensitiveInDirs(fs, mapDirs, [file]);
    if (path === undefined) continue;
    try {
      consider(iniBytesToSections(await fs.readFile(path)));
    } catch (err) {
      console.warn(`[pipeline] map ${rel}: ${file} unreadable: ${errorMessage(err)}`);
    }
  }
  if (cifSections !== undefined) consider(cifSections);
  return {
    nameStringId: nameStringId ?? DEFAULT_NAME_STRING_ID,
    descriptionStringId: descriptionStringId ?? DEFAULT_DESCRIPTION_STRING_ID,
    ...(musicType !== undefined ? { musicType } : {}),
    ...(mapTypes !== undefined ? { mapTypes } : {}),
  };
}

/**
 * Loads every language a map folder ships (`<mapDir>/text/<lang>/strings.*`) as
 * `{ <stringId>: <text> }`, preferring the readable `strings.ini` over its encrypted `strings.cif`
 * twin. An unreadable or empty table falls through to the next form, then the next language.
 */
export async function loadMapStringTables(
  fs: Vfs,
  mapDirs: readonly string[],
  rel: string,
): Promise<MapStringTables> {
  const tables: MapStringTables = {};
  for (const lang of MAP_TEXT_LANGUAGES) {
    for (const form of ['strings.ini', 'strings.cif'] as const) {
      const path = await findPathCaseInsensitiveInDirs(fs, mapDirs, [STRING_TABLE_DIR, lang, form]);
      if (path === undefined) continue;
      let table: Record<number, string>;
      try {
        const bytes = await fs.readFile(path);
        // Owned text/rus/strings.ini uses CP1251 (e.g. CD CE C2 C0 DF spells НОВАЯ).
        const encoding = lang === 'rus' ? 'windows-1251' : 'windows-1250';
        table =
          form === 'strings.ini'
            ? extractStringTable(parseIniSections(new TextDecoder(encoding).decode(bytes)))
            : decodeCifStringTable(bytes, encoding);
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: text/${lang}/${form} undecodable: ${errorMessage(err)}`);
        continue;
      }
      if (Object.keys(table).length > 0) {
        tables[lang] = table;
        break;
      }
    }
  }
  return tables;
}

/** The table the map's own menu strings and mission texts resolve through: the first language the
 *  folder ships, in {@link MAP_TEXT_LANGUAGES} preference order. */
export function preferredStringTable(tables: MapStringTables): Record<number, string> | undefined {
  for (const lang of MAP_TEXT_LANGUAGES) {
    const table = tables[lang];
    if (table !== undefined) return table;
  }
  return undefined;
}

/**
 * Resolves one map folder's meta sidecar: the `[misc_mapname]` header's ids looked up in the folder's
 * string table, the `[misc_music]` code and the `[misc_maptype]` listing. Returns undefined when
 * nothing resolves. `cifSections` and `strings` come from the caller so each map decodes its cif and
 * loads its table once.
 */
export async function resolveMapMeta(
  fs: Vfs,
  mapDirs: readonly string[],
  rel: string,
  cifSections: readonly RuleSection[] | undefined,
  strings?: Record<number, string>,
): Promise<MapMetaFile | undefined> {
  strings ??= preferredStringTable(await loadMapStringTables(fs, mapDirs, rel));
  const { nameStringId, descriptionStringId, musicType, mapTypes } = await resolveMapHeader(
    fs,
    mapDirs,
    rel,
    cifSections,
  );
  const name = strings?.[nameStringId];
  const description = strings?.[descriptionStringId];
  const listing =
    mapTypes !== undefined &&
    (mapTypes.types.length > 0 || mapTypes.multiplayerOnly || mapTypes.campaign !== undefined);
  if (name === undefined && description === undefined && musicType === undefined && !listing)
    return undefined;
  return {
    ...(mapTypes?.campaign === undefined ? {} : { campaign: mapTypes.campaign }),
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(musicType !== undefined ? { musicType } : {}),
    ...(mapTypes === undefined || mapTypes.types.length === 0 ? {} : { mapTypes: [...mapTypes.types] }),
    ...(mapTypes?.multiplayerOnly ? { multiplayerOnly: true } : {}),
  };
}
