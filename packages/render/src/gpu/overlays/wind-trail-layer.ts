import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { BufferImageSource, type Container, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  WIND_GUST_ALPHA,
  WIND_GUST_EVERY_TICKS,
  WIND_GUST_FRAME_H,
  WIND_GUST_FRAME_W,
  WIND_GUST_FRAMES,
  WIND_GUST_MAX_SPEED,
  WIND_GUST_MIN_SPEED,
  WIND_GUST_SHAPES,
  WIND_GUST_TAIL_X,
  WIND_GUST_TEXELS_PER_PX,
  windGust,
  windGustFrame,
  windGustSheet,
  windGustStretch,
  windGustTailX,
  windGustTailY,
} from '../../data/effects/index.js';
import { isVisible, type Viewport } from '../../data/projection/index.js';
import { SHADOW_DEPTH_EPS } from '../../data/scene/index.js';
import { readCarriesLiveGood } from '../../data/scene/snapshot-readers/index.js';
import type { DrawnGeometry, DrawnWalker } from '../sprite-pool/index.js';
import { worldBatched } from '../world-batch/batcher.js';

export interface WindTrailFrame {
  readonly snapshot: WorldSnapshot;
  readonly walkers: readonly DrawnWalker[];
  readonly drawn: DrawnGeometry;
  readonly viewport: Viewport;
  /** Interpolated render clock, `tick + alpha`. */
  readonly renderTime: number;
}

/** Ticks between two readings of a walker's drawn feet: long enough that the heading between them is
 *  steady, short enough that a turn shows in the next gust. */
const SAMPLE_TICKS = 0.5;
/** A longer gap between readings is a pause or a jump of the clock, not a walk. */
const MAX_SAMPLE_TICKS = 3;
const NO_FRAME = -1;

/** A fast walker as last read: where its feet were drawn, and when it is due its next gust. */
interface Trail {
  x: number;
  y: number;
  /** NaN until the walker is read once. */
  time: number;
  nextGust: number;
  gusts: number;
}

interface Gust {
  readonly node: Sprite;
  readonly walker: number;
  readonly born: number;
  readonly shape: number;
  /** Where its tail was born; it stays there. */
  readonly x: number;
  readonly y: number;
  frame: number;
}

/** The gust frames, painted on first use: a game without a fast walker never builds them. */
class WindGustTextures {
  private source: BufferImageSource | undefined;
  private readonly frames: Texture[] = [];

  frame(shape: number, index: number): Texture | undefined {
    if (this.source === undefined) {
      const frameW = WIND_GUST_FRAME_W * WIND_GUST_TEXELS_PER_PX;
      const frameH = WIND_GUST_FRAME_H * WIND_GUST_TEXELS_PER_PX;
      const source = new BufferImageSource({
        resource: windGustSheet(),
        width: frameW * WIND_GUST_FRAMES,
        height: frameH * WIND_GUST_SHAPES,
        alphaMode: 'premultiplied-alpha',
        scaleMode: 'linear',
      });
      this.source = source;
      for (let row = 0; row < WIND_GUST_SHAPES; row++)
        for (let i = 0; i < WIND_GUST_FRAMES; i++)
          this.frames.push(
            new Texture({ source, frame: new Rectangle(i * frameW, row * frameH, frameW, frameH) }),
          );
    }
    return this.frames[shape * WIND_GUST_FRAMES + index];
  }

  destroy(): void {
    for (const frame of this.frames) frame.destroy();
    this.frames.length = 0;
    this.source?.destroy();
    this.source = undefined;
  }
}

/**
 * The wind a walker trails while it carries a live good that shortens its step (`data/effects/wind-trail.ts`).
 * The app names those goods. The gusts sit in the depth-sorted sprite layer just under their walker, so
 * whatever stands in front of it covers them. Only walkers drawn on screen are read, once a snapshot,
 * and a gust lives where it was born, so the work follows the fast walkers in view.
 */
export class WindTrailLayer {
  private goods: ReadonlySet<number> | undefined;
  private readonly trails = new Map<number, Trail>();
  private readonly gusts: Gust[] = [];
  /** The drawn walkers carrying one of the goods in the last snapshot read. */
  private readonly carriers = new Set<number>();
  private readonly textures = new WindGustTextures();
  private lastSnapshot: WorldSnapshot | undefined;

  constructor(private readonly spriteLayer: Container) {}

  /** The goods whose live carrier trails wind; `null` or an empty set draws nothing. */
  setGoods(goods: ReadonlySet<number> | null): void {
    this.goods = goods === null || goods.size === 0 ? undefined : goods;
    this.lastSnapshot = undefined;
  }

  draw(frame: WindTrailFrame): void {
    this.track(frame);
    const time = frame.renderTime;
    for (const [ref, trail] of this.trails) this.follow(ref, trail, frame, time);
    this.place(frame, time);
  }

