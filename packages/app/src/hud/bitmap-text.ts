import { PalettedSprite, type SpriteLayer, type TextureSource } from '@open-northland/render';
import { Container, Text } from 'pixi.js';
import {
  FONT_FILL,
  type FontColorName,
  type FontMetrics,
  fontColorRow,
  type GlyphMetric,
  loadFontColorLut,
  loadFontIndexed,
  loadFontMetrics,
} from '../content/font-gfx.js';
import type { TextRun } from './text-run.js';

/**
 * A glyph-run drawer for the decoded `.fnt` bitmap fonts — the first runtime consumer of the pipeline's
 * font outputs. A `.fnt` glyph atlas is indexed (like the settler/GUI atlases), so each glyph is drawn by a
 * {@link PalettedSprite} reading the `256 × 4` font colour LUT: same mechanism as player/GUI colours, one
 * row per colour (white/dark/dimmed/red). Layout follows decoded glyph metrics: blit each non-empty
 * glyph at `pen + (offsetX, offsetY)`, advance the pen by the glyph's
 * `advance`, skip empty glyphs (space/undefined). See source basis ".fnt".
 *
 * A run is a retained `Container` of one PalettedSprite per glyph; {@link BitmapTextRun.place} re-anchors it
 * in screen pixels (the panel re-places on resize/scale change — screen-space meshes carry the resolution).
 */

/** A loaded bitmap font: its indexed glyph atlas + metrics + the shared colour LUT. */
export interface BitmapFont {
  readonly layer: SpriteLayer;
  readonly metrics: FontMetrics;
  readonly lut: TextureSource;
  /** LUT row count (its pixel height) — passed to each `PalettedSprite`. */
  readonly colours: number;
}

/** The UI bitmap font the HUD draws text with (font10 is the standard in-game body font). */
export const DEFAULT_FONT_KEY = 'font10';
/** Fallback (no-`.fnt`) text size in design px, scaled by uiscale — kept legible inside the scaled row rects. */
const FALLBACK_TEXT_PX = 9;

const fontOnce = new Map<string, Promise<BitmapFont | null>>();

/**
 * Load a UI bitmap font (indexed atlas + colour LUT + metrics), or `null` if the pipeline hasn't run.
 * Memoized per key and page — several HUD panels mount the same font and must share its textures.
 */
export function loadBitmapFont(key: string = DEFAULT_FONT_KEY): Promise<BitmapFont | null> {
  let once = fontOnce.get(key);
  if (once === undefined) {
    once = (async () => {
      try {
        const [layer, lut, metrics] = await Promise.all([
          loadFontIndexed(key).catch(() => null),
          loadFontColorLut(),
          loadFontMetrics(key),
        ]);
        if (layer === null || lut === undefined || metrics === null) return null;
        return { layer, metrics, lut, colours: lut.pixelHeight };
      } catch {
        return null;
      }
    })();
    fontOnce.set(key, once);
  }
  return once;
}

/**
 * Unicode codepoint → CP1250 byte, for codepoints above 0xFF. The decoded UI strings are Unicode
 * (the pipeline decodes the original CP1250 bytes), but the `.fnt` glyph table is indexed by the
 * original byte — so `ę`/`ż`/`Ś`... must be mapped back or their glyphs are silently skipped.
 * Codepoints ≤ 0xFF pass through unchanged, which is exact for every character CP1250 shares with
 * Latin-1 (`ó`, umlauts, ß) — a Latin-1 character CP1250 does not carry (e.g. `ñ`) would select a
 * wrong glyph, but the decoded CP1250-origin tables can't contain one. Source basis: the CP1250
 * code page (pinned by `test/bitmap-text.test.ts` against `TextDecoder('windows-1250')`); covers
 * the Polish set plus the CP1250 punctuation the string tables use.
 */
