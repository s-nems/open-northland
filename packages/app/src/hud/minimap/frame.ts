import { bakeToSprite, oversampleFor } from '@open-northland/render';
import type { Renderer } from 'pixi.js';
import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import { loadGuiArt, makeGuiSprite } from '../../content/gui-art.js';
import { GUI_FRAME } from '../../content/gui-atlas-map.js';
import { keyEdgeConnectedNearBlack, outlineOpaqueSilhouette } from './frame-keying.js';
import { FRAME_NATIVE } from './model.js';

/**
 * The minimap's braided window frame, from the original overview-window art (`ls_gui_window` bob 55). A
 * checkout without `content/` returns null and the mount draws its flat fallback frame. Two one-time
 * raster passes shape the sprite: an integer-oversample bake for the nearest-sampled indexed art, then a
 * readback that keys the removable backdrop by connectivity and restores the silhouette rim.
 */

/** `oversampleFor` bounds: braid highlights want ≥2 for smoothing headroom; 8 caps texture memory. */
const FRAME_SS_FLOOR = 2;
const FRAME_SS_CAP = 8;

/**
 * Warm carved-wood tint multiplied onto the baked braid. The original draw-site palette is not
 * established, so the braid keeps 'iconsleft''s shading contrast and this tint warms it to wood: a named
 * approximation.
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
  // 'magenta' keys only the atlas's transparent sentinel; the near-black backdrop is keyed after the bake.
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
  made.sprite.flipY = true; // bakeToSprite renders an upright source
  offscreen.addChild(made.sprite);
  made.sprite.place(0, 0, ss, texW, texH);
  const baked = bakeToSprite(renderer, offscreen, texW, texH, 1);
  let extracted: ReturnType<typeof renderer.extract.pixels>;
  try {
    // Alphas are exactly 0 or 255 at an integer nearest scale, so premultiplication is identity and this
    // readback sees exact LUT colours.
    extracted = renderer.extract.pixels(baked.display.texture);
  } finally {
    baked.display.destroy();
    baked.dispose();
  }
  const { pixels, width, height } = extracted;
  keyEdgeConnectedNearBlack(pixels, width, height);
  // The keying eats the art's own dark contour, which touches the backdrop, so redraw a 1-native-px
  // (= ss baked px) black rim to stop the silhouette fraying against the world.
  outlineOpaqueSilhouette(pixels, width, height, ss);
  const texture = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      width,
      height,
      scaleMode: 'linear', // the fractional downscale to display size stays smooth
    }),
  });
  try {
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
  } catch (error: unknown) {
    texture.destroy(true);
    throw error;
  }
}
