import { bakeToSprite, oversampleFor } from '@open-northland/render';
import type { Renderer } from 'pixi.js';
import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import { loadGuiArt, makeGuiSprite } from '../../content/gui-art.js';
import { GUI_FRAME } from '../../content/gui-atlas-map.js';
import { keyEdgeConnectedNearBlack, outlineOpaqueSilhouette } from './frame-keying.js';
import { FRAME_NATIVE } from './model.js';

/**
 * The minimap's braided window frame — the original overview-window art (`ls_gui_window` bob 55, braid
 * along top+right, hole flush to the bottom-left screen corner; geometry measured in `model.ts`
 * {@link FRAME_NATIVE}). Loaded through the shared GUI-art path (indexed atlas + palette LUT, like the
 * tool panel); a checkout without `content/` returns null and the mount draws its flat fallback frame.
 *
 * Two one-time raster passes shape the sprite:
 * - The indexed art is nearest-sampled, so a fractional UI scale drawn straight is "pixeloza" — the frame
 *   is baked at an integer oversample and linear-downscaled (the tool-panel strip's fix,
 *   `render/gpu/supersample.ts`).
 * - The art fills the removable outside (margins + window hole) and the braid's own crevice shadows with
 *   one near-black band, so the shader's colour-only 'full' key would punch see-through holes in the braid.
 *   Instead the baked pixels are read back once and the outside band is keyed by connectivity
 *   ({@link keyEdgeConnectedNearBlack}) — the frame ends where the braid ends, enclosed shadows stay opaque.
 */

/** `oversampleFor` bounds: braid highlights want ≥2 for smoothing headroom; 8 caps texture memory. */
const FRAME_SS_FLOOR = 2;
const FRAME_SS_CAP = 8;

/**
 * Warm carved-wood tint multiplied onto the baked braid. The LUT's braid-coloured palettes are the
 * silver-olive 'iconsleft' (washed-out) and the order-buttons 'context' (garishly orange at this
 * size); the original draw-site palette has not been established, so the braid keeps 'iconsleft''s
 * shading contrast and this tint warms it to wood — a named approximation, montage-picked.
 */
const BRAID_WOOD_TINT = 0xc89868;

/** The mounted frame sprite: top-anchored; the caller positions it and owns `dispose`. */
export interface MinimapFrame {
  readonly display: Sprite;
  dispose(): void;
}

/**
 * Load + bake the braided frame at `artScale` drawn px per native px, or null when the GUI art is
 * absent.
 */
export async function loadMinimapFrame(
  renderer: Renderer,
  artScale: number,
  resolution: number,
): Promise<MinimapFrame | null> {
  const art = await loadGuiArt();
  if (art === null) return null;
  // 'magenta' keys only the atlas's transparent sentinel here — the near-black backdrop is keyed
  // after the bake, by connectivity (see the module note).
  const made = makeGuiSprite(art, GUI_FRAME.minimap_frame, {
    defaultPalette: 'iconsleft',
    palette: 'iconsleft',
    colorKey: 'magenta',
  });
  if (made === null) return null;
  const ss = oversampleFor(artScale, resolution, FRAME_SS_FLOOR, FRAME_SS_CAP);
  const texW = FRAME_NATIVE.w * ss;
  const texH = FRAME_NATIVE.h * ss;
  const offscreen = new Container();
  made.sprite.flipY = true; // bakeToSprite renders an upright source (see supersample.ts module note)
  offscreen.addChild(made.sprite);
  made.sprite.place(0, 0, ss, texW, texH);
  const baked = bakeToSprite(renderer, offscreen, texW, texH, 1);
  // One-time CPU readback of the oversampled bake (alphas are exactly 0/255 — nearest at an integer
  // scale — so premultiplication is identity and the flood fill sees exact LUT colours).
  const { pixels, width, height } = renderer.extract.pixels(baked.display.texture);
  baked.dispose();
  keyEdgeConnectedNearBlack(pixels, width, height);
  // The keying eats the art's own dark contour (it touches the backdrop), so the silhouette's last
  // pixels fray against the world — redraw a 1-native-px (= ss baked px) black rim around it.
  outlineOpaqueSilhouette(pixels, width, height, ss);
  const texture = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      width,
      height,
      scaleMode: 'linear', // the fractional downscale to display size stays smooth
    }),
  });
  const display = new Sprite(texture);
  display.scale.set(artScale / ss);
  display.tint = BRAID_WOOD_TINT;
  return {
    display,
    dispose(): void {
      display.destroy();
      texture.destroy(true);
    },
  };
}
