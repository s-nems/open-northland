import { type Container, Rectangle, type Renderer, RenderTexture, Sprite, Texture } from 'pixi.js';
import { clamp } from '../data/math.js';

/**
 * Off-screen supersampling for the screen-space `PalettedSprite` HUD meshes. Palette indices cannot be
 * linearly filtered, so nearest-sampled GUI art drawn straight at a fractional UI scale doubles texel
 * columns unevenly; rasterizing at an integer oversample and linear-downscaling that resolved-RGBA
 * texture is smooth instead. A baked source lands upside-down unless one side corrects it, so each bake
 * entry point states its flip.
 */

/**
 * The integer oversample for a supersampled bake. `floor(2×)` the device px per design px pins the
 * downscale ratio into (1, 2]: a ratio near 1 leaves nearest-hard palette edges, above 2 undersamples the
 * GPU's 2×2 linear tap. The `ceil` term only bites below 0.5 device px per design px, where `floor(2×)`
 * alone would upscale. `floor` is the caller's quality floor; `cap` bounds the bake's texture memory.
 */
export function oversampleFor(scale: number, resolution: number, floor: number, cap: number): number {
  const devicePerDesign = scale * resolution;
  const target = Math.max(Math.ceil(devicePerDesign), Math.floor(2 * devicePerDesign));
  return clamp(target, floor, cap);
}

export interface SupersampledTexture {
  readonly display: Sprite;
  /** Re-rasterize `source` into the texture (call after a mesh in it changes frame). */
  redraw(): void;
  dispose(): void;
}

/** `source` is a detached container already placed at an integer oversample into the `texW × texH` box;
 *  `invScale` is displayScale ÷ oversample. Owns the texture and `source` lifetime via `dispose`. */
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

/** Bake an all-PalettedSprite source: the display is Y-flipped and the caller bottom-anchors it. */
export function bakeToFlippedSprite(
  renderer: Renderer,
  source: Container,
  texW: number,
  texH: number,
  invScale: number,
): SupersampledTexture {
  return bake(renderer, source, texW, texH, invScale, true);
}

/** Bake an already-upright source (Pixi-native content plus `flipY` PalettedSprites): the display is not
 *  flipped and the caller top-anchors it. */
export function bakeToSprite(
  renderer: Renderer,
  source: Container,
  texW: number,
  texH: number,
  invScale: number,
): SupersampledTexture {
  return bake(renderer, source, texW, texH, invScale, false);
}

/** A {@link bakeToSprite} twin that reuses one render target across bakes. */
export interface ReusableBaker {
  bake(source: Container, texW: number, texH: number, invScale: number): SupersampledTexture;
  /** Free the shared render target (call once, after every outstanding bake is disposed). */
  dispose(): void;
}

/**
 * A baker for a caller that re-bakes frequently: one grow-only {@link RenderTexture} plus one persistent
 * frame view of it, reused as the render target so a rebuild allocates no GPU texture, and reallocated
 * only when a bake outgrows the target. Single-slot, because every bake reuses the one view: `bake`
 * throws while the previous bake is undisposed, since a second live handle would be silently retargeted.
 */
export function createReusableBaker(renderer: Renderer): ReusableBaker {
  let target: RenderTexture | null = null;
  let view: Texture | null = null;
  let outstanding = false;
  const ensure = (w: number, h: number): Texture => {
    if (target === null || view === null || target.width < w || target.height < h) {
      const grownW = Math.max(w, target?.width ?? 0);
      const grownH = Math.max(h, target?.height ?? 0);
      view?.destroy(false);
      target?.destroy(true);
      target = RenderTexture.create({ width: grownW, height: grownH, resolution: 1, antialias: false });
      target.source.scaleMode = 'linear';
      view = new Texture({ source: target.source, frame: new Rectangle(0, 0, w, h) });
    } else if (view.frame.width !== w || view.frame.height !== h) {
      view.frame.width = w;
      view.frame.height = h;
      view.updateUvs();
    }
    return view;
  };
  return {
    bake(source, texW, texH, invScale): SupersampledTexture {
      if (outstanding) throw new Error('ReusableBaker is single-slot: dispose the previous bake first');
      outstanding = true;
      const bakeView = ensure(texW, texH);
      const redraw = (): void => {
        renderer.render({ container: source, target: bakeView, clear: true });
      };
      redraw();
      const display = new Sprite(bakeView);
      display.scale.set(invScale);
      return {
        display,
        redraw,
        dispose(): void {
          outstanding = false;
          source.destroy({ children: true }); // the shared view + target stay with the baker
        },
      };
    },
    dispose(): void {
      view?.destroy(false);
      target?.destroy(true);
      view = null;
      target = null;
    },
  };
}
