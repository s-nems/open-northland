import { type Container, RenderTexture, type Renderer, Sprite } from 'pixi.js';

/**
 * Off-screen supersampling for the screen-space {@link import('./paletted-sprite.js').PalettedSprite} HUD
 * meshes. The GUI art is a nearest-sampled INDEXED atlas (palette indices can't be linearly filtered), so
 * drawing it straight at a fractional UI scale doubles texel columns unevenly ("pixeloza"). The fix is to
 * rasterize the sprites at an INTEGER oversample into a texture (nearest is exact at an integer zoom) and
 * then draw that RESOLVED-RGBA texture as one ordinary `Sprite` LINEAR-downscaled to the display size — the
 * downscale is smooth, so the result is crisp with no pixeloza.
 *
 * The knowledge that lives HERE (not in the app callers): a WebGL render-texture is stored bottom-up, and a
 * {@link PalettedSprite} hand-rolls its own screen→clip projection assuming the on-screen Y convention (it
 * can't ride the scene-graph transform — see its class note), so rendering it into a texture lands it
 * upside-down. The returned sprite's Y is therefore FLIPPED (negative y-scale); the caller anchors it at the
 * box BOTTOM. The app forces a WebGL backend (`gpu/pixi-app.ts` `preference: 'webgl'`), so this inversion is
 * fixed; a WebGPU switch would revisit it once, here.
 */
/**
 * The integer oversample a supersampled bake needs: enough texels to cover every DEVICE pixel the
 * display sprite spans (`scale` screen px per design px × `resolution` device px per screen px), so the
 * linear downscale only ever shrinks. `floor` is the caller's quality floor (a hard-clipped disc rim
 * wants ≥3 for smoothing headroom; a flat strip is fine from 1); `cap` bounds the texture memory a
 * pathological `?uiscale=`/DPR combination could request. Lives beside the bake so the sizing policy
 * can't drift between callers.
 */
export function oversampleFor(scale: number, resolution: number, floor: number, cap: number): number {
  return Math.max(floor, Math.min(cap, Math.ceil(scale * resolution)));
}

export interface SupersampledTexture {
  /** The baked, linear-downscaled, Y-flipped display sprite — the caller adds it to the scene + positions it. */
  readonly display: Sprite;
  /** Re-rasterize `source` into the texture (call after a mesh in it changes frame). */
  redraw(): void;
  dispose(): void;
}

/**
 * Rasterize `source` — a detached container of {@link PalettedSprite}s already placed at an integer
 * oversample into a `texW × texH` box — into an off-screen texture, and return it as ONE `Sprite`
 * linear-downscaled by `invScale` (= displayScale ÷ oversample) with its Y flipped (see the module note; the
 * caller bottom-anchors it). Owns the texture + `source` lifetime via {@link SupersampledTexture.dispose}.
 */
export function bakeToFlippedSprite(
  renderer: Renderer,
  source: Container,
  texW: number,
  texH: number,
  invScale: number,
): SupersampledTexture {
  const texture = RenderTexture.create({ width: texW, height: texH, resolution: 1, antialias: false });
  texture.source.scaleMode = 'linear'; // linear so the fractional downscale to screen is smooth
  const redraw = (): void => {
    renderer.render({ container: source, target: texture, clear: true });
  };
  redraw();

  const display = new Sprite(texture);
  display.scale.set(invScale, -invScale);

  return {
    display,
    redraw,
    dispose(): void {
      source.destroy({ children: true });
      texture.destroy(true);
    },
  };
}
