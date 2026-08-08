import { FOG_STATE } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { aabbIntersects, screenToCell, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import { destroyMeshChildren } from '../mesh-teardown.js';
import { TERRAIN_CHUNK_TILES } from '../terrain/index.js';
import type { TextureCache } from '../texture-cache.js';
import { buildDecorChunk, type DecorChunk, writeObjectQuad } from './decor-batch.js';
import { type MapObjectSprite, objectFrameAt } from './map-object-sprite.js';
import { TallObjectLayer } from './tall-blocks.js';

/**
 * The retained landscape-object layers, split by whether an object occludes a settler. Both halves are
 * built once per map.
 */

/** Decor chunks partition world space into square blocks of this many px - the same horizontal pitch as
 *  a terrain chunk. */
const DECOR_CHUNK_PX = TERRAIN_CHUNK_TILES * TILE_HALF_W * 2;

export class MapObjectLayer {
  /** Flat map-object decor (waves, grass, mine stains). */
  readonly decorContainer = new Container();
  private decorChunks: DecorChunk[] = [];
  private readonly tall: TallObjectLayer;

  constructor(spriteLayer: Container, textures: TextureCache) {
    this.tall = new TallObjectLayer(spriteLayer, textures);
  }

  /** Call once per map. */
  set(objects: readonly MapObjectSprite[]): void {
    this.destroy();
    const byBlock = new Map<string, MapObjectSprite[]>();
    const tallByBlock = new Map<string, MapObjectSprite[]>();
    for (const obj of objects) {
      if (obj.frames.length === 0) continue;
      const key = `${Math.floor(obj.x / DECOR_CHUNK_PX)},${Math.floor(obj.y / DECOR_CHUNK_PX)}`;
      const buckets = obj.decor ? byBlock : tallByBlock;
      let block = buckets.get(key);
      if (block === undefined) {
        block = [];
        buckets.set(key, block);
      }
      block.push(obj);
    }
    for (const block of byBlock.values()) {
      const chunk = buildDecorChunk(block);
      this.decorContainer.addChild(chunk.container);
      this.decorChunks.push(chunk);
    }
    this.tall.build(tallByBlock);
  }

  /**
   * Take one placed object out of the built layers. A decor object's quad is zeroed in place rather than
   * rebuilding the batch: O(block members), and only on that first-touch event, never per frame. An
   * unknown object is a no-op.
   */
  remove(obj: MapObjectSprite): void {
    if (this.tall.remove(obj)) return;
    for (const chunk of this.decorChunks) {
      const quad = chunk.quads.get(obj);
      if (quad === undefined) continue;
      chunk.quads.delete(obj);
      quad.positions.fill(0, quad.quadIndex * 8, quad.quadIndex * 8 + 8); // degenerate quad → invisible
      quad.geometry.getBuffer('aPosition').update();
      if (quad.animated !== null) quad.animated.objects[quad.quadIndex] = null;
      return;
    }
  }

  /**
   * Advance the landscape objects for one frame. Flat decor keeps drawing on ground the viewer does not
   * watch, because it reads as terrain dressing, but its animation freezes there.
   */
  update(vp: Viewport, tick: number, fogStateOfCell?: (cellX: number, cellY: number) => number): void {
    for (const chunk of this.decorChunks) {
      const visible = aabbIntersects(vp, chunk);
      chunk.container.visible = visible;
      if (!visible || chunk.animated.length === 0 || chunk.lastWrittenTick === tick) continue;
      chunk.lastWrittenTick = tick;
      for (const batch of chunk.animated) {
        for (let q = 0; q < batch.objects.length; q++) {
          const obj = batch.objects[q];
          if (obj === null || obj === undefined) continue; // removed - its quad stays zeroed
          // The loop rewrites every on-screen animated quad each tick anyway, so a frozen quad just
          // re-writes its fixed-clock frame and needs no extra state.
          const cell = screenToCell(obj.x, obj.y);
          const watched =
            fogStateOfCell === undefined || fogStateOfCell(cell.col, cell.row) === FOG_STATE.VISIBLE;
          const frame = objectFrameAt(obj, watched ? tick : 0);
          if (frame !== undefined) {
            writeObjectQuad(batch.positions, batch.uvs, q, obj, frame, batch.pageW, batch.pageH);
          }
        }
        batch.geometry.getBuffer('aPosition').update();
        batch.geometry.getBuffer('aUV').update();
      }
    }
    this.tall.update(vp, tick, fogStateOfCell);
  }

  /** Free the decor meshes + tall-object sprites (a map change re-invalidates both). */
  destroy(): void {
    for (const chunk of this.decorChunks) {
      destroyMeshChildren(chunk.container);
      chunk.container.destroy({ children: true });
    }
    this.decorChunks = [];
    this.tall.destroy();
  }
}
