import { FOG_STATE } from '@open-northland/sim';
import { Container, Mesh } from 'pixi.js';
import { aabbIntersects, screenToCell, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import { destroyMeshChildren } from '../mesh-teardown.js';
import { worldShadowStyle } from '../pixel-art-registry.js';
import type { ShadowStyle } from '../shadow-style.js';
import { TERRAIN_CHUNK_TILES } from '../terrain/index.js';
import type { TextureCache } from '../texture-cache.js';
import {
  buildDecorChunk,
  type DecorChunk,
  retireDecorQuad,
  uploadAnimatedBatch,
  writeAnimatedQuad,
} from './decor-batch.js';
import { makeDecorShadowUniforms, writeDecorShadowStyle } from './decor-shadow-shader.js';
import type { MapObjectSprite } from './map-object-sprite.js';
import { TallObjectLayer } from './tall-blocks.js';

/**
 * Landscape objects share retained spatial blocks, split by whether they occlude a settler.
 */

/** Decor chunks partition world space into square blocks of this many px - the same horizontal pitch as
 *  a terrain chunk. */
const DECOR_CHUNK_PX = TERRAIN_CHUNK_TILES * TILE_HALF_W * 2;

/** The frame inputs the whole layer's output is a function of: attach state and culling follow the
 *  viewport and fog, bound frames follow the tick and fog. */
interface UpdateInputs {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly tick: number;
  readonly motionTime: number;
  readonly shadowRevision: number;
  readonly fogEpoch: number | undefined;
}

export class MapObjectLayer {
  /** Flat map-object decor (waves, grass, mine stains). */
  readonly decorContainer = new Container();
  /** The decor's cast shadows, mounted under {@link decorContainer}; its children pair with that
   *  container's by index. */
  readonly decorShadowContainer = new Container();
  private readonly decorShadowStyle = makeDecorShadowUniforms();
  /** The style {@link decorShadowStyle} holds; it starts as the authored silhouette, which is `null`. */
  private writtenShadowStyle: ShadowStyle | null = null;
  private readonly decorChunks = new Map<string, DecorChunk>();
  private readonly decorByObject = new Map<MapObjectSprite, string>();
  private readonly objects = new Set<MapObjectSprite>();
  private readonly tall: TallObjectLayer;
  /** The last frame's inputs; an identical frame skips the walk since the retained scene already
   *  matches. `remove` needs no reset - it detaches and zeroes directly. */
  private lastInputs: UpdateInputs | null = null;
  private environmentMotion = false;

  constructor(
    spriteLayer: Container,
    private readonly textures: TextureCache,
  ) {
    this.tall = new TallObjectLayer(spriteLayer, textures);
  }

  setEnvironmentMotion(enabled: boolean): void {
    if (this.environmentMotion === enabled) return;
    this.environmentMotion = enabled;
    this.lastInputs = null;
  }

  /** Call once per map. */
  set(objects: readonly MapObjectSprite[]): void {
    this.destroy();
    this.add(objects);
  }

  /** Add script placements, rebuilding only affected decor blocks. Existing object references are ignored. */
  add(objects: readonly MapObjectSprite[]): void {
    const byBlock = new Map<string, MapObjectSprite[]>();
    const tallByBlock = new Map<string, MapObjectSprite[]>();
    for (const obj of objects) {
      if (obj.frames.length === 0 || this.objects.has(obj)) continue;
      this.objects.add(obj);
      const key = `${Math.floor(obj.x / DECOR_CHUNK_PX)},${Math.floor(obj.y / DECOR_CHUNK_PX)}`;
      const buckets = obj.decor ? byBlock : tallByBlock;
      let block = buckets.get(key);
      if (block === undefined) {
        block = obj.decor ? [...(this.decorChunks.get(key)?.quads.keys() ?? [])] : [];
        buckets.set(key, block);
      }
      block.push(obj);
      if (obj.decor) this.decorByObject.set(obj, key);
    }
    for (const [key, block] of byBlock) {
      const previous = this.decorChunks.get(key);
      const index =
        previous === undefined
          ? this.decorContainer.children.length
          : this.decorContainer.getChildIndex(previous.container);
      if (previous !== undefined) destroyDecorChunk(previous);
      const chunk = buildDecorChunk(block, this.decorShadowStyle);
      this.decorContainer.addChildAt(chunk.container, index);
      this.decorShadowContainer.addChildAt(chunk.shadowContainer, index);
      this.decorChunks.set(key, chunk);
    }
    this.tall.build(tallByBlock);
    this.lastInputs = null;
  }

  /**
   * Take one placed object out of the built layers. A decor object's quad is zeroed in place rather than
   * rebuilding the batch: O(block members), and only on that first-touch event, never per frame. An
   * unknown object is a no-op.
   */
  remove(obj: MapObjectSprite): void {
    if (!this.objects.delete(obj)) return;
    if (this.tall.remove(obj)) return;
    const key = this.decorByObject.get(obj);
    this.decorByObject.delete(obj);
    if (key === undefined) return;
    const chunk = this.decorChunks.get(key);
    const quads = chunk?.quads.get(obj);
    if (chunk === undefined || quads === undefined) return;
    chunk.quads.delete(obj);
    if (chunk.quads.size === 0) {
      destroyDecorChunk(chunk);
      this.decorChunks.delete(key);
      return;
    }
    retireDecorQuad(quads.body);
    if (quads.shadow !== null) retireDecorQuad(quads.shadow);
  }

  /**
   * Advance the landscape objects for one frame. Flat decor keeps drawing on ground the viewer does not
   * watch, because it reads as terrain dressing, but its animation freezes there.
   */
  update(
    vp: Viewport,
    tick: number,
    fogStateOfCell?: (cellX: number, cellY: number) => number,
    fogEpoch?: number,
    timeTicks: number = tick,
  ): void {
    const motionTime = this.environmentMotion ? timeTicks : tick;
    const shadowStyle = worldShadowStyle();
    if (shadowStyle !== this.writtenShadowStyle) {
      writeDecorShadowStyle(this.decorShadowStyle, shadowStyle);
      this.writtenShadowStyle = shadowStyle;
    }
    const shadowRevision = this.textures.shadowRevision;
    // A fog probe without an epoch has no change signal, so such a frame never counts as identical.
    const fogKeyed = fogStateOfCell === undefined || fogEpoch !== undefined;
    const last = this.lastInputs;
    if (
      fogKeyed &&
      last !== null &&
      last.minX === vp.minX &&
      last.minY === vp.minY &&
      last.maxX === vp.maxX &&
      last.maxY === vp.maxY &&
      last.tick === tick &&
      last.motionTime === motionTime &&
      last.shadowRevision === shadowRevision &&
      last.fogEpoch === fogEpoch
    ) {
      return;
    }
    this.lastInputs = fogKeyed
      ? {
          minX: vp.minX,
          minY: vp.minY,
          maxX: vp.maxX,
          maxY: vp.maxY,
          tick,
          motionTime,
          shadowRevision,
          fogEpoch,
        }
      : null;
    for (const chunk of this.decorChunks.values()) {
      const visible = aabbIntersects(vp, chunk);
      chunk.container.visible = visible;
      chunk.shadowContainer.visible = visible;
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
          writeAnimatedQuad(batch, q, obj, watched ? tick : 0);
        }
        uploadAnimatedBatch(batch);
      }
    }
    this.tall.update(vp, tick, fogStateOfCell, motionTime);
  }

  /** Free the decor meshes + tall-object sprites (a map change re-invalidates both). */
  destroy(): void {
    for (const chunk of this.decorChunks.values()) destroyDecorChunk(chunk);
    this.decorChunks.clear();
    this.decorByObject.clear();
    this.objects.clear();
    this.tall.destroy();
    this.lastInputs = null;
  }
}

function destroyDecorChunk(chunk: DecorChunk): void {
  for (const container of [chunk.container, chunk.shadowContainer]) {
    // A plain batch owns the texture view it draws through; the page source outlives it.
    for (const child of container.children) {
      if (child instanceof Mesh && child.shader === null) child.texture.destroy();
    }
    destroyMeshChildren(container);
    container.destroy({ children: true });
  }
}
