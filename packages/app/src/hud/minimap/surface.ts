import {
  cellColourResolver,
  flatTileColour,
  rasterizeTerrain,
  type SceneTerrain,
} from '@open-northland/render';
import { BufferImageSource, type Container, Sprite, Texture } from 'pixi.js';
import type { Rect } from '../geometry.js';

/** Ground-raster px per device px, keeping the cell mosaic smooth under linear sampling. */
export const RASTER_OVERSAMPLE = 2;

export interface MinimapSurfaceDeps {
  readonly container: Container;
  readonly terrain: SceneTerrain;
  readonly cellColours?: Uint32Array | undefined;
  readonly colourOf?: ((typeId: number) => number | undefined) | undefined;
  /** Whole-map raster space; the owner transforms and clips all map layers together. */
  readonly map: Rect;
  readonly resolution: () => number;
}

export interface MinimapSurface {
  syncResolution(): void;
  dispose(): void;
}

export function createMinimapSurface(deps: MinimapSurfaceDeps): MinimapSurface {
  const { terrain, cellColours, colourOf, map, resolution } = deps;
  const colours = cellColourResolver(cellColours, (id) => colourOf?.(id) ?? flatTileColour(id));
  const bake = (): Texture => {
    const width = Math.max(1, Math.round(map.w * RASTER_OVERSAMPLE * resolution()));
    const height = Math.max(1, Math.round(map.h * RASTER_OVERSAMPLE * resolution()));
    return new Texture({
      source: new BufferImageSource({
        resource: rasterizeTerrain(terrain, colours, width, height),
        width,
        height,
        scaleMode: 'linear',
      }),
    });
  };
  let bakedResolution = resolution();
  let texture = bake();
  const ground = new Sprite(texture);
  ground.position.set(map.x, map.y);
  ground.width = map.w;
  ground.height = map.h;
  deps.container.addChild(ground);
  return {
    syncResolution: () => {
      if (resolution() === bakedResolution) return;
      const next = bake();
      ground.texture = next;
      texture.destroy(true);
      texture = next;
      bakedResolution = resolution();
    },
    dispose: () => {
      ground.destroy();
      texture.destroy(true);
    },
  };
}
