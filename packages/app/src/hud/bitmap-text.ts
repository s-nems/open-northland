import { PalettedSprite, type SpriteLayer, type TextureSource } from '@vinland/render';
import { Container, Text } from 'pixi.js';
import {
  type FontColorName,
  type FontMetrics,
  type GlyphMetric,
  fontColorRow,
  loadFontColorLut,
  loadFontIndexed,
  loadFontMetrics,
} from '../content/font-gfx.js';

/**
 * A glyph-run drawer for the decoded `.fnt` bitmap fonts — the first runtime consumer of the pipeline's
 * font outputs. A `.fnt` glyph atlas is INDEXED (like the settler/GUI atlases), so each glyph is drawn by a
 * {@link PalettedSprite} reading the `256 × 4` font colour LUT: same mechanism as player/GUI colours, one
 * row per colour (white/dark/dimmed/red). Layout follows the original's top-anchored model (OpenVikings
 * `CFont.cs`): blit each non-empty glyph at `pen + (offsetX, offsetY)`, advance the pen by the glyph's
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
/** Pixi-`Text` fallback colours mirroring the four font-LUT rows. */
const FALLBACK_COLORS: Readonly<Record<FontColorName, string>> = {
  white: '#f2ead6',
  dark: '#2a2118',
  dimmed: '#9a8f78',
  red: '#c8503c',
};

/** Load a UI bitmap font (indexed atlas + colour LUT + metrics), or `null` if the pipeline hasn't run. */
export async function loadBitmapFont(key: string = DEFAULT_FONT_KEY): Promise<BitmapFont | null> {
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
}

function glyphFor(font: BitmapFont, code: number): GlyphMetric | undefined {
  const i = code - font.metrics.firstChar;
  if (i < 0 || i >= font.metrics.glyphs.length) return undefined;
  return font.metrics.glyphs[i];
}

/** One placed glyph sprite plus the native-pixel pen offset it sits at within the run. */
interface RunGlyph {
  readonly sprite: PalettedSprite;
  readonly penX: number;
}

/** A retained, re-placeable line of HUD text — bitmap glyphs when the `.fnt` is loaded, else a Pixi `Text`. */
export interface TextRun {
  /** Parent this under the panel's window/menu container for draw order (position is via {@link place}). */
  readonly container: Container;
  /** Anchor the run's top-left at screen `(x, y)`, drawn at `scale` px per native pixel. */
  place(x: number, y: number, scale: number, resWidth: number, resHeight: number): void;
  destroy(): void;
}

/**
 * Build a retained run of bitmap glyphs for `text` in the given colour row. Empty glyphs advance the pen but
 * draw nothing (the original's space quirk sidestepped). The run starts unplaced — call {@link TextRun.place}.
 */
export function createBitmapTextRun(font: BitmapFont, text: string, colorRow: number): TextRun {
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
        container.addChild(sprite);
        glyphs.push({ sprite, penX: pen });
      }
    }
    pen += g.advance;
  }
  return {
    container,
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
 * The HUD's ONE text factory: a bitmap-font run when the decoded `.fnt` is present, else a Pixi `Text`
 * at the same {@link TextRun} surface (so callers place/destroy runs identically in both modes).
 */
export function makeTextRun(
  font: BitmapFont | null,
  text: string,
  color: FontColorName,
  scale: number,
): TextRun {
  if (font !== null) return createBitmapTextRun(font, text, fontColorRow(color));
  const t = new Text({
    text,
    style: { fill: FALLBACK_COLORS[color], fontSize: FALLBACK_TEXT_PX * scale, fontFamily: 'sans-serif' },
  });
  const container = new Container();
  container.addChild(t);
  return {
    container,
    place: (x, y) => container.position.set(x, y),
    destroy: () => container.destroy({ children: true }),
  };
}
