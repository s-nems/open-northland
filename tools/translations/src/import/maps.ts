import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MapOverlay, mapOverlayFileId, OVERLAY_VERSION } from '@open-northland/data';
import { type MapLanguageText, mapSourceTextDigest } from '@open-northland/map-import';
import type { PackMap } from '../pack-text.js';
import {
  BASIS_LANGUAGE,
  LOCALIZATION_LANGUAGES,
  LOCALIZATION_SOURCES,
  type LocalizationLanguage,
} from './columns.js';
import { correctedMapKeys, type GermanCorrections } from './corrected-keys.js';
import { type GermanRoundTrip, germanRoundTrip, translateMap } from './map-translation.js';
import { type LocalizationMap, readLocalizationMap } from './map-xml.js';

const MAP_XML_DIR = ['Localization', 'map_xml'] as const;
const XML_FILE = /\.xml$/i;

/** One overlay file the import writes, by its path under the translations directory. */
export interface OverlayFile {
  readonly path: string;
  readonly value: unknown;
}

export interface MapLanguageResult {
  readonly strings: number;
  readonly blocks: number;
  readonly unknown: readonly string[];
  readonly markupMismatches: readonly string[];
  readonly retagged: readonly string[];
  readonly unframed: readonly string[];
  /** Written keys whose German our corrections change, so the translation follows the original. */
  readonly corrected: readonly string[];
}

/** One pack map the import matched, with the XML it took the text from. */
export interface MatchedMap {
  readonly map: PackMap;
  readonly xml: string;
  /** Other pack folders shipping the same `map.dat` and German text, which the overlay serves as well. */
  readonly aliases: readonly string[];
  /** Other pack folders shipping the same `map.dat` with other German text: the overlay reaches them as
   *  a stale fallback until each has a variant of its own. */
  readonly twins: readonly string[];
  /** XMLs that matched the same `map.dat` but whose German column fits our text less well. */
  readonly passedOver: readonly string[];
  readonly roundTrip: GermanRoundTrip;
  readonly languages: Readonly<Partial<Record<LocalizationLanguage, MapLanguageResult>>>;
}

export interface MapImport {
  readonly xmlCount: number;
  readonly matched: readonly MatchedMap[];
  readonly unmatched: readonly string[];
  readonly deprecated: readonly string[];
  /** Matched maps our pack ships without German text, which the overlays are written against. */
  readonly withoutBasis: readonly string[];
  readonly files: readonly OverlayFile[];
}

/** How well an XML's German column fits our text: the more equal strings and blocks, the better. */
function fit(roundTrip: GermanRoundTrip): number {
  return roundTrip.strings.equal + roundTrip.blocks.normalized;
}

