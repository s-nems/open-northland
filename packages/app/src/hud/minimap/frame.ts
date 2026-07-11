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

/** `oversampleFor` bounds: braid highlights want ≥2 for smoothing headroom; 6 caps texture memory. */
const FRAME_SS_FLOOR = 2;
const FRAME_SS_CAP = 6;

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
  // 'magenta' keys only the atlas's transparent sentinel: the frame's hole is OPAQUE near-black in the
  // art, so the mount draws the map window's content ABOVE the frame, inside the hole. The palette is
  // the sheet-preview 'iconsleft' (montage-verified braid colouring; the original draw site's palette
  // is not decompiled — a named approximation).
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
  return bakeToSprite(renderer, offscreen, texW, texH, artScale / ss);
}
