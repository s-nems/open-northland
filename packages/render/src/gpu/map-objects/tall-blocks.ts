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
 * The tall landscape objects (trees, stones — anything that occludes a settler): pooled sprites in the
 * renderer's shared entity layer, depth-sorted against settlers/buildings by their world-`y` feet anchor
 * and viewport-culled each frame. A member's sprite is minted on first visibility (a big map holds
 * 10k–270k tall objects, most of which never scroll into view). Split from
 * {@link import('./map-object-layer.js').MapObjectLayer}, which owns the flat decor half and buckets the
 * placements into the per-block groups this consumes.
 */

/** One tall (non-decor) map object: its static draw data + a lazily-minted pooled sprite. */
interface PooledObject {
  readonly obj: MapObjectSprite;
  /** Null until minted on first visibility. */
  sprite: Sprite | null;
  /** The cast-shadow twin, minted with {@link sprite} only when the object carries shadow frames. */
  shadowSprite: Sprite | null;
  attached: boolean;
  /** The sprite's undimmed tint (the baked-shading multiplier, or white) — computed at mint so the
   *  per-frame fog grading is a pick between two cached colours, never a recompute. */
  baseTint: number;
  /** {@link import('../../data/fog/mask.js').fogGhostTint} of {@link baseTint} — the explored-ground dim. */
  ghostTint: number;
  /** Whether the last bound frame was picked on the live clock (visible ground) or the frozen one
   *  (a ghosted, explored-only object) — a state flip rebinds once even mid-animation-tick. */
  lastWatched: boolean;
}

/**
 * One block of tall map objects, AABB-culled as a whole before its members are point-tested — the
 * per-frame cull cost tracks the screen (visible blocks), not the map (the render contract; a
 * whole-map flat scan would be an O(objects) loop per frame on maps with 10k–270k trees).
 */
interface TallBlock {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly objects: PooledObject[];
  /** How many members are currently attached — lets an off-screen block skip its detach scan. */
  attachedCount: number;
}

export class TallObjectLayer {
  /** Tall map objects (trees, stones) in AABB-culled blocks; sprites minted lazily on first view. */
  private blocks: TallBlock[] = [];
  /** Removal handle per tall object — which block holds it (see {@link remove}). */
  private blockByObject = new Map<MapObjectSprite, TallBlock>();
  /** The animation tick the tall-object frames were last refreshed for. */
  private lastAnimTick = -1;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer — tall objects attach here so
   *   they interleave with settlers/buildings in one painter order.
   * @param textures the renderer's shared frame→texture cache.
   */
  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
  ) {}

  /**
   * Build the AABB-culled blocks from the tall placements grouped by chunk key (the split is
   * {@link import('./map-object-layer.js').MapObjectLayer.set}'s — it partitions decor from tall). Each
   * block's box covers only the feet anchors (the per-object cull is a point test against the
   * margin-inflated viewport), and every member starts sprite-less (minted on first visibility).
   */
  build(tallByBlock: Map<string, MapObjectSprite[]>): void {
    for (const block of tallByBlock.values()) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const obj of block) {
        // Box covers only the feet anchors; the per-object cull is a point test against it.
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
   * Take one tall object out of the built blocks (the `?map=` handover: a virgin resource node is first
   * worked, so its static drawing is removed and the live pool draws it from then on) — its pooled sprite
   * is detached + destroyed and its member dropped from the block. Returns whether the object was a tall
   * one (so the caller can try the decor half when it wasn't). O(block members), only on first-touch.
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
   * Detach a tall object's pooled sprite from the shared entity layer, returning whether it was attached
   * (so the caller keeps its block's `attachedCount` correct — some callers zero the counter in bulk,
   * others decrement per member). Leaves the sprite pooled for re-attach; does not destroy it.
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
    // Baked-shading multiplier as a grey tint (stones on a dark slope darken with the ground). A batch
    // tint cannot brighten, so the lane's >1 half clamps at ×1 — a named approximation (see
    // MapObjectSprite.brightness); the app omits the field for the full-bright kinds (trees).
    po.baseTint = obj.brightness !== undefined ? scaleColour(0xffffff, obj.brightness) : 0xffffff;
    po.ghostTint = fogGhostTint(po.baseTint);
    if (obj.shadow !== undefined) {
      // The cast shadow, sorted just under its caster (see SHADOW_DEPTH_EPS). Pre-baked black pixels —
      // the fog/shading tints multiply to black anyway, so it never re-tints.
      po.shadowSprite = new Sprite();
      po.shadowSprite.scale.set(obj.scale);
      po.shadowSprite.zIndex = depth - SHADOW_DEPTH_EPS;
    }
    po.sprite = sprite;
    return sprite;
  }

  /** Bind the pose at `clock` onto a member's sprites. False when that pose has no frame, which leaves
   *  the member untouched — the caller's `continue` then skips both `lastWatched` and the attach. */
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
   * visible blocks — the scan cost tracks the visible blocks, not the map. A member's sprite is minted on
   * first visibility and depth-sorted against entities by its feet anchor (the same world-`y` key the
   * entity containers use).
   *
   * `fogStateOfCell` is the fog-of-war gate over cell coords (the viewer's effective `FOG_STATE`): a tall
   * object (a tree/stone — a strategic resource) on unexplored ground is treated exactly like a
   * viewport-culled one (detached, kept pooled for when the fog lifts); on explored ground it draws dimmed
   * to the ghost grading with its animation frozen (a ghost is a memory, not a live feed) — a virgin map
   * object never changes until first worked (the handover removes it at that moment), so the real object
   * is its own last-seen ghost, and RECON's known-terrain view shows the map's resources from the start.
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
        // Fog is gated per visual cell — tall objects sit on half-cell nodes, so the anchor's cell is
        // its screen→cell inverse (see screenToCell).
        const cell = screenToCell(obj.x, obj.y);
        const fogState =
          fogStateOfCell === undefined ? FOG_STATE.VISIBLE : fogStateOfCell(cell.col, cell.row);
        if (!isVisible(vp, obj.x, obj.y) || fogState === FOG_STATE.UNEXPLORED) {
          if (this.detach(po)) block.attachedCount--;
          continue;
        }
        const sprite = po.sprite ?? this.mint(po);
        // Explored-but-unwatched ground dims to the ghost grading. Assigned only on change: Pixi's tint
        // setter allocates (a Color.shared round-trip) even for an unchanged value, and this runs per
        // visible object per frame.
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
