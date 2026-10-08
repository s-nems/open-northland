import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import { BloodCoats } from '../../data/effects/blood-coats.js';
import type { GhostSource } from '../../data/fog/index.js';
import {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  snapToDevicePixels,
  type Viewport,
} from '../../data/projection/index.js';
import { SpriteDepthOrder } from '../../data/scene/depth-order.js';
import {
  buildSpriteScene,
  collectSpriteScene,
  type DrawItem,
  IncrementalScene,
  isStaticItem,
  type LiveRefs,
  SceneItemMemo,
  type SpriteDrawItem,
  type SpriteScene,
  screenDepth,
} from '../../data/scene/index.js';
import { DEFAULT_FACING, vehicleAfloat, vehicleLookFor } from '../../data/sprites/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { WindSway } from '../../data/weather/climate.js';
import { PalettedQuad } from '../paletted-sprite/index.js';
import type { PixelArtScaler } from '../pixel-art-registry.js';
import { PLOT_BOUNDS, type PlanRoadTextures } from '../plan-road.js';
import type { PlanStakeTextures } from '../plan-stake.js';
import type { SelectionStyle } from '../selection-style.js';
import type { ShadowStyle } from '../shadow-style.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { restoreStash, type StashedVisibility, stashHidden } from '../visibility.js';
import { LayerBinder } from './bind-layers.js';
import { FrameEpoch } from './bind-stamp.js';
import { coatBody } from './blood-coats.js';
import { atRest } from './motion.js';
import { anchorOf, boundsOf, type DamagedBuilding, keelOf, pixelHit, type ShipAfloat } from './pick.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';
import { PortraitSubject } from './portrait-subject.js';
import { presentEntity } from './present-entity.js';
import { reconcileSprites } from './reconcile.js';
import { resolvesWithoutClock } from './resolve-layers.js';
import { SpriteSceneCache } from './scene-cache.js';
import { SelectionEffects } from './selection-effects.js';

/** The retained per-entity sprite pool, keyed by the entity's monotonic, never-reused id. */

/**
 * Pooled entries the death reap sweeps per frame - the one pass that must reach off-screen entities, so
 * a fixed budget keeps its cost constant instead of a whole-pool spike. A death detaches immediately, so
 * the delay before its display object is freed (one full round-robin pass) is memory reclamation only.
 */
const POOL_REAP_BUDGET = 32;

const NO_REFS: ReadonlySet<number> = new Set();

/** A pooled entity's container names its entity, so the sprite layer's still mesh asks about a child
 *  without a map lookup. */
const POOLED: unique symbol = Symbol('pooled entity');
type PooledContainer = Container & { [POOLED]?: PooledEntity };

/** The hold generation a kept draw item was last presented under; a symbol, so the item's own fields
 *  and the stamp's field-by-field compare never see it. */
const HELD: unique symbol = Symbol('held under pool generation');
type HoldMarked = { [HELD]?: number };