const CP1250_HIGH_CODEPOINTS: ReadonlyMap<number, number> = new Map([
  [0x104, 0xa5], // Ą
  [0x105, 0xb9], // ą
  [0x106, 0xc6], // Ć
  [0x107, 0xe6], // ć
  [0x118, 0xca], // Ę
  [0x119, 0xea], // ę
  [0x141, 0xa3], // Ł
  [0x142, 0xb3], // ł
  [0x143, 0xd1], // Ń
  [0x144, 0xf1], // ń
  [0x15a, 0x8c], // Ś
  [0x15b, 0x9c], // ś
  [0x179, 0x8f], // Ź
  [0x17a, 0x9f], // ź
  [0x17b, 0xaf], // Ż
  [0x17c, 0xbf], // ż
  [0x160, 0x8a], // Š
  [0x161, 0x9a], // š
  [0x17d, 0x8e], // Ž
  [0x17e, 0x9e], // ž
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x201e, 0x84], // „
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2026, 0x85], // …
]);

/** The CP1250 byte a Unicode codepoint maps to, or `undefined` when the code page has no slot for it. */
export function cp1250Byte(codepoint: number): number | undefined {
  return codepoint <= 0xff ? codepoint : CP1250_HIGH_CODEPOINTS.get(codepoint);
}

/** The high-codepoint map entries, exposed for the code-page regression test. */
export const CP1250_HIGH_ENTRIES: ReadonlyArray<readonly [number, number]> = [...CP1250_HIGH_CODEPOINTS];

function glyphFor(font: BitmapFont, codepoint: number): GlyphMetric | undefined {
  const code = cp1250Byte(codepoint);
  if (code === undefined) return undefined;
  const i = code - font.metrics.firstChar;
  if (i < 0 || i >= font.metrics.glyphs.length) return undefined;
  return font.metrics.glyphs[i];
}

/** One placed glyph sprite plus the native-pixel pen offset it sits at within the run. */
interface RunGlyph {
  readonly sprite: PalettedSprite;
  readonly penX: number;
}

/**
 * Build a retained run of bitmap glyphs for `text` in the given colour row. Empty glyphs advance the pen but
 * draw nothing (the original's space quirk sidestepped). The run starts unplaced — call {@link TextRun.place}.
 */
export function createBitmapTextRun(
  font: BitmapFont,
  text: string,
  colorRow: number,
  flipY = false,
): TextRun {
  const container = new Container();
  const { source, atlas } = font.layer;
  const glyphs: RunGlyph[] = [];
  let pen = 0;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(font, text.charCodeAt(i));
    if (g === undefined) continue;
    if (!g.empty) {
      const frame = atlas.frames.get(g.bobId);
      if (frame !== undefined) {
        const sprite = new PalettedSprite(font.lut, font.colours);
        sprite.setFrame(source, frame, atlas.width, atlas.height);
        sprite.player = colorRow;
        sprite.flipY = flipY;
        container.addChild(sprite);
        glyphs.push({ sprite, penX: pen });
      }
    }
    pen += g.advance;
  }
  return {
    container,
    width: pen,
    place(x, y, scale, resWidth, resHeight): void {
      for (const { sprite, penX } of glyphs) {
        sprite.place(x + penX * scale, y, scale, resWidth, resHeight);
      }
    },
    destroy(): void {
      container.destroy({ children: true });
    },
  };
}

/**
 * The HUD's one text factory: a bitmap-font run when the decoded `.fnt` is present, else a Pixi `Text`
 * at the same {@link TextRun} surface (so callers place/destroy runs identically in both modes).
 */
export function makeTextRun(
  font: BitmapFont | null,
  text: string,
  color: FontColorName,
  scale: number,
  flipY = false,
): TextRun {
  if (font !== null) return createBitmapTextRun(font, text, fontColorRow(color), flipY);
  const t = new Text({
    text,
    style: { fill: FONT_FILL[color], fontSize: FALLBACK_TEXT_PX * scale, fontFamily: 'sans-serif' },
  });
  const container = new Container();
  container.addChild(t);
  return {
    container,
    // The Pixi Text is already rendered at `scale`× the design size, so its screen width divided by
    // the scale mirrors the bitmap runs' native-px convention.
    width: t.width / Math.max(1e-6, scale),
    place: (x, y) => container.position.set(x, y),
    destroy: () => container.destroy({ children: true }),
  };
}
