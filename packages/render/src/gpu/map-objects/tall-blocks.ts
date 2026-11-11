import { FOG_STATE } from '@open-northland/sim';
import { type Container, Sprite, type Texture } from 'pixi.js';
import { fogGhostTint } from '../../data/fog/index.js';
import {
  aabbIntersects,
  depthKey,
  isVisible,
  screenToCell,
  type Viewport,
} from '../../data/projection/index.js';
import { drawPassDepth, SHADOW_DEPTH_EPS } from '../../data/scene/index.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { scaleColour } from '../../data/terrain/index.js';
import { FULL_DETAIL, type ViewDetail } from '../../data/view-detail.js';
import type { WindSway } from '../../data/weather/climate.js';
import { BloodSurfaceSprite, bloodSurface } from '../blood/surface-sprite.js';
import { FOOT_OVERLAY_STRIPS, type GroundFootPart } from '../ground-foot/index.js';
import { castShadowShear, setVegetationShear, vegetationShear } from '../sway/vegetation.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { worldBatched } from '../world-batch/batcher.js';
import { activeSway, type MapObjectSprite, objectFrameIndexAt } from './map-object-sprite.js';

/** A grounded object's ground shade sorts under its cast shadow, and the cover over its foot one mark over
 *  its body: each clear of `depthKey`'s x tiebreak, so nothing on the same row slips between, and under
 *  one whole paint step, so neither crosses a kind boundary. */
const GROUND_SHADE_DEPTH_EPS = 1.5 * SHADOW_DEPTH_EPS;
const FOOT_COVER_DEPTH_EPS = SHADOW_DEPTH_EPS;
/** The overlays' tint on watched and on explored ground: their colours already carry the ground's
 *  brightness, so only the fog dims them. */
const WATCHED_OVERLAY_TINT = 0xffffff;
const GHOST_OVERLAY_TINT = fogGhostTint(WATCHED_OVERLAY_TINT);

/**
 * The tall landscape objects - anything that occludes a settler: pooled sprites in the renderer's shared
 * entity layer, depth-sorted against entities by their feet anchor inside their draw pass. A member's
 * sprite is minted on first visibility, since most of a map's tall objects never scroll into view.
 */

interface PooledObject {
  readonly obj: MapObjectSprite;
  /** Null until minted on first visibility. */
  sprite: BloodSurfaceSprite | null;
  /** The cast-shadow twin, minted with {@link sprite} only when the object carries shadow frames. */
  shadowSprite: Sprite | null;
  /** A {@link MapObjectSprite.grounded} object's ground shade strips, then its foot cover strips, minted
   *  with {@link sprite}; empty otherwise. */
  overlaySprites: Sprite[];
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
  readonly key: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  readonly objects: PooledObject[];
  /** How many members are currently attached - lets an off-screen block skip its detach scan. */
  attachedCount: number;
}

const EMPTY_BOX = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
} as const;

/** Refit the cull box to the members left: it covers only the feet anchors, never the sprite extents. */
function fitBox(block: TallBlock): void {
  let { minX, minY, maxX, maxY } = EMPTY_BOX;
  for (const { obj } of block.objects) {
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x);
    maxY = Math.max(maxY, obj.y);
  }
  block.minX = minX;
  block.minY = minY;
  block.maxX = maxX;
  block.maxY = maxY;
}

/** Show an overlay at the body's `(x, y)`, or hide it without one. */
function placeOverlay(overlay: Sprite, texture: Texture | null, x: number, y: number): void {
  overlay.visible = texture !== null;
  if (texture === null) return;
  overlay.texture = texture;
  overlay.position.set(x, y);
}

export class TallObjectLayer {
  private readonly blocks = new Map<string, TallBlock>();
  /** Which block holds each object, so {@link remove} does not scan every block. */
  private blockByObject = new Map<MapObjectSprite, TallBlock>();
  /** The animation tick the tall-object frames were last refreshed for. */
  private lastAnimTick = -1;
  private lastMotionTime = -1;
  private lastEnvironmentMotion = false;
  private lastDetail: ViewDetail = FULL_DETAIL;
  private lastWind: WindSway | undefined;
  private lastTextureRevision = -1;

