import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { BufferImageSource, type Container, Sprite, Texture } from 'pixi.js';
import {
  STUN_RING_LIFT,
  STUN_STAR_DRAW_SCALE,
  STUN_STAR_FRAME_PX,
  STUN_STARS,
  type StunStar,
  stunStar,
  stunStarFrame,
} from '../../data/effects/stun-stars.js';
import { isVisible, type Viewport } from '../../data/projection/index.js';
import { SHADOW_DEPTH_EPS } from '../../data/scene/index.js';
import { readsStun } from '../../data/scene/snapshot-readers/index.js';
import type { DrawnGeometry, DrawnWalker } from '../sprite-pool/index.js';
import { worldBatched } from '../world-batch/batcher.js';
import { retireUndrawn } from './retained-pool.js';

/** The height of a body whose drawn bounds are not known this frame, world px. */
const FALLBACK_BODY_HEIGHT = 34;

export interface StunStarFrame {
  readonly snapshot: WorldSnapshot;
  /** The drawn humans on the map ground, off the pool's culled draw list. */
  readonly walkers: readonly DrawnWalker[];
  readonly drawn: DrawnGeometry;
  readonly viewport: Viewport;
  /** Interpolated render clock, `tick + alpha`. */
  readonly renderTime: number;
}

/**
 * The stars circling the head of each drawn human a critical hit stunned (see
 * `data/effects/stun-stars.ts`). The sprites sit in the depth-sorted sprite layer just over or under
 * the body, by the side of the ring each star is on, and draw through the world batch off one frame.
 */
export class StunStarLayer {
  private source: BufferImageSource | undefined;
  private texture: Texture | undefined;
  private readonly nodes = new Map<number, Sprite[]>();
  private readonly seen = new Set<number>();
  private readonly star: StunStar = { x: 0, y: 0, scale: 1, rotation: 0, front: true };

  constructor(private readonly spriteLayer: Container) {}

  draw(frame: StunStarFrame): void {
    this.seen.clear();
    for (const walker of frame.walkers) {
      const ref = walker.ref;
      const components = entityById(frame.snapshot, ref)?.components;
      if (components === undefined || !readsStun(components)) continue;
      const feet = frame.drawn.anchorOf(ref);
      const depth = frame.drawn.depthOf?.(ref);
      if (feet === undefined || depth === undefined) continue;
      if (!isVisible(frame.viewport, feet.x, feet.y)) continue;
      const top = frame.drawn.boundsOf(ref)?.minY ?? feet.y - FALLBACK_BODY_HEIGHT;
      this.place(this.nodeOf(ref), ref, feet.x, top - STUN_RING_LIFT, depth, frame.renderTime);
      this.seen.add(ref);
    }
    retireUndrawn(this.nodes, this.seen, destroyNode);
  }

  destroy(): void {
    for (const node of this.nodes.values()) destroyNode(node);
    this.nodes.clear();
    this.texture?.destroy();
    this.texture = undefined;
    this.source?.destroy();
    this.source = undefined;
  }

  private nodeOf(ref: number): Sprite[] {
    let node = this.nodes.get(ref);
    if (node !== undefined) return node;
    const texture = this.starTexture();
    node = Array.from({ length: STUN_STARS }, () => {
      const sprite = worldBatched(new Sprite(texture));
      sprite.anchor.set(0.5);
      this.spriteLayer.addChild(sprite);
      return sprite;
    });
    this.nodes.set(ref, node);
    return node;
  }

  private starTexture(): Texture {
    if (this.texture !== undefined) return this.texture;
    this.source = new BufferImageSource({
      resource: stunStarFrame(),
      width: STUN_STAR_FRAME_PX,
      height: STUN_STAR_FRAME_PX,
      alphaMode: 'premultiplied-alpha',
      scaleMode: 'linear',
    });
    this.texture = new Texture({ source: this.source });
    return this.texture;
  }

  private place(
    node: readonly Sprite[],
    ref: number,
    x: number,
    y: number,
    depth: number,
    renderTime: number,
  ): void {
    const star = this.star;
    for (let i = 0; i < node.length; i++) {
      const sprite = node[i];
      if (sprite === undefined) continue;
      stunStar(renderTime, ref, i, star);
      sprite.position.set(x + star.x, y + star.y);
      sprite.scale.set(star.scale * STUN_STAR_DRAW_SCALE);
      sprite.rotation = star.rotation;
      sprite.zIndex = depth + (star.front ? SHADOW_DEPTH_EPS : -SHADOW_DEPTH_EPS);
    }
  }
}

function destroyNode(node: readonly Sprite[]): void {
  for (const sprite of node) sprite.destroy();
}
