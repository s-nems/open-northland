import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HypertextBlock, HypertextBook } from '@open-northland/data';
import { type IncludeResolver, parseBriefingBlocks, renderHypertext } from '../../decoders/hypertext.js';
import { decodeIni } from '../../decoders/ini/grammar.js';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitive, type SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { HYPERTEXT_GRAPHICS_DIR, resolvePagePictures } from '../hypertext-pictures.js';
import { GUI_CONTENT_DIR, GUI_LANGS } from './paths.js';

/** The mod ships the mission window's history book here, opened on `index.hlt`. */
const HISTORY_DIR = ['Data', 'text', '<lang>', 'hypertext', 'history'] as const;
const START_PAGE = 'index';
const PAGE_EXT = /\.hlt$/i;
/** The block files the pages include (`<include:$local$\mythology.txt,…>`). */
const BLOCKS_EXT = /\.txt$/i;

export interface GuiHistoryResult {
  readonly lang: string;
  /** Path under `content/` (served at `/gui/history/<lang>.json`). */
  readonly path: string;
  readonly pages: number;
}

/**
 * Renders each language's history book into `content/gui/history/<lang>.json`. A language without the
 * folder, or whose folder lacks the start page, emits nothing.
 */
export async function convertGuiHistory(
  roots: SourceRoots,
  outDir: string,
  langs: readonly string[] = GUI_LANGS,
): Promise<GuiHistoryResult[]> {
  const done: GuiHistoryResult[] = [];
  for (const lang of langs) {
    const segments = HISTORY_DIR.map((s) => (s === '<lang>' ? lang : s));
    const dir = await findPathCaseInsensitive(roots.mod, segments);
    if (dir === undefined) continue;
    let book: HypertextBook | undefined;
    try {
      book = await renderBook(dir, outDir, lang);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped history ${lang}: ${errorMessage(err)}`);
      continue;
    }
    if (book === undefined) {
      console.warn(`[pipeline] gui: skipped history ${lang}: no ${START_PAGE}.hlt page`);
      continue;
    }
    const path = `${GUI_CONTENT_DIR}/history/${lang}.json`;
    await writeJsonFile(outDir, path, book);
    done.push({ lang, path, pages: Object.keys(book.pages).length });
  }
  return done;
}

async function renderBook(dir: string, outDir: string, lang: string): Promise<HypertextBook | undefined> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile());
  const blocksByFile = new Map<string, Map<string, string>>();
  for (const entry of entries) {
    if (!BLOCKS_EXT.test(entry.name)) continue;
    const text = decodeIni(await readFile(join(dir, entry.name)));
    blocksByFile.set(entry.name.toLowerCase(), parseBriefingBlocks(text));
  }
  const include: IncludeResolver = (file, label) => {
    const name = file.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
    return blocksByFile.get(name)?.get(label);
  };
  const texts = new Map<string, string>();
  for (const entry of entries
    .filter((e) => PAGE_EXT.test(e.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    texts.set(
      entry.name.replace(PAGE_EXT, '').toLowerCase(),
      decodeIni(await readFile(join(dir, entry.name))),
    );
  }
  const picture = await resolvePagePictures(
    outDir,
    (name) => findPathCaseInsensitive(dir, [HYPERTEXT_GRAPHICS_DIR, name]),
    texts.values(),
    include,
    `gui: history ${lang}`,
  );
  const pages: Record<string, HypertextBlock[]> = {};
  for (const [id, text] of texts) {
    const blocks = renderHypertext(text, { include, picture });
    if (blocks.length > 0) pages[id] = blocks;
  }
  return START_PAGE in pages ? { start: START_PAGE, pages } : undefined;
}
