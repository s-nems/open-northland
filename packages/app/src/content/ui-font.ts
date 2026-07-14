/**
 * The details panel's vector text face — a deliberate, named approximation of the original UI font.
 *
 * The original game draws HUD text with a small (~10 px) bitmap `.fnt` face (decoded by the `fonts`
 * pipeline stage, drawn by `hud/bitmap-text.ts`), a transitional serif. At the panel's fractional UI
 * scale a 10 px bitmap has no sub-pixel detail to stay crisp — upscaling reads as the "postrzępiona"
 * (frayed) text the original bitmap path produced. So the details panel swaps it for Tinos — a
 * metric-compatible "Times"-class serif (Apache-2.0; see `public/fonts/LICENSE-Tinos.txt`) — rendered as
 * vector Pixi text that stays sharp at any scale. The bitmap path stays for the tool-panel HUD.
 *
 * Coverage: the UI strings are Polish (CP1250-origin), so two woff2 subsets are registered under one family
 * — Latin (ASCII + Latin-1 + the punctuation range the tables use) and Latin-Extended (the Polish
 * diacritics ą ć ę ł ń ó ś ź ż). The browser (and the canvas text raster Pixi uses) composes glyphs across
 * both faces of the family.
 */

/** The text fill colours (shared with the bitmap font's fallback), re-exported so callers import one name. */
export { FONT_FILL as UI_TEXT_FILL } from './font-gfx.js';

/** A Pixi `Text` top-anchors at its line-box top, this fraction of the font size above the visible cap
 *  tops (measured for Tinos: `fontBoundingBoxAscent − actualBoundingBoxAscent ≈ 0.22 em`). Both text kits
 *  subtract it so a caller's `y` means the visible glyph top, matching the bitmap path's baseline contract. */
export const CAP_TOP_RATIO = 0.22;

/** The registered family name (both subsets share it); paired with a serif fallback stack in {@link UiFont}. */
const UI_FONT_FAMILY = 'OpenNorthlandUi';
/**
 * System serifs to fall back to before generic `serif`, chosen to stay close to the Tinos/Times look if
 * the bundled woff2 ever fails to load (offline first paint, a stripped build).
 */
const SERIF_FALLBACK = "'Times New Roman', Georgia, 'Nimbus Roman', serif";

/** One registered subset: its woff2 (served from `public/fonts/`) and the codepoints it carries. */
interface FontSubset {
  readonly file: string;
  readonly unicodeRange: string;
}

/**
 * The two Tinos subsets. `unicodeRange`s are the canonical Google-Fonts `latin` / `latin-ext` ranges — the
 * `latin` range already includes U+2000–206F (the em dash / ellipsis / curly quotes the string tables use),
 * so ASCII + Latin-1 + those punctuation marks come from `latin` and the Polish letters from `latin-ext`.
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
  /** The family stack: the bundled Tinos (when it loaded) ahead of the serif fallback. */
  readonly family: string;
}

/** The `document.fonts` methods used here — `add` is absent from this TS lib.dom revision though every browser ships it. */
type FontRegistry = { add(font: FontFace): void };

let uiFontOnce: Promise<UiFont> | null = null;

/**
 * Register the bundled Tinos subsets as one browser font family and resolve once they are ready to raster.
 * Memoized (several panels share the family). Degrades to the serif fallback stack — never throws — when
 * the `FontFace` API is absent (headless test / SSR) or a subset fails to load, so a `Text` always renders.
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
      // A missing/blocked woff2: keep the serif fallback so text stays legible (just not the exact face).
      return fallback;
    }
  })();
  return uiFontOnce;
}