  destroy(): void {
    for (const gust of this.gusts) gust.node.destroy();
    this.gusts.length = 0;
    this.trails.clear();
    this.textures.destroy();
  }

  /** Once a snapshot: keep a trail for every drawn walker that carries one of the goods. */
  private track(frame: WindTrailFrame): void {
    const snapshot = frame.snapshot;
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    const goods = this.goods;
    if (goods === undefined || frame.walkers.length === 0) {
      this.trails.clear();
      return;
    }
    const carriers = this.carriers;
    carriers.clear();
    for (const walker of frame.walkers) {
      const components = entityById(snapshot, walker.ref)?.components;
      if (components === undefined || !readCarriesLiveGood(components, goods)) continue;
      carriers.add(walker.ref);
      if (this.trails.has(walker.ref)) continue;
      this.trails.set(walker.ref, { x: 0, y: 0, time: Number.NaN, nextGust: 0, gusts: 0 });
    }
    if (this.trails.size === carriers.size) return;
    for (const ref of this.trails.keys()) if (!carriers.has(ref)) this.trails.delete(ref);
  }

  /** Read a fast walker's drawn feet and, when it is walking and due one, raise its next gust. */
  private follow(ref: number, trail: Trail, frame: WindTrailFrame, time: number): void {
    const feet = frame.drawn.anchorOf(ref);
    const depth = frame.drawn.depthOf?.(ref);
    if (feet === undefined || depth === undefined) {
      trail.time = Number.NaN;
      return;
    }
    const elapsed = time - trail.time;
    if (elapsed >= 0 && elapsed < SAMPLE_TICKS) return;
    const dx = feet.x - trail.x;
    const dy = feet.y - trail.y;
    trail.x = feet.x;
    trail.y = feet.y;
    trail.time = time;
    // The first reading, a rewound clock and a long gap give no heading.
    if (!(elapsed > 0 && elapsed <= MAX_SAMPLE_TICKS)) return;
    const distance = Math.hypot(dx, dy);
    const speed = distance / elapsed;
    if (speed < WIND_GUST_MIN_SPEED || speed > WIND_GUST_MAX_SPEED) return;
    // A due time further off than one interval is left over from before the clock was rewound.
    if (time < trail.nextGust && trail.nextGust - time <= WIND_GUST_EVERY_TICKS) return;
    trail.nextGust = time + WIND_GUST_EVERY_TICKS;
    if (!isVisible(frame.viewport, feet.x, feet.y)) return;
    this.raise(ref, trail.gusts++, feet, dx / distance, dy / distance, speed, depth, time);
  }

  private raise(
    ref: number,
    index: number,
    feet: { readonly x: number; readonly y: number },
    dirX: number,
    dirY: number,
    speed: number,
    depth: number,
    time: number,
  ): void {
    const gust = windGust(ref, index);
    const node = worldBatched(new Sprite());
    node.anchor.set(WIND_GUST_TAIL_X / WIND_GUST_FRAME_W, 0.5);
    node.rotation = Math.atan2(dirY, dirX);
    const scale = 1 / WIND_GUST_TEXELS_PER_PX;
    node.scale.set(scale * gust.length * windGustStretch(speed), gust.flipped ? -scale : scale);
    node.alpha = WIND_GUST_ALPHA;
    node.zIndex = depth - SHADOW_DEPTH_EPS;
    node.visible = false;
    const x = feet.x + windGustTailX(gust.lane, dirX, dirY);
    const y = feet.y + windGustTailY(gust.lane, dirX, dirY);
    node.position.set(x, y);
    this.spriteLayer.addChild(node);
    this.gusts.push({ node, walker: ref, born: time, shape: gust.shape, x, y, frame: NO_FRAME });
  }

  /** Draw every gust's frame for its age and drop the ones that are over, compacting in place. */
  private place(frame: WindTrailFrame, time: number): void {
    const { viewport, drawn } = frame;
    let kept = 0;
    for (const gust of this.gusts) {
      const index = windGustFrame(time - gust.born);
      const node = gust.node;
      if (index < 0) {
        node.destroy();
        continue;
      }
      this.gusts[kept++] = gust;
      if (!isVisible(viewport, gust.x, gust.y)) {
        node.visible = false;
        continue;
      }
      if (index !== gust.frame) {
        const texture = this.textures.frame(gust.shape, index);
        if (texture === undefined) continue;
        node.texture = texture;
        gust.frame = index;
      }
      // A walker heading up the screen sorts ever further back: its gusts stay under it.
      const depth = drawn.depthOf?.(gust.walker);
      if (depth !== undefined && depth - SHADOW_DEPTH_EPS < node.zIndex)
        node.zIndex = depth - SHADOW_DEPTH_EPS;
      node.visible = true;
    }
    this.gusts.length = kept;
  }
}
