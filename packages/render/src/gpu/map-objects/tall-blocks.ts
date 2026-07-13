import { FOG_STATE } from '@vinland/sim';
import { type Container, Sprite } from 'pixi.js';
import { scaleColour } from '../../data/brightness.js';
import { fogGhostTint } from '../../data/fog.js';
import { depthKey, screenToCell } from '../../data/iso.js';
import { aabbIntersects, isVisible, type Viewport } from '../../data/viewport.js';
import type { TextureCache } from '../texture-cache.js';
import { type MapObjectSprite, objectFrameAt } from './map-object-sprite.js';

/**
 * The TALL landscape objects (trees, stones — anything that occludes a settler): pooled sprites in the
 * renderer's shared ENTITY layer, depth-sorted against settlers/buildings by their world-`y` feet anchor
 * and viewport-culled each frame. A member's sprite is minted on FIRST visibility (a big map holds
 * 10k–270k tall objects, most of which never scroll into view). Split from
 * {@link import('./map-object-layer.js').MapObjectLayer}, which owns the flat decor half and buckets the
 * placements into the per-block groups this consumes.
 */

/** One tall (non-decor) map object: its static draw data + a LAZILY-minted pooled sprite. */
interface PooledObject {
  readonly obj: MapObjectSprite;
  /** Minted on first visibility (a big map holds 10k–270k tall objects; most never scroll into view). */
  sprite: Sprite | null;
  attached: boolean;
  /** The sprite's undimmed tint (the baked-shading multiplier, or white) — computed at mint so the
   *  per-frame fog grading is a pick between two cached colours, never a recompute. */
  baseTint: number;
  /** {@link import('../../data/fog.js').fogGhostTint} of {@link baseTint} — the explored-ground dim. */
  ghostTint: number;
  /** Whether the last bound frame was picked on the LIVE clock (visible ground) or the frozen one
   *  (a ghosted, explored-only object) — a state flip rebinds once even mid-animation-tick. */
  lastWatched: boolean;
}

/**
 * One block of tall map objects, AABB-culled as a whole before its members are point-tested — the
 * per-frame cull cost tracks the SCREEN (visible blocks), not the map (the render contract; a
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
  /** Removal handle per TALL object — which block holds it (see {@link remove}). */
  private blockByObject = new Map<MapObjectSprite, TallBlock>();
  /** The animation tick the tall-object frames were last refreshed for. */
  private lastAnimTick = -1;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer — tall objects attach HERE so
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
   * block's box covers only the feet ANCHORS (the per-object cull is a point test against the
   * margin-inflated viewport), and every member starts sprite-less (minted on first visibility).
   */
  build(tallByBlock: Map<string, MapObjectSprite[]>): void {
    for (const block of tallByBlock.values()) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const obj of block) {
        // The block box only needs to cover the feet ANCHORS (the per-object cull is a point test
        // against the margin-inflated viewport, same convention as the entity cull).
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
   * Take ONE tall object out of the built blocks (the `?map=` handover: a virgin resource node is first
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
      const po = block.objects[i] as PooledObject;
      if (this.detach(po)) block.attachedCount--;
      po.sprite?.destroy();
      block.objects.splice(i, 1);
    }
    return true;
  }

  /**
   * Detach a tall object's pooled sprite from the shared entity layer, returning whether it WAS attached
   * (so the caller keeps its block's `attachedCount` correct — some callers zero the counter in bulk,
   * others decrement per member). Leaves the sprite pooled for re-attach; does not destroy it.
   */
  private detach(po: PooledObject): boolean {
    if (!po.attached || po.sprite === null) return false;
    this.spriteLayer.removeChild(po.sprite);
    po.attached = false;
    return true;
  }

  /**
   * Advance the tall objects for one frame: block-cull to the viewport, then per-member point-test the
   * visible blocks — the scan cost tracks the visible blocks, not the map. A member's sprite is minted on
   * FIRST visibility and depth-sorted against entities by its feet anchor (the same world-`y` key the
   * entity containers use); its texture is refreshed only on attach or an animation-tick advance.
   *
   * `fogStateOfCell` is the fog-of-war gate over CELL coords (the viewer's effective `FOG_STATE`): a tall
   * object (a tree/stone — a strategic resource) on UNEXPLORED ground is treated exactly like a
   * viewport-culled one (detached, kept pooled for when the fog lifts); on EXPLORED ground it draws DIMMED
   * to the ghost grading with its animation FROZEN (a ghost is a memory, not a live feed) — a virgin map
   * object never changes until first worked (the handover removes it at that moment), so the real object
   * IS its own last-seen ghost, and RECON's known-terrain view shows the map's resources from the start.
   */
  update(vp: Viewport, tick: number, fogStateOfCell?: (cellX: number, cellY: number) => number): void {
    const animAdvanced = tick !== this.lastAnimTick;
    for (const block of this.blocks) {
      const blockVisible = aabbIntersects(vp, block);
      if (!blockVisible) {
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
        const visible = isVisible(vp, obj.x, obj.y) && fogState !== FOG_STATE.UNEXPLORED;
        if (!visible) {
          if (this.detach(po)) block.attachedCount--;
          continue;
        }
        if (po.sprite === null) {
          po.sprite = new Sprite();
          po.sprite.scale.set(obj.scale);
          po.sprite.zIndex = depthKey(obj.x, obj.y); // static — set once
          // Baked-shading multiplier as a grey tint (stones on a dark slope darken with the ground).
          // A batch tint cannot brighten, so the lane's >1 half clamps at ×1 — a named approximation
          // (see MapObjectSprite.brightness); the app omits the field for the full-bright kinds (trees).
          po.baseTint = obj.brightness !== undefined ? scaleColour(0xffffff, obj.brightness) : 0xffffff;
          po.ghostTint = fogGhostTint(po.baseTint);
        }
        // Explored-but-unwatched ground dims the object to the ghost grading; re-assigned per frame
        // (a pick between two cached colours — Pixi's tint setter no-ops on an unchanged value).
        // UNEXPLORED never reaches here (detached above), so VISIBLE is the one live state.
        const watched = fogState === FOG_STATE.VISIBLE;
        po.sprite.tint = watched ? po.baseTint : po.ghostTint;
        // A ghosted object's animation FREEZES (a memory, not a live feed — swaying trees under the
        // fog read as watched ground): unwatched frames bind at a fixed clock, live ones advance;
        // a watched↔ghosted flip rebinds once so the pose switches with the tint.
        if (
          !po.attached ||
          watched !== po.lastWatched ||
          (watched && animAdvanced && obj.frames.length > 1)
        ) {
          const frame = objectFrameAt(obj, watched ? tick : 0);
          if (frame === undefined) continue;
          po.sprite.texture = this.textures.get(obj.source, frame);
          // Draw at the lifted feet; the zIndex above kept the pre-lift `obj.y` so depth is by map row.
          po.sprite.position.set(
            obj.x + frame.offsetX * obj.scale,
            obj.y - (obj.lift ?? 0) + frame.offsetY * obj.scale,
          );
        }
        po.lastWatched = watched;
        if (!po.attached) {
          this.spriteLayer.addChild(po.sprite);
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
      for (const po of block.objects) po.sprite?.destroy();
    }
    this.blocks = [];
    this.blockByObject.clear();
    this.lastAnimTick = -1;
  }
}
