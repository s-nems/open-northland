import { type Container, type Renderer, RenderTexture, Sprite } from 'pixi.js';

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
 * upside-down. Two ways out, one per caller shape:
 * - {@link bakeToFlippedSprite}: Y-flip the whole baked sprite (negative y-scale, caller BOTTOM-anchors).
 *   Correct only when EVERY element is a PalettedSprite (the tool-panel strip).
 * - {@link bakeToSprite}: the source already renders upright — Pixi-native content (Graphics, Sprites) plus
 *   PalettedSprites with `flipY = true` — so the display is NOT flipped (caller TOP-anchors). Use this when
 *   the source MIXES PalettedSprites with Pixi-native primitives (the details panel).
 *
 * The app forces a WebGL backend (`gpu/pixi-app.ts` `preference: 'webgl'`), so this inversion is fixed; a
 * WebGPU switch would revisit it once, here.
 */
/**
 * The integer oversample a supersampled bake needs. The display sprite spans `scale × resolution`
 * DEVICE px per design px; merely covering that (`ceil`) is not enough — at a near-integer device
 * scale (e.g. the 1.4× default on DPR 2 → 2.8 → ss 3) the downscale ratio lands ≈1 and the linear
 * tap barely averages, leaving nearest-hard palette edges (jagged icon rims on Retina). So the bake
 * targets DOUBLE the device coverage: `floor(2×)` pins the downscale ratio into (1, 2], where every
 * device px is fully covered by the GPU's 2×2 linear tap (a ratio above 2 would undersample) and
 * hard palette edges resolve anti-aliased. Integer device scales stay pixel-exact — each device px
 * then averages a uniform block of one source texel. The `ceil` term only bites below 0.5 device px
 * per design px, where `floor(2×)` alone would UPSCALE (there the (1, 2] guarantee yields to "never
 * upscale") — do not "simplify" the max away. `floor` is the caller's quality floor (a
 * hard-clipped disc rim wants ≥3 for smoothing headroom; a flat strip is fine from 1); `cap` bounds
 * the texture memory a pathological `?uiscale=`/DPR combination could request. Lives beside the
 * bake so the sizing policy can't drift between callers.
 */
export function oversampleFor(scale: number, resolution: number, floor: number, cap: number): number {
  const devicePerDesign = scale * resolution;
  const target = Math.max(Math.ceil(devicePerDesign), Math.floor(2 * devicePerDesign));
  return Math.max(floor, Math.min(cap, target));
}

export interface SupersampledTexture {
  /** The baked, linear-downscaled display sprite — the caller adds it to the scene + positions it. Y-flipped
   *  by {@link bakeToFlippedSprite} (bottom-anchor), upright by {@link bakeToSprite} (top-anchor). */
  readonly display: Sprite;
  /** Re-rasterize `source` into the texture (call after a mesh in it changes frame). */
  redraw(): void;
  dispose(): void;
}

/**
 * Rasterize `source` — a detached container already placed at an integer oversample into a `texW × texH`
 * box — into an off-screen texture and return it as ONE `Sprite` LINEAR-downscaled by `invScale`
 * (= displayScale ÷ oversample). `flipDisplay` negates the sprite's y-scale (see the module note): the
 * all-PalettedSprite path bakes upside-down and flips here (bottom-anchor); the mixed / `flipY`-per-mesh
 * path bakes upright and does not (top-anchor). Owns the texture + `source` lifetime via `dispose`.
 */
function bake(
  renderer: Renderer,
  source: Container,
  texW: number,
  texH: number,
  invScale: number,
  flipDisplay: boolean,
): SupersampledTexture {
  const texture = RenderTexture.create({ width: texW, height: texH, resolution: 1, antialias: false });
  texture.source.scaleMode = 'linear'; // linear so the fractional downscale to screen is smooth
  const redraw = (): void => {
    renderer.render({ container: source, target: texture, clear: true });
  };
  redraw();

  const display = new Sprite(texture);
  display.scale.set(invScale, flipDisplay ? -invScale : invScale);

  return {
    display,
    redraw,
    dispose(): void {
      source.destroy({ children: true });
      texture.destroy(true);
    },
  };
}

/** Bake an all-{@link PalettedSprite} source (renders upside-down into the texture); display Y-flipped,
 *  caller BOTTOM-anchors. See the module note. */
export function bakeToFlippedSprite(
  renderer: Renderer,
  source: Container,
  texW: number,
  texH: number,
  invScale: number,
): SupersampledTexture {
  return bake(renderer, source, texW, texH, invScale, true);
}

/** Bake an upright source (Pixi-native content + `flipY` PalettedSprites); display NOT flipped, caller
 *  TOP-anchors. Use when the source mixes PalettedSprites with Pixi-native primitives. See the module note. */
export function bakeToSprite(
  renderer: Renderer,
  source: Container,
  texW: number,
  texH: number,
  invScale: number,
): SupersampledTexture {
  return bake(renderer, source, texW, texH, invScale, false);
}