export interface PoolFrame {
  readonly selection?: ReadonlySet<number>;
  /** Work flags belonging to selected gatherers always receive an amber outline. */
  readonly flagged?: ReadonlySet<number>;
  readonly selectionStyle?: SelectionStyle;
  readonly selectionTime?: number;
  readonly enhancedSampling?: boolean;
  /** How original pixel art magnifies under enhanced sampling; the registry default when absent. */
  readonly pixelArtScaler?: PixelArtScaler;
  readonly environmentMotion?: boolean;
  /** The weather's wind, bending swaying vegetation and filling sails while `environmentMotion` is on;
   *  the same object while it holds still. Absent is still air. */
  readonly wind?: WindSway | undefined;
  /** How shadow silhouettes draw; absent means the shadow enhancement is off, which also keeps a
   *  character's projected cast layer off the screen. */
  readonly shadowStyle?: ShadowStyle | undefined;
  readonly snapshot: WorldSnapshot;
  /** The margin-inflated world-space box the camera frames - the sprite cull rectangle. */
  readonly viewport: Viewport;
  /** The sim tick the snapshot belongs to - the animation clock for looping gaits. */
  readonly tick: number;
  /** The camera transform; the screen-space paletted vehicle meshes self-place from it. */
  readonly camera: Camera;
  /** Canvas size in pixels. */
  readonly screenW: number;
  readonly screenH: number;
  readonly elevation: ElevationField;
  /** Fixed-timestep interpolation fraction [0,1] between an entity's last two tick anchors; `1` draws
   *  raw tick positions, which is what a gait-clocked walker draws whatever this carries. */
  readonly alpha: number;
  /** Device px per screen px the paletted layers round their feet origin to; absent draws them
   *  at their fractional origin, as the `?shot` capture does. */
  readonly snapResolution?: number | undefined;
  /** Entities the retained static map-object layer draws instead; the scene build skips them, so the
   *  pool never touches them. */
  readonly staticRefs?: ReadonlySet<number>;
  /** Entities whose sprites wait for a presentation over them to end; skipped like
   *  {@link staticRefs}. A change hands a new set, which keys the cached scene build. */
  readonly withheldRefs?: ReadonlySet<number>;
  /** The fog-of-war cull: entities on tiles it rejects stay pooled but undrawn. Absent = no fog. */
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
  /** Version of the fog cull's answers, bumped by the fog owner whenever `fogVisible` may answer
   *  differently; a bump invalidates the cached scene build. Absent = no fog. */
  readonly fogEpoch?: number;
  /** Remembered statics drawn dimmed on explored ground in place of their fog-culled or dead entities. */
  readonly ghosts?: GhostSource;
  /** Workplace-assignment highlight: building id → assignable (green tint) or not (red). Transient view
   *  state like the selection, never sim state. */
  readonly highlight?: ReadonlyMap<number, boolean>;
  /** The details-panel portrait's subject: force-drawn through the cull so its cutout survives
   *  off-screen or indoors, but hidden on the main map (see {@link DrawItem.portraitOnly}). */
  readonly portraitRef?: number;
  /** The building the portrait's settler subject is inside: kept through the cull in the subject's
   *  place while nothing choreographs the subject in there (see {@link SpriteSceneOptions.portraitHouse}). */
  readonly portraitHouse?: number;
  /** The other portrait insets' subjects (the trade window's houses, a rider's vehicle): force-drawn
   *  through the cull like {@link portraitRef}, and hidden on the main map when only an inset keeps them. */
  readonly insetRefs?: readonly number[];
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

/**
 * Depth is the feet-anchor screen y plus a small deterministic x tiebreak, the same key the tall map
 * objects use, so a settler and the tree it walks behind sort into one painter order. Adding back
 * `item.lift` restores the pre-lift y, so occlusion sorts by map row while the sprite rides the hill. An
 * unclaimed road plot paints with the ground; a claimed one keeps its flag among the standing sprites
 * but sorts at the plot's back edge, so a walker on the plot is never painted under its stones. The
 * flag then covers a walker at most the plot's half-depth behind its pole.
 */
function pooledDepth(pe: PooledEntity, item: DrawItem): number {
  const plotBack = item.roadSite === 'claimed' ? PLOT_BOUNDS.top : 0;
  return screenDepth(
    pe.motion.drawX,
    pe.motion.drawY + (item.lift ?? 0) + plotBack,
    item.kind,
    item.isFlag === true,
    item.roadSite === 'unclaimed',
  );
}

export class SpritePool {
  private readonly pool = new Map<number, PooledEntity>();
  /** The pooled entities currently attached to {@link spriteLayer}, kept in sync with each entity's
   *  `attached` flag. */
  private readonly attached = new Set<PooledEntity>();
  /** The death reap's round-robin cursor, carried across frames; `undefined` restarts a pass from the front. */
  private reapCursor: MapIterator<number> | undefined;
  private frameId = 0;
  private readonly sceneCache = new SpriteSceneCache();
  private readonly depthOrder = new SpriteDepthOrder();
  private readonly itemMemo = new SceneItemMemo();
  private readonly incremental = new IncrementalScene();
  private lastItems: readonly SpriteDrawItem[] = [];
  /** Indices into {@link lastItems} of the entities the last full pass found moving with the frame clock
   *  or emphasised, and their refs: what a still frame presents. */
  private readonly moving: number[] = [];
  private readonly movingRefs = new Set<number>();
  /** What the last full pass drew under, which a still frame must match. */
  private passEpoch = -1;
  private passHighlight: PoolFrame['highlight'];
  private passStyle: PoolFrame['selectionStyle'];
  private passHasPortrait = false;
  /** Bumped whenever a held entity may have to draw otherwise without its draw item changing. */
  private holdGeneration = 0;
  private holdBind = -1;
  private holdMotion = -1;
  private holdHighlight: PoolFrame['highlight'];
  private holdStyle: PoolFrame['selectionStyle'];
  /** The pooled entity of each of {@link lastItems}, by index: a repeated scene build skips the lookups. */
  private readonly lastPooled: (PooledEntity | undefined)[] = [];
  private readonly damaged: DamagedBuilding[] = [];
  private readonly ships: ShipAfloat[] = [];
  /** Scratch {@link keelOf} answers in, valid until the next call. */
  private readonly keelScratch: number[] = [];
  private readonly portrait: PortraitSubject;
  private readonly binder: LayerBinder;
  private readonly selectionEffects: SelectionEffects;
  private readonly bloodCoats = new BloodCoats();
  private readonly epoch = new FrameEpoch();
  /** Last {@link reconcile}'s device grid, so the portrait pass re-places the meshes the way it drew
   *  them. */
  private snapResolution: number | undefined;

