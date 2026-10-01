import {
  cellColourResolver,
  flatTileColour,
  type MinimapFeature,
  type SceneTerrain,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { BufferImageSource, type Container, Sprite, Texture } from 'pixi.js';
import { diag } from '../../diag/index.js';
import type { Rect } from '../geometry.js';
import { type MinimapBaker, type MinimapBakerFactory, minimapBakeScene } from './bake.js';
import { standingNodesRevision, standingObjects } from './live-objects.js';

/** The least wall time between two bakes for a change of the standing forest and ore, in ms. */
export const OBJECT_REBAKE_INTERVAL_MS = 4000;
/** The revision no snapshot reports, so the first sync bakes the object lanes. */
const UNBAKED = -1;

export interface MinimapSurfaceDeps {
  readonly container: Container;
  readonly terrain: SceneTerrain;
  readonly cellColours?: Uint32Array | undefined;
  readonly colourOf?: ((typeId: number) => number | undefined) | undefined;
  /** The feature a standing node of each sim good type draws as; a good absent here draws nothing. */
  readonly featureOfGoodType: ReadonlyMap<number, MinimapFeature>;
  /** Whole-map raster space; the owner transforms and clips all map layers together. */
  readonly map: Rect;
  readonly resolution: () => number;
  readonly baker: MinimapBakerFactory;
  /** Wall-clock ms. */
  readonly now: () => number;
}

export interface MinimapSurface {
  /** Rebake when the display resolution changed, or the standing forest and ore did at most once per
   *  {@link OBJECT_REBAKE_INTERVAL_MS}. A bake runs on the baker; its picture lands on a later sync. */
  sync(snapshot: WorldSnapshot): void;
  dispose(): void;
}

export function createMinimapSurface(deps: MinimapSurfaceDeps): MinimapSurface {
  const { terrain, cellColours, colourOf, featureOfGoodType, map, resolution } = deps;
  const colours = cellColourResolver(cellColours, (id) => colourOf?.(id) ?? flatTileColour(id));
  const baker: MinimapBaker = deps.baker(minimapBakeScene(terrain, colours));
  let texture: Texture | null = null;
  const ground = new Sprite();
  ground.visible = false;
  ground.position.set(map.x, map.y);
  deps.container.addChild(ground);
  let bakedResolution = 0;
  let bakedRevision = UNBAKED;
  let objectsBakedAt = Number.NEGATIVE_INFINITY;
  let baking = false;
  let failed = false;
  let disposed = false;

  const show = (rgba: Uint8Array, width: number, height: number): void => {
    const next = new Texture({
      source: new BufferImageSource({ resource: rgba, width, height, scaleMode: 'linear' }),
    });
    ground.texture = next;
    ground.width = map.w;
    ground.height = map.h;
    ground.visible = true;
    texture?.destroy(true);
    texture = next;
  };

  return {
    sync: (snapshot) => {
      if (baking || failed || disposed) return;
      const scale = resolution();
      const revision = standingNodesRevision(snapshot, featureOfGoodType);
      const now = deps.now();
      const objectsDue = revision !== bakedRevision && now - objectsBakedAt >= OBJECT_REBAKE_INTERVAL_MS;
      if (scale === bakedResolution && !objectsDue) return;
      const width = Math.max(1, Math.round(map.w * scale));
      const height = Math.max(1, Math.round(map.h * scale));
      const objects = objectsDue ? standingObjects(snapshot, featureOfGoodType) : undefined;
      if (objectsDue) {
        bakedRevision = revision;
        objectsBakedAt = now;
      }
      baking = true;
      baker.bake(width, height, objects).then(
        (rgba) => {
          baking = false;
          if (disposed) return;
          bakedResolution = scale;
          show(rgba, width, height);
        },
        (err: unknown) => {
          baking = false;
          failed = true;
          if (!disposed) diag.warn('hud', `minimap ground bake failed: ${String(err)}`);
        },
      );
    },
    dispose: () => {
      disposed = true;
      baker.dispose();
      ground.destroy();
      texture?.destroy(true);
    },
  };
}
