import type { HypertextBlock, MapBriefing, MapScript } from '@open-northland/data';
import type { Vfs } from '@open-northland/vfs';
import { type IncludeResolver, parseBriefingBlocks, renderHypertext } from '../../decoders/hypertext.js';
import { decodeIni } from '../../decoders/ini/grammar.js';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitive } from '../../roots.js';
import { HYPERTEXT_GRAPHICS_DIR, resolvePagePictures } from '../hypertext-pictures.js';
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
 * `<mapDir>/text/<lang>/briefings/`, with the pictures those pages name emitted under `outDir`. A
 * language folder without the file is skipped, an unreadable page warns and is skipped, and a map
 * resolving no page at all yields undefined.
 */
export async function resolveMapBriefing(
  fs: Vfs,
  mapDir: string,
  outDir: string,
  rel: string,
  ids: readonly number[],
): Promise<MapBriefing | undefined> {
  if (ids.length === 0) return undefined;
  const texts: Record<string, Record<string, HypertextBlock[]>> = {};
  for (const lang of BRIEFING_LANGS) {
    const pages = await renderLanguage(fs, mapDir, outDir, rel, lang, ids);
    if (pages !== undefined) texts[lang] = pages;
  }
  return Object.keys(texts).length === 0 ? undefined : { texts };
}

async function renderLanguage(
  fs: Vfs,
  mapDir: string,
  outDir: string,
  rel: string,
  lang: string,
  ids: readonly number[],
): Promise<Record<string, HypertextBlock[]> | undefined> {
  const dir = [STRING_TABLE_DIR, lang, BRIEFINGS_DIR];
  const blocksPath = await findPathCaseInsensitive(fs, mapDir, [...dir, BRIEFINGS_FILE]);
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
  const include: IncludeResolver = (_file, label) => blocks.get(label);
  const texts = new Map<number, string>();
  for (const id of ids) {
    const page =
      id >= FIRST_BLOCK_CUTSCENE_ID ? blocks.get(String(id)) : await readPage(fs, mapDir, rel, lang, id);
    if (page !== undefined) texts.set(id, page);
  }
  const picture = await resolvePagePictures(
    fs,
    outDir,
    (name) => findPathCaseInsensitive(fs, mapDir, [...dir, HYPERTEXT_GRAPHICS_DIR, name]),
    texts.values(),
    include,
    `map ${rel}`,
  );
  const pages: Record<string, HypertextBlock[]> = {};
  for (const [id, page] of texts) {
    const blocksOfPage = renderHypertext(page, { include, picture });
    if (blocksOfPage.length > 0) pages[String(id)] = blocksOfPage;
  }
  return Object.keys(pages).length === 0 ? undefined : pages;
}

/** One `NNNN.hlt` page's text, or undefined when it is absent or unreadable. */
async function readPage(
  fs: Vfs,
  mapDir: string,
  rel: string,
  lang: string,
  id: number,
): Promise<string | undefined> {
  const file = `${String(id).padStart(HLT_PAGE_DIGITS, '0')}.hlt`;
  const path = await findPathCaseInsensitive(fs, mapDir, [STRING_TABLE_DIR, lang, BRIEFINGS_DIR, file]);
  if (path === undefined) return undefined;
  try {
    return decodeIni(await fs.readFile(path));
  } catch (err) {
    console.warn(
      `[pipeline] map ${rel}: text/${lang}/${BRIEFINGS_DIR}/${file} unreadable: ${errorMessage(err)}`,
    );
    return undefined;
  }
}