  setBloodEnabled(enabled: boolean): void {
    this.bloodCoats.setEnabled(enabled);
    if (!enabled) for (const pe of this.pool.values()) coatBody(pe, 0);
  }

  ingestBlood(events: readonly SimEvent[], tick: number): void {
    this.bloodCoats.ingest(events, tick);
    for (const event of events) {
      if ((event.kind !== 'combatHit' && event.kind !== 'projectileHit') || event.structure === true)
        continue;
      const victim = this.pool.get(event.target);
      if (victim !== undefined) victim.held = -1;
      if (event.kind === 'combatHit') {
        const attacker = this.pool.get(event.attacker);
        if (attacker !== undefined) attacker.held = -1;
      }
    }
  }

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer, also holding the tall map objects.
   * @param sheet the loaded bob atlas + bindings; `undefined` draws placeholder geometry for every entity.
   */
  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    private readonly sheet: SpriteSheet | undefined,
    /** Owner slot → team-colour slot; absent = identity. */
    private readonly playerColourOf?: (player: number) => number,
    stakes?: PlanStakeTextures,
    roads?: PlanRoadTextures,
  ) {
    this.selectionEffects = new SelectionEffects(textures);
    this.portrait = new PortraitSubject(spriteLayer);
    this.binder = new LayerBinder(textures, sheet, stakes, roads);
  }

  /**
   * Reconcile the pool to one frame: update, depth-sort and attach the drawn entities, detach the rest,
   * and reap the ones that left the snapshot.
   */
  reconcile(frame: PoolFrame): void {
    const scene = this.sceneFor(frame);
    this.sheet?.palette?.beginFrame();
    this.epoch.advance(frame, this.textures.textureRevision);
    this.snapResolution = frame.snapResolution;
    if (this.repeatsStill(scene, frame)) {
      this.presentMoving(frame);
      this.reap(scene.liveRefs);
      this.sheet?.palette?.flush();
      return;
    }
    this.frameId++;
    this.portrait.release();
    this.reviseHolds(scene, frame);
    // A kept bind placed its paletted layers for the camera it was bound under. Re-placed before the
    // visits, so a selection outline copies where its body draws under this camera.
    if (this.epoch.viewMoved) this.placePaletted(frame.camera, frame.screenW, frame.screenH);
    // The cached build of an unchanged scene: last frame's entities, damage and ships all still hold.
    const repeated = scene.items === this.lastItems;
    if (!repeated) this.collectOverlays(scene.items);
    this.moving.length = 0;
    this.movingRefs.clear();
    this.passHasPortrait = false;
    const kept = scene.kept;
    const generation = this.holdGeneration;
    for (let i = 0; i < scene.items.length; i++) {
      const item = scene.items[i];
      if (item === undefined) continue;
      // A self-contained item kept from the last build, its entity holding still: nothing to present.
      if (kept !== undefined && kept[i] === 1 && (item as unknown as HoldMarked)[HELD] === generation) {
        this.lastPooled[i] = undefined;
        continue;
      }
      const pe = (repeated ? this.lastPooled[i] : undefined) ?? this.pooledFor(item);
      this.visit(pe, item, i, frame);
    }
    // A held entity a selection or flag now names draws its emphasis, which only a visit applies.
    for (const refs of [frame.selection, frame.flagged]) {
      for (const ref of refs ?? NO_REFS) {
        const pe = this.pool.get(ref);
        const item = pe?.bound.item;
        if (pe !== undefined && pe.held === generation && pe.lastSeen !== this.frameId && item !== undefined)
          this.visit(pe, item as SpriteDrawItem, -1, frame);
      }
    }
    this.lastItems = scene.items;
    this.lastPooled.length = scene.items.length;
    this.passEpoch = this.epoch.current;
    this.passHighlight = frame.highlight;
    this.passStyle = frame.selectionStyle;

    // Iterating `attached` instead of the whole pool keeps the detach scan bounded by the screen.
    // Deleting the current entry mid-iteration is well-defined for a Set.
    for (const pe of this.attached) {
      if (pe.lastSeen === this.frameId || pe.held === generation) continue;
      this.selectionEffects.clear(pe);
      this.spriteLayer.removeChild(pe.container);
      pe.attached = false;
      this.attached.delete(pe);
    }

    this.reap(scene.liveRefs);
    this.sheet?.palette?.flush();
  }

