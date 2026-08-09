import { type Vfs, vjoin } from '@open-northland/vfs';
import type { SourceRoots } from '../../roots.js';
import { buildPaletteLut, type PaletteLutResult } from '../palette-lut.js';

/** The dir holding the palette carriers the engine colours HUD elements with. */
const GUI_PALETTES_DIR = vjoin('Data', 'gui', 'palettes');
/** The speech/thought-bubble palette, which lives outside the element-palette tree. */
const BUBBLES_PALETTE_FILE = vjoin('Data', 'engine2d', 'bin', 'palettes', 'gui', 'gui_bubbles.pcx');
/** Filename stem of the emitted GUI palette LUT PNG under `/bobs/`. */
export const GUI_PALETTE_LUT_STEM = 'gui-palettes-lut';

/** One GUI colorization palette: its LUT-row name and the `.pcx` carrier it is read from (under `roots`). */
interface GuiPaletteSource {
  readonly name: string;
  readonly file: string;
}

/**
 * The GUI colorization palettes in LUT-row order, row index = array index. The in-game HUD element palettes
 * from `Data/gui/palettes/` (`font_*` belongs to the font step, `campaignmap`/`campaignbuttons`/`menu_remap`
 * are menu art), then `gui_bubbles`. `packages/app/src/content/gui-gfx.ts` mirrors this order: append,
 * never reorder, or the app's row indices drift.
 */
const GUI_PALETTES: readonly GuiPaletteSource[] = [
  { name: 'iconsleft', file: vjoin(GUI_PALETTES_DIR, 'iconsleft.pcx') },
  { name: 'context', file: vjoin(GUI_PALETTES_DIR, 'context.pcx') },
  { name: 'frame', file: vjoin(GUI_PALETTES_DIR, 'frame.pcx') },
  { name: 'bar_standart', file: vjoin(GUI_PALETTES_DIR, 'bar_standart.pcx') },
  { name: 'bar_hitpoints', file: vjoin(GUI_PALETTES_DIR, 'bar_hitpoints.pcx') },
  { name: 'bar_disabled', file: vjoin(GUI_PALETTES_DIR, 'bar_disabled.pcx') },
  { name: 'bg_normal', file: vjoin(GUI_PALETTES_DIR, 'bg_normal.pcx') },
  { name: 'bg_hilite', file: vjoin(GUI_PALETTES_DIR, 'bg_hilite.pcx') },
  { name: 'bg_invert', file: vjoin(GUI_PALETTES_DIR, 'bg_invert.pcx') },
  { name: 'ingame_remap_01', file: vjoin(GUI_PALETTES_DIR, 'ingame_remap_01.pcx') },
  { name: 'ingame_remap_02', file: vjoin(GUI_PALETTES_DIR, 'ingame_remap_02.pcx') },
  { name: 'ingame_remap_03', file: vjoin(GUI_PALETTES_DIR, 'ingame_remap_03.pcx') },
  { name: 'papyrus', file: vjoin(GUI_PALETTES_DIR, 'papyrus.pcx') },
  { name: 'gui_bubbles', file: BUBBLES_PALETTE_FILE },
];

/** Stacks every {@link GUI_PALETTES} carrier into one `256 × N` LUT PNG under `BOBS_DIR`. */
export function convertGuiPaletteLut(fs: Vfs, roots: SourceRoots, outDir: string): Promise<PaletteLutResult> {
  return buildPaletteLut(fs, roots, outDir, GUI_PALETTES, GUI_PALETTE_LUT_STEM, {
    label: 'gui',
    noun: 'palette',
  });
}