async function readXmls(source: string): Promise<Map<string, LocalizationMap>> {
  const dir = join(source, ...MAP_XML_DIR);
  const names = (await readdir(dir)).filter((name) => XML_FILE.test(name)).sort();
  const xmls = new Map<string, LocalizationMap>();
  for (const name of names) {
    try {
      xmls.set(name, readLocalizationMap(await readFile(join(dir, name), 'utf8')));
    } catch (err) {
      throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return xmls;
}

/** One matched pack map with our German text and the corrections that change it. */
interface Target {
  readonly map: PackMap;
  readonly basis: MapLanguageText;
  readonly digest: string;
  readonly corrections: GermanCorrections;
}

/** The basis digest of `text` in the basis language. */
const basisDigest = (text: MapLanguageText): string => mapSourceTextDigest(text.strings, text.briefings);

function translateLanguage(
  xml: LocalizationMap,
  lang: LocalizationLanguage,
  { map, basis, digest, corrections }: Target,
): { readonly result: MapLanguageResult; readonly file?: OverlayFile } {
  const translation = translateMap(xml, LOCALIZATION_SOURCES[lang].column, basis);
  const result: MapLanguageResult = {
    strings: Object.keys(translation.strings).length,
    blocks: Object.keys(translation.briefings).length,
    unknown: translation.unknown,
    markupMismatches: translation.markupMismatches,
    retagged: translation.retagged,
    unframed: translation.unframed,
    corrected: correctedMapKeys(corrections, map, { text: basis, digest }, translation),
  };
  if (result.strings + result.blocks === 0) return { result };
  const overlay = MapOverlay.parse({
    version: OVERLAY_VERSION,
    map: map.id,
    basis: { lang: BASIS_LANGUAGE, digest },
    strings: translation.strings,
    briefings: translation.briefings,
  });
  return {
    result,
    file: { path: `${lang}/maps/${mapOverlayFileId(map.id, map.text.datDigest)}.json`, value: overlay },
  };
}

/**
 * Matches every map XML to the pack's maps by `map.dat` MD5 and turns each match into one map overlay
 * per overlay language, named by the `map.dat` SHA-256. When several XMLs match one `map.dat`, the one
 * whose German column fits our German text best is taken. When several pack maps ship that `map.dat`,
 * the overlay is written against the first one's German text, a campaign map's before a base map's:
 * the upstream has one text per map and translates the original campaigns.
 */
export async function importMaps(
  source: string,
  packMaps: ReadonlyMap<string, readonly PackMap[]>,
  corrections: GermanCorrections,
): Promise<MapImport> {
  const xmls = await readXmls(source);
  const all = [...packMaps.values()].flat();
  const campaignFirst = [
    ...all.filter((map) => map.campaign !== undefined),
    ...all.filter((map) => map.campaign === undefined),
  ];
  const byMd5 = new Map<string, readonly PackMap[]>();
  for (const map of campaignFirst) byMd5.set(map.datMd5, [...(byMd5.get(map.datMd5) ?? []), map]);

  const unmatched: string[] = [];
  const deprecated: string[] = [];
  const candidates = new Map<
    string,
    { readonly maps: readonly PackMap[]; readonly xmls: { name: string; xml: LocalizationMap }[] }
  >();
  for (const [name, xml] of xmls) {
    if (xml.deprecated) {
      deprecated.push(name);
      continue;
    }
    const maps = byMd5.get(xml.mapMd5);
    if (maps === undefined) {
      unmatched.push(name);
      continue;
    }
    const entry = candidates.get(xml.mapMd5) ?? { maps, xmls: [] };
    entry.xmls.push({ name, xml });
    candidates.set(xml.mapMd5, entry);
  }

  const matched: MatchedMap[] = [];
  const withoutBasis: string[] = [];
  const files: OverlayFile[] = [];
  for (const candidate of candidates.values()) {
    const [map, ...copies] = candidate.maps;
    if (map === undefined) continue;
    const basis = map.text.languages[BASIS_LANGUAGE];
    if (basis === undefined) {
      withoutBasis.push(`${map.id} (${candidate.xmls.map(({ name }) => name).join(', ')})`);
      continue;
    }
    const ranked = candidate.xmls
      .map(({ name, xml }) => ({ name, xml, roundTrip: germanRoundTrip(xml, basis) }))
      .sort((a, b) => fit(b.roundTrip) - fit(a.roundTrip));
    const [best, ...others] = ranked;
    if (best === undefined) continue;
    const digest = basisDigest(basis);
    const aliases: string[] = [];
    const twins: string[] = [];
    for (const copy of copies) {
      const text = copy.text.languages[BASIS_LANGUAGE];
      (text !== undefined && basisDigest(text) === digest ? aliases : twins).push(copy.id);
    }
    const languages: Partial<Record<LocalizationLanguage, MapLanguageResult>> = {};
    for (const lang of LOCALIZATION_LANGUAGES) {
      const { result, file } = translateLanguage(best.xml, lang, { map, basis, digest, corrections });
      languages[lang] = result;
      if (file !== undefined) files.push(file);
    }
    matched.push({
      map,
      xml: best.name,
      aliases,
      twins,
      passedOver: others.map((other) => other.name),
      roundTrip: best.roundTrip,
      languages,
    });
  }
  return { xmlCount: xmls.size, matched, unmatched, deprecated, withoutBasis, files };
}
