import type { WorldRenderer } from '@open-northland/render';
import { type Application, TexturePool } from 'pixi.js';
import type { CameraController } from '../camera/index.js';

export function createWorldTeardown(deps: {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WorldRenderer;
  readonly cameraCtl: CameraController;
  readonly disposeSession: () => void;
}): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    deps.disposeSession();
    deps.cameraCtl.dispose();
    deps.renderer.dispose();
    // The filter system still binds its last pooled target when the destroyed view prunes the pool, which
    // Pixi warns about; the pool forgets its idle targets first, and the renderer frees their GPU copies.
    TexturePool.clear(false);
    deps.app.destroy(false, { children: true });
    // The next renderer needs a fresh canvas after this one's WebGL context is destroyed.
    deps.canvas.replaceWith(deps.canvas.cloneNode(false));
  };
}
