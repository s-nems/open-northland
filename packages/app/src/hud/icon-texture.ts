import type { AtlasFrame, PalettedSprite } from '@vinland/render';
import { type Application, Container, RenderTexture, Sprite } from 'pixi.js';

/**
 * Crisp fractional scaling for a single round HUD icon (the settler action-ring order buttons) — the
 * per-icon twin of the tool panel's {@link import('./tool-panel/strip-texture.js')}.
 *
 * The order buttons are {@link PalettedSprite} meshes over an INDEXED atlas, drawn with the `'round'`
 * colour key (hard-clipped to the inscribed disc in the shader). At a fractional UI scale the nearest
 * sampling stair-steps the disc rim and the hard clip aliases the circle. Fix it by supersampling: bake the
 * icon at an INTEGER oversample into an off-screen texture (nearest is exact at an integer zoom, the clip is
 * a clean high-res circle), then draw that RESOLVED-RGBA texture as one ordinary `Sprite` LINEAR-downscaled
 * to the display size — the downscale anti-aliases the disc edge uniformly and DPR-independently (an
 * in-shader screen-space feather instead varied with the device pixel ratio and left corner specks).
 *
 * Unlike the static strip, the ring is dynamic: the icon art is baked ONCE here, and the caller repositions
 * the returned display sprite on the settlers' centroid every frame.
 */

/** Oversample cap — the small disc icons are already crisp by here; the cap bounds texture memory. */
const MAX_SUPERSAMPLE = 4;
/** Oversample floor — a smooth downscaled CIRCLE wants a bit more headroom than the strip's flat edges. */
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
 * sprite's Y is flipped (a WebGL render-texture is stored bottom-up and PalettedSprite hand-rolls its own
 * screen→clip projection — see its class note), so {@link placeBakedIcon} anchors it at the box bottom.
 */
export function bakeRoundIcon(opts: {
  readonly app: Application;
  readonly sprite: PalettedSprite;
  readonly frame: AtlasFrame;
  readonly scale: number;
}): BakedIcon {
  const { app, sprite, frame, scale } = opts;

  const dpr = app.renderer.resolution;
  const ss = Math.max(MIN_SUPERSAMPLE, Math.min(MAX_SUPERSAMPLE, Math.ceil(scale * dpr)));
  const texW = Math.ceil(frame.width * ss);
  const texH = Math.ceil(frame.height * ss);

  const texture = RenderTexture.create({ width: texW, height: texH, resolution: 1, antialias: false });
  texture.source.scaleMode = 'linear';

  // Place the mesh so the frame's content box fills the texture: origin cancels the frame's draw offset,
  // zoom = ss, resolution = the texture size (a PalettedSprite maps native px → target px itself via its own
  // uResolution — it doesn't ride the scene-graph transform, so it renders into the off-screen target the
  // same way it would the canvas). The detached container keeps it off the main stage render.
  sprite.place(-frame.offsetX * ss, -frame.offsetY * ss, ss, texW, texH);
  const offscreen = new Container();
  offscreen.addChild(sprite);
  app.renderer.render({ container: offscreen, target: texture, clear: true });

  const display = new Sprite(texture);
  display.scale.set(scale / ss, -(scale / ss));

  return {
    display,
    width: frame.width * scale,
    height: frame.height * scale,
    dispose(): void {
      offscreen.destroy({ children: true });
      texture.destroy(true);
    },
  };
}

/** Centre a baked icon's display sprite in a layout rect (bottom-anchored for the Y-flip). */
export function placeBakedIcon(
  icon: BakedIcon,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): void {
  icon.display.position.set(
    Math.round(rect.x + rect.w / 2 - icon.width / 2),
    Math.round(rect.y + rect.h / 2 + icon.height / 2),
  );
}
