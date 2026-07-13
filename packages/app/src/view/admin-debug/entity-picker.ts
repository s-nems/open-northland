import {
  buildSpriteScene,
  cameraViewport,
  type ElevationField,
  SPRITE_CULL_MARGIN,
  type WorldRenderer,
} from '@open-northland/render';
import type { Simulation } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { CameraController } from '../camera.js';
import { type Pickable, pickTopAt, screenToWorld } from '../picking.js';
import type { DebugTargetKind } from './actions-catalog.js';

export interface AdminEntityPickerDeps {
  readonly app: Application;
  readonly sim: Simulation;
  readonly renderer: WorldRenderer;
  readonly camera: CameraController;
  readonly toScreen: (clientX: number, clientY: number) => { x: number; y: number };
  readonly elevation?: ElevationField;
}

/**
 * Build the admin palette's rare click-time entity picker. It projects only the current camera viewport,
 * includes every owner, and refines building boxes through the renderer's solid-pixel hit test.
 */
export function createAdminEntityPicker(
  deps: AdminEntityPickerDeps,
): (clientX: number, clientY: number, kind: DebugTargetKind) => number | null {
  return (clientX, clientY, kind) => {
    const camera = deps.camera.camera();
    const point = deps.toScreen(clientX, clientY);
    const world = screenToWorld(camera, point.x, point.y);
    const viewport = cameraViewport(
      camera,
      deps.app.screen.width,
      deps.app.screen.height,
      SPRITE_CULL_MARGIN + (deps.elevation?.maxLift ?? 0),
    );
    const targets: Pickable[] = [];
    for (const item of buildSpriteScene(deps.sim.snapshot(), {
      viewport,
      elevation: deps.elevation,
    })) {
      if (item.kind !== kind) continue;
      targets.push({
        ref: item.ref,
        x: item.x,
        y: item.y,
        box: deps.renderer.entityBounds(item.ref),
        ...(kind === 'building'
          ? {
              pixelHit: (wx: number, wy: number) => deps.renderer.entityPixelHit(item.ref, wx, wy),
            }
          : {}),
      });
    }
    return pickTopAt(targets, world.x, world.y);
  };
}
