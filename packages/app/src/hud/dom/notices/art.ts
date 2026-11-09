import { PLAYER_SWATCH_COLORS } from '../../../catalog/roster.js';
import { uiFoundationArt } from '../../../content/gui/ui-foundation.js';
import { teamColour } from '../../../view/accessibility/team-colour.js';
import type { NoticeGlyph } from '../../tool-panel/messages/cards.js';
import { createStaticPictures, showPicture } from '../static-picture.js';

/** The key colour's tint on a card about no seat: bone ivory, so an own settler's skull reads as bone. */
const UNTINTED_KEY_COLOUR = 0xe6dcc3;

/** The colour a card's key areas take (`0xRRGGBB`): the swatch of the seat it is about, through the
 *  session's colour slots when it has them. */
export function noticeTint(seat: number | null, colourSlotOf?: (player: number) => number): number {
  if (seat === null) return UNTINTED_KEY_COLOUR;
  const slot = colourSlotOf?.(seat) ?? seat;
  const swatch = PLAYER_SWATCH_COLORS[slot % PLAYER_SWATCH_COLORS.length];
  return swatch === undefined ? UNTINTED_KEY_COLOUR : teamColour(swatch);
}

/** A pixel belongs to the key while its green stays under this share of the red/blue peak. The atlas
 *  paints recolourable areas in the magenta family and uses it nowhere else. */
const KEY_GREEN_SHARE = 0.75;
/** The key's red and blue stay within this share of their peak of each other; russet and purple
 *  shades do not. */
const KEY_BALANCE_SHARE = 0.3;
/** Below this peak (0..255) a pixel is outline black whatever its cast. */
const KEY_FLOOR = 24;
const CHANNEL_MAX = 255;
const RGBA = 4;

/**
 * Recolour the key areas of straight-alpha RGBA `pixels` in place. A key pixel keeps its own value and
 * whiteness (the shade and highlight steps the artwork painted) and takes `tint`'s hue: `0xRRGGBB`.
 */
export function recolourKey(pixels: Uint8ClampedArray, tint: number): void {
  const tr = (tint >> 16) & CHANNEL_MAX;
  const tg = (tint >> 8) & CHANNEL_MAX;
  const tb = tint & CHANNEL_MAX;
  for (let i = 0; i < pixels.length; i += RGBA) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const peak = Math.max(r, b);
    if (peak < KEY_FLOOR || g > peak * KEY_GREEN_SHARE || Math.abs(r - b) > peak * KEY_BALANCE_SHARE)
      continue;
    const value = peak / CHANNEL_MAX;
    const white = g / peak;
    pixels[i] = value * (tr + (CHANNEL_MAX - tr) * white);
    pixels[i + 1] = value * (tg + (CHANNEL_MAX - tg) * white);
    pixels[i + 2] = value * (tb + (CHANNEL_MAX - tb) * white);
  }
}

export interface NoticeArt {
  /** Show `glyph`'s cell in `image` once the atlas has loaded, its key areas in `tint` (`0xRRGGBB`);
   *  false when the atlas has no such cell or failed to decode. `onFail` runs when the decode fails
   *  after a true return, so the caller can swap the image it already placed. */
  paint(image: HTMLImageElement, glyph: NoticeGlyph, tint: number, onFail: () => void): boolean;
}

/** The delivered notification icons, or null while the pack is unpublished. */
export function createNoticeArt(): NoticeArt | null {
  const art = uiFoundationArt();
  if (art === null) return null;
  const atlas = art.manifest.notices;
  const image = new Image();
  image.src = art.noticesUrl;
  let failed = false;
  const loaded = image.decode().catch(() => {
    failed = true;
  });
  // A battle raises the same few cards over and over; each glyph and tint is read back, recoloured and
  // kept once.
  const pictures = createStaticPictures();
  return {
    paint: (target, glyph, tint, onFail) => {
      const index = atlas.names.indexOf(glyph);
      if (index < 0 || failed) return false;
      const draw = (): void => {
        const picture = pictures.picture(`${glyph}:${tint}`, atlas.cell, atlas.cell, (ctx) => {
          const column = index % atlas.columns;
          const row = Math.floor(index / atlas.columns);
          ctx.drawImage(
            image,
            column * atlas.cell,
            row * atlas.cell,
            atlas.cell,
            atlas.cell,
            0,
            0,
            atlas.cell,
            atlas.cell,
          );
          const cell = ctx.getImageData(0, 0, atlas.cell, atlas.cell);
          recolourKey(cell.data, tint);
          ctx.putImageData(cell, 0, 0);
        });
        if (picture !== null) showPicture(target, picture);
      };
      void loaded.then(() => (failed ? onFail() : draw()));
      return true;
    },
  };
}
