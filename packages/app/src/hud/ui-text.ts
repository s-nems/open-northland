import { Container, Text } from 'pixi.js';
import type { FontColorName } from '../content/font-gfx.js';
import { UI_TEXT_FILL } from '../content/ui-font.js';
import type { TextRun } from './bitmap-text.js';

/**
 * The HUD's DEFAULT text face: the bundled vector serif (`content/ui-font.ts`, "Tinos") drawn as Pixi
 * `Text`. It replaces the decoded `.fnt` bitmap path for the on-screen HUD windows because a small indexed
 * bitmap glyph has no sub-pixel detail — at the HUD's fractional UI scale it can only be blocky or hazy
 * ("niewyraźna"), while a vector face rasters crisp at any scale + device-pixel-ratio. The details panel
 * already proved this face; making it the shared HUD default keeps every window's text consistent and sharp.
 *
 * The `.fnt` path (`bitmap-text.ts`) stays for anything that must be the exact decoded original face, but
 * new HUD text should default here.
 */

/** Default text size in DESIGN px (scaled by uiscale). Matches the details panel's body size. */
export const UI_TEXT_PX = 11;
/**
 * A `Text` top-anchors at its line box top, which sits this fraction of the font size ABOVE the visible cap
 * tops (measured for Tinos: `fontBoundingBoxAscent − actualBoundingBoxAscent ≈ 0.22 em`). {@link TextRun.place}
 * subtracts it so a caller's `y` means the visible glyph top — matching the bitmap path's baseline contract.
 */
const CAP_TOP_RATIO = 0.22;

/**
 * Build a retained {@link TextRun} in the vector UI font at `basePx * scale`. Placement positions the run's
 * visible cap-top at `(x, y)` (the `resWidth`/`resHeight` args are ignored — a stage-space `Text` needs no
 * projection resolution, unlike the bitmap font's screen-space meshes). `width` is the run's advance in
 * NATIVE (pre-scale) px, so centring math matches the bitmap runs.
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
