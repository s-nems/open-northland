import type { Container, Texture } from 'pixi.js';
import type { Viewport } from '../../src/data/projection/index.js';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import type { MapObjectLayer } from '../../src/gpu/map-objects/index.js';

/**
 * Shared reach-through for the {@link MapObjectLayer} specs. The layer's GPU state is the only place
 * its decisions are observable, so these read its batch geometry and attached sprites directly — the
 * one home for that coupling, so a refactor of the layer's internals costs this file, not every spec.
 */

/** The two atlas frames the specs animate between — same size, distinct `x`, so the pose in play is
 *  readable off a bound texture's frame or a written quad's UVs. */
export const FRAME_0: AtlasFrame = { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };
export const FRAME_1: AtlasFrame = { x: 8, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };

/** A viewport that frames everything the tests place (world coords are single-digit px). */
export const WIDE: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

/** The decor container's single batch mesh geometry (one batch: same source, same still/moving split). */
function decorBatchGeometry(layer: MapObjectLayer): { positions: Float32Array; uvs: Float32Array } {
  const mesh = layer.decorContainer.children[0]?.children[0] as {
    geometry?: { positions: Float32Array; uvs: Float32Array };
  };
  const geometry = mesh?.geometry;
  if (geometry === undefined) throw new Error('expected one decor batch mesh');
  return geometry;
}

/** The decor batch's position buffer — a quad's placement is observable as its written vertices. */
export function decorPositions(layer: MapObjectLayer): Float32Array {
  return decorBatchGeometry(layer).positions;
}

/** The decor batch's UV buffer — the frame pick is observable as the quad's atlas UVs. */
export function decorUVs(layer: MapObjectLayer): Float32Array {
  return decorBatchGeometry(layer).uvs;
}

/** One tall object's pooled sprite as the specs read it: its fog tint, bound pose, sort key, visibility. */
export interface TallSprite {
  readonly tint: number;
  readonly frameX: number;
  readonly zIndex: number;
  readonly visible: boolean;
}

/** The tall sprites attached to the layer's sprite container, in child order (empty while hidden). */
export function tallSprites(spriteLayer: Container): TallSprite[] {
  return spriteLayer.children.map((c) => {
    const spr = c as unknown as { tint: number; texture: Texture; zIndex: number; visible: boolean };
    return { tint: spr.tint, frameX: spr.texture.frame.x, zIndex: spr.zIndex, visible: spr.visible };
  });
}
