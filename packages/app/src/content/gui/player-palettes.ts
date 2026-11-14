import { decodeAtlasPalette } from '@open-northland/formats/atlas/paletted-sheet';
import type { PaletteLut } from '@open-northland/render';
import { BufferImageSource } from 'pixi.js';
import { PLAYER_COLOR_COUNT, playerSignAtlasStem } from '../../catalog/roster.js';
import { loadServedBobAtlas } from '../bob-atlases.js';

/** One LUT texel per palette entry. */
const LUT_WIDTH = 256;
const RGB = 3;
const RGBA = 4;
const OPAQUE = 255;

let lutOnce: Promise<PaletteLut | null> | null = null;

/**
 * Every colour slot's `human_playerNN` palette as a `256 × PLAYER_COLOR_COUNT` LUT, row = colour slot:
 * the palettes the original draws the GUI sheet's player-coloured bobs through, read off the sign stems
 * the pipeline colours with them. `null` when the atlas catalogue or a slot's sign stem is not served.
 * Memoized per page.
 */
export function loadPlayerPaletteLut(): Promise<PaletteLut | null> {
  lutOnce ??= (async () => {
    const signs = await Promise.all(
      Array.from({ length: PLAYER_COLOR_COUNT }, (_, slot) => loadServedBobAtlas(playerSignAtlasStem(slot))),
    );
    const rows = new Uint8Array(LUT_WIDTH * PLAYER_COLOR_COUNT * RGBA);
    for (const [slot, sign] of signs.entries()) {
      const palette = sign?.sheet.palette;
      if (palette === undefined) return null;
      const colours = decodeAtlasPalette(palette);
      let at = slot * LUT_WIDTH * RGBA;
      for (let i = 0; i < colours.length; i += RGB, at += RGBA) {
        rows[at] = colours[i] ?? 0;
        rows[at + 1] = colours[i + 1] ?? 0;
        rows[at + 2] = colours[i + 2] ?? 0;
        rows[at + 3] = OPAQUE;
      }
    }
    const source = new BufferImageSource({
      resource: rows,
      width: LUT_WIDTH,
      height: PLAYER_COLOR_COUNT,
      format: 'rgba8unorm',
      scaleMode: 'nearest',
    });
    return { source, colours: PLAYER_COLOR_COUNT };
  })();
  return lutOnce;
}
