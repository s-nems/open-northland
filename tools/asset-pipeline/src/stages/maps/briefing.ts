import type { BriefingParagraph, MapBriefing, MapScript } from '@open-northland/data';
import type { Vfs } from '@open-northland/vfs';
import { parseBriefingBlocks, renderHypertext } from '../../decoders/hypertext.js';
import { decodeIni } from '../../decoders/ini/grammar.js';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitiveInDirs } from '../../roots.js';
import { STRING_TABLE_DIR } from './info.js';

/** Both menu languages, since the mission window follows the app's `?lang=`. */
const BRIEFING_LANGS = ['pol', 'eng'] as const;
const BRIEFINGS_DIR = 'briefings';
const BRIEFINGS_FILE = 'briefings.txt';
/** Ids from here up name a `briefings.txt` block; smaller ids name a `NNNN.hlt` page (observed). */
const FIRST_BLOCK_CUTSCENE_ID = 500;
const HLT_PAGE_DIGITS = 4;
const PLAY_CUTSCENE = 'PlayCutscene';

/** The cutscene ids the map's mission results play, ascending and deduplicated. */
export function cutsceneIdsOf(script: Pick<MapScript, 'missions'>): number[] {
  const ids = new Set<number>();
  for (const mission of script.missions) {
    for (const line of mission.results) {
      if (line.values[0] !== PLAY_CUTSCENE) continue;
      const id = Number.parseInt(line.values[1] ?? '', 10);
      if (Number.isInteger(id) && id >= 0) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Resolves one map folder's briefing sidecar: every cutscene id in `ids` rendered per language from
 * `<mapDir>/text/<lang>/briefings/`. A language folder without the file is skipped, an unreadable page
 * warns and is skipped, and a map resolving no page at all yields undefined.
 */
export async function resolveMapBriefing(
  fs: Vfs,
  mapDirs: readonly string[],
  rel: string,
  ids: readonly number[],
): Promise<MapBriefing | undefined> {
  if (ids.length === 0) return undefined;
  const texts: Record<string, Record<string, BriefingParagraph[]>> = {};
  for (const lang of BRIEFING_LANGS) {
    const pages = await renderLanguage(fs, mapDirs, rel, lang, ids);
    if (pages !== undefined) texts[lang] = pages;
  }
  return Object.keys(texts).length === 0 ? undefined : { texts };
}

async function renderLanguage(
  fs: Vfs,
  mapDirs: readonly string[],
  rel: string,
  lang: string,
  ids: readonly number[],
): Promise<Record<string, BriefingParagraph[]> | undefined> {
  const dir = [STRING_TABLE_DIR, lang, BRIEFINGS_DIR];
  const blocksPath = await findPathCaseInsensitiveInDirs(fs, mapDirs, [...dir, BRIEFINGS_FILE]);
  if (blocksPath === undefined) return undefined;
  let blocks: Map<string, string>;
  try {
    blocks = parseBriefingBlocks(decodeIni(await fs.readFile(blocksPath)));
  } catch (err) {
    console.warn(
      `[pipeline] map ${rel}: text/${lang}/${BRIEFINGS_DIR}/${BRIEFINGS_FILE} unreadable: ${errorMessage(err)}`,
    );
    return undefined;
  }
  const include = (label: string): string | undefined => blocks.get(label);
  const pages: Record<string, BriefingParagraph[]> = {};
  for (const id of ids) {
    let page: string | undefined;
    if (id >= FIRST_BLOCK_CUTSCENE_ID) {
      page = blocks.get(String(id));
    } else {
      const file = `${String(id).padStart(HLT_PAGE_DIGITS, '0')}.hlt`;
      const path = await findPathCaseInsensitiveInDirs(fs, mapDirs, [...dir, file]);
      if (path === undefined) continue;
      try {
        page = decodeIni(await fs.readFile(path));
      } catch (err) {
        console.warn(
          `[pipeline] map ${rel}: text/${lang}/${BRIEFINGS_DIR}/${file} unreadable: ${errorMessage(err)}`,
        );
        continue;
      }
    }
    if (page === undefined) continue;
    const paragraphs = renderHypertext(page, include);
    if (paragraphs.length > 0) pages[String(id)] = paragraphs;
  }
  return Object.keys(pages).length === 0 ? undefined : pages;
}
