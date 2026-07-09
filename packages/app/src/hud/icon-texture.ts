import { type AtlasFrame, type PalettedSprite, bakeToFlippedSprite, oversampleFor } from '@vinland/render';
import { type Application, Container, type Sprite } from 'pixi.js';

/**
 * Crisp fractional scaling for a single round HUD icon (the settler action-ring order buttons) — the
 * per-icon twin of the tool panel's {@link import('./tool-panel/strip-texture.js')}, over the same
 * render-layer supersample ({@link bakeToFlippedSprite}).
 *
 * The order buttons are {@link PalettedSprite} meshes over an INDEXED atlas, drawn with the `'round'` colour
 * key (hard-clipped to the inscribed disc in the shader). At a fractional UI scale the nearest sampling
 * stair-steps the disc rim and the hard clip aliases the circle. Fix it by supersampling: bake the icon at
 * an INTEGER oversample into a texture (nearest is exact at an integer zoom, the clip is a clean high-res
 * circle), then draw it linear-downscaled — the downscale anti-aliases the disc edge uniformly. This module
 * owns the layout (oversample choice, centering); the render helper owns the texture + the WebGL Y-flip.
 *
 * Unlike the static strip, the ring is dynamic: the icon art is baked ONCE here, and the caller repositions
 * the returned display sprite on the settlers' centroid every frame.
 */

/** Oversample cap — the small disc icons are already crisp by here; the cap bounds texture memory. */
const MAX_SUPERSAMPLE = 6;
/** Oversample floor — a smooth downscaled CIRCLE wants a bit more headroom than the strip's flat edges.
 *  At small effective scales this floor deliberately EXITS oversampleFor's (1, 2] downscale window (e.g.
 *  uiscale 1 at DPR 1 → ratio ~2.9): the slight linear-tap undersample is accepted for the rim smoothing. */
const MIN_SUPERSAMPLE = 3;

export interface BakedIcon {
  /** The display sprite (add to the scene graph); position it each frame with {@link placeBakedIcon}. */
  readonly display: Sprite;
  /** The drawn size in CSS px (`frame.width/height × scale`) — the caller centres by it. */
  readonly width: number;
  readonly height: number;
  dispose(): void;
}

/**
 * Bake one round order-icon into a supersampled texture and return a linear-downscaled display sprite. The
 * sprite's Y is flipped by {@link bakeToFlippedSprite} (a WebGL render-texture is bottom-up), so
 * {@link placeBakedIcon} anchors it at the box bottom.
 */
export function bakeRoundIcon(opts: {
  readonly app: Application;
  readonly sprite: PalettedSprite;
  readonly frame: AtlasFrame;
  readonly scale: number;
}): BakedIcon {
  const { app, sprite, frame, scale } = opts;

  // Integer oversample so nearest sampling stays exact; sized at DOUBLE the DEVICE px the icon covers
  // so the downscale anti-aliases (see oversampleFor), floored so the disc rim always has headroom.
  const ss = oversampleFor(scale, app.renderer.resolution, MIN_SUPERSAMPLE, MAX_SUPERSAMPLE);
  const texW = Math.ceil(frame.width * ss);
  const texH = Math.ceil(frame.height * ss);

  // Place the mesh so the frame's content box fills the texture: origin cancels the frame's draw offset,
  // zoom = ss, resolution = the texture size (a PalettedSprite maps native px → target px itself via its own
  // uResolution — it doesn't ride the scene-graph transform). The detached container is owned by dispose.
  sprite.place(-frame.offsetX * ss, -frame.offsetY * ss, ss, texW, texH);
  const offscreen = new Container();
  offscreen.addChild(sprite);

  const baked = bakeToFlippedSprite(app.renderer, offscreen, texW, texH, scale / ss);
  return {
    display: baked.display,
    width: frame.width * scale,
    height: frame.height * scale,
    dispose: baked.dispose,
  };
}

/** The bottom-anchored top-left origin (screen px) that centres a `width × height` baked icon in `rect`. */
export function bakedIconOrigin(
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  return {
    // Centre horizontally; the Y-flip draws the sprite UPWARD from its origin, so anchor at the box BOTTOM
    // (centre + height/2) — a sign error here silently renders every icon vertically off-centre.
    x: Math.round(rect.x + rect.w / 2 - width / 2),
    y: Math.round(rect.y + rect.h / 2 + height / 2),
  };
}

/** Centre a baked icon's display sprite in a layout rect (bottom-anchored for the Y-flip). */
export function placeBakedIcon(
  icon: BakedIcon,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): void {
  const { x, y } = bakedIconOrigin(rect, icon.width, icon.height);
  icon.display.position.set(x, y);
}
