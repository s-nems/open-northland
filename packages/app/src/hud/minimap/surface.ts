import {
  cellColourResolver,
  flatTileColour,
  type MinimapFeature,
  type SceneTerrain,
} from '@open-northland/render';
import type { FogView, WorldSnapshot } from '@open-northland/sim';
import { BufferImageSource, type Container, Sprite, Texture } from 'pixi.js';
import { diag } from '../../diag/index.js';
import type { Rect } from '../geometry.js';
import {
  createMinimapRasterizer,
  type MinimapBaker,
  type MinimapBakerFactory,
  minimapBakeScene,
} from './bake.js';
import { createSeenStandingObjects } from './live-objects.js';

/** The least wall time between two looks for a change of the seen forest and ore, in ms. */
export const OBJECT_REBAKE_INTERVAL_MS = 4000;
/** The widest bake in raster widths per display px; a map shown wider upscales it. Measured on
 *  magiczny_las at DPR 2: the capped 2640x1172 bake takes about 400 ms on the worker. */
export const MAX_BAKE_ZOOM = 2;
/** Wall ms a new bake size must hold before it bakes, so a wheel-zoom burst asks for one bake. */
export const BAKE_SIZE_SETTLE_MS = 250;

export interface MinimapSurfaceDeps {
  readonly container: Container;
  readonly terrain: SceneTerrain;
  readonly cellColours?: Uint32Array | undefined;
  readonly colourOf?: ((typeId: number) => number | undefined) | undefined;
  /** The feature a standing node of each sim good type draws as; a good absent here draws nothing. */
  readonly featureOfGoodType: ReadonlyMap<number, MinimapFeature>;
  /** Whole-map raster space; the owner transforms and clips all map layers together. */
  readonly map: Rect;
  /** Display px per screen px. */
  readonly resolution: () => number;
  /** The whole map's drawn width in screen px, its own zoom included. */
  readonly shownWidth: () => number;
  readonly baker: MinimapBakerFactory;
  /** Wall-clock ms. */
  readonly now: () => number;
}

export interface MinimapSurface {
  /** Rebake when the bake size, the shown width in display px up to {@link MAX_BAKE_ZOOM} raster widths,
   *  settled on a new value, or the forest and ore the viewer sees through `fog` changed, looked for at
   *  most once per {@link OBJECT_REBAKE_INTERVAL_MS}. A bake runs on the baker, one at a time; the shown
   *  picture stays until the next lands on a later sync. A failed bake bakes once on the calling thread
   *  and stops rebaking. */
  sync(snapshot: WorldSnapshot, fog: FogView | null): void;
  dispose(): void;
}

export function createMinimapSurface(deps: MinimapSurfaceDeps): MinimapSurface {
  const { terrain, cellColours, colourOf, featureOfGoodType, map, resolution, shownWidth } = deps;
  const colours = cellColourResolver(cellColours, (id) => colourOf?.(id) ?? flatTileColour(id));
  const scene = minimapBakeScene(terrain, colours);
  const baker: MinimapBaker = deps.baker(scene);
  let texture: Texture | null = null;
  const ground = new Sprite();
  ground.visible = false;
  ground.position.set(map.x, map.y);
  deps.container.addChild(ground);
  let bakedWidth = 0;
  let wantedWidth = 0;
  let wantedSince = Number.NEGATIVE_INFINITY;
  const seenObjects = createSeenStandingObjects(featureOfGoodType);
  let objectsCheckedAt = Number.NEGATIVE_INFINITY;
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
    sync: (snapshot, fog) => {
      const width = Math.max(1, Math.round(Math.min(shownWidth(), map.w * MAX_BAKE_ZOOM) * resolution()));
      const now = deps.now();
      if (width !== wantedWidth) {
        wantedWidth = width;
        wantedSince = now;
      }
      if (baking || failed || disposed) return;
      // The first bake goes at once; a later size waits for the shown width or resolution to settle.
      const sizeDue = width !== bakedWidth && (bakedWidth === 0 || now - wantedSince >= BAKE_SIZE_SETTLE_MS);
      let objectsDue = false;
      if (now - objectsCheckedAt >= OBJECT_REBAKE_INTERVAL_MS && seenObjects.stale(snapshot, fog)) {
        objectsCheckedAt = now;
        objectsDue = seenObjects.refresh(snapshot, fog);
      }
      if (!sizeDue && !objectsDue) return;
      const height = Math.max(1, Math.round((width * map.h) / map.w));
      const objects = objectsDue ? seenObjects.objects() : undefined;
      baking = true;
      baker.bake(width, height, objects).then(
        (rgba) => {
          baking = false;
          if (disposed) return;
          bakedWidth = width;
          show(rgba, width, height);
        },
        (err: unknown) => {
          baking = false;
          failed = true;
          if (disposed) return;
          // One bake on this thread keeps the ground; the picture then holds still.
          diag.warn('hud', `minimap ground bake failed, baking once inline: ${String(err)}`);
          show(createMinimapRasterizer(scene)(width, height, seenObjects.objects()), width, height);
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
