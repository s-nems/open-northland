import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertGuiAtlases, type GuiAtlasResult } from './atlases.js';
import { convertCursors, type GuiCursorResult } from './cursors.js';
import { convertGuiPaletteLut } from './palette-lut.js';
import { GUI_CONTENT_DIR } from './paths.js';
import { convertGuiStrings, type GuiStringsResult, STRING_TABLES } from './strings.js';
import { convertWindowBitmaps } from './window-bitmaps.js';

/**
 * GUI extraction stage — the original in-game HUD art, colorization palettes, UI strings, and mouse
 * cursors, converted from an OWNED game copy into `content/` for the app to consume. It is the GUI twin
 * of the character/building bob stages, reusing their pieces:
 *
 *  - **Atlas art.** `ls_gui_window.bmd` (193 bobs: tool-panel chrome, order buttons, window frames,
 *    progress/hit bars, minimap chrome) and `ls_gui_bubbles.bmd` (23 speech/thought bubbles) are the same
 *    CBobManager `.bmd` the settlers use, so each becomes (a) an **indexed** atlas (`packIndexedBobAtlas` —
 *    palette index in red, mask in alpha) the renderer colours per element at draw time through a palette
 *    LUT, plus (b) an **RGBA preview** atlas (`packBobAtlas`) coloured with one sensible default palette so
 *    a human can eyeball "chrome, not noise". Both ride the existing `/bobs/` route (`<stem>.png` +
 *    `<stem>.atlas.json`), so the app's `loadLayer` reads them unchanged.
 *  - **Palettes.** The engine colours each HUD element with a `Data/gui/palettes/*.pcx` (2×2 carriers
 *    whose real payload is the 256-colour trailer). We stack them into one `256 × N` LUT PNG — the exact
 *    mechanism as the player-colour LUT ({@link buildPlayerLutImage}) — with the row order fixed by
 *    {@link GUI_PALETTES} (mirrored app-side, so no sidecar descriptor is needed). The renderer reads an
 *    indexed atlas pixel through the LUT row for its element's palette. Which palette pairs with which
 *    element is documented in `docs/SOURCES.md` (from the OpenVikings `CGuiBaseDataManager`/`CGuiManager`
 *    oracle: `iconsleft` = the whole tool panel, `context` = the order icons, `frame`/`bg_*`/`bar_*`/
 *    `papyrus` = windows & bars).
 *  - **Strings.** The nine `ingamegui*.cif` UI tables per language are `CStringArray`s (already decoded by
 *    `cif.ts`); we emit id→text JSON per language, re-decoded to CP1250 for the display glyphs.
 *  - **Cursors.** The three `DataX/Mouse/*.cur` are standard Win32 cursors — decoded to PNG (with hotspot)
 *    and copied through verbatim so the app can use either the `.cur` (CSS `cursor: url()`) or the PNG.
 *
 * Boundary failures are warned-and-skipped, never fatal (matching the other tree-walk stages): a missing
 * `.bmd`/palette/string table/cursor drops that one output rather than aborting the run. All sources are
 * loose files read straight from `gameDir` (the HUD ships unpacked; the culturesnation mod does not
 * override it), so this stage does not depend on the `.lib` unpack. No copyrighted bytes enter the repo —
 * everything lands under the gitignored `content/`.
 */

export * from './atlases.js';
export * from './cursors.js';
export * from './palette-lut.js';
export * from './strings.js';
export * from './window-bitmaps.js';

/** The top-level `content/gui/manifest.json` — the app's single entry point to discover every GUI output. */
export interface GuiManifest {
  readonly atlases: GuiAtlasResult[];
  readonly paletteLut: { readonly stem: string; readonly names: string[] };
  readonly strings: { readonly languages: string[]; readonly tables: readonly string[] };
  readonly cursors: GuiCursorResult[];
}

/** What {@link convertGuiStage} did, for the CLI log line. */
export interface GuiStageSummary {
  readonly atlases: number;
  readonly frames: number;
  readonly palettes: number;
  readonly strings: GuiStringsResult[];
  readonly cursors: number;
}

/**
 * Runs the whole GUI extraction: palette LUT (which also yields the preview palettes) → indexed + preview
 * atlases → per-language strings → cursors → the top-level `content/gui/manifest.json`. Returns a summary
 * for the CLI log. Each sub-step is independently resilient (warn-and-skip), so a partial game install
 * still produces whatever it can.
 */
export async function convertGuiStage(gameDir: string, outDir: string): Promise<GuiStageSummary> {
  const palettes = await convertGuiPaletteLut(gameDir, outDir);
  const atlases = await convertGuiAtlases(gameDir, outDir, palettes.byName);
  await convertWindowBitmaps(gameDir, outDir, palettes.byName);
  const strings = await convertGuiStrings(gameDir, outDir);
  const cursors = await convertCursors(gameDir, outDir);

  const manifest: GuiManifest = {
    atlases,
    paletteLut: { stem: palettes.stem, names: palettes.names },
    strings: { languages: strings.map((s) => s.lang), tables: STRING_TABLES },
    cursors,
  };
  await mkdir(join(outDir, GUI_CONTENT_DIR), { recursive: true });
  await writeFile(join(outDir, GUI_CONTENT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    atlases: atlases.length,
    frames: atlases.reduce((sum, a) => sum + a.frames, 0),
    palettes: palettes.names.length,
    strings,
    cursors: cursors.length,
  };
}
