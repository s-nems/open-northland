import { Sprite, Texture } from 'pixi.js';
import { readable2dContext } from './drawable-resource.js';

/**
 * The world post pass - a named OpenNorthland enhancement, not an original mechanism: one screen-space
 * multiply sprite over the world carrying a radial vignette with a warm grade baked into its gradient.
 * Deliberately not a Pixi `Filter` on the world layer, because the `PalettedSprite` meshes hand-roll
 * their screen→clip projection, so a filter's render-texture pass would draw every settler upside-down.
 * All constants below are tuned by eye.
 */

/** The grade at the screen centre (multiply tint): near-white with a gentle warm cast. */
const GRADE_CENTRE = { r: 255, g: 250, b: 242 } as const;
/** How much darker the vignette corners multiply than the centre (0 = off, 1 = black corners). */
const VIGNETTE_STRENGTH = 0.22;
/** Fraction of the corner radius where the vignette starts falling off (inside it: pure centre grade). */
const VIGNETTE_INNER_RADIUS = 0.55;
/** Baked gradient texture size (px). */
const VIGNETTE_TEXTURE_SIZE = 512;

/** Build the multiply-blended vignette sprite; the caller sizes it to the screen each frame. */
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
