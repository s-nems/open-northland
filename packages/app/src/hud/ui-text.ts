import { Container, Text } from 'pixi.js';
import type { FontColorName } from '../content/font-gfx.js';
import { CAP_TOP_RATIO, UI_TEXT_FILL } from '../content/ui-font.js';
import type { TextRun } from './text-run.js';

/**
 * The HUD's default text face: the bundled vector serif drawn as Pixi `Text`, which rasters crisp at the
 * HUD's fractional UI scale where an indexed bitmap glyph can only be blocky or hazy. The decoded `.fnt`
 * path in `bitmap-text.ts` stays for text that must be the exact original face.
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