  /** Tall objects attach to `spriteLayer` so they interleave with entities in one painter order. */
  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
  ) {}

  /** Build the AABB-culled blocks from the tall placements grouped by chunk key. */
  build(tallByBlock: Map<string, MapObjectSprite[]>): void {
    for (const [key, block] of tallByBlock) {
      let tall = this.blocks.get(key);
      if (tall === undefined) {
        tall = { key, ...EMPTY_BOX, objects: [], attachedCount: 0 };
        this.blocks.set(key, tall);
      }
      tall.objects.push(
        ...block.map((obj) => ({
          obj,
          sprite: null,
          shadowSprite: null,
          overlaySprites: [],
          attached: false,
          baseTint: 0xffffff,
          ghostTint: 0xffffff,
          lastWatched: true,
        })),
      );
      for (const obj of block) this.blockByObject.set(obj, tall);
      fitBox(tall);
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
      for (const overlay of po.overlaySprites) overlay.destroy();
      block.objects.splice(i, 1);
      if (block.objects.length === 0) this.blocks.delete(block.key);
      else fitBox(block);
    }
    return true;
  }

  /** Leaves the sprite pooled for re-attach; does not destroy it. */
  private detach(po: PooledObject): boolean {
    if (!po.attached || po.sprite === null) return false;
    this.spriteLayer.removeChild(po.sprite);
    if (po.shadowSprite !== null) this.spriteLayer.removeChild(po.shadowSprite);
    for (const overlay of po.overlaySprites) this.spriteLayer.removeChild(overlay);
    po.attached = false;
    return true;
  }

  private mint(po: PooledObject): BloodSurfaceSprite {
    const obj = po.obj;
    const depth = depthKey(obj.x, obj.y) + drawPassDepth(obj.groundPass === true ? 'ground' : 'sorted');
    const sprite = worldBatched(new BloodSurfaceSprite());
    sprite.scale.set(obj.scale);
    sprite.zIndex = depth;
    po.baseTint = obj.brightness !== undefined ? scaleColour(0xffffff, obj.brightness) : 0xffffff;
    po.ghostTint = fogGhostTint(po.baseTint);
    if (obj.shadow !== undefined) {
      // The cast shadow, sorted just under its caster. Its pixels are pre-baked black, which the fog
      // and shading tints multiply to black anyway, so it never re-tints.
      po.shadowSprite = worldBatched(new Sprite());
      po.shadowSprite.scale.set(obj.scale);
      po.shadowSprite.zIndex = depth - SHADOW_DEPTH_EPS;
    }
    if (obj.grounded === true) {
      // The strips of one overlay never overlap, so they share its depth.
      for (const zIndex of [depth - GROUND_SHADE_DEPTH_EPS, depth + FOOT_COVER_DEPTH_EPS]) {
        for (let i = 0; i < FOOT_OVERLAY_STRIPS; i++) {
          const overlay = worldBatched(new Sprite());
          overlay.scale.set(obj.scale);
          overlay.zIndex = zIndex;
          po.overlaySprites.push(overlay);
        }
      }
    }
    po.sprite = sprite;
    return sprite;
  }

  /** Set a grounded object's pose into the ground: its sunk body and two overlays, placed at the body's
   *  `(x, y)`. Where the foot has no grounding, the body keeps its plain texture and the overlays hide. */
  private bindGrounded(po: PooledObject, sprite: Sprite, frame: AtlasFrame, x: number, y: number): void {
    const { obj, overlaySprites } = po;
    if (overlaySprites.length === 0) return;
    const feetY = obj.y - (obj.lift ?? 0);
    const grounded = (part: GroundFootPart, strip?: number): Texture | null =>
      this.textures.groundedPart(part, obj.source, frame, obj.scale, obj.x, feetY, false, strip);
    sprite.texture = grounded('body') ?? sprite.texture;
    overlaySprites.forEach((overlay, i) => {
      const part = i < FOOT_OVERLAY_STRIPS ? 'shade' : 'cover';
      placeOverlay(overlay, grounded(part, i % FOOT_OVERLAY_STRIPS), x, y);
    });
  }

  /** Bind the pose at `clock` onto a member's sprites. False when that pose has no frame, which
   *  leaves the member untouched. */
  private bindPose(
    po: PooledObject,
    sprite: Sprite,
    clock: number,
    motionTime: number,
    sway: number,
    wind: WindSway | undefined,
    watched: boolean,
  ): boolean {
    const obj = po.obj;
    const frameIndex = objectFrameIndexAt(obj, clock);
    const frame = obj.frames[frameIndex];
    if (frame === undefined) return false;
    // Draw at the lifted feet; mint's zIndex kept the pre-lift `obj.y`, so depth is still by map row.
    const lift = obj.lift ?? 0;
    sprite.texture = this.textures.get(obj.source, frame);
    const shear = vegetationShear(motionTime, obj.x, obj.y, sway, wind);
    setVegetationShear(sprite, obj.scale, shear);
    sprite.position.set(
      obj.x + (frame.offsetX + frame.offsetY * shear) * obj.scale,
      obj.y - lift + frame.offsetY * obj.scale,
    );
    this.bindGrounded(po, sprite, frame, sprite.position.x, sprite.position.y);
    if (po.shadowSprite !== null && obj.shadow !== undefined) {
      const shadowFrame = obj.shadow.frames[frameIndex];
      // A pose with no silhouette hides it, and a ghost casts none: a memory has no sun on it.
      const casts = watched && shadowFrame !== undefined && this.lastDetail.landscapeShadows;
      po.shadowSprite.visible = casts;
      if (casts) {
        po.shadowSprite.texture = this.textures.getShadow(obj.shadow.source, shadowFrame);
        const shadowShear = castShadowShear(shear, frame.offsetY, shadowFrame.offsetY);
        setVegetationShear(po.shadowSprite, obj.scale, shadowShear);
        po.shadowSprite.position.set(
          obj.x + (shadowFrame.offsetX + shadowFrame.offsetY * shadowShear) * obj.scale,
          obj.y - lift + shadowFrame.offsetY * obj.scale,
        );
      }
    }
    return true;
  }

  /**
   * Advance the tall objects for one frame. An object on unexplored ground is treated exactly like a
   * viewport-culled one: detached, kept pooled for when the fog lifts. On explored ground it draws
   * dimmed with its animation frozen, since a ghost is a memory, not a live feed - and a virgin map
   * object never changes until first worked, so the real object is its own last-seen ghost. A creature
   * leaves no ghost: it draws only while watched.
   */
  update(
    vp: Viewport,
    tick: number,
    fogStateOfCell: ((cellX: number, cellY: number) => number) | undefined,
    motionTime: number,
    environmentMotion: boolean,
    wind?: WindSway,
    detail: ViewDetail = FULL_DETAIL,
  ): void {
    const detailSwitched = detail !== this.lastDetail;
    this.lastDetail = detail;
    const animAdvanced = tick !== this.lastAnimTick;
    const motionAdvanced = motionTime !== this.lastMotionTime || wind !== this.lastWind;
    const motionSwitched = environmentMotion !== this.lastEnvironmentMotion;
    const texturesChanged = this.lastTextureRevision !== this.textures.retryRevision;
    for (const block of this.blocks.values()) {
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
        const hidden =
          fogState === FOG_STATE.UNEXPLORED || (obj.creature === true && fogState !== FOG_STATE.VISIBLE);
        if (hidden || !isVisible(vp, obj.x, obj.y)) {
          if (this.detach(po)) block.attachedCount--;
          continue;
        }
        const sprite = po.sprite ?? this.mint(po);
        // Assigned only on change: Pixi's tint setter allocates a Color.shared round-trip even for an
        // unchanged value, and this runs per visible object per frame.
        const watched = fogState === FOG_STATE.VISIBLE;
        const sway = detail.motion ? activeSway(obj, environmentMotion) : undefined;
        const tint = watched ? po.baseTint : po.ghostTint;
        if (sprite.tint !== tint) sprite.tint = tint;
        const overlayTint = watched ? WATCHED_OVERLAY_TINT : GHOST_OVERLAY_TINT;
        for (const overlay of po.overlaySprites) if (overlay.tint !== overlayTint) overlay.tint = overlayTint;
        // The frozen/live pose switches with the tint.
        const rebind =
          !po.attached ||
          texturesChanged ||
          watched !== po.lastWatched ||
          (watched && animAdvanced && obj.frames.length > 1) ||
          (watched && motionAdvanced && sway !== undefined) ||
          (motionSwitched && obj.environmentSway !== undefined) ||
          // A tier stills a swaying object upright and takes its shadow off.
          (detailSwitched &&
            (obj.shadow !== undefined || obj.sway !== undefined || obj.environmentSway !== undefined));
        // A ghost holds its frozen pose, still air included.
        if (
          rebind &&
          !this.bindPose(
            po,
            sprite,
            watched ? tick : 0,
            watched ? motionTime : 0,
            sway ?? 0,
            watched ? wind : undefined,
            watched,
          )
        ) {
          continue;
        }
        if (rebind)
          bloodSurface(sprite, obj.y, { enabled: watched && obj.creature !== true, lift: obj.lift ?? 0 });
        po.lastWatched = watched;
        if (!po.attached) {
          this.spriteLayer.addChild(sprite);
          if (po.shadowSprite !== null) this.spriteLayer.addChild(po.shadowSprite);
          for (const overlay of po.overlaySprites) this.spriteLayer.addChild(overlay);
          po.attached = true;
          block.attachedCount++;
        }
      }
    }
    this.lastAnimTick = tick;
    this.lastMotionTime = motionTime;
    this.lastEnvironmentMotion = environmentMotion;
    this.lastWind = wind;
    this.lastTextureRevision = this.textures.retryRevision;
  }

  /** Free the tall-object sprites (a map change re-invalidates them). */
  destroy(): void {
    for (const block of this.blocks.values()) {
      for (const po of block.objects) {
        po.sprite?.destroy();
        po.shadowSprite?.destroy();
        for (const overlay of po.overlaySprites) overlay.destroy();
      }
    }
    this.blocks.clear();
    this.blockByObject.clear();
    this.lastAnimTick = -1;
    this.lastMotionTime = -1;
    this.lastTextureRevision = -1;
  }
}
