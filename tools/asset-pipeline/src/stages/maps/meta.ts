import { readFile } from 'node:fs/promises';
import {
  type RuleSection,
  decodeCifStringTable,
  decodeIni,
  extractStringTable,
  parseIniSections,
} from '../../decoders/ini.js';
import { findPathCaseInsensitive } from './case-path.js';

/**
 * The emitted `maps/<id>.meta.json` sidecar: the map's menu-facing display strings, resolved to ONE
 * language (see {@link MAP_TEXT_LANGS}). Written only when the map folder carries a string table.
 */
export interface MapMetaFile {
  /** The map's display name (the string at the header's `mapnamestringid`). */
  readonly name?: string;
  /** The map's flavor/mission description (the string at `mapdescriptionstringid`). */
  readonly description?: string;
}

/**
 * Language preference for the emitted {@link MapMetaFile} (the menu shows ONE language): the
 * culturesnation mod is Polish-authored, so `pol` first, `eng` as the fallback.
 */
const MAP_TEXT_LANGS = ['pol', 'eng'] as const;

/**
 * String-table ids of the map name/description when NO header names them (no readable `misc.inc`/
 * `map.ini` and no `map.cif`). Source basis: observed — 87 of the 113 readable `[misc_mapname]`
 * headers in the owned copy say `0`/`1`; the rest override (24× `99`/`98`, 1× `40`/`41`, plus the
 * tutorial/military `map.cif`s at `99`/`98`), which is why the header is consulted first.
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
 * in three forms; per golden rule #4 the READABLE ones win: the split `misc.inc` (111 of the owned
 * copy's map folders), the monolithic `map.ini` (2 folders, e.g. `oasis_o_plenty`), then the encrypted
 * `map.cif`'s sections (the tutorial/military maps are `.cif`-only — pass the already-decoded sections
 * in; this module never re-decodes the cif). A map with no header at all keeps the observed
 * {@link DEFAULT_NAME_STRING_ID}/{@link DEFAULT_DESCRIPTION_STRING_ID}. Name and description ids
 * resolve independently, first source naming each wins.
 */
async function resolveMapNameStringIds(
  mapDir: string,
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
    const path = await findPathCaseInsensitive(mapDir, [file]);
    if (path === null) continue;
    try {
      consider(parseIniSections(decodeIni(await readFile(path))));
    } catch (err) {
      console.warn(`[pipeline] map ${rel}: ${file} unreadable: ${(err as Error).message}`);
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
 * trying each {@link MAP_TEXT_LANGS} language in order. Per language the readable `strings.ini` is
 * preferred (golden rule #4; {@link decodeIni} already yields CP1250 text) over the encrypted
 * `strings.cif` twin ({@link decodeCifStringTable}) — e.g. the tutorial maps ship `.cif`-only. Paths
 * resolve case-insensitively ({@link findPathCaseInsensitive}); a missing file is normal absence, an
 * unreadable one warns and falls through, and an empty table falls through to the next form/language.
 * Returns undefined when no language yields strings — the caller then emits no meta sidecar (the menu
 * card degrades).
 */
async function loadMapStringTable(mapDir: string, rel: string): Promise<Record<number, string> | undefined> {
  for (const lang of MAP_TEXT_LANGS) {
    for (const form of ['strings.ini', 'strings.cif'] as const) {
      const path = await findPathCaseInsensitive(mapDir, ['text', lang, form]);
      if (path === null) continue;
      let table: Record<number, string>;
      try {
        const bytes = await readFile(path);
        table =
          form === 'strings.ini'
            ? extractStringTable(parseIniSections(decodeIni(bytes)))
            : decodeCifStringTable(bytes);
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: text/${lang}/${form} undecodable: ${(err as Error).message}`);
        continue;
      }
      if (Object.keys(table).length > 0) return table;
    }
  }
  return undefined;
}

/**
 * Resolves one map folder's {@link MapMetaFile}: the header's string ids ({@link resolveMapNameStringIds})
 * looked up in the folder's string table ({@link loadMapStringTable}). Returns undefined when neither a
 * name nor a description resolves (no text, or the table lacks the header's ids) — the caller then emits
 * no sidecar. `cifSections` is the already-decoded sibling `map.cif` (or undefined), passed in so the
 * cif is decoded once per map, by the caller that also needs its entity layer.
 */
export async function resolveMapMeta(
  mapDir: string,
  rel: string,
  cifSections: readonly RuleSection[] | undefined,
): Promise<MapMetaFile | undefined> {
  const strings = await loadMapStringTable(mapDir, rel);
  if (strings === undefined) return undefined;
  const { nameStringId, descriptionStringId } = await resolveMapNameStringIds(mapDir, rel, cifSections);
  const name = strings[nameStringId];
  const description = strings[descriptionStringId];
  if (name === undefined && description === undefined) return undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}