  /**
   * Present `item` (at `index` of the draw list, −1 outside it) on `pe`, attach it, and record whether
   * it holds still for the passes after this one or moves with the frame clock.
   */
  private visit(pe: PooledEntity, item: SpriteDrawItem, index: number, frame: PoolFrame): void {
    if (index >= 0) this.lastPooled[index] = pe;
    // An entity absent from last frame's draw list holds the motion track from whenever it was last
    // drawn: resuming from it would glide an arrow in from that stale anchor, and would run a walker's
    // gait and stall clocks over the whole gap. Reset to first-sighting and let trackMotion snap. A held
    // entity was drawn all along. Reads `lastSeen` before the stamp below overwrites it.
    // A hold of any generation stood attached until this visit, so it counts as drawn all along.
    const heldAttached = pe.held !== -1 && pe.attached;
    const continuous = pe.lastSeen === this.frameId - 1 || heldAttached;
    if (!continuous) pe.motion.tick = -1;
    if (heldAttached && pe.boundsFrame === pe.lastSeen) pe.boundsFrame = this.frameId - 1;
    const emphasis = this.presentItemAt(pe, item, frame, continuous);
    if (!pe.attached) {
      this.spriteLayer.addChild(pe.container);
      pe.attached = true;
      this.attached.add(pe);
    }
    pe.lastSeen = this.frameId;
    if (item.portraitOnly === true) {
      this.portrait.capture(item.ref, pe, item.frozen === true);
      this.passHasPortrait = true;
    }
    const still = !emphasis && this.holdsStill(pe, item);
    // Only a static-run item may stand unvisited: the touch log names it when a delta changes or removes
    // it. Any other kind is rebuilt every build, and only a visit notices it left the draw list.
    pe.held = still && isStaticItem(item) ? this.holdGeneration : -1;
    (item as unknown as HoldMarked)[HELD] = pe.held;
    if (!still && index >= 0) {
      this.moving.push(index);
      this.movingRefs.add(item.ref);
    }
  }

  /**
   * Release every hold when something a held entity draws from changed without its draw item changing
   * (a bind input, the wind or motion setting, the highlight, the selection style, a full scene build),
   * and each one whose entity a delta touched.
   */
  private reviseHolds(scene: SpriteScene, frame: PoolFrame): void {
    if (
      scene.kept === undefined ||
      this.epoch.bind !== this.holdBind ||
      this.epoch.motion !== this.holdMotion ||
      frame.highlight !== this.holdHighlight ||
      frame.selectionStyle !== this.holdStyle
    ) {
      this.holdGeneration++;
      this.holdBind = this.epoch.bind;
      this.holdMotion = this.epoch.motion;
      this.holdHighlight = frame.highlight;
      this.holdStyle = frame.selectionStyle;
    }
    for (const ref of scene.touchedStatics ?? NO_REFS) {
      const pe = this.pool.get(ref);
      if (pe !== undefined) pe.held = -1;
    }
  }

  /** The frame `pe`'s last sighting and bounds must carry to count as current: a held entity's stand
   *  from the pass that last presented it. */
  private currentFrameOf(pe: PooledEntity | undefined): number {
    return pe !== undefined && pe.held === this.holdGeneration ? pe.lastSeen : this.frameId;
  }

