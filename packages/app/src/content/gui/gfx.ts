import { HypertextBook, ObjectHelp } from '@open-northland/data';
import type { SpriteLayer, TextureSource } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import { loadLayer } from '../ir/load.js';
import { fetchJsonOrNull, loadTextureIfPresent } from '../net.js';
import { type ContentFetch, contentFetch, contentUrl } from '../url.js';

/**
 * GUI content bindings for the pipeline's `gui` stage outputs. Atlases and the palette LUT ride the
 * `/bobs/` route; strings, cursors and the manifest are served at `/gui/`. A checkout without `content/`
 * degrades: a missing manifest or strings return `null`, a missing atlas throws `MissingAtlasError`.
 */

/**
 * The GUI palette LUT row order (row index = palette). Append, never reorder: the pipeline bakes this
 * order into the LUT rows (`stages/gui/palette-lut.ts`) and the renderer selects a row by index.
 */
export const GUI_PALETTES = [
  'iconsleft',
  'context',
  'frame',
  'bar_standart',
  'bar_hitpoints',
  'bar_disabled',
  'bg_normal',
  'bg_hilite',
  'bg_invert',
  'ingame_remap_01',
  'ingame_remap_02',
  'ingame_remap_03',
  'papyrus',
  'gui_bubbles',
] as const;

export type GuiPaletteName = (typeof GUI_PALETTES)[number];

/** The LUT row a `PalettedSprite` reads an indexed GUI atlas through. */
export function guiPaletteRow(name: GuiPaletteName): number {
  return GUI_PALETTES.indexOf(name);
}

/** `loadLayer` stem of the whole-HUD bob sheet (tool panel, order buttons, window frames, bars). */
const GUI_WINDOW_STEM = 'ls_gui_window';
/** Path (relative to a `/bobs/` stem) of the recolourable indexed atlas: `<sheet>.indexed`. */
const INDEXED_GUI_SUFFIX = 'indexed';
/** The `/bobs/` stem of the GUI palette LUT PNG. */
const GUI_PALETTE_LUT_STEM = 'gui-palettes-lut';

/** One language's UI strings, decoded by the pipeline: `{ <table>: { <id>: <text> } }`. */
export type GuiStrings = Record<string, Record<string, string>>;

/** Look up the decoded UI string for `(table, id)`, else the pinned fallback label. */
export type UiString = (table: string, id: number, fallback: string) => string;

/** The shared `(table, id, fallback)` lookup over one loaded string set (or none - always the fallback). */
export function uiStringLookup(strings: GuiStrings | null): UiString {
  return (table, id, fallback) => strings?.[table]?.[String(id)] ?? fallback;
}

/** The served root for the GUI text/cursor assets (atlases + LUT ride `/bobs/`). */
const GUI_ROOT = '/gui';

/** The recolourable indexed GUI sheet. Throws `MissingAtlasError` when the decoded files are absent. */
export function loadGuiWindowIndexed(): Promise<SpriteLayer> {
  return loadLayer(`${GUI_WINDOW_STEM}.${INDEXED_GUI_SUFFIX}`);
}

/**
 * The GUI palette LUT texture (a `256 × N` sheet, one composed palette per row) the indexed GUI atlases
 * are coloured through. `undefined` when the pipeline hasn't produced it, so a caller degrades to the
 * RGBA preview atlas.
 */
export function loadGuiPaletteLut(): Promise<TextureSource | undefined> {
  return loadTextureIfPresent(contentUrl(`/bobs/${GUI_PALETTE_LUT_STEM}.png`));
}

const guiStringsByLang = new Map<string, Promise<GuiStrings | null>>();

/**
 * Load one language's decoded in-game UI strings, once per document. `null` when the pipeline hasn't
 * produced them or the fetch failed, so a caller falls back to placeholder labels; a `null` is not kept,
 * so the next caller asks again.
 */
export function loadGuiStrings(lang: string): Promise<GuiStrings | null> {
  const cached = guiStringsByLang.get(lang);
  if (cached !== undefined) return cached;
  const loading = fetchJsonOrNull<GuiStrings>(`${GUI_ROOT}/strings/${lang}.json`);
  guiStringsByLang.set(lang, loading);
  void loading.then((loaded) => {
    if (loaded === null && guiStringsByLang.get(lang) === loading) guiStringsByLang.delete(lang);
  });
  return loading;
}

/** Load one language's rendered history tables (read in the mission book's chronicle), or `null` without them. */
export async function loadGuiHistory(
  lang: string,
  fetchImpl: ContentFetch = contentFetch,
): Promise<HypertextBook | null> {
  const raw = await fetchJsonOrNull<unknown>(`${GUI_ROOT}/history/${lang}.json`, fetchImpl);
  if (raw === null) return null;
  const parsed = HypertextBook.safeParse(raw);
  if (!parsed.success) {
    diag.warn('content', `loadGuiHistory: rejected /gui/history/${lang}.json (${parsed.error.message})`);
    return null;
  }
  return parsed.data;
}

/** One language's goods and houses descriptions, fetched only when a reader asks; `null` for a language
 *  or a checkout without them. */
export async function loadObjectHelp(
  locale: string,
  fetchImpl: ContentFetch = contentFetch,
): Promise<ObjectHelp | null> {
  const raw = await fetchJsonOrNull<unknown>(`${GUI_ROOT}/help/${locale}.json`, fetchImpl);
  if (raw === null) return null;
  const parsed = ObjectHelp.safeParse(raw);
  if (!parsed.success) {
    diag.warn('content', `loadObjectHelp: rejected /gui/help/${locale}.json (${parsed.error.message})`);
    return null;
  }
  return parsed.data;
}

/** A hypertext page picture's URL, by the content-addressed file name its block carries; a checkout
 *  without the pipeline's output answers it with a missing image. */
export function hypertextPictureUrl(file: string): string {
  return contentUrl(`${GUI_ROOT}/hypertext/${file}`);
}
