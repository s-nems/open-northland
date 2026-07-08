import type { PalettedSprite } from '@vinland/render';
import { type Application, Container, RenderTexture, Sprite } from 'pixi.js';
import type { DesignRect } from './layout.js';

/**
 * Crisp fractional scaling for the LEFT tool-panel strip.
 *
 * The strip + buttons are {@link PalettedSprite} meshes over an INDEXED atlas (red = palette index), read
 * through the GUI palette LUT and sampled NEAREST — palette indices can't be linearly filtered (an averaged
 * index decodes to a wrong colour). Drawn straight at a fractional `uiscale` (the 1.2× default) that
 * nearest sampling doubles some texel columns and not others ("pixeloza"). The only correct fix is to
 * supersample: rasterize the panel at an INTEGER oversample `ss` (nearest is exact at an integer zoom) into
 * an off-screen {@link RenderTexture}, then draw that RESOLVED-RGB texture as one ordinary `Sprite`
 * LINEAR-downscaled to the fractional display size. Downsampling RGB is smooth, so the result is crisp with
 * no pixeloza and no blur (it is a down-, never an up-scale).
 *
 * This also makes the strip STATIC: it bakes once (and re-bakes only when a glyph changes, e.g. the
 * game-speed button — {@link SupersampledStrip.redraw}), replacing the old per-frame screen-space
 * re-placement of every panel mesh. The display `Sprite` is a normal scene-graph child, so it batches and
 * follows canvas resizes for free.
 */

/**
 * Oversample cap. `ss = ceil(scale × dpr)` needs at most this for any sane `uiscale` (≤ ~2×, since the
 * strip is 433 design px tall) on a ≤2× DPR display; the cap only bounds the texture memory a pathological
 * `?uiscale=` could request. Past this the panel is already crisp.
 */
const MAX_SUPERSAMPLE = 4;

/** One panel mesh plus its DESIGN-space rect (pre-scale) — the strip background or a tool button. */
export interface StripSpriteSpec {
  readonly spr: PalettedSprite;
  readonly design: DesignRect;
}

export interface SupersampledStrip {
  /** The single display sprite to add to the scene graph (the baked, downscaled strip). */
  readonly display: Sprite;
  /** Re-rasterize the strip into the texture — call after a panel mesh's frame changes (speed glyph). */
  redraw(): void;
  dispose(): void;
}

/**
 * Build the supersampled strip: rasterize `sprites` into an off-screen texture at an integer oversample and
 * return a linear-downscaled display sprite anchored at the strip's design origin (top-left). `bounds` is
 * the design-space union the meshes occupy (`layout.designBounds`); `scale` is the fractional display scale.
 */
export function createSupersampledStrip(opts: {
  readonly app: Application;
  readonly bounds: DesignRect;
  readonly scale: number;
  readonly sprites: readonly StripSpriteSpec[];
}): SupersampledStrip {
  const { app, bounds, scale, sprites } = opts;

  // Oversample at least to the device resolution so the texture holds ≥ 1 texel per device pixel — then the
  // draw to screen is always a downscale (crisp), never an upscale-blur. Integer so nearest stays exact.
  const dpr = app.renderer.resolution;
  const ss = Math.max(1, Math.min(MAX_SUPERSAMPLE, Math.ceil(scale * dpr)));
  const texW = Math.ceil(bounds.w * ss);
  const texH = Math.ceil(bounds.h * ss);

  const texture = RenderTexture.create({ width: texW, height: texH, resolution: 1, antialias: false });
  // Linear so the fractional downscale to the screen is smooth; the source→texture pass is 1:1 integer.
  texture.source.scaleMode = 'linear';

  // Place every mesh in TEXTURE texel space: origin = ss × (designPos − boundsOrigin), zoom = ss, resolution
  // = the texture size (a PalettedSprite maps native px → target px itself via its own uResolution — it does
  // not ride the scene-graph transform, so it renders into the off-screen target the same way it would the
  // canvas). Kept in a detached container so the main stage render never draws them.
  const offscreen = new Container();
  for (const { spr, design } of sprites) {
    spr.place((design.x - bounds.x) * ss, (design.y - bounds.y) * ss, ss, texW, texH);
    offscreen.addChild(spr);
  }

  const redraw = (): void => {
    app.renderer.render({ container: offscreen, target: texture, clear: true });
  };
  redraw();

  const display = new Sprite(texture);
  // Shrink the ss-oversampled texture back to `scale` CSS-px per design px so the drawn strip lands exactly
  // where the pinned placed geometry (hit-testing) expects it.
  //
  // Y is FLIPPED (negative y-scale, anchored at the strip's bottom edge): a WebGL render-texture is stored
  // bottom-up, and PalettedSprite hand-rolls its own screen→clip projection (it can't ride the scene-graph
  // transform — see its class note) assuming the ON-SCREEN Y convention, so rendering it into the texture
  // lands it upside-down. Flipping the display sprite reads it back upright. (The app forces a WebGL backend
  // — `render/gpu/pixi-app.ts` `preference: 'webgl'` — so this inversion is fixed; a WebGPU switch would
  // need this revisited.)
  display.scale.set(scale / ss, -(scale / ss));
  display.position.set(bounds.x * scale, (bounds.y + bounds.h) * scale);

  return {
    display,
    redraw,
    dispose(): void {
      offscreen.destroy({ children: true });
      texture.destroy(true);
    },
  };
}