  /** Present `item` on `pe` and apply its selection emphasis; whether any emphasis applies. */
  private presentItemAt(pe: PooledEntity, item: DrawItem, frame: PoolFrame, continuous: boolean): boolean {
    this.presentPooled(pe, item, frame, continuous);
    if (item.kind === 'settler') coatBody(pe, this.bloodCoats.packed(item.ref, frame.tick + frame.alpha));
    const flagged = frame.flagged?.has(item.ref) === true;
    const style =
      item.ghost === true || item.portraitOnly === true
        ? undefined
        : flagged
          ? 'outline'
          : frame.selection?.has(item.ref)
            ? frame.selectionStyle
            : undefined;
    this.selectionEffects.update(
      pe,
      style,
      frame.camera.scale ?? 1,
      frame.selectionTime ?? 0,
      flagged ? 0xffc020 : undefined,
    );
    return style !== undefined;
  }

  /** Whether `container` is a pooled entity held still with its sprites as bound: what the sprite layer
   *  may draw from its still mesh. Paletted layers re-place with the camera, so they never qualify. */
  isHeld(container: Container): boolean {
    const pe = (container as PooledContainer)[POOLED];
    return pe !== undefined && pe.held === this.holdGeneration && pe.attached && !pe.paletted;
  }

  /** Whether `pe` draws the same whatever the frame alpha: what a still frame may leave untouched. */
  private holdsStill(pe: PooledEntity, item: DrawItem): boolean {
    return (
      this.bloodCoats.packed(item.ref, pe.motion.tick) === 0 &&
      pe.reveal === undefined &&
      !pe.bound.retrying &&
      resolvesWithoutClock(item) &&
      pe.bound.clockFree &&
      atRest(pe.motion)
    );
  }

  /**
   * Whether this frame differs from the last full pass only in the frame alpha: the same draw list, no
   * tick, setting, camera or highlight change, and every selected or flagged entity already among the
   * moving ones. Then only {@link moving} needs a present; everything else holds still where it is.
   */
  private repeatsStill(scene: SpriteScene, frame: PoolFrame): boolean {
    if (
      scene.items !== this.lastItems ||
      this.epoch.current !== this.passEpoch ||
      this.epoch.viewMoved ||
      this.passHasPortrait ||
      frame.highlight !== this.passHighlight ||
      frame.selectionStyle !== this.passStyle
    )
      return false;
    for (const ref of frame.selection ?? NO_REFS) if (!this.movingRefs.has(ref)) return false;
    for (const ref of frame.flagged ?? NO_REFS) if (!this.movingRefs.has(ref)) return false;
    return true;
  }

  /** A still frame's pass: present the entities that move with the frame clock, in draw-list order. */
  private presentMoving(frame: PoolFrame): void {
    for (const i of this.moving) {
      const item = this.lastItems[i];
      const pe = this.lastPooled[i];
      if (item !== undefined && pe !== undefined) this.presentItemAt(pe, item, frame, true);
    }
  }

  /** Collect the drawn damaged buildings and ships off a new draw list. */
  private collectOverlays(items: readonly SpriteDrawItem[]): void {
    this.damaged.length = 0;
    this.ships.length = 0;
    const vehicles = this.sheet?.bindings.vehicle;
    for (const item of items) {
      if (item.kind === 'building' && item.hpFrac !== undefined && item.ghost !== true) {
        this.damaged.push({ ref: item.ref, hpFrac: item.hpFrac });
      }
      // A portrait-only ship is hidden on the map, so it pushes no water there.
      const onMap = item.ghost !== true && item.portraitOnly !== true;
      if (item.kind === 'vehicle' && onMap && vehicles !== undefined) {
        // A moored ship still sits in the water: it keeps its lapping foam and lets a wake settle.
        const look = vehicleLookFor(vehicles, item);
        if (look?.afloat === true) {
          const sailing = vehicleAfloat(look, item) === 'sailing';
          this.ships.push({ ref: item.ref, facing: item.facing ?? DEFAULT_FACING, sailing });
        }
      }
    }
  }

