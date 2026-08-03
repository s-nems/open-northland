import {
  type AtlasFrame,
  bakeToFlippedSprite,
  oversampleFor,
  type PalettedSprite,
} from '@open-northland/render';
import { type Application, Container, type Sprite } from 'pixi.js';

/**
 * Crisp fractional scaling for a single round HUD icon, over the render-layer supersample.
 *
 * The order buttons are `PalettedSprite` meshes drawn with the `'round'` colour key, hard-clipped to the
 * inscribed disc in the shader. At a fractional UI scale nearest sampling stair-steps the rim and the hard
 * clip aliases the circle, so the icon is baked at an integer oversample and drawn linear-downscaled. This
 * module owns the layout; the render helper owns the texture and the WebGL Y-flip.
 */

/** Oversample cap; the small disc icons are already crisp by here, and the cap bounds texture memory. */
const MAX_SUPERSAMPLE = 6;
/** Oversample floor for the disc rim. It deliberately exits `oversampleFor`'s (1, 2] downscale window at
 *  small effective scales, accepting a slight linear-tap undersample for the smoother rim. */
const MIN_SUPERSAMPLE = 3;

export interface BakedIcon {
  /** The display sprite (add to the scene graph); position it each frame with {@link placeBakedIcon}. */
  readonly display: Sprite;
  /** The drawn size in CSS px (`frame.width/height × scale`) - the caller centres by it. */
  readonly width: number;
  readonly height: number;
  dispose(): void;
}

/**
 * Bake one round order-icon into a supersampled texture and return a linear-downscaled display sprite.
 * Its Y is flipped, because a WebGL render-texture is bottom-up, so `placeBakedIcon` anchors it at the
 * box bottom.
 */
export function bakeRoundIcon(opts: {
  readonly app: Application;
  readonly sprite: PalettedSprite;
  readonly frame: AtlasFrame;
  readonly scale: number;
}): BakedIcon {
  const { app, sprite, frame, scale } = opts;

  // Integer oversample so nearest sampling stays exact, sized at double the device px the icon covers so
  // the downscale anti-aliases, and floored so the disc rim always has headroom.
  const ss = oversampleFor(scale, app.renderer.resolution, MIN_SUPERSAMPLE, MAX_SUPERSAMPLE);
  const texW = Math.ceil(frame.width * ss);
  const texH = Math.ceil(frame.height * ss);

  // Place the mesh so the frame's content box fills the texture, cancelling the frame's draw offset. A
  // PalettedSprite maps native px to target px through its own uScreen, not the scene-graph transform.
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
    // The Y-flip draws the sprite upward from its origin, so the vertical anchor is the box bottom.
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
