import {
  bakeToFlippedSprite,
  oversampleFor,
  type PalettedSprite,
  type SupersampledTexture,
} from '@open-northland/render';
import { type Application, Container } from 'pixi.js';
import type { DesignRect } from './layout.js';

/**
 * Crisp fractional scaling for the left tool-panel strip: palette indices cannot be linearly filtered, so
 * the meshes sample nearest and are placed at an integer oversample into a texture that is then drawn
 * linear-downscaled to the fractional `uiscale`. The render helper owns that texture and its WebGL Y-flip.
 */

/**
 * Oversample cap for `oversampleFor`, which targets double the `uiscale × renderer.resolution` device px
 * per design px so the linear downscale anti-aliases. The cap is authored to bound texture memory; above
 * it (a high derived scale on HiDPI, e.g. 4K at DPR 2) the bake displays upscaled and the art softens.
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
 * occupy.
 */
export function createSupersampledStrip(opts: {
  readonly app: Application;
  readonly bounds: DesignRect;
  readonly scale: number;
  readonly sprites: readonly StripSpriteSpec[];
}): SupersampledStrip {
  const { app, bounds, scale, sprites } = opts;

  const ss = oversampleFor(scale, app.renderer.resolution, MIN_SUPERSAMPLE, MAX_SUPERSAMPLE);
  const texW = Math.ceil(bounds.w * ss);
  const texH = Math.ceil(bounds.h * ss);

  // Meshes are placed in texture texel space: a PalettedSprite maps native px to target px through its
  // own uResolution rather than the scene-graph transform.
  const offscreen = new Container();
  for (const { spr, design } of sprites) {
    spr.place((design.x - bounds.x) * ss, (design.y - bounds.y) * ss, ss, texW, texH);
    offscreen.addChild(spr);
  }

  const baked = bakeToFlippedSprite(app.renderer, offscreen, texW, texH, scale / ss);
  // The Y-flip draws the sprite upward, so anchoring at the design bottom-left lands its top-left at
  // `bounds × scale`, where the pinned hit-test geometry expects it.
  baked.display.position.set(bounds.x * scale, (bounds.y + bounds.h) * scale);
  return baked;
}
