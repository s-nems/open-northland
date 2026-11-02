import { createPixiApp } from '@open-northland/render';
import type { Container } from 'pixi.js';
import type { Rect } from '../geometry.js';

export interface OverviewCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly stage: Container;
  /** Draw `hole`, a screen rect of the stage, at `resolution` backing px per screen px. */
  render(hole: Rect, resolution: number): void;
  dispose(): void;
}

/**
 * The overview's own drawing surface. The game canvas lies under the whole DOM HUD, so a map drawn on it
 * cannot stand over the HUD; this canvas is a DOM element and stacks among the HUD like a window.
 */
export async function createOverviewCanvas(): Promise<OverviewCanvas> {
  const canvas = document.createElement('canvas');
  canvas.className = 'on-minimap-chrome__canvas';
  const app = await createPixiApp(canvas, 1, 1);
  let size = '';
  return {
    canvas,
    stage: app.stage,
    render: (hole, resolution) => {
      if (hole.w <= 0 || hole.h <= 0) return;
      const next = `${hole.w},${hole.h},${resolution}`;
      if (next !== size) {
        size = next;
        app.renderer.resize(hole.w, hole.h, resolution);
      }
      app.stage.position.set(-hole.x, -hole.y);
      app.render();
    },
    dispose: () => app.destroy(true),
  };
}
