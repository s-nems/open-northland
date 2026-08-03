import type { Container, Texture } from 'pixi.js';
import type { Viewport } from '../../src/data/projection/index.js';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import type { MapObjectLayer } from '../../src/gpu/map-objects/index.js';

/**
 * The {@link MapObjectLayer}'s GPU state is the only place its decisions are observable, so these read
 * its batch geometry and attached sprites directly and own that coupling for every spec.
 */

/** Same size, distinct `x`, so the pose in play is readable off a bound frame or a written quad's UVs. */
export const FRAME_0: AtlasFrame = { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };
export const FRAME_1: AtlasFrame = { x: 8, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };

/** Frames everything the tests place; their world coords are single-digit px. */
export const WIDE: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

/** The decor container's single batch mesh: one source, one still/moving split. */
function decorBatchGeometry(layer: MapObjectLayer): { positions: Float32Array; uvs: Float32Array } {
  const mesh = layer.decorContainer.children[0]?.children[0] as {
    geometry?: { positions: Float32Array; uvs: Float32Array };
  };
  const geometry = mesh?.geometry;
  if (geometry === undefined) throw new Error('expected one decor batch mesh');
  return geometry;
}

/** A quad's placement is observable as its written vertices. */
export function decorPositions(layer: MapObjectLayer): Float32Array {
  return decorBatchGeometry(layer).positions;
}

/** A quad's frame pick is observable as its atlas UVs. */
export function decorUVs(layer: MapObjectLayer): Float32Array {
  return decorBatchGeometry(layer).uvs;
}

export interface TallSprite {
  readonly x: number;
  readonly y: number;
  readonly tint: number;
  readonly frameX: number;
  readonly zIndex: number;
  readonly visible: boolean;
}

/** The tall sprites attached to the layer's sprite container, in child order; empty while hidden. */
export function tallSprites(spriteLayer: Container): TallSprite[] {
  return spriteLayer.children.map((c) => {
    const spr = c as unknown as {
      x: number;
      y: number;
      tint: number;
      texture: Texture;
      zIndex: number;
      visible: boolean;
    };
    return {
      x: spr.x,
      y: spr.y,
      tint: spr.tint,
      frameX: spr.texture.frame.x,
      zIndex: spr.zIndex,
      visible: spr.visible,
    };
  });
}
