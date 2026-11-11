import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BookOverlay,
  type HypertextBlock,
  type HypertextBook,
  isSourceLanguage,
  type Language,
} from '@open-northland/data';
import {
  type IncludeResolver,
  parseBriefingBlocks,
  renderHypertext,
} from '@open-northland/formats/hypertext';
import { decodeIni } from '@open-northland/formats/ini/grammar';
import { textEncoding } from '@open-northland/formats/text-encoding';
import { HYPERTEXT_GRAPHICS_DIR } from '@open-northland/map-import';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitive, type SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { resolvePagePictures } from '../hypertext-pictures.js';
import { GUI_CONTENT_DIR, GUI_LANGS } from './paths.js';

/** The mod ships the mission window's history book here, opened on `index.hlt`. */
const HISTORY_DIR = ['Data', 'text', '<lang>', 'hypertext', 'history'] as const;
/** The history book's name among the translation overlays, `translations/<lang>/books/history.json`. */
export const HISTORY_BOOK = 'history';
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

/** One language's history folder under the data root, or undefined when the language lacks it. */
export function historyDir(roots: SourceRoots, lang: string): Promise<string | undefined> {
  return findPathCaseInsensitive(
    roots.data,
    HISTORY_DIR.map((s) => (s === '<lang>' ? lang : s)),
  );
}

/**
 * Renders each language's history book into `content/gui/history/<lang>.json`. A language without the
 * folder, or whose folder lacks the start page, emits nothing. An overlay language with a history
 * overlay and no shipped book renders the pages of the overlay's basis language, else of the first language that has the
 * book, with each included block taken from the overlay when it has the file and label.
 */
export async function convertGuiHistory(
  roots: SourceRoots,
  outDir: string,
  langs: readonly string[] = GUI_LANGS,
): Promise<GuiHistoryResult[]> {
  const done: GuiHistoryResult[] = [];
  for (const lang of langs) {
    const dir = await historyDir(roots, lang);
    const written = dir === undefined ? undefined : await writeBook(outDir, lang, { lang, dir });
    if (written !== undefined) done.push(written);
  }
  for (const [lang, books] of roots.overlays?.books ?? []) {
    const overlay = books.get(HISTORY_BOOK);
    if (overlay === undefined) continue;
    if (isSourceLanguage(lang)) {
      console.warn(
        `[pipeline] gui: refused ${lang} history overlay: source-language text belongs in corrections`,
      );
      continue;
    }
    if (done.some((result) => result.lang === lang)) {
      console.warn(`[pipeline] gui: skipped ${lang} history overlay: the pack ships the book in ${lang}`);
      continue;
    }
    const pages = await basisBook(roots, overlay.basis.lang);
    if (pages === undefined) {
      console.warn(`[pipeline] gui: skipped history ${lang}: no language ships the book`);
      continue;
    }
    const written = await writeBook(outDir, lang, pages, overlay.blocks);
    if (written !== undefined) done.push(written);
  }
  return done;
}

/** Writes `gui/history/<lang>.json` from the pages of one language's folder, warning when it renders none. */
async function writeBook(
  outDir: string,
  lang: string,
  pages: HistoryPages,
  overlay?: BookOverlay['blocks'],
): Promise<GuiHistoryResult | undefined> {
  let book: HypertextBook | undefined;
  try {
    book = await renderBook(pages.dir, outDir, pages.lang, overlay);
  } catch (err) {
    console.warn(`[pipeline] gui: skipped history ${lang}: ${errorMessage(err)}`);
    return undefined;
  }
  if (book === undefined) {
    console.warn(`[pipeline] gui: skipped history ${lang}: no ${START_PAGE}.hlt page`);
    return undefined;
  }
  const path = `${GUI_CONTENT_DIR}/history/${lang}.json`;
  await writeJsonFile(outDir, path, book);
  return { lang, path, pages: Object.keys(book.pages).length };
}

/** A history folder and the language its text files are encoded for. */
interface HistoryPages {
  readonly lang: string;
  readonly dir: string;
}

/** The history folder of `preferred`, else of the first GUI language that has one. */
async function basisBook(roots: SourceRoots, preferred: Language): Promise<HistoryPages | undefined> {
  for (const lang of [preferred, ...GUI_LANGS]) {
    const dir = await historyDir(roots, lang);
    if (dir !== undefined) return { lang, dir };
  }
  return undefined;
}

/** The lower-cased block file a `<include:…>` argument names, `$local$\Mythology.txt` naming `mythology.txt`. */
function blockFileName(file: string): string {
  return file.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
}

/** Reads every block file of one history folder in `encoding` by lower-cased file name, in name order,
 *  then label. */
export async function readHistoryBlocks(
  dir: string,
  encoding: string,
): Promise<Map<string, Map<string, string>>> {
  const blocksByFile = new Map<string, Map<string, string>>();
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && BLOCKS_EXT.test(e.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of files) {
    const text = decodeIni(await readFile(join(dir, entry.name)), encoding);
    blocksByFile.set(entry.name.toLowerCase(), parseBriefingBlocks(text));
  }
  return blocksByFile;
}

async function renderBook(
  dir: string,
  outDir: string,
  lang: string,
  overlay?: BookOverlay['blocks'],
): Promise<HypertextBook | undefined> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile());
  const blocksByFile = await readHistoryBlocks(dir, textEncoding(lang));
  const include: IncludeResolver = (file, label) => {
    const name = blockFileName(file);
    const overlaid = overlay !== undefined && Object.hasOwn(overlay, name) ? overlay[name] : undefined;
    return overlaid !== undefined && Object.hasOwn(overlaid, label)
      ? overlaid[label]
      : blocksByFile.get(name)?.get(label);
  };
  const texts = new Map<string, string>();
  for (const entry of entries
    .filter((e) => PAGE_EXT.test(e.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    texts.set(
      entry.name.replace(PAGE_EXT, '').toLowerCase(),
      decodeIni(await readFile(join(dir, entry.name)), textEncoding(lang)),
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
