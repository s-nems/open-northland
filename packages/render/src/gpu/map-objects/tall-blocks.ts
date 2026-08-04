import { FOG_STATE } from '@open-northland/sim';
import { type Container, Sprite } from 'pixi.js';
import { fogGhostTint } from '../../data/fog/index.js';
import {
  aabbIntersects,
  depthKey,
  isVisible,
  screenToCell,
  type Viewport,
} from '../../data/projection/index.js';
import { SHADOW_DEPTH_EPS } from '../../data/scene/index.js';
import { scaleColour } from '../../data/terrain/index.js';
import type { TextureCache } from '../texture-cache.js';
import { type MapObjectSprite, objectFrameIndexAt } from './map-object-sprite.js';

/**
 * The tall landscape objects - anything that occludes a settler: pooled sprites in the renderer's
 * shared entity layer, depth-sorted against entities by their world-`y` feet anchor and
 * viewport-culled each frame. A member's sprite is minted on first visibility, because a big map
 * holds 10k-270k tall objects and most never scroll into view.
 */

interface PooledObject {
  readonly obj: MapObjectSprite;
  /** Null until minted on first visibility. */
  sprite: Sprite | null;
  /** The cast-shadow twin, minted with {@link sprite} only when the object carries shadow frames. */
  shadowSprite: Sprite | null;
  attached: boolean;
  /** The undimmed tint, computed at mint so the per-frame fog grading picks between two cached
   *  colours instead of recomputing. */
  baseTint: number;
  /** The explored-ground dim of {@link baseTint}. */
  ghostTint: number;
  /** Whether the last bound frame was picked on the live clock or the frozen one; a flip rebinds once
   *  even mid-animation-tick. */
  lastWatched: boolean;
}

/**
 * One block of tall map objects, AABB-culled as a whole before its members are point-tested, so the
 * per-frame cull cost tracks the visible blocks rather than the map.
 */
interface TallBlock {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly objects: PooledObject[];
  /** How many members are currently attached - lets an off-screen block skip its detach scan. */
  attachedCount: number;
}

