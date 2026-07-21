import type { SpriteLayer, TextureSource } from '@open-northland/render';
import { loadLayer } from './ir/load.js';
import { fetchImageData, fetchJsonOrNull, loadTextureIfPresent } from './net.js';

/**
 * GUI (in-game HUD) content bindings — the loadable seam for the pipeline's `gui` stage outputs: the
 * decoded GUI art, palettes, strings and cursors. A checkout without `content/` degrades gracefully: a
 * missing manifest/strings return `null`, a missing atlas throws `MissingAtlasError` via {@link loadLayer}.
 *
 * Where each output lives (matching the pipeline stage + `vite.config.ts` routes):
 *  - **Atlases + palette LUT** ride the `/bobs/` route (they are bob atlases): the recolourable indexed
 *    atlas at stem `<sheet>.indexed`, the RGBA preview at `<sheet>.<previewPalette>`, and the `256 × N`
 *    palette LUT at `/bobs/gui-palettes-lut.png`. The renderer reads an indexed atlas pixel through the
 *    LUT row for its element's palette (same mechanism as the player-colour LUT + `PalettedSprite`).
 *  - **Strings + cursors + the top-level manifest** are served at `/gui/…` (not bob atlases).
 */

/**
 * The GUI palette LUT row order (row index = palette). Kept in lock-step with `GUI_PALETTES` in
 * `tools/asset-pipeline/src/stages/gui/palette-lut.ts` (append, never reorder): the pipeline bakes this
 * order into the LUT rows and the renderer selects a row by index.
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

/** The LUT row (y) a GUI palette occupies — the row a `PalettedSprite` reads an indexed GUI atlas through. */
export function guiPaletteRow(name: GuiPaletteName): number {
  return GUI_PALETTES.indexOf(name);
}

/** `loadLayer` stem of the whole-HUD bob sheet (tool panel, order buttons, window frames, bars). */
const GUI_WINDOW_STEM = 'ls_gui_window';
/** Path (relative to a `/bobs/` stem) of the recolourable indexed atlas: `<sheet>.indexed`. */
const INDEXED_GUI_SUFFIX = 'indexed';
/** The `/bobs/` stem of the GUI palette LUT PNG. */
const GUI_PALETTE_LUT_STEM = 'gui-palettes-lut';

/** One language's decoded UI strings: `{ <table>: { <id>: <text> } }` (CP1250-decoded by the pipeline). */
export type GuiStrings = Record<string, Record<string, string>>;

/** Look up the decoded UI string for `(table, id)`, else the pinned fallback label. */
export type UiString = (table: string, id: number, fallback: string) => string;

/** The shared `(table, id, fallback)` lookup over one loaded string set (or none — always the fallback). */
export function uiStringLookup(strings: GuiStrings | null): UiString {
  return (table, id, fallback) => strings?.[table]?.[String(id)] ?? fallback;
}

/** The served root for the GUI text/cursor assets (atlases + LUT ride `/bobs/`). */
const GUI_ROOT = '/gui';
/** The served root for original GUI bitmap fills (`content/Data/gui/bitmaps/*.png`). */
const GUI_BITMAP_ROOT = '/gui-bitmaps';

/**
 * The recolourable indexed atlas of a GUI sheet (the whole-HUD window sheet / the speech-bubble sheet),
 * loaded by its `<sheet>.indexed` stem through the shared {@link loadLayer}. Throws `MissingAtlasError`
 * when the decoded files are absent (the pipeline hasn't run).
 */
export function loadGuiWindowIndexed(): Promise<SpriteLayer> {
  return loadLayer(`${GUI_WINDOW_STEM}.${INDEXED_GUI_SUFFIX}`);
}

/**
 * Load the GUI palette LUT texture (`/bobs/gui-palettes-lut.png`, a `256 × N` sheet, one composed palette
 * per row) the indexed GUI atlases are coloured through. Returns `undefined` when the pipeline hasn't
 * produced it, so a caller degrades to the RGBA preview atlas.
 */
