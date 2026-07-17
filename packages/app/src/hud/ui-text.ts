import { Container, Text } from 'pixi.js';
import type { FontColorName } from '../content/font-gfx.js';
import { CAP_TOP_RATIO, UI_TEXT_FILL } from '../content/ui-font.js';
import type { TextRun } from './text-run.js';

/**
 * The HUD's default text face: the bundled vector serif (`content/ui-font.ts`, "Tinos") drawn as Pixi
 * `Text`. It replaces the decoded `.fnt` bitmap path for the on-screen HUD windows because a small indexed
 * bitmap glyph has no sub-pixel detail — at the HUD's fractional UI scale it can only be blocky or hazy,
 * while a vector face rasters crisp at any scale + device-pixel-ratio.
 *
 * The `.fnt` path (`bitmap-text.ts`) stays for anything that must be the exact decoded original face, but
 * new HUD text should default here.
 */

/** Default text size in design px (scaled by uiscale). Matches the details panel's body size. */
const UI_TEXT_PX = 11;
/**
 * Build a retained {@link TextRun} in the vector UI font at `basePx * scale`. Placement positions the run's
 * visible cap-top at `(x, y)` (the `resWidth`/`resHeight` args are ignored — a stage-space `Text` needs no
 * projection resolution, unlike the bitmap font's screen-space meshes). `width` is the run's advance in
 * native (pre-scale) px, so centring math matches the bitmap runs.
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
