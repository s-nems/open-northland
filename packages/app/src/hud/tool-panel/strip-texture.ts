import {
  bakeToFlippedSprite,
  oversampleFor,
  type PalettedSprite,
  type SupersampledTexture,
} from '@vinland/render';
import { type Application, Container } from 'pixi.js';
import type { DesignRect } from './layout.js';

/**
 * Crisp fractional scaling for the LEFT tool-panel strip — the layout half of the render-layer supersample
 * ({@link bakeToFlippedSprite}).
 *
 * The strip + buttons are {@link PalettedSprite} meshes over an INDEXED atlas (red = palette index), read
 * through the GUI palette LUT and sampled NEAREST — palette indices can't be linearly filtered (an averaged
 * index decodes to a wrong colour). Drawn straight at a fractional `uiscale` (the 1.4× default) that nearest
 * sampling doubles some texel columns and not others ("pixeloza"). The fix is to supersample: place the
 * meshes at an INTEGER oversample `ss` into a texture, then draw that texture linear-downscaled to the
 * display size — this module owns the layout (design bounds → texel placement, the display anchor); the
 * render helper owns the texture + the WebGL Y-flip.
 *
 * This also makes the strip STATIC: it bakes once (and re-bakes only when a glyph changes, e.g. the
 * game-speed button — {@link SupersampledStrip.redraw}), replacing the old per-frame screen-space
 * re-placement of every panel mesh. The display `Sprite` is a normal scene-graph child, so it batches and
 * follows canvas resizes for free.
 */

/**
 * Oversample cap for {@link oversampleFor} (which targets DOUBLE the `uiscale × renderer.resolution`
 * device px per design px so the linear downscale anti-aliases — the 1.4× default at DPR 2 covers
 * 2.8 → ss 5). The cap bounds the texture memory a pathological `?uiscale=`/DPR combination could
 * request (the strip is 433 design px tall; ss 6 ≈ a 300×2598 texture, ~3 MB RGBA, baked once).
 * Flat panel edges need no quality floor (floor 1).
 */
const MAX_SUPERSAMPLE = 6;
const MIN_SUPERSAMPLE = 1;

/** One panel mesh plus its DESIGN-space rect (pre-scale) — the strip background or a tool button. */
export interface StripSpriteSpec {
  readonly spr: PalettedSprite;
  readonly design: DesignRect;
}

export type SupersampledStrip = SupersampledTexture;

/**
 * Build the supersampled strip: place `sprites` at an integer oversample into a texture (via
 * {@link bakeToFlippedSprite}) and anchor the returned display sprite at the strip's design origin. `bounds`
 * is the design-space union the meshes occupy (`layout.designBounds`); `scale` is the fractional display scale.
 */
export function createSupersampledStrip(opts: {
  readonly app: Application;
  readonly bounds: DesignRect;
  readonly scale: number;
  readonly sprites: readonly StripSpriteSpec[];
}): SupersampledStrip {
  const { app, bounds, scale, sprites } = opts;

  // Integer oversample so nearest sampling stays exact; sized at DOUBLE the DEVICE px the display
  // sprite covers so the linear downscale anti-aliases the palette edges (see oversampleFor).
  const ss = oversampleFor(scale, app.renderer.resolution, MIN_SUPERSAMPLE, MAX_SUPERSAMPLE);
  const texW = Math.ceil(bounds.w * ss);
  const texH = Math.ceil(bounds.h * ss);

  // Place every mesh in TEXTURE texel space: origin = ss × (designPos − boundsOrigin), zoom = ss, resolution
  // = the texture size (a PalettedSprite maps native px → target px itself via its own uResolution — it does
  // not ride the scene-graph transform, so it renders into the off-screen target the same way it would the
  // canvas). The detached container is owned by the returned handle's dispose.
  const offscreen = new Container();
  for (const { spr, design } of sprites) {
    spr.place((design.x - bounds.x) * ss, (design.y - bounds.y) * ss, ss, texW, texH);
    offscreen.addChild(spr);
  }

  const baked = bakeToFlippedSprite(app.renderer, offscreen, texW, texH, scale / ss);
  // Anchor at the strip's design BOTTOM-left (the Y-flip draws the sprite upward) so it lands exactly where
  // the pinned placed geometry (hit-testing) expects the top-left at `bounds × scale`.
  baked.display.position.set(bounds.x * scale, (bounds.y + bounds.h) * scale);
  return baked;
}
