import type { SpriteLayer, TextureSource } from '@vinland/render';
import { loadLayer } from './ir.js';
import { fetchJsonOrNull, loadTextureIfPresent } from './net.js';

/**
 * GUI (in-game HUD) content bindings — the loadable seam for the pipeline's `gui` stage outputs, the GUI
 * twin of {@link import('./building-gfx.js')} / {@link import('./settler-gfx.js')}. No HUD is rendered
 * yet; this module just makes the decoded GUI art/palettes/strings/cursors reachable so the HUD slice
 * can consume them. Nothing here pulls in copyrighted bytes — a checkout without `content/` degrades
 * gracefully (a missing manifest/strings return `null`; a missing atlas throws `MissingAtlasError`
 * via {@link loadLayer}, the same precondition the settler/building loaders degrade on).
 *
 * Where each output lives (matching the pipeline stage + `vite.config.ts` routes):
 *  - **Atlases + palette LUT** ride the existing `/bobs/` route (they are bob atlases): the recolourable
 *    **indexed** atlas at stem `<sheet>.indexed`, the RGBA **preview** at `<sheet>.<previewPalette>`, and
 *    the `256 × N` palette LUT at `/bobs/gui-palettes-lut.png` (loaded like the player-colour LUT). The
 *    renderer reads an indexed atlas pixel through the LUT row for its element's palette — same mechanism
 *    as the player-colour LUT + `PalettedSprite`.
 *  - **Strings + cursors + the top-level manifest** are served at `/gui/…` (they are not bob atlases).
 */

/**
 * The GUI palette LUT row order (row index = palette). MIRRORS `GUI_PALETTES` in
 * `tools/asset-pipeline/src/stages/gui.ts` — keep the two in lock-step (append, never reorder), since the
 * pipeline bakes this order into the LUT rows and the renderer selects a row by index. The manifest also
 * carries the names, so a consumer can cross-check `guiPaletteRow` against `manifest.paletteLut.names`.
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
export const GUI_WINDOW_STEM = 'ls_gui_window';
/** Path (relative to a `/bobs/` stem) of the recolourable indexed atlas: `<sheet>.indexed`. */
export const INDEXED_GUI_SUFFIX = 'indexed';
/** The `/bobs/` stem of the GUI palette LUT PNG. */
export const GUI_PALETTE_LUT_STEM = 'gui-palettes-lut';

/** One language's decoded UI strings: `{ <table>: { <id>: <text> } }` (CP1250-decoded by the pipeline). */
export type GuiStrings = Record<string, Record<string, string>>;

/** The one default UI-string language — every HUD surface that isn't told otherwise uses this. */
export const DEFAULT_UI_LANG = 'pol';

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
 * The recolourable INDEXED atlas of a GUI sheet (the whole-HUD window sheet / the speech-bubble sheet),
 * loaded by its `<sheet>.indexed` stem through the shared {@link loadLayer} — so GUI atlases go through the
 * exact same manifest→geometry + PNG→texture path as the settler/building atlases; the renderer reads each
 * pixel's index through the GUI palette LUT at draw time. Throws `MissingAtlasError` when the decoded files
 * are absent (the pipeline hasn't run). The RGBA preview atlases load the same way — `loadLayer(previewStem)`
 * off a {@link GuiManifest} atlas entry — so no separate preview loader is needed.
 */
export function loadGuiWindowIndexed(): Promise<SpriteLayer> {
  return loadLayer(`${GUI_WINDOW_STEM}.${INDEXED_GUI_SUFFIX}`);
}

/**
 * Load the GUI palette LUT texture (`/bobs/gui-palettes-lut.png`, a `256 × N` sheet, one composed palette
 * per row) the indexed GUI atlases are coloured through — the GUI twin of `loadPlayerLut`. Returns
 * `undefined` when the pipeline hasn't produced it, so a caller degrades to the RGBA preview atlas.
 */
export function loadGuiPaletteLut(): Promise<TextureSource | undefined> {
  return loadTextureIfPresent(`/bobs/${GUI_PALETTE_LUT_STEM}.png`);
}

/** Original GUI bitmap fills copied/converted from `Data/gui/bitmaps/*.pcx` by the pipeline. */
export type GuiBitmapName = 'bg' | 'bg_button' | 'bg_button_hilite' | 'bg_headline' | 'bg_selected';

/**
 * The served file per bitmap. `bg` uses the pipeline-baked `bg.bg_normal.png` — the in-game window body
 * draws `bg.pcx` through the `bg_normal` element palette (warm brown); its embedded palette is the grey
 * menu look. The other four match the original through their embedded palettes.
 */
const GUI_BITMAP_FILES: Readonly<Record<GuiBitmapName, string>> = {
  bg: 'bg.bg_normal.png',
  bg_button: 'bg_button.png',
  bg_button_hilite: 'bg_button_hilite.png',
  bg_headline: 'bg_headline.png',
  bg_selected: 'bg_selected.png',
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
