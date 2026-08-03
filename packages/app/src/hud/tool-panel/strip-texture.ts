import {
  bakeToFlippedSprite,
  oversampleFor,
  type PalettedSprite,
  type SupersampledTexture,
} from '@open-northland/render';
import { type Application, Container } from 'pixi.js';
import type { DesignRect } from './layout.js';

/**
 * Crisp fractional scaling for the left tool-panel strip, the layout half of the render-layer
 * supersample.
 *
 * The strip and buttons are `PalettedSprite` meshes over an indexed atlas sampled nearest, because
 * palette indices cannot be linearly filtered: an averaged index decodes to a wrong colour. At a
 * fractional `uiscale` that nearest sampling doubles some texel columns and not others, so the meshes are
 * placed at an integer oversample into a texture that is then drawn linear-downscaled to display size.
 * This module owns the layout; the render helper owns the texture and the WebGL Y-flip.
 */

/**
 * Oversample cap for `oversampleFor`, which targets double the `uiscale × renderer.resolution` device px
 * per design px so the linear downscale anti-aliases. The cap bounds the texture memory a pathological
 * `?uiscale=` and DPR combination could request. Flat panel edges need no quality floor.
 */
const MAX_SUPERSAMPLE = 6;
const MIN_SUPERSAMPLE = 1;

/** One panel mesh plus its design-space rect, pre-scale. */
export interface StripSpriteSpec {
  readonly spr: PalettedSprite;
  readonly design: DesignRect;
}

export type SupersampledStrip = SupersampledTexture;

/**
 * Build the supersampled strip: place `sprites` at an integer oversample into a texture and anchor the
 * returned display sprite at the strip's design origin. `bounds` is the design-space union the meshes
 * occupy; `scale` is the fractional display scale.
 */
export function createSupersampledStrip(opts: {
  readonly app: Application;
  readonly bounds: DesignRect;
  readonly scale: number;
  readonly sprites: readonly StripSpriteSpec[];
}): SupersampledStrip {
  const { app, bounds, scale, sprites } = opts;

  // Integer oversample so nearest sampling stays exact, sized at double the device px the display sprite
  // covers so the linear downscale anti-aliases the palette edges.
  const ss = oversampleFor(scale, app.renderer.resolution, MIN_SUPERSAMPLE, MAX_SUPERSAMPLE);
  const texW = Math.ceil(bounds.w * ss);
  const texH = Math.ceil(bounds.h * ss);

  // Place every mesh in texture texel space. A PalettedSprite maps native px to target px through its own
  // uResolution rather than the scene-graph transform, so it renders into an off-screen target unchanged.
  const offscreen = new Container();
  for (const { spr, design } of sprites) {
    spr.place((design.x - bounds.x) * ss, (design.y - bounds.y) * ss, ss, texW, texH);
    offscreen.addChild(spr);
  }

  const baked = bakeToFlippedSprite(app.renderer, offscreen, texW, texH, scale / ss);
  // Anchor at the strip's design bottom-left, since the Y-flip draws the sprite upward, so its top-left
  // lands at `bounds × scale` where the pinned hit-test geometry expects it.
  baked.display.position.set(bounds.x * scale, (bounds.y + bounds.h) * scale);
  return baked;
}
