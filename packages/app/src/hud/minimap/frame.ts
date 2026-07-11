import { type SupersampledTexture, bakeToSprite, oversampleFor } from '@vinland/render';
import type { Renderer } from 'pixi.js';
import { Container } from 'pixi.js';
import { loadGuiArt, makeGuiSprite } from '../../content/gui-art.js';
import { GUI_FRAME } from '../../content/gui-atlas-map.js';
import { FRAME_NATIVE } from './model.js';

/**
 * The minimap's braided window frame — the ORIGINAL overview-window art (`ls_gui_window` bob 55,
 * braid along top+right, hole flush to the bottom-left screen corner; geometry measured in
 * `model.ts` {@link FRAME_NATIVE}). Loaded through the shared GUI-art path (indexed atlas + palette
 * LUT, like the tool panel); a checkout without `content/` returns null and the mount draws its flat
 * fallback frame at the same geometry.
 *
 * The indexed art is nearest-sampled, so a fractional UI scale drawn straight is "pixeloza" — the
 * frame is BAKED once at an integer oversample and linear-downscaled (the tool-panel strip's fix,
 * `render/gpu/supersample.ts`), yielding an ordinary top-anchored Sprite that rides the container.
 */

/** `oversampleFor` bounds: braid highlights want ≥2 for smoothing headroom; 8 caps texture memory. */
const FRAME_SS_FLOOR = 2;
const FRAME_SS_CAP = 8;

/**
 * Warm carved-wood tint multiplied onto the baked braid. The LUT's clean-keying palettes are the
 * silver-olive 'iconsleft' (washed-out) and the order-buttons 'context' (garishly orange at this
 * size); the original draw site's palette is not decompiled, so the braid keeps 'iconsleft''s
 * shading contrast and this tint warms it to wood — a named approximation, montage-picked.
 */
const BRAID_WOOD_TINT = 0xc89868;

/**
 * Load + bake the braided frame at `artScale` drawn px per native px, or null when the GUI art is
 * absent. The returned display sprite is top-anchored; the caller positions it and owns `dispose`.
 */
export async function loadMinimapFrame(
  renderer: Renderer,
  artScale: number,
  resolution: number,
): Promise<SupersampledTexture | null> {
  const art = await loadGuiArt();
  if (art === null) return null;
  // The art fills everything around the braid (the hole AND the outer margins) with OPAQUE near-black,
  // so 'full' keys that whole band away and the frame ends where the braid graphic ends — the world
  // shows through the margins, and the mount's own hole backdrop supplies the window black.
  const made = makeGuiSprite(art, GUI_FRAME.minimap_frame, {
    defaultPalette: 'iconsleft',
    palette: 'iconsleft',
    colorKey: 'full',
  });
  if (made === null) return null;
  const ss = oversampleFor(artScale, resolution, FRAME_SS_FLOOR, FRAME_SS_CAP);
  const texW = FRAME_NATIVE.w * ss;
  const texH = FRAME_NATIVE.h * ss;
  const offscreen = new Container();
  made.sprite.flipY = true; // bakeToSprite renders an upright source (see supersample.ts module note)
  offscreen.addChild(made.sprite);
  made.sprite.place(0, 0, ss, texW, texH);
  const baked = bakeToSprite(renderer, offscreen, texW, texH, artScale / ss);
  baked.display.tint = BRAID_WOOD_TINT;
  return baked;
}