export function loadGuiPaletteLut(): Promise<TextureSource | undefined> {
  return loadTextureIfPresent(`/bobs/${GUI_PALETTE_LUT_STEM}.png`);
}

/**
 * The decoded level→colour ramp of the original `bar_hitpoints.pcx` palette, as 256 packed `0xRRGGBB`
 * entries: red `#ff0000` at index 0 (empty) → orange → yellow-green `#d4ff4b` at 255 (full), the decoded
 * evidence that a bar's colour follows its level. The exact original draw behavior is not established, so
 * the panel's reading (fill colour = `ramp[level]`, one colour per bar) is a named approximation. Every
 * stat gauge uses this ramp (user decision 2026-07-11) rather than the sibling `bar_standart`, which stays
 * green until ~15% and so showed no colour change on a draining need.
 */
export type GuiBarRamp = readonly number[];

/**
 * Read the `bar_hitpoints` LUT row CPU-side (the renderer samples the same `/bobs/gui-palettes-lut.png` on
 * the GPU) and pack its 256 RGB entries. `undefined` when the LUT is absent (no `content/`) or unreadable,
 * so the bars fall back to their flat banded colours.
 */
export async function loadGuiBarRamp(): Promise<GuiBarRamp | undefined> {
  const image = await fetchImageData(`/bobs/${GUI_PALETTE_LUT_STEM}.png`);
  if (image === null) return undefined;
  const rowIndex = guiPaletteRow('bar_hitpoints');
  // A stale LUT baked before this palette was appended is shorter than the row index; reading past it
  // would sample transparent black (an all-black ramp) — degrade instead.
  if (rowIndex >= image.height) return undefined;
  const { data, width } = image;
  const base = rowIndex * width * 4;
  const colors: number[] = [];
  for (let x = 0; x < width; x++) {
    const o = base + x * 4;
    colors.push(((data[o] ?? 0) << 16) | ((data[o + 1] ?? 0) << 8) | (data[o + 2] ?? 0));
  }
  return colors;
}

/** Original GUI bitmap fills copied/converted from `Data/gui/bitmaps/*.pcx` by the pipeline. */
export type GuiBitmapName = 'bg' | 'bg_button' | 'bg_button_hilite' | 'bg_headline' | 'bg_selected';

/**
 * The served file per bitmap. Two draw through an element palette rather than their embedded one (the
 * pipeline bakes the swap): `bg` uses `bg.bg_normal.png` — the window body's warm brown; `bg_selected`
 * uses `bg_selected.bg_normal.png` — the selected-item card body's grey-blue (its embedded palette is a
 * warm olive; through `bg_normal` its indices land cool, avg ≈ #3c4043). The other three match the
 * original through their embedded palettes.
 */
const GUI_BITMAP_FILES: Readonly<Record<GuiBitmapName, string>> = {
  bg: 'bg.bg_normal.png',
  bg_button: 'bg_button.png',
  bg_button_hilite: 'bg_button_hilite.png',
  bg_headline: 'bg_headline.png',
  bg_selected: 'bg_selected.bg_normal.png',
};

/** Load one optional GUI bitmap fill. Missing `content/` degrades to `undefined`. */
export function loadGuiBitmap(name: GuiBitmapName): Promise<TextureSource | undefined> {
  return loadTextureIfPresent(`${GUI_BITMAP_ROOT}/${GUI_BITMAP_FILES[name]}`);
}

/**
 * Load one language's decoded in-game UI strings (`/gui/strings/<lang>.json`). Returns `null` when the
 * pipeline hasn't produced them (a checkout without `content/`), so a caller can fall back to placeholder
 * labels instead of crashing.
 */
export function loadGuiStrings(lang: string): Promise<GuiStrings | null> {
  return fetchJsonOrNull<GuiStrings>(`${GUI_ROOT}/strings/${lang}.json`);
}
