import type { SourceRoots } from '../../roots.js';
import { type BobAtlasCatalog, writeJsonFile } from '../content-tree.js';
import { convertGuiAtlases, type GuiAtlasResult } from './atlases.js';
import { convertCursors, type GuiCursorResult } from './cursors.js';
import { convertGuiObjectHelp, type GuiObjectHelpResult } from './help.js';
import { convertGuiHistory, type GuiHistoryResult } from './history.js';
import { convertGuiPaletteLut } from './palette-lut.js';
import { GUI_CONTENT_DIR } from './paths.js';
import { convertGuiStrings, EXPORTED_TABLES, type GuiStringsResult } from './strings.js';

export { convertGuiAtlases, type GuiAtlasResult } from './atlases.js';
export { convertCursors, type GuiCursorResult } from './cursors.js';
export { convertGuiObjectHelp, type GuiObjectHelpResult } from './help.js';
export { convertGuiHistory, type GuiHistoryResult } from './history.js';
export { convertGuiPaletteLut, GUI_PALETTE_LUT_STEM } from './palette-lut.js';
export { convertGuiStrings, type GuiStringsResult } from './strings.js';

/** The emitted `content/gui/manifest.json`, the app's entry point to every GUI output. */
export interface GuiManifest {
  readonly atlases: GuiAtlasResult[];
  readonly paletteLut: { readonly stem: string; readonly names: string[] };
  readonly strings: { readonly languages: string[]; readonly tables: readonly string[] };
  readonly history: { readonly languages: string[] };
  readonly help: { readonly languages: string[] };
  readonly cursors: GuiCursorResult[];
}

/** Counts for the CLI log line. */
export interface GuiStageSummary {
  readonly atlases: number;
  readonly frames: number;
  readonly palettes: number;
  readonly strings: GuiStringsResult[];
  readonly history: GuiHistoryResult[];
  readonly help: GuiObjectHelpResult[];
  readonly cursors: number;
}

/**
 * Runs the GUI extraction and writes `content/gui/manifest.json`. Each sub-step warns and skips on its own,
 * so a partial game install still produces whatever it can.
 */
export async function convertGuiStage(
  roots: SourceRoots,
  outDir: string,
  bobAtlases: BobAtlasCatalog,
): Promise<GuiStageSummary> {
  const palettes = await convertGuiPaletteLut(roots, outDir);
  const atlases = await convertGuiAtlases(roots, bobAtlases, palettes.byName);
  const strings = await convertGuiStrings(roots, outDir);
  const history = await convertGuiHistory(roots, outDir);
  const help = await convertGuiObjectHelp(roots, outDir);
  const cursors = await convertCursors(roots, outDir);

  const manifest: GuiManifest = {
    atlases,
    paletteLut: { stem: palettes.stem, names: palettes.names },
    strings: { languages: strings.map((s) => s.lang), tables: EXPORTED_TABLES },
    history: { languages: history.map((h) => h.lang) },
    help: { languages: help.map((h) => h.lang) },
    cursors,
  };
  await writeJsonFile(outDir, `${GUI_CONTENT_DIR}/manifest.json`, manifest);

  return {
    atlases: atlases.length,
    frames: atlases.reduce((sum, a) => sum + a.frames, 0),
    palettes: palettes.names.length,
    strings,
    history,
    help,
    cursors: cursors.length,
  };
}
