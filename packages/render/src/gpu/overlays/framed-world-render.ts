import type { Application, Container, Rectangle, RenderOptions, Sprite } from 'pixi.js';
import type { Camera } from '../../data/projection/index.js';
import { restoreStash, stashHidden } from '../visibility.js';

/** Pixi's public `RenderOptions` omits `frame`, though the runtime honours it as the viewport region in
 *  the target's logical px. Undocumented API, verified on pixi.js 8.19: re-verify on a Pixi bump, since
 *  a dropped `frame` would paint the re-aimed world over the whole canvas instead of the box. */
interface FramedRenderOptions extends RenderOptions {
  readonly frame: Rectangle;
}

/** One re-aimed render of the world into a screen region. */
export interface FramedWorldRender {
  /** Frame-local: `offsetX`/`offsetY` place the world relative to the frame's top-left. */
  readonly camera: Camera;
  /** The screen region painted, in logical px. */
  readonly frame: Rectangle;
  /** The `0xRRGGBB` floor under the world; null keeps whatever the stage render left there. */
  readonly fill: number | null;
  /** The one world layer left visible, for a render of a single subject; null draws them all. */
  readonly keep: Container | null;
}

/**
 * A second, frame-limited screen render of `worldLayer` re-aimed by `pass.camera`, painted over what the
 * stage render drew (`clear: false`), so it must run after that render. The world transform, the
 * layer visibilities and the `floor` quad's parenting are restored even if the render throws.
 */
export function renderFramedWorld(
  app: Application,
  worldLayer: Container,
  floor: Sprite,
  pass: FramedWorldRender,
): void {
  const scale = pass.camera.scale ?? 1;
  const saved = { scale: worldLayer.scale.x, x: worldLayer.position.x, y: worldLayer.position.y };
  worldLayer.scale.set(scale);
  worldLayer.position.set(pass.camera.offsetX, pass.camera.offsetY);
  const stash = pass.keep === null ? null : stashHidden(worldLayer.children, pass.keep);
  try {
    if (pass.fill !== null) {
      floor.tint = pass.fill;
      floor.position.set(-pass.camera.offsetX / scale, -pass.camera.offsetY / scale);
      floor.width = pass.frame.width / scale;
      floor.height = pass.frame.height / scale;
      worldLayer.addChildAt(floor, 0);
    }
    const options: FramedRenderOptions = { container: worldLayer, clear: false, frame: pass.frame };
    app.renderer.render(options);
  } finally {
    floor.removeFromParent();
    if (stash !== null) restoreStash(stash);
    worldLayer.scale.set(saved.scale);
    worldLayer.position.set(saved.x, saved.y);
  }
}