export class TallObjectLayer {
  private blocks: TallBlock[] = [];
  /** Which block holds each object, so {@link remove} does not scan every block. */
  private blockByObject = new Map<MapObjectSprite, TallBlock>();
  /** The animation tick the tall-object frames were last refreshed for. */
  private lastAnimTick = -1;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer - tall objects attach here so
   *   they interleave with settlers and buildings in one painter order.
   * @param textures the renderer's shared frame→texture cache.
   */
  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
  ) {}

  /** Build the AABB-culled blocks from the tall placements grouped by chunk key. */
  build(tallByBlock: Map<string, MapObjectSprite[]>): void {
    for (const block of tallByBlock.values()) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const obj of block) {
        // Box covers only the feet anchors, never the sprite extents.
        minX = Math.min(minX, obj.x);
        minY = Math.min(minY, obj.y);
        maxX = Math.max(maxX, obj.x);
        maxY = Math.max(maxY, obj.y);
      }
      const tall: TallBlock = {
        minX,
        minY,
        maxX,
        maxY,
        objects: block.map((obj) => ({
          obj,
          sprite: null,
          shadowSprite: null,
          attached: false,
          baseTint: 0xffffff,
          ghostTint: 0xffffff,
          lastWatched: true,
        })),
        attachedCount: 0,
      };
      this.blocks.push(tall);
      for (const obj of block) this.blockByObject.set(obj, tall);
    }
  }

  /**
   * Take one tall object out of the built blocks, detaching and destroying its pooled sprite. Returns
   * whether the object was a tall one, so the caller can try the decor half when it was not.
   * O(block members), and only on the first-touch handover.
   */
  remove(obj: MapObjectSprite): boolean {
    const block = this.blockByObject.get(obj);
    if (block === undefined) return false;
    this.blockByObject.delete(obj);
    const i = block.objects.findIndex((po) => po.obj === obj);
    if (i >= 0) {
      const po = block.objects[i];
      if (po === undefined) return true;
      if (this.detach(po)) block.attachedCount--;
      po.sprite?.destroy();
      po.shadowSprite?.destroy();
      block.objects.splice(i, 1);
    }
    return true;
  }

  /**
   * Detach a tall object's pooled sprite from the shared entity layer, returning whether it was
   * attached so the caller can keep its block's `attachedCount` correct. Leaves the sprite pooled for
   * re-attach; does not destroy it.
   */
  private detach(po: PooledObject): boolean {
    if (!po.attached || po.sprite === null) return false;
    this.spriteLayer.removeChild(po.sprite);
    if (po.shadowSprite !== null) this.spriteLayer.removeChild(po.shadowSprite);
    po.attached = false;
    return true;
  }

  private mint(po: PooledObject): Sprite {
    const obj = po.obj;
    // Sorted at the object's own row, or at the row the app overrode it to (a bridge deck).
    const depth = depthKey(obj.x, obj.depthY ?? obj.y);
    const sprite = new Sprite();
    sprite.scale.set(obj.scale);
    sprite.zIndex = depth;
    po.baseTint = obj.brightness !== undefined ? scaleColour(0xffffff, obj.brightness) : 0xffffff;
    po.ghostTint = fogGhostTint(po.baseTint);
    if (obj.shadow !== undefined) {
      // The cast shadow, sorted just under its caster. Its pixels are pre-baked black, which the fog
      // and shading tints multiply to black anyway, so it never re-tints.
      po.shadowSprite = new Sprite();
      po.shadowSprite.scale.set(obj.scale);
      po.shadowSprite.zIndex = depth - SHADOW_DEPTH_EPS;
    }
    po.sprite = sprite;
    return sprite;
  }

  /** Bind the pose at `clock` onto a member's sprites. False when that pose has no frame, which
   *  leaves the member untouched. */
  private bindPose(po: PooledObject, sprite: Sprite, clock: number): boolean {
    const obj = po.obj;
    const frameIndex = objectFrameIndexAt(obj, clock);
    const frame = obj.frames[frameIndex];
    if (frame === undefined) return false;
    // Draw at the lifted feet; mint's zIndex kept the pre-lift `obj.y`, so depth is still by map row.
    const lift = obj.lift ?? 0;
    sprite.texture = this.textures.get(obj.source, frame);
    sprite.position.set(obj.x + frame.offsetX * obj.scale, obj.y - lift + frame.offsetY * obj.scale);
    if (po.shadowSprite !== null && obj.shadow !== undefined) {
      const shadowFrame = obj.shadow.frames[frameIndex];
      po.shadowSprite.visible = shadowFrame !== undefined; // a pose with no silhouette just hides it
      if (shadowFrame !== undefined) {
        po.shadowSprite.texture = this.textures.get(obj.shadow.source, shadowFrame);
        po.shadowSprite.position.set(
          obj.x + shadowFrame.offsetX * obj.scale,
          obj.y - lift + shadowFrame.offsetY * obj.scale,
        );
      }
    }
    return true;
  }

  /**
   * Advance the tall objects for one frame: block-cull to the viewport, then per-member point-test the
   * visible blocks.
   *
   * `fogStateOfCell` is the fog-of-war gate over cell coords (the viewer's effective `FOG_STATE`). An
   * object on unexplored ground is treated exactly like a viewport-culled one: detached, kept pooled
   * for when the fog lifts. On explored ground it draws dimmed to the ghost grading with its
   * animation frozen, since a ghost is a memory, not a live feed. A virgin map object never changes
   * until first worked, so the real object is its own last-seen ghost.
   */
  update(vp: Viewport, tick: number, fogStateOfCell?: (cellX: number, cellY: number) => number): void {
    const animAdvanced = tick !== this.lastAnimTick;
    for (const block of this.blocks) {
      if (!aabbIntersects(vp, block)) {
        if (block.attachedCount > 0) {
          for (const po of block.objects) this.detach(po);
          block.attachedCount = 0;
        }
        continue;
      }
      for (const po of block.objects) {
        const obj = po.obj;
        // Fog is gated per visual cell, but tall objects sit on half-cell nodes, so the anchor's cell
        // is its screen→cell inverse.
        const cell = screenToCell(obj.x, obj.y);
        const fogState =
          fogStateOfCell === undefined ? FOG_STATE.VISIBLE : fogStateOfCell(cell.col, cell.row);
        if (!isVisible(vp, obj.x, obj.y) || fogState === FOG_STATE.UNEXPLORED) {
          if (this.detach(po)) block.attachedCount--;
          continue;
        }
        const sprite = po.sprite ?? this.mint(po);
        // Assigned only on change: Pixi's tint setter allocates a Color.shared round-trip even for an
        // unchanged value, and this runs per visible object per frame.
        const watched = fogState === FOG_STATE.VISIBLE;
        const tint = watched ? po.baseTint : po.ghostTint;
        if (sprite.tint !== tint) sprite.tint = tint;
        // A watched↔ghosted flip rebinds once, so the frozen/live pose switches with the tint.
        const rebind =
          !po.attached || watched !== po.lastWatched || (watched && animAdvanced && obj.frames.length > 1);
        if (rebind && !this.bindPose(po, sprite, watched ? tick : 0)) continue;
        po.lastWatched = watched;
        if (!po.attached) {
          this.spriteLayer.addChild(sprite);
          if (po.shadowSprite !== null) this.spriteLayer.addChild(po.shadowSprite);
          po.attached = true;
          block.attachedCount++;
        }
      }
    }
    this.lastAnimTick = tick;
  }

  /** Free the tall-object sprites (a map change re-invalidates them). */
  destroy(): void {
    for (const block of this.blocks) {
      for (const po of block.objects) {
        po.sprite?.destroy();
        po.shadowSprite?.destroy();
      }
    }
    this.blocks = [];
    this.blockByObject.clear();
    this.lastAnimTick = -1;
  }
}
