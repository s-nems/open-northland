import type { WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import type { FogGhost } from '../../data/fog/index.js';
import {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  snapToDevicePixels,
  type Viewport,
} from '../../data/projection/index.js';
import {
  buildSpriteScene,
  collectSpriteScene,
  type DrawItem,
  type LiveRefs,
  type SpriteDrawItem,
  type SpriteScene,
  SpriteSpatialIndex,
  screenDepth,
} from '../../data/scene/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { PixelArtScaler } from '../pixel-art-registry.js';
import type { PlanStakeTextures } from '../plan-stake.js';
import type { ShadowStyle } from '../shadow-style.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { restoreStash, type StashedVisibility, stashHidden } from '../visibility.js';
import { LayerBinder } from './bind-layers.js';
import { anchorOf, boundsOf, type DamagedBuilding, pixelHit } from './pick.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';
import { PortraitSubject } from './portrait-subject.js';
import { presentEntity } from './present-entity.js';
import { reconcileSprites } from './reconcile.js';
import { SpriteSceneCache } from './scene-cache.js';

/** The retained per-entity sprite pool, keyed by the entity's monotonic, never-reused id. */

/**
 * Pooled entries the death reap sweeps per frame - the one pass that must reach off-screen entities, so
 * a fixed budget keeps its cost constant instead of a whole-pool spike. A death detaches immediately, so
 * the delay before its display object is freed (one full round-robin pass) is memory reclamation only.
 */
const POOL_REAP_BUDGET = 32;

export interface PoolFrame {
  readonly enhancedSampling?: boolean;
  /** How original pixel art magnifies under enhanced sampling; the registry default when absent. */
  readonly pixelArtScaler?: PixelArtScaler;
  readonly environmentMotion?: boolean;
  /** How shadow silhouettes draw; absent means the shadow enhancement is off, which also keeps a
   *  character's projected cast layer off the screen. */
  readonly shadowStyle?: ShadowStyle | undefined;
  readonly snapshot: WorldSnapshot;
  /** The margin-inflated world-space box the camera frames - the sprite cull rectangle. */
  readonly viewport: Viewport;
  /** The sim tick the snapshot belongs to - the animation clock for looping gaits. */
  readonly tick: number;
  /** The camera transform; the screen-space paletted settler meshes self-place from it. */
  readonly camera: Camera;
  /** Canvas size in pixels. */
  readonly screenW: number;
  readonly screenH: number;
  readonly elevation: ElevationField;
  /** Fixed-timestep interpolation fraction [0,1] between an entity's last two tick anchors; `1` draws
   *  raw tick positions, which is what a gait-clocked walker draws whatever this carries. */
  readonly alpha: number;
  /** Device px per screen px the self-placing paletted meshes round their origin to; absent draws them
   *  at their fractional origin, as the `?shot` capture does. */
  readonly snapResolution?: number | undefined;
  /** Entities the retained static map-object layer draws instead; the scene build skips them, so the
   *  pool never touches them. */
  readonly staticRefs?: ReadonlySet<number>;
  /** The fog-of-war cull: entities on tiles it rejects stay pooled but undrawn. Absent = no fog. */
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
  /** Version of the fog cull's answers, bumped by the fog owner whenever `fogVisible` may answer
   *  differently; a bump invalidates the cached scene build. Absent = no fog. */
  readonly fogEpoch?: number;
  /** Remembered statics drawn dimmed on explored ground in place of their fog-culled or dead entities. */
  readonly ghosts?: readonly FogGhost[];
  /** Workplace-assignment highlight: building id → assignable (green tint) or not (red). Transient view
   *  state like the selection, never sim state. */
  readonly highlight?: ReadonlyMap<number, boolean>;
  /** The details-panel portrait's subject: force-drawn through the cull so its cutout survives
   *  off-screen or indoors, but hidden on the main map (see {@link DrawItem.portraitOnly}). */
  readonly portraitRef?: number;
}

/** One camera framing of a {@link SpritePool.portraitPass} render; the size is the render target's
 *  logical px. */
export interface PortraitView {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
}

/** A {@link SpritePool.mapViewPass} render: the entities in `viewport` around another camera, drawn
 *  whatever the fog, or only `solo` when set. */
export interface MapViewPassFrame extends PortraitView {
  readonly snapshot: WorldSnapshot;
  readonly viewport: Viewport;
  readonly tick: number;
  readonly alpha: number;
  readonly elevation: ElevationField;
  /** As {@link PoolFrame.staticRefs}: the map-object layer draws these. */
  readonly staticRefs?: ReadonlySet<number>;
  readonly solo?: number;
}

/** A borrowed entity's bounds are reset to this after its bind, so they never count as the frame's and
 *  it stays unpickable on the main map. */
const MAP_VIEW_BOUNDS_FRAME = -1;

export class SpritePool {
  private readonly pool = new Map<number, PooledEntity>();
  /** The retained viewport index the scene build walks instead of every snapshot entity. */
  private readonly spatial = new SpriteSpatialIndex();
  /** The pooled entities currently attached to {@link spriteLayer}, kept in sync with each entity's
   *  `attached` flag. */
  private readonly attached = new Set<PooledEntity>();
  /** The death reap's round-robin cursor, carried across frames; `undefined` restarts a pass from the front. */
  private reapCursor: MapIterator<number> | undefined;
  private frameId = 0;
  private readonly sceneCache = new SpriteSceneCache();
  private lastItems: readonly SpriteDrawItem[] = [];
  private readonly damaged: DamagedBuilding[] = [];
  private readonly portrait: PortraitSubject;
  private readonly binder: LayerBinder;
  /** Last {@link reconcile}'s device grid, so the portrait pass re-places the meshes the way it drew
   *  them. */
  private snapResolution: number | undefined;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer, also holding the tall map objects.
   * @param sheet the loaded bob atlas + bindings; `undefined` draws placeholder geometry for every entity.
   */
  constructor(
    private readonly spriteLayer: Container,
    textures: TextureCache,
    private readonly sheet: SpriteSheet | undefined,
    /** Owner slot → team-colour slot; absent = identity. */
    private readonly playerColourOf?: (player: number) => number,
    stakes?: PlanStakeTextures,
  ) {
    this.portrait = new PortraitSubject(spriteLayer);
    this.binder = new LayerBinder(textures, sheet, stakes);
  }

  /**
   * Reconcile the pool to one frame: update, depth-sort and attach the drawn entities, detach the rest,
   * and reap the ones that left the snapshot.
   */
  reconcile(frame: PoolFrame): void {
    const scene = this.sceneFor(frame);
    this.frameId++;
    this.snapResolution = frame.snapResolution;
    this.portrait.release();
    this.damaged.length = 0;
    for (let i = 0; i < scene.items.length; i++) {
      const item = scene.items[i];
      if (item === undefined) continue;
      if (item.kind === 'building' && item.hpFrac !== undefined && item.ghost !== true) {
        this.damaged.push({ ref: item.ref, hpFrac: item.hpFrac });
      }
      const pe = this.pooledFor(item);
      // An entity absent from last frame's draw list holds the motion track from whenever it was last
      // drawn: resuming from it would glide an arrow in from that stale anchor, and would run a walker's
      // gait and stall clocks over the whole gap. Reset to first-sighting and let trackMotion snap.
      // Reads `lastSeen` before the stamp below overwrites it.
      if (pe.lastSeen !== this.frameId - 1) pe.motion.tick = -1;
      this.updatePooled(pe, item, frame);
      // Depth is the feet-anchor screen y plus a small deterministic x tiebreak, the same key the tall map
      // objects use, so a settler and the tree it walks behind sort into one painter order. Adding back
      // `item.lift` restores the pre-lift y, so occlusion sorts by map row while the sprite rides the hill.
      pe.container.zIndex = screenDepth(
        pe.motion.drawX,
        pe.motion.drawY + (item.lift ?? 0),
        item.kind,
        item.isFlag === true,
      );
      if (!pe.attached) {
        this.spriteLayer.addChild(pe.container);
        pe.attached = true;
        this.attached.add(pe);
      }
      pe.lastSeen = this.frameId;
      if (item.portraitOnly === true) this.portrait.capture(pe, item.frozen === true);
    }
    this.lastItems = scene.items;

    // Iterating `attached` instead of the whole pool keeps the detach scan bounded by the screen.
    // Deleting the current entry mid-iteration is well-defined for a Set.
    for (const pe of this.attached) {
      if (pe.lastSeen === this.frameId) continue;
      this.spriteLayer.removeChild(pe.container);
      pe.attached = false;
      this.attached.delete(pe);
    }

    this.reap(scene.liveRefs);
  }

  /**
   * `item`'s pooled entity, minted on first sight and minted again when its sprite class no longer suits
   * it. The replacement keeps the old one's motion and sighting, so the swap never snaps or restarts a
   * gait.
   */
  private pooledFor(item: SpriteDrawItem): PooledEntity {
    const pe = this.pool.get(item.ref);
    if (pe !== undefined && this.binder.suits(pe, item)) return pe;
    const fresh = this.binder.create(item.kind, item);
    if (pe !== undefined) {
      Object.assign(fresh.motion, pe.motion);
      if (pe.lastFacing !== undefined) fresh.lastFacing = pe.lastFacing;
      fresh.lastSeen = pe.lastSeen;
      fresh.viewSeen = pe.viewSeen;
      if (pe.attached) {
        this.spriteLayer.removeChild(pe.container);
        this.attached.delete(pe);
      }
      pe.container.destroy({ children: true });
    }
    this.pool.set(item.ref, fresh);
    return fresh;
  }

  /**
   * One indexed pass yields both the culled draw list and the pre-cull liveness view the reap needs,
   * reused across frames while every input is unchanged - at high frame rates most frames only move
   * `alpha`, which the build never reads. The cached liveness view stays valid because only a rebuild
   * ever advances the spatial index it reads.
   */
  private sceneFor(frame: PoolFrame): SpriteScene {
    const cached = this.sceneCache.lookup(frame);
    if (cached !== null) return cached;
    const scene = collectSpriteScene(frame.snapshot, {
      viewport: frame.viewport,
      elevation: frame.elevation,
      staticRefs: frame.staticRefs,
      index: this.spatial,
      fogVisible: frame.fogVisible,
      ghosts: frame.ghosts,
      ...(this.sheet?.inHousePrograms !== undefined ? { inHousePrograms: this.sheet.inHousePrograms } : {}),
      ...(this.sheet?.holyFire !== undefined ? { holyFire: this.sheet.holyFire } : {}),
      ...(frame.portraitRef !== undefined ? { portraitRef: frame.portraitRef } : {}),
      ...(this.playerColourOf !== undefined ? { playerColourOf: this.playerColourOf } : {}),
    });
    this.sceneCache.store(frame, scene);
    return scene;
  }

  /** Free the entries in the next {@link POOL_REAP_BUDGET} slice that left the snapshot. */
  private reap(liveRefs: LiveRefs): void {
    const swept: number[] = [];
    for (let i = 0; i < POOL_REAP_BUDGET; i++) {
      if (this.reapCursor === undefined) this.reapCursor = this.pool.keys();
      const next = this.reapCursor.next();
      if (next.done === true) {
        this.reapCursor = undefined;
        break;
      }
      swept.push(next.value);
    }
    for (const ref of reconcileSprites(liveRefs, swept).toDestroy) {
      const pe = this.pool.get(ref);
      if (pe === undefined) continue;
      pe.container.destroy({ children: true });
      this.pool.delete(ref);
    }
  }

  /** This frame's drawn damaged finished buildings, valid until the next {@link reconcile}. Collected off
   *  the culled draw list, so the smoke overlay's cost tracks the screen. */
  damagedBuildings(): readonly DamagedBuilding[] {
    return this.damaged;
  }

  stats(): { drawn: number; pooled: number } {
    return { drawn: this.lastItems.length, pooled: this.pool.size };
  }

  /** The last {@link reconcile}'s culled, depth-sorted draw list, valid until the next reconcile. */
  drawnItems(): readonly DrawItem[] {
    return this.lastItems;
  }

  boundsOf(ref: number): EntityBounds | undefined {
    return boundsOf(this.pool.get(ref), this.frameId);
  }

  selectionOf(ref: number) {
    const pe = this.pool.get(ref);
    return pe?.boundsFrame === this.frameId ? pe.selectionEllipse : undefined;
  }

  pixelHit(ref: number, wx: number, wy: number): boolean | undefined {
    return pixelHit(this.pool.get(ref), this.frameId, wx, wy);
  }

  anchorOf(ref: number): { x: number; y: number } | undefined {
    return anchorOf(this.pool.get(ref), this.frameId);
  }

  /**
   * Scope the details-panel portrait's second render: re-place the self-placing paletted meshes for the
   * inset camera, reveal the force-hidden subject, solo an indoor one, then restore all of it even if
   * `render` throws - a failed cutout must not leave a real unit hidden on the main map.
   */
  portraitPass(inset: PortraitView, main: PortraitView, render: (soloKeep: Container | null) => void): void {
    this.placePaletted(inset.camera, inset.width, inset.height);
    this.portrait.show();
    const soloKeep = this.portrait.beginSoloIfIndoor();
    try {
      render(soloKeep);
    } finally {
      this.portrait.endSolo();
      this.portrait.hide();
      this.placePaletted(main.camera, main.width, main.height);
    }
  }

  /**
   * Scope a map view's render: borrow the entities around its camera that this frame's cull left
   * detached (off screen or in the fog), place everything for the view, render, then detach the borrowed
   * ones and re-place for the main camera, even if a step throws. A solo view hides every other
   * sprite-layer child, and `render` then receives the sprite layer as the one world layer to keep. An
   * entity the main frame draws keeps its main presentation, a fog ghost included (approximation).
   */
  mapViewPass(
    view: MapViewPassFrame,
    main: PortraitView,
    render: (soloKeep: Container | null) => void,
  ): void {
    const items = buildSpriteScene(view.snapshot, {
      viewport: view.viewport,
      elevation: view.elevation,
      index: this.spatial,
      staticRefs: view.staticRefs,
      keepIndoorSettlers: view.solo !== undefined,
      ...(view.solo !== undefined ? { onlyRefs: new Set([view.solo]) } : {}),
      ...(this.sheet?.inHousePrograms !== undefined ? { inHousePrograms: this.sheet.inHousePrograms } : {}),
      ...(this.sheet?.holyFire !== undefined ? { holyFire: this.sheet.holyFire } : {}),
      ...(this.playerColourOf !== undefined ? { playerColourOf: this.playerColourOf } : {}),
    });
    const frame: PoolFrame = {
      snapshot: view.snapshot,
      viewport: view.viewport,
      tick: view.tick,
      camera: view.camera,
      screenW: view.width,
      screenH: view.height,
      elevation: view.elevation,
      alpha: view.alpha,
      snapResolution: this.snapResolution,
    };
    const borrowed: PooledEntity[] = [];
    let stash: StashedVisibility[] | null = null;
    try {
      let solo: Container | null = null;
      for (const item of items) {
        // An entity the main frame drew keeps that presentation, a fog ghost of a driven cart included.
        const drawn = this.pool.get(item.ref);
        const pe = drawn?.attached === true ? drawn : this.pooledFor(item);
        if (!pe.attached) {
          // Another view may already have drawn it this frame.
          const continuous = pe.lastSeen === this.frameId - 1 || pe.viewSeen >= this.frameId - 1;
          if (!continuous) pe.motion.tick = -1;
          borrowed.push(pe);
          this.spriteLayer.addChild(pe.container);
          const layers = presentEntity(pe, item, frame, this.sheet);
          this.binder.bind(pe, item, layers, frame, this.frameId);
          pe.boundsFrame = MAP_VIEW_BOUNDS_FRAME;
          pe.container.zIndex = screenDepth(
            pe.motion.drawX,
            pe.motion.drawY + (item.lift ?? 0),
            item.kind,
            item.isFlag === true,
          );
          pe.viewSeen = this.frameId;
        }
        if (item.ref === view.solo) solo = pe.container;
      }
      this.placePaletted(view.camera, view.width, view.height);
      if (solo !== null) stash = stashHidden(this.spriteLayer.children, solo);
      if (view.solo === undefined || solo !== null) render(solo === null ? null : this.spriteLayer);
    } finally {
      if (stash !== null) restoreStash(stash);
      for (const pe of borrowed) this.spriteLayer.removeChild(pe.container);
      this.placePaletted(main.camera, main.width, main.height);
    }
  }

  /** Re-place every drawn paletted entity's meshes for a camera and target size (logical px). Must
   *  mirror the {@link LayerBinder}'s placement exactly. */
  private placePaletted(camera: Camera, resWidth: number, resHeight: number): void {
    const camScale = camera.scale ?? 1;
    const snap = this.snapResolution;
    for (const pe of this.attached) {
      if (!pe.paletted) continue;
      const originX = snapToDevicePixels(cameraScreenX(camera, pe.motion.drawX), snap);
      const originY = snapToDevicePixels(cameraScreenY(camera, pe.motion.drawY), snap);
      for (const spr of pe.sprites) {
        if (!spr.visible) continue;
        spr.place(
          originX + spr.artDx * camScale,
          originY + spr.artDy * camScale,
          camScale * spr.artScale,
          resWidth,
          resHeight,
        );
      }
    }
  }

  /**
   * Destroy every pooled entity, including the detached (culled off-screen) ones a scene-graph walk from
   * the sprite layer can't reach.
   */
  destroy(): void {
    for (const pe of this.pool.values()) pe.container.destroy({ children: true });
    this.pool.clear();
    this.attached.clear();
    this.reapCursor = undefined;
    this.sceneCache.clear();
  }

  private updatePooled(pe: PooledEntity, item: DrawItem, frame: PoolFrame): void {
    const layers = presentEntity(pe, item, frame, this.sheet);
    this.binder.bind(pe, item, layers, frame, this.frameId);
  }
}
