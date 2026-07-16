import { Sprite, Texture } from 'pixi.js';
import { readable2dContext } from './drawable-resource.js';

/**
 * The world post pass — an OpenNorthland visual enhancement, not an original mechanism: one
 * screen-space multiply sprite over the world (under the HUD) carrying a radial vignette with a warm
 * grade baked into its gradient. Deliberately NOT a Pixi `Filter` on the world layer: the team-colour
 * `PalettedSprite` meshes hand-roll their screen→clip projection (see `gpu/paletted-sprite/`), so a
 * layer filter's render-texture pass would draw every settler upside-down unless the whole `uFlip`
 * machinery were threaded through the main render. A true contrast/saturation grade needs that work —
 * a filed follow-up (docs/tickets/render/post-grade-filter.md); this sprite is the safe first pass:
 * zero batching impact, one extra draw call, trivially absent from the deterministic `?shot` capture.
 *
 * All constants are tuned by eye (named enhancement, human pass pending).
 */

/** The grade at the screen centre (multiply tint): near-white with a gentle warm cast. */
const GRADE_CENTRE = { r: 255, g: 250, b: 242 } as const;
/** How much darker the vignette corners multiply than the centre (0 = off, 1 = black corners). */
const VIGNETTE_STRENGTH = 0.22;
/** Fraction of the corner radius where the vignette starts falling off (inside it: pure centre grade). */
const VIGNETTE_INNER_RADIUS = 0.55;
/** Baked gradient texture size (px) — the linear-sampled radial gradient upscales smoothly. */
const VIGNETTE_TEXTURE_SIZE = 512;

/**
 * Build the multiply-blended vignette sprite, sized by the caller to the screen each frame. Returns
 * `null` when no 2d canvas is available to bake the gradient (the caller simply goes without).
 */
export function makeVignetteSprite(): Sprite | null {
  const ctx = readable2dContext(VIGNETTE_TEXTURE_SIZE, VIGNETTE_TEXTURE_SIZE);
  if (ctx === null) return null;
  const centre = VIGNETTE_TEXTURE_SIZE / 2;
  // Corner radius, so the full vignette strength lands exactly in the screen corners.
  const radius = Math.SQRT2 * centre;
  const gradient = ctx.createRadialGradient(
    centre,
    centre,
    radius * VIGNETTE_INNER_RADIUS,
    centre,
    centre,
    radius,
  );
  const { r, g, b } = GRADE_CENTRE;
  const edge = 1 - VIGNETTE_STRENGTH;
  gradient.addColorStop(0, `rgb(${r},${g},${b})`);
  gradient.addColorStop(1, `rgb(${Math.round(r * edge)},${Math.round(g * edge)},${Math.round(b * edge)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, VIGNETTE_TEXTURE_SIZE, VIGNETTE_TEXTURE_SIZE);
  const texture = Texture.from(ctx.canvas);
  texture.source.scaleMode = 'linear'; // the bake upscales to any screen size smoothly
  const sprite = new Sprite(texture);
  sprite.blendMode = 'multiply';
  return sprite;
}
