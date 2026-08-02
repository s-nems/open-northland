import type { FogView } from '@open-northland/sim';
import { BufferImageSource, type Container, Sprite, Texture } from 'pixi.js';
import type { Rect } from '../geometry.js';
import { fillFogAlpha } from './model.js';

export interface FogMaskLayer {
  draw(fog: FogView | null): void;
  dispose(): void;
}

/**
 * The fog mask over the minimap ground: one cell-resolution alpha raster stretched over `mapRect` (the
 * map picture in panel-local coords, constant for the session) with linear filtering - the same soft
 * edge the world wash shows. The sprite is parented here, so the caller must create the layer in draw
 * order: child order is draw order, and the mask belongs under the dots. Its buffer and texture live
 * for the session and are rewritten in place, only when the fog generation moves.
 *
 * NAMED APPROXIMATION: the stretch ignores the odd-row half-cell stagger the ground raster samples (a
 * half-cell skew on a soft mask, invisible at minimap scale).
 */
export function createFogMaskLayer(container: Container, mapRect: Rect): FogMaskLayer {
  const sprite = new Sprite();
  sprite.visible = false;
  container.addChild(sprite);

  let texture: Texture | null = null;
  let pixels = new Uint8Array(0);
  let generation = -1; // none rasterized yet

  return {
    draw: (fog): void => {
      if (fog === null) {
        if (sprite.visible) {
          sprite.visible = false;
          generation = -1;
        }
        return;
      }
      if (fog.generation === generation) return;
      generation = fog.generation;
      if (texture === null) {
        pixels = new Uint8Array(fog.cellsWide * fog.cellsHigh * 4);
        texture = new Texture({
          source: new BufferImageSource({
            resource: pixels,
            width: fog.cellsWide,
            height: fog.cellsHigh,
            scaleMode: 'linear',
          }),
        });
      }
      fillFogAlpha(fog, pixels);
      texture.source.update();
      sprite.texture = texture;
      sprite.position.set(mapRect.x, mapRect.y);
      sprite.width = mapRect.w;
      sprite.height = mapRect.h;
      sprite.visible = true;
    },
    dispose: (): void => {
      texture?.destroy(true);
    },
  };
}
