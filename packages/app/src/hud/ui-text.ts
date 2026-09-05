import { Container, Text } from 'pixi.js';
import type { FontColorName } from '../content/font-gfx.js';
import { CAP_TOP_RATIO, UI_TEXT_FILL } from '../content/ui-font.js';
import type { ParagraphRun, TextRun } from './text-run.js';

/**
 * The HUD's default text face: the bundled vector serif drawn as Pixi `Text`, which rasters crisp at the
 * HUD's fractional UI scale where an indexed bitmap glyph can only be blocky or hazy.
 */

/** Default text size in design px, scaled by uiscale. */
const UI_TEXT_PX = 11;
/**
 * Build a retained {@link TextRun} in the vector UI font at `basePx * scale`, placed by its visible
 * cap-top, with `width` as the advance in native pre-scale px. The `resWidth`/`resHeight` place args are
 * ignored: a stage-space `Text` needs no projection resolution.
 */
export function makeUiTextRun(
  family: string,
  text: string,
  color: FontColorName,
  scale: number,
  basePx: number = UI_TEXT_PX,
): TextRun {
  const fontSize = basePx * scale;
  const t = new Text({ text, style: { fill: UI_TEXT_FILL[color], fontSize, fontFamily: family } });
  const container = new Container();
  container.addChild(t);
  return {
    container,
    width: t.width / Math.max(1e-6, scale),
    place: (x, y) => container.position.set(Math.round(x), Math.round(y - CAP_TOP_RATIO * fontSize)),
    destroy: () => container.destroy({ children: true }),
  };
}

/** Body line height as a multiple of the font size; the wrap keeps the original's airy paragraph rhythm. */
const PARAGRAPH_LINE_HEIGHT = 1.35;

/**
 * Build a retained {@link ParagraphRun}: `text` in the vector UI font at `basePx * scale`, word-wrapped to
 * `wrapWidth` design px and drawn `align`ed inside it. Explicit line breaks in `text` are kept.
 */
export function makeUiParagraph(
  family: string,
  text: string,
  color: FontColorName,
  scale: number,
  basePx: number,
  wrapWidth: number,
  align: 'left' | 'center' = 'left',
): ParagraphRun {
  const fontSize = basePx * scale;
  const t = new Text({
    text,
    style: {
      fill: UI_TEXT_FILL[color],
      fontSize,
      fontFamily: family,
      lineHeight: fontSize * PARAGRAPH_LINE_HEIGHT,
      wordWrap: true,
      wordWrapWidth: wrapWidth * scale,
      breakWords: true,
      align,
    },
  });
  const container = new Container();
  container.addChild(t);
  const inv = 1 / Math.max(1e-6, scale);
  return {
    container,
    width: t.width * inv,
    height: t.height * inv,
    place: (x, y) => container.position.set(Math.round(x), Math.round(y)),
    destroy: () => container.destroy({ children: true }),
  };
}
