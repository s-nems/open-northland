import { type Vfs, vjoin } from '@open-northland/vfs';
import { decodeBmd } from '../../decoders/bmd/index.js';
import { errorMessage } from '../../errors.js';
import { MOD_BOBS_DIR, type SourceRoots } from '../../roots.js';
import { emitIndexedAndPreviewAtlas } from '../content-tree.js';
import { readSourceFile } from '../source-files.js';

/** The GUI bob sheets to atlas, each with the palette its RGBA preview is coloured through. */
interface GuiAtlasSource {
  readonly stem: string;
  readonly bmd: string;
  readonly previewPalette: string;
}

/**
 * The GUI bob sheets. By visual check `ls_gui_window` is drawn mostly through `iconsleft` (its order icons
 * use `context`), so that is its best single preview palette; the bubble sheet uses `gui_bubbles`.
 */
const GUI_ATLASES: readonly GuiAtlasSource[] = [
  { stem: 'ls_gui_window', bmd: vjoin(MOD_BOBS_DIR, 'ls_gui_window.bmd'), previewPalette: 'iconsleft' },
  { stem: 'ls_gui_bubbles', bmd: vjoin(MOD_BOBS_DIR, 'ls_gui_bubbles.bmd'), previewPalette: 'gui_bubbles' },
];

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
 * Decodes each GUI bob sheet into an indexed atlas plus an RGBA preview atlas under `bobs/`, taking the
 * preview colours from `paletteByName`. A missing sheet or preview palette skips that sheet only.
 */
export async function convertGuiAtlases(
  fs: Vfs,
  roots: SourceRoots,
  outDir: string,
  paletteByName: ReadonlyMap<string, Uint8Array>,
): Promise<GuiAtlasResult[]> {
  const done: GuiAtlasResult[] = [];
  for (const src of GUI_ATLASES) {
    let bytes: Uint8Array;
    try {
      bytes = await readSourceFile(fs, roots, src.bmd);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${src.stem}: ${errorMessage(err)}`);
      continue;
    }
    const preview = paletteByName.get(src.previewPalette);
    if (preview === undefined) {
      console.warn(
        `[pipeline] gui: skipped ${src.stem}: preview palette "${src.previewPalette}" unavailable`,
      );
      continue;
    }
    let indexedStem: string;
    let previewStem: string;
    let frames: number;
    try {
      ({ indexedStem, previewStem, frames } = await emitIndexedAndPreviewAtlas(
        fs,
        outDir,
        src.stem,
        decodeBmd(bytes),
        src.previewPalette,
        preview,
      ));
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${src.stem}: ${errorMessage(err)}`);
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
