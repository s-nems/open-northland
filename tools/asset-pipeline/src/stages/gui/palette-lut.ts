import { join } from 'node:path';
import { buildPaletteLut, type PaletteLutResult } from '../game-file.js';

/** The dir holding the 2×2 palette carriers the engine colours HUD elements with. */
const GUI_PALETTES_DIR = join('Data', 'gui', 'palettes');
/** The speech/thought-bubble palette (a different tree from the element palettes). */
const BUBBLES_PALETTE_FILE = join('Data', 'engine2d', 'bin', 'palettes', 'gui', 'gui_bubbles.pcx');
/** Filename stem of the emitted GUI palette LUT (a `/bobs/` PNG, loaded like the player-colour LUT). */
export const GUI_PALETTE_LUT_STEM = 'gui-palettes-lut';

/** One GUI colorization palette: its LUT-row name and the `.pcx` carrier it is read from (under `gameDir`). */
interface GuiPaletteSource {
  readonly name: string;
  readonly file: string;
}

/**
 * The GUI colorization palettes, in LUT-row order (row index = array index). The 13 in-game HUD element
 * palettes from `Data/gui/palettes/` (the `font_*` ones belong to the later font step; `campaignmap`/
 * `campaignbuttons`/`menu_remap` are menu/campaign, not in-game HUD), then `gui_bubbles` for the bubble
 * sheet. The renderer reads an indexed GUI atlas pixel through the row named here for its element. This
 * order is the contract with the app (mirrored in `packages/app/src/content/gui-gfx.ts`) — append, never
 * reorder, or the app's row indices drift.
 */
const GUI_PALETTES: readonly GuiPaletteSource[] = [
  { name: 'iconsleft', file: join(GUI_PALETTES_DIR, 'iconsleft.pcx') },
  { name: 'context', file: join(GUI_PALETTES_DIR, 'context.pcx') },
  { name: 'frame', file: join(GUI_PALETTES_DIR, 'frame.pcx') },
  { name: 'bar_standart', file: join(GUI_PALETTES_DIR, 'bar_standart.pcx') },
  { name: 'bar_hitpoints', file: join(GUI_PALETTES_DIR, 'bar_hitpoints.pcx') },
  { name: 'bar_disabled', file: join(GUI_PALETTES_DIR, 'bar_disabled.pcx') },
  { name: 'bg_normal', file: join(GUI_PALETTES_DIR, 'bg_normal.pcx') },
  { name: 'bg_hilite', file: join(GUI_PALETTES_DIR, 'bg_hilite.pcx') },
  { name: 'bg_invert', file: join(GUI_PALETTES_DIR, 'bg_invert.pcx') },
  { name: 'ingame_remap_01', file: join(GUI_PALETTES_DIR, 'ingame_remap_01.pcx') },
  { name: 'ingame_remap_02', file: join(GUI_PALETTES_DIR, 'ingame_remap_02.pcx') },
  { name: 'ingame_remap_03', file: join(GUI_PALETTES_DIR, 'ingame_remap_03.pcx') },
  { name: 'papyrus', file: join(GUI_PALETTES_DIR, 'papyrus.pcx') },
  { name: 'gui_bubbles', file: BUBBLES_PALETTE_FILE },
];

/**
 * Reads every {@link GUI_PALETTES} carrier, stacks their 256-colour trailers into one `256 × N` LUT PNG
 * (via {@link buildPaletteLut}, the same mechanism as the font-colour + player-colour LUTs), and writes
 * it under `BOBS_DIR`. A missing/palette-less carrier is warned and replaced with a neutral grayscale
 * row so the row order (the app's contract) stays fixed regardless of a partial install.
 */
export function convertGuiPaletteLut(gameDir: string, outDir: string): Promise<PaletteLutResult> {
  return buildPaletteLut(gameDir, outDir, GUI_PALETTES, GUI_PALETTE_LUT_STEM, 'gui', 'palette');
}
