import { join } from 'node:path';
import { decodeBmd } from '../../decoders/bmd/index.js';
import { BOBS_DIR, emitIndexedAndPreviewAtlas, readGameFile } from '../game-file.js';

/** The GUI bob sheets to atlas, each with the palette its RGBA preview is coloured through. */
interface GuiAtlasSource {
  readonly stem: string;
  readonly bmd: string;
  /** A {@link GUI_PALETTES} name — the palette that colours the most of this sheet (best default preview). */
  readonly previewPalette: string;
}

/**
 * The GUI bob sheets. `ls_gui_window` is drawn mostly through `iconsleft` (the whole tool panel; the order
 * icons use `context`) per the OpenVikings oracle, so `iconsleft` is the best single preview palette; the
 * bubble sheet uses its own `gui_bubbles` palette.
 */
const GUI_ATLASES: readonly GuiAtlasSource[] = [
  { stem: 'ls_gui_window', bmd: join(BOBS_DIR, 'ls_gui_window.bmd'), previewPalette: 'iconsleft' },
  { stem: 'ls_gui_bubbles', bmd: join(BOBS_DIR, 'ls_gui_bubbles.bmd'), previewPalette: 'gui_bubbles' },
];

/** One emitted GUI bob atlas: the app-side `loadLayer` stems for its indexed + preview forms, plus frame count. */
export interface GuiAtlasResult {
  readonly stem: string;
  /** `loadLayer` stem for the recolourable indexed atlas (`<stem>.indexed`). */
  readonly indexedStem: string;
  /** `loadLayer` stem for the default-coloured RGBA preview (`<stem>.<previewPalette>`). */
  readonly previewStem: string;
  readonly previewPalette: string;
  readonly frames: number;
}

/**
 * Decodes each GUI bob sheet into an indexed atlas + an RGBA preview atlas, written under `BOBS_DIR`.
 * `paletteByName` supplies the preview colours (from {@link convertGuiPaletteLut}). A missing/malformed
 * `.bmd`, or an absent preview palette, warns-and-skips that sheet. Returns one {@link GuiAtlasResult} per
 * sheet that converted.
 */
export async function convertGuiAtlases(
  gameDir: string,
  outDir: string,
  paletteByName: ReadonlyMap<string, Uint8Array>,
): Promise<GuiAtlasResult[]> {
  const done: GuiAtlasResult[] = [];
  for (const src of GUI_ATLASES) {
    let bytes: Uint8Array;
    try {
      bytes = await readGameFile(gameDir, src.bmd);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${src.stem}: ${(err as Error).message}`);
      continue;
    }
    const preview = paletteByName.get(src.previewPalette);
    if (preview === undefined) {
      console.warn(
        `[pipeline] gui: skipped ${src.stem}: preview palette "${src.previewPalette}" unavailable`,
      );
      continue;
    }
    // decode + atlas emit share one warn-and-skip guard so a malformed-but-decodable sheet drops only
    // itself, never aborting the batch (matching the goods/font stages).
    let indexedStem: string;
    let previewStem: string;
    let frames: number;
    try {
      ({ indexedStem, previewStem, frames } = await emitIndexedAndPreviewAtlas(
        outDir,
        src.stem,
        decodeBmd(bytes),
        src.previewPalette,
        preview,
      ));
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${src.stem}: ${(err as Error).message}`);
      continue;
    }
    done.push({
      stem: src.stem,
      indexedStem,
      previewStem,
      previewPalette: src.previewPalette,
      frames,
    });
  }
  return done;
}
