import type { WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import type { FogGhost } from '../../data/fog/index.js';
import { type Camera, cameraScreenX, cameraScreenY, type Viewport } from '../../data/projection/index.js';
import {
  collectSpriteScene,
  type DrawItem,
  type LiveRefs,
  type SpriteDrawItem,
  SpriteSpatialIndex,
  screenDepth,
} from '../../data/scene/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { LayerBinder } from './bind-layers.js';
import { trackMotion } from './motion.js';
import { anchorOf, boundsOf, type DamagedBuilding, pixelHit } from './pick.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';
import { PortraitSubject } from './portrait-subject.js';
import { animationClock, easeReveal, revealedItem, walkPose } from './presentation.js';
import { reconcileSprites } from './reconcile.js';
import { resolveLayers } from './resolve-layers.js';

/** The retained per-entity sprite pool, keyed by the entity's monotonic, never-reused id. */

/**
 * Pooled entries the death reap sweeps per frame - the one pass that must reach off-screen entities, so
 * a fixed budget keeps its cost constant instead of a whole-pool spike. A death detaches immediately, so
 * the delay before its display object is freed (one full round-robin pass) is memory reclamation only.
 */
const POOL_REAP_BUDGET = 32;

export interface PoolFrame {
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
   *  raw tick positions. */
  readonly alpha: number;
  /** Entities the retained static map-object layer draws instead; the scene build skips them, so the
   *  pool never touches them. */
  readonly staticRefs?: ReadonlySet<number>;
  /** The fog-of-war cull: entities on tiles it rejects stay pooled but undrawn. Absent = no fog. */
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
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
  private lastItems: readonly SpriteDrawItem[] = [];
  private readonly damaged: DamagedBuilding[] = [];
  private readonly portrait: PortraitSubject;
  private readonly binder: LayerBinder;

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
  ) {
    this.portrait = new PortraitSubject(spriteLayer);
    this.binder = new LayerBinder(textures, sheet);
  }

  /**
   * Reconcile the pool to one frame: update, depth-sort and attach the drawn entities, detach the rest,
   * and reap the ones that left the snapshot.
   */
  reconcile(frame: PoolFrame): void {
    // One indexed pass yields both the culled draw list and the pre-cull liveness view the reap needs.
    const scene = collectSpriteScene(frame.snapshot, {
      viewport: frame.viewport,
      elevation: frame.elevation,
      staticRefs: frame.staticRefs,
      index: this.spatial,
      fogVisible: frame.fogVisible,
      ghosts: frame.ghosts,
      ...(frame.portraitRef !== undefined ? { portraitRef: frame.portraitRef } : {}),
      ...(this.playerColourOf !== undefined ? { playerColourOf: this.playerColourOf } : {}),
    });
    this.frameId++;
    this.portrait.release();
    this.damaged.length = 0;
    for (let i = 0; i < scene.items.length; i++) {
      const item = scene.items[i];
      if (item === undefined) continue;
      if (item.kind === 'building' && item.hpFrac !== undefined && item.ghost !== true) {
        this.damaged.push({ ref: item.ref, hpFrac: item.hpFrac });
      }
      let pe = this.pool.get(item.ref);
      if (pe === undefined) {
        pe = this.binder.create(item.kind, item);
        this.pool.set(item.ref, pe);
      }
      // An entity absent from last frame's draw list holds the motion track from whenever it was last
      // drawn, so resuming the lerp would glide it in from that stale anchor. Reset to first-sighting and
      // let trackMotion snap. Reads `lastSeen` before the stamp below overwrites it.
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

  /** Re-place every drawn paletted settler's meshes for a camera and target size (logical px). Must
   *  mirror the {@link LayerBinder}'s placement exactly. */
  private placePaletted(camera: Camera, resWidth: number, resHeight: number): void {
    const camScale = camera.scale ?? 1;
    for (const pe of this.attached) {
      if (!pe.paletted) continue;
      const originX = cameraScreenX(camera, pe.motion.drawX);
      const originY = cameraScreenY(camera, pe.motion.drawY);
      for (const spr of pe.sprites) {
        if (!spr.visible) continue;
        spr.place(originX, originY, camScale * spr.artScale, resWidth, resHeight);
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
  }

  private updatePooled(pe: PooledEntity, item: DrawItem, frame: PoolFrame): void {
    trackMotion(pe.motion, frame.tick, item.x, item.y - (item.lift ?? 0), frame.alpha);
    pe.container.position.set(pe.motion.drawX, pe.motion.drawY);
    if (item.facing !== undefined) pe.lastFacing = item.facing;
    // `upgradePct` and `builtPct` are mutually exclusive by construction, so an upgrade site rides the
    // same eased reveal as a from-scratch one.
    pe.reveal = easeReveal(pe.reveal, item.builtPct ?? item.upgradePct);
    const layers = resolveLayers(
      this.sheet,
      revealedItem(walkPose(item, pe.kind, pe.motion, pe.lastFacing), pe.reveal),
      animationClock(item, frame.tick),
      Math.floor(pe.motion.gaitPhase),
    );
    this.binder.bind(pe, item, layers, frame, this.frameId);
  }
}