  /**
   * Present and bind `pe` for this frame, unless what it last bound on the previous frame still stands:
   * the same inputs keep it without a present, as does an equal item that resolves without a clock under
   * the same bind inputs, and a present under the same bind inputs keeps it when it resolved exactly
   * what was bound, as a new tick does for most of a still town. A construction site always binds: its
   * eased reveal moves every frame, and a reveal bake left unbound may be evicted.
   */
  private presentPooled(pe: PooledEntity, item: DrawItem, frame: PoolFrame, continuous: boolean): void {
    const stamp = pe.bound;
    const highlight = frame.highlight?.get(item.ref);
    const steady = continuous && pe.reveal === undefined;
    if (
      steady &&
      stamp.alpha === frame.alpha &&
      stamp.holds(item, this.epoch.current, highlight) &&
      this.binder.paletteHolds(pe, item)
    ) {
      this.keepBound(pe);
      return;
    }
    if (
      steady &&
      resolvesWithoutClock(item) &&
      stamp.clockFree &&
      atRest(pe.motion) &&
      stamp.bindHolds(item, this.epoch.bind, highlight) &&
      stamp.sameItem(item) &&
      this.binder.paletteHolds(pe, item)
    ) {
      stamp.carry(item, this.epoch.current);
      stamp.alpha = frame.alpha;
      this.keepBound(pe);
      return;
    }
    const layers = presentEntity(pe, item, frame, this.sheet);
    stamp.alpha = frame.alpha;
    if (
      steady &&
      // The present may have started a construction reveal, which binds every frame.
      pe.reveal === undefined &&
      stamp.bindHolds(item, this.epoch.bind, highlight) &&
      stamp.presents(pe.motion, layers) &&
      this.binder.paletteHolds(pe, item)
    ) {
      stamp.carry(item, this.epoch.current);
      this.keepBound(pe);
      return;
    }
    const deferrals = this.textures.deferrals;
    this.binder.bind(pe, item, layers, frame, this.frameId);
    stamp.record(item, this.epoch, highlight, pe.motion, layers);
    // A bake the budget turned away left a stand-in on this entity alone: it binds again next frame.
    if (this.textures.deferrals !== deferrals) stamp.retry();
    pe.container.zIndex = pooledDepth(pe, item);
  }

