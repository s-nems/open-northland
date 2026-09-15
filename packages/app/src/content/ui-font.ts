/**
 * The HUD's vector text face. Approximation: the original draws HUD text with a small (~10 px) bitmap
 * `.fnt` serif, which has no sub-pixel detail to stay crisp at the HUD's fractional UI scale, so the HUD
 * substitutes Tinos, a metric-compatible "Times"-class serif (Apache-2.0, see
 * `public/fonts/LICENSE-Tinos.txt`) rendered as vector text by Pixi and by the DOM pickers.
 */

/** The text fill colours, shared with the bitmap font's fallback. */
export { FONT_FILL as UI_TEXT_FILL } from './font-gfx.js';

/** A Pixi `Text` top-anchors at its line-box top, this fraction of the font size above the visible cap
 *  tops (measured for Tinos: `fontBoundingBoxAscent − actualBoundingBoxAscent ≈ 0.22 em`). Subtracting it
 *  makes a caller's `y` mean the visible glyph top. */
export const CAP_TOP_RATIO = 0.22;

const UI_FONT_FAMILY = 'OpenNorthlandUi';
/** System serifs close to the Tinos/Times look, tried before generic `serif`. */
const SERIF_FALLBACK = "'Times New Roman', Georgia, 'Nimbus Roman', serif";

/** One registered subset: its woff2 (served from `public/fonts/`) and the codepoints it carries. */
interface FontSubset {
  readonly file: string;
  readonly unicodeRange: string;
}

/**
 * The two Tinos subsets, using the canonical Google-Fonts `latin` / `latin-ext` ranges: `latin` already
 * covers the U+2000-206F punctuation the string tables use, and `latin-ext` carries the Polish letters.
 */
const SUBSETS: readonly FontSubset[] = [
  {
    file: '/fonts/tinos-latin-400.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
  {
    file: '/fonts/tinos-latinext-400.woff2',
    unicodeRange:
      'U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
];

/** A loaded UI font: the CSS `font-family` string a Pixi `TextStyle` draws with. */
export interface UiFont {
  readonly family: string;
}

/** `add` is absent from this TS lib.dom revision though every browser ships it. */
type FontRegistry = { add(font: FontFace): void };

let uiFontOnce: Promise<UiFont> | null = null;

/**
 * Register the bundled Tinos subsets as one browser family and resolve once they are ready to raster.
 * Memoized, and never throws: an absent `FontFace` API or a failed subset degrades to the serif fallback.
 */
export function loadUiFont(): Promise<UiFont> {
  if (uiFontOnce !== null) return uiFontOnce;
  const fallback: UiFont = { family: SERIF_FALLBACK };
  const canRegister =
    typeof document !== 'undefined' && typeof FontFace !== 'undefined' && document.fonts !== undefined;
  if (!canRegister) {
    uiFontOnce = Promise.resolve(fallback);
    return uiFontOnce;
  }
  uiFontOnce = (async () => {
    try {
      await Promise.all(
        SUBSETS.map(async (subset) => {
          const face = new FontFace(UI_FONT_FAMILY, `url(${subset.file}) format('woff2')`, {
            weight: '400',
            style: 'normal',
            unicodeRange: subset.unicodeRange,
          });
          await face.load();
          (document.fonts as unknown as FontRegistry).add(face);
        }),
      );
      return { family: `${UI_FONT_FAMILY}, ${SERIF_FALLBACK}` };
    } catch {
      return fallback;
    }
  })();
  return uiFontOnce;
}
