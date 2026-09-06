import type { HypertextBook, HypertextParagraph } from '@open-northland/data';
import { type Vfs, vjoin } from '@open-northland/vfs';
import { type IncludeResolver, parseBriefingBlocks, renderHypertext } from '../../decoders/hypertext.js';
import { decodeIni } from '../../decoders/ini/grammar.js';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitiveInDirs, rootsInOrder, type SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { GUI_CONTENT_DIR, GUI_LANGS } from './paths.js';

/** The owned copy ships the mission window's history book here, opened on `index.hlt`. */
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
  fs: Vfs,
  roots: SourceRoots,
  outDir: string,
  langs: readonly string[] = GUI_LANGS,
): Promise<GuiHistoryResult[]> {
  const done: GuiHistoryResult[] = [];
  for (const lang of langs) {
    const segments = HISTORY_DIR.map((s) => (s === '<lang>' ? lang : s));
    const dir = await findPathCaseInsensitiveInDirs(fs, rootsInOrder(roots), segments);
    if (dir === undefined) continue;
    let book: HypertextBook | undefined;
    try {
      book = await renderBook(fs, dir);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped history ${lang}: ${errorMessage(err)}`);
      continue;
    }
    if (book === undefined) {
      console.warn(`[pipeline] gui: skipped history ${lang}: no ${START_PAGE}.hlt page`);
      continue;
    }
    const path = vjoin(GUI_CONTENT_DIR, 'history', `${lang}.json`);
    await writeJsonFile(fs, outDir, path, book);
    done.push({ lang, path, pages: Object.keys(book.pages).length });
  }
  return done;
}

async function renderBook(fs: Vfs, dir: string): Promise<HypertextBook | undefined> {
  const entries = (await fs.readdir(dir)).filter((e) => e.kind === 'file');
  const blocksByFile = new Map<string, Map<string, string>>();
  for (const entry of entries) {
    if (!BLOCKS_EXT.test(entry.name)) continue;
    const text = decodeIni(await fs.readFile(vjoin(dir, entry.name)));
    blocksByFile.set(entry.name.toLowerCase(), parseBriefingBlocks(text));
  }
  const include: IncludeResolver = (file, label) => {
    const name = file.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
    return blocksByFile.get(name)?.get(label);
  };
  const pages: Record<string, HypertextParagraph[]> = {};
  for (const entry of entries
    .filter((e) => PAGE_EXT.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const id = entry.name.replace(PAGE_EXT, '').toLowerCase();
    const paragraphs = renderHypertext(decodeIni(await fs.readFile(vjoin(dir, entry.name))), include);
    if (paragraphs.length > 0) pages[id] = paragraphs;
  }
  return START_PAGE in pages ? { start: START_PAGE, pages } : undefined;
}