  /** Leave `pe`'s sprites and depth as bound; bounds stamped last frame hold for this one. */
  private keepBound(pe: PooledEntity): void {
    if (pe.boundsFrame === this.frameId - 1) pe.boundsFrame = this.frameId;
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
      this.selectionEffects.clear(pe);
      pe.container.destroy({ children: true });
    }
    this.pool.set(item.ref, fresh);
    (fresh.container as PooledContainer)[POOLED] = fresh;
    return fresh;
  }

  /**
   * One indexed pass yields both the culled draw list and the pre-cull liveness view the reap needs,
   * reused across frames while every input is unchanged - at high frame rates most frames only move
   * `alpha`, which the build never reads. The cached liveness view reads the snapshot's position index,
   * which answers for the mirror's newest snapshot; a mirror hands out a new snapshot object per delta,
   * so a cache hit is always on the newest one.
   */
  private sceneFor(frame: PoolFrame): SpriteScene {
    const cached = this.sceneCache.lookup(frame);
    if (cached !== null) return cached;
    const scene = collectSpriteScene(
      frame.snapshot,
      {
        viewport: frame.viewport,
        elevation: frame.elevation,
        staticRefs: frame.staticRefs,
        withheldRefs: frame.withheldRefs,
        fogVisible: frame.fogVisible,
        fogEpoch: frame.fogEpoch,
        ghosts: frame.ghosts,
        ...(this.sheet?.inHousePrograms !== undefined ? { inHousePrograms: this.sheet.inHousePrograms } : {}),
        ...(this.sheet?.holyFire !== undefined ? { holyFire: this.sheet.holyFire } : {}),
        ...(frame.portraitRef !== undefined ? { portraitRef: frame.portraitRef } : {}),
        ...(frame.portraitHouse !== undefined ? { portraitHouse: frame.portraitHouse } : {}),
        ...(frame.insetRefs !== undefined ? { insetRefs: frame.insetRefs } : {}),
        ...(this.playerColourOf !== undefined ? { playerColourOf: this.playerColourOf } : {}),
      },
      this.depthOrder,
      this.itemMemo,
      this.incremental,
    );
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
      this.selectionEffects.clear(pe);
      pe.container.destroy({ children: true });
      this.pool.delete(ref);
    }
  }

  /** This frame's drawn damaged finished buildings, valid until the next {@link reconcile}. Collected off
   *  the culled draw list, so the smoke overlay's cost tracks the screen. */
  damagedBuildings(): readonly DamagedBuilding[] {
    return this.damaged;
  }

  /** This frame's drawn ships, at sea or moored, valid until the next {@link reconcile}; off the culled
   *  draw list like {@link damagedBuildings}. */
  shipsAfloat(): readonly ShipAfloat[] {
    return this.ships;
  }

  /** {@link keelOf} for `ref`, valid until the next call. */
  keelOf(ref: number): readonly number[] | undefined {
    const pe = this.pool.get(ref);
    return keelOf(pe, this.currentFrameOf(pe), this.keelScratch);
  }

  stats(): { drawn: number; pooled: number } {
    return { drawn: this.lastItems.length, pooled: this.pool.size };
  }

  /** The last {@link reconcile}'s culled, depth-sorted draw list, valid until the next reconcile. */
  drawnItems(): readonly DrawItem[] {
    return this.lastItems;
  }

  boundsOf(ref: number): EntityBounds | undefined {
    const pe = this.pool.get(ref);
    return boundsOf(pe, this.currentFrameOf(pe));
  }

  selectionOf(ref: number) {
    const pe = this.pool.get(ref);
    return pe !== undefined && pe.boundsFrame === this.currentFrameOf(pe) ? pe.selectionEllipse : undefined;
  }

  pixelHit(ref: number, wx: number, wy: number): boolean | undefined {
    const pe = this.pool.get(ref);
    return pixelHit(pe, this.currentFrameOf(pe), wx, wy);
  }

  anchorOf(ref: number): { x: number; y: number } | undefined {
    const pe = this.pool.get(ref);
    return anchorOf(pe, this.currentFrameOf(pe));
  }

  /**
   * Scope one portrait inset's render: re-place the self-placing paletted meshes for the inset camera,
   * reveal the inset's force-hidden `subjects`, solo an indoor one, then restore all of it even if
   * `render` throws - a failed cutout must not leave a real unit hidden on the main map.
   */
  portraitPass(
    subjects: readonly number[],
    inset: PortraitView,
    main: PortraitView,
    render: (soloKeep: Container | null) => void,
  ): void {
    this.selectionEffects.setVisible(false);
    this.placePaletted(inset.camera, inset.width, inset.height);
    this.portrait.show(subjects);
    const soloKeep = this.portrait.beginSoloIfIndoor(subjects);
    try {
      render(soloKeep);
    } finally {
      this.portrait.endSolo();
      this.portrait.hide(subjects);
      this.selectionEffects.setVisible(true);
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
          if (item.kind === 'settler')
            coatBody(pe, this.bloodCoats.packed(item.ref, frame.tick + frame.alpha));
          pe.boundsFrame = MAP_VIEW_BOUNDS_FRAME;
          pe.container.zIndex = pooledDepth(pe, item);
          pe.viewSeen = this.frameId;
        }
        if (item.ref === view.solo) solo = pe.container;
      }
      this.selectionEffects.setVisible(false);
      this.placePaletted(view.camera, view.width, view.height);
      this.sheet?.palette?.flush();
      if (solo !== null) stash = stashHidden(this.spriteLayer.children, solo);
      if (view.solo === undefined || solo !== null) render(solo === null ? null : this.spriteLayer);
    } finally {
      if (stash !== null) restoreStash(stash);
      for (const pe of borrowed) this.spriteLayer.removeChild(pe.container);
      this.selectionEffects.setVisible(true);
      this.placePaletted(main.camera, main.width, main.height);
    }
  }

  /** Re-place every drawn paletted layer for a camera and target size (logical px): a mesh its screen
   *  origin, a quad its snap to that camera's device grid. Must mirror the {@link LayerBinder}'s
   *  placement exactly. */
  private placePaletted(camera: Camera, resWidth: number, resHeight: number): void {
    const camScale = camera.scale ?? 1;
    const snap = this.snapResolution;
    for (const pe of this.attached) {
      if (!pe.paletted) continue;
      const originX = snapToDevicePixels(cameraScreenX(camera, pe.motion.drawX), snap);
      const originY = snapToDevicePixels(cameraScreenY(camera, pe.motion.drawY), snap);
      for (const spr of pe.sprites) {
        if (!spr.visible) continue;
        if (spr instanceof PalettedQuad) {
          spr.placeFor(camera, pe.motion.drawX, pe.motion.drawY, snap);
          continue;
        }
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
    this.bloodCoats.setEnabled(false);
    for (const pe of this.pool.values()) {
      this.selectionEffects.clear(pe);
      pe.container.destroy({ children: true });
    }
    this.pool.clear();
    this.attached.clear();
    this.lastItems = [];
    this.lastPooled.length = 0;
    this.moving.length = 0;
    this.movingRefs.clear();
    this.passEpoch = -1;
    this.reapCursor = undefined;
    this.sceneCache.clear();
    this.incremental.clear();
  }
}
