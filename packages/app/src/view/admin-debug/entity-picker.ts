import {
  buildSpriteScene,
  cameraViewport,
  type DrawItem,
  type ElevationField,
  type EntityBounds,
  SPRITE_CULL_MARGIN,
} from '@open-northland/render';
import type { Application } from 'pixi.js';
import type { SessionHost } from '../../session/index.js';
import type { CameraController } from '../camera/index.js';
import { type Pickable, pickTopAt, screenToWorld } from '../picking.js';
import type { DebugTargetKind } from './actions-catalog.js';

export interface AdminEntityPickerDeps {
  readonly app: Application;
  readonly host: Pick<SessionHost, 'snapshot'>;
  readonly camera: CameraController;
  readonly toScreen: (clientX: number, clientY: number) => { x: number; y: number };
  readonly elevation?: ElevationField;
  /** Exact bounds and solid-texel test of an entity, the map's static layer included. */
  readonly boundsOf: (ref: number) => EntityBounds | undefined;
  readonly pixelHitOf: (ref: number, wx: number, wy: number) => boolean | undefined;
}

/** The fallback hit box of each drawn kind the eraser takes; a delivery flag draws as a `stockpile` too,
 *  but holds no good. */
function erasableBoxOf(item: DrawItem): 'resource' | 'pile' | null {
  if (item.kind === 'resource' || item.kind === 'berrybush') return 'resource';
  return (item.kind === 'stockpile' || item.kind === 'grounddrop') && item.goodType !== undefined
    ? 'pile'
    : null;
}

function matchesKind(item: DrawItem, kind: DebugTargetKind): boolean {
  switch (kind) {
    case 'any':
      return item.kind === 'building' || item.kind === 'settler' || item.kind === 'vehicle';
    case 'erasable':
      return erasableBoxOf(item) !== null;
    default:
      return item.kind === kind;
  }
}

/** Unlike gameplay picking, this picker matches entities of every owner. */
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
    for (const item of buildSpriteScene(deps.host.snapshot(), {
      viewport,
      elevation: deps.elevation,
    })) {
      if (!matchesKind(item, kind)) continue;
      const erasableBox = erasableBoxOf(item);
      targets.push({
        ref: item.ref,
        x: item.x,
        y: item.y,
        box: deps.boundsOf(item.ref),
        ...(erasableBox !== null ? { kind: erasableBox } : {}),
        ...(item.kind === 'building' || erasableBox !== null
          ? { pixelHit: (wx: number, wy: number) => deps.pixelHitOf(item.ref, wx, wy) }
          : {}),
      });
    }
    return pickTopAt(targets, world.x, world.y);
  };
}
