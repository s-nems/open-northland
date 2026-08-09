import { type Vfs, vjoin } from '@open-northland/vfs';
import type { SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { convertGuiAtlases, type GuiAtlasResult } from './atlases.js';
import { convertCursors, type GuiCursorResult } from './cursors.js';
import { convertGuiPaletteLut } from './palette-lut.js';
import { GUI_CONTENT_DIR } from './paths.js';
import { convertGuiStrings, type GuiStringsResult, STRING_TABLES } from './strings.js';
import { convertWindowBitmaps } from './window-bitmaps.js';

/**
 * GUI extraction stage. Every source is a loose file read straight from `roots` (the HUD ships unpacked
 * and the culturesnation mod does not override it), so this stage does not depend on the `.lib` unpack.
 */

export { convertGuiAtlases, type GuiAtlasResult } from './atlases.js';
export { convertCursors, type GuiCursorResult } from './cursors.js';
export { convertGuiPaletteLut, GUI_PALETTE_LUT_STEM } from './palette-lut.js';
export { convertGuiStrings, type GuiStringsResult, STRING_TABLES } from './strings.js';
export { BODY_SHADOW_MIN_LUMA, convertWindowBitmaps, liftPaletteShadows } from './window-bitmaps.js';

/** The emitted `content/gui/manifest.json`, the app's entry point to every GUI output. */
export interface GuiManifest {
  readonly atlases: GuiAtlasResult[];
  readonly paletteLut: { readonly stem: string; readonly names: string[] };
  readonly strings: { readonly languages: string[]; readonly tables: readonly string[] };
  readonly cursors: GuiCursorResult[];
}

/** Counts for the CLI log line. */
export interface GuiStageSummary {
  readonly atlases: number;
  readonly frames: number;
  readonly palettes: number;
  readonly strings: GuiStringsResult[];
  readonly cursors: number;
}

/**
 * Runs the GUI extraction and writes `content/gui/manifest.json`. Each sub-step warns and skips on its own,
 * so a partial game install still produces whatever it can.
 */
export async function convertGuiStage(fs: Vfs, roots: SourceRoots, outDir: string): Promise<GuiStageSummary> {
  const palettes = await convertGuiPaletteLut(fs, roots, outDir);
  const atlases = await convertGuiAtlases(fs, roots, outDir, palettes.byName);
  await convertWindowBitmaps(fs, roots, outDir, palettes.byName);
  const strings = await convertGuiStrings(fs, roots, outDir);
  const cursors = await convertCursors(fs, roots, outDir);

  const manifest: GuiManifest = {
    atlases,
    paletteLut: { stem: palettes.stem, names: palettes.names },
    strings: { languages: strings.map((s) => s.lang), tables: STRING_TABLES },
    cursors,
  };
  await writeJsonFile(fs, outDir, vjoin(GUI_CONTENT_DIR, 'manifest.json'), manifest);

  return {
    atlases: atlases.length,
    frames: atlases.reduce((sum, a) => sum + a.frames, 0),
    palettes: palettes.names.length,
    strings,
    cursors: cursors.length,
  };
}
