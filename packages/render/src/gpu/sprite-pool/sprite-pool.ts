import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import { Container, type Sprite } from 'pixi.js';
import { BloodCoats } from '../../data/effects/blood-coats.js';
import { marksGround } from '../../data/effects/footfall.js';
import type { GhostSource } from '../../data/fog/index.js';
import { BEARER_GLOW, HOUSE_GLOW, type LightSiteList, lightOn } from '../../data/lighting/light-sites.js';
import {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  cameraViewport,
  snapToDevicePixels,
  type Viewport,
} from '../../data/projection/index.js';
import { SpriteDepthOrder } from '../../data/scene/build/depth-order.js';
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
import { signpostBoardSteps } from '../../data/scene/signpost-boards.js';
import { DEFAULT_FACING, vehicleAfloat, vehicleLookFor } from '../../data/sprites/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { WindSway } from '../../data/weather/climate.js';
import { BuildingDamage, type FallenBody } from '../building-damage/building-damage.js';
import { PalettedQuad } from '../paletted-sprite/index.js';
import { PLOT_BOUNDS, type PlanRoadTextures } from '../placement/plan-road.js';
import type { PlanStakeTextures } from '../placement/plan-stake.js';
import {
  type SelectionStyle,
  TARGET_MARK_LIFT,
  TARGET_MARK_STYLE,
  type TargetFlash,
  type TargetTone,
  targetMarkBreath,
} from '../selection/style.js';
import type { ErasedRegion } from '../textures/erased-frame-cache.js';
import type { SpriteSheet } from '../textures/sprite-sheet.js';
import type { TextureCache } from '../textures/texture-cache.js';
import type { ShadowStyle } from '../world-batch/shadow-style.js';
import { DepthSortedLayer, drawLayerOf } from '../world-renderer/depth-sorted-layer.js';
import { restoreStash, type StashedVisibility, stashHidden } from '../world-views/visibility.js';
import { LayerBinder } from './bind-layers.js';
import { FrameEpoch } from './bind-stamp.js';
import { coatBody } from './blood-coats.js';
import { cullBox, type KindReach, type KindReaches, kindReaches } from './cull-reach.js';
import { GroundPileCover } from './ground-pile-cover.js';
import { damageScaffoldLayers } from './layers/building.js';
import { resolvesWithoutClock } from './layers/resolve.js';
import type { ResolvedLayer } from './layers/resolved-layer.js';
import { NightBearers } from './night-bearers.js';
import {
  anchorOf,
  boundsOf,
  type DamagedBuilding,
  type DrawnWalker,
  keelOf,
  pixelHit,
  type ShipAfloat,
  siteFlagHit,
} from './picking/pick.js';
import { type EntityBounds, meshablePooled, type PooledEntity } from './pooled-entity.js';
import { PortraitSubject } from './portrait-subject.js';
import { atRest, SNAP_DISTANCE } from './presentation/motion.js';
import { presentEntity } from './presentation/present-entity.js';
import { presentAtRest, repeatsInTick, repeatWithinTick } from './presentation/present-item.js';
import { loopStepOf } from './presentation/presentation.js';
import { reconcileSprites } from './reconcile.js';
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

/** The marked entities that draw an emphasis; a refused one draws plain. */
function* drawnMarksOf(marks: ReadonlyMap<number, TargetTone> | undefined): Iterable<number> {
  for (const [ref, tone] of marks ?? []) if (tone !== 'refused') yield ref;
}

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
  /** The entity id the cursor rests over, drawn with the selection outline's contour unless it is
   *  already selected or flagged. Absent draws no hover outline. */
  readonly hovered?: number;
  /** Work flags belonging to selected gatherers always receive an amber outline. */
  readonly flagged?: ReadonlySet<number>;
  readonly selectionStyle?: SelectionStyle;
  readonly selectionTime?: number;
  /** Order targets playing their one-time flash, by entity. */
  readonly flashes?: ReadonlyMap<number, TargetFlash>;
  readonly enhancedSampling?: boolean;
  readonly environmentMotion?: boolean;
  /** The weather's wind, bending swaying vegetation and filling sails while `environmentMotion` is on;
   *  the same object while it holds still. Absent is still air. */
  readonly wind?: WindSway | undefined;
  readonly buildingDamage?: boolean;
  /** How shadow silhouettes draw; absent means the shadow enhancement is off, which also keeps a
   *  character's projected cast layer off the screen. */
  readonly shadowStyle?: ShadowStyle | undefined;
  readonly snapshot: WorldSnapshot;
  /** The margin-inflated world-space box the camera frames - the sprite cull rectangle. */
  readonly viewport: Viewport;
  /** The sim tick the snapshot belongs to - the animation clock for looping gaits. */
  readonly tick: number;
  /** The water clock in base-rate sim ticks (12 Hz), which a ship's swell and sail keep at every game
   *  speed; absent follows the sim tick. */
  readonly seaClock?: number;
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
  /** Entities not drawn for now (waiting for a presentation to end, or hidden from the viewer); skipped
   *  like {@link staticRefs}. A change hands a new set, which keys the cached scene build. */
  readonly withheldRefs?: ReadonlySet<number>;
  /** The fog-of-war cull: entities on tiles it rejects stay pooled but undrawn. Absent = no fog. */
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
  /** Version of the fog cull's answers, bumped by the fog owner whenever `fogVisible` may answer
   *  differently; a bump invalidates the cached scene build. Absent = no fog. */
  readonly fogEpoch?: number;
  /** Remembered statics drawn dimmed on explored ground in place of their fog-culled or dead entities. */
  readonly ghosts?: GhostSource;
  /** An armed pick's verdicts by entity id, present while one is armed: the candidates and the doomed
   *  draw their outline, and nothing else takes the hover outline meanwhile. Transient view state like
   *  the selection, never sim state. */
  readonly marks?: ReadonlyMap<number, TargetTone>;
  /** Building id → the part of its art a mark stands in for, such as a manned tower's roof finial under
   *  its garrison flag. Pass a new map on every change. */
  readonly erased?: ReadonlyMap<number, ErasedRegion>;
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
    item.boardIndex === undefined ? 0 : signpostBoardSteps(item.boardIndex),
    item.rally === true,
  );
}

/** Whether `item`'s drawn feet, its anchor raised by its lift, stand inside one of `boxes`. */
function shows(boxes: readonly Viewport[], item: DrawItem, slack: number): boolean {
  const y = item.y - (item.lift ?? 0);
  for (const box of boxes) {
    if (
      item.x >= box.minX - slack &&
      item.x <= box.maxX + slack &&
      y >= box.minY - slack &&
      y <= box.maxY + slack
    )
      return true;
  }
  return false;
}

/** World px a unit drawn larger than its look reaches past its kind's cull box: its art grows about the
 *  feet by `visualScale - 1` of the kind's farthest reach. */
function scaledSlack(reach: KindReach | undefined, item: DrawItem): number {
  const factor = item.visualScale;
  if (factor === undefined || factor <= 1 || reach === undefined) return 0;
  const { up, down, left, right } = reach.art;
  return Math.max(up, down, left, right) * (factor - 1);
}

/** World px a portrait inset's view may move between two frames that frame the same subjects: a
 *  subject that moves farther snaps, as a teleport does. */
const INSET_FOLLOW_SLACK = SNAP_DISTANCE;

/** The world box one portrait inset framed, and the subjects it framed. */
interface FramedInset {
  readonly subjects: readonly number[];
  readonly view: Viewport;
  readonly zoom: number;
}

/** The refs this frame's portrait insets frame. */
function portraitSubjectsOf(frame: PoolFrame): number[] {
  const subjects = [...(frame.insetRefs ?? [])];
  if (frame.portraitRef !== undefined) subjects.push(frame.portraitRef);
  if (frame.portraitHouse !== undefined) subjects.push(frame.portraitHouse);
  return subjects;
}

/** Whether `framed` framed each of `subjects` and nothing else. */
function framesSubjects(framed: readonly FramedInset[], subjects: readonly number[]): boolean {
  const seen = new Set<number>();
  for (const inset of framed) for (const ref of inset.subjects) seen.add(ref);
  return seen.size === new Set(subjects).size && subjects.every((ref) => seen.has(ref));
}

export class SpritePool {
  readonly groundContainer = new Container({ sortableChildren: true });

  private readonly resourceBinding: SpriteSheet['bindings']['resource'] | undefined;

  private layerFor(item: DrawItem): Container {
    const binding = this.resourceBinding;
    if (item.kind !== 'resource' || binding === undefined || typeof binding === 'number')
      return this.spriteLayer;
    const variant = item.gfxIndex !== undefined && binding.byGfxIndex?.[item.gfxIndex] !== undefined;
    const flat = variant
      ? binding.flatByGfxIndex?.[item.gfxIndex ?? -1]
      : binding.flatByGood?.[item.goodType ?? -1];
    return flat === true ? this.groundContainer : this.spriteLayer;
  }
  private readonly pool = new Map<number, PooledEntity>();
  private readonly groundPileCover = new GroundPileCover();
  /** The pooled entities currently attached to either draw layer, kept in sync with each entity's
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
  /** The items of {@link lastItems} the last full pass drew: those its cull boxes kept. */
  private drawn: readonly SpriteDrawItem[] = [];
  /** Indices into {@link lastItems} of the entities the last full pass found moving with the frame clock
   *  or emphasised, and their refs: what a still frame presents. */
  private readonly moving: number[] = [];
  private readonly movingRefs = new Set<number>();
  /** Indices into {@link lastItems} of the entities the last full pass left standing until the animation
   *  clock reaches another whole tick: a still frame presents them only on that step. */
  private readonly steppers: number[] = [];
  /** The whole animation tick {@link steppers} were last presented at. */
  private stepperStep = Number.NaN;
  /** Whether events reached the blood coats since the last full pass, which alone finds a figure its
   *  new coat. */
  private coatsIngested = false;
  /** Held entities the last full pass visited off the draw list for an emphasis that moves with the
   *  frame clock, such as a pick target's breathing lift; still frames present them with {@link moving}. */
  private readonly movingHeld: PooledEntity[] = [];
  /** Held entities that step a looping record: they skip the visits, and each new step of the animation
   *  clock presents them alone. Entries whose hold ended leave on the next step. */
  private readonly loopers: PooledEntity[] = [];
  /** What the last full pass drew under, which a still frame must match. */
  private passEpoch = -1;
  private passMarks: PoolFrame['marks'];
  private passErased: PoolFrame['erased'];
  private passStyle: PoolFrame['selectionStyle'];
  private passHovered: PoolFrame['hovered'];
  private passHasPortrait = false;
  /** Bumped whenever a held entity may have to draw otherwise without its draw item changing. */
  private holdGeneration = 0;
  private holdBind = -1;
  private holdMotion = -1;
  private holdErased: PoolFrame['erased'];
  private holdStyle: PoolFrame['selectionStyle'];
  /** The pooled entity of each of {@link lastItems}, by index: a repeated scene build skips the lookups. */
  private readonly lastPooled: (PooledEntity | undefined)[] = [];
  private readonly damaged: DamagedBuilding[] = [];
  private readonly buildingDamage = new BuildingDamage((ref) => {
    const item = this.pool.get(ref)?.bound.item;
    return item === undefined ? [] : damageScaffoldLayers(this.sheet, item);
  });
  private readonly damageSubject = (ref: number): PooledEntity | undefined => {
    const pe = this.pool.get(ref);
    return pe?.attached === true ? pe : undefined;
  };

  /**
   * Light this frame's night `level` (0 day, 1 full night) on the bearers drawn on the map: an owned
   * settler outside a house or an owned vehicle lights its own figure, a finished house its walls and a
   * pool round its feet, appended to `out`. Wildlife, sites, fog ghosts and settlers inside stay dark.
   */
  lightNight(level: number, out: LightSiteList): void {
    this.nightBearers.begin();
    if (level > 0) {
      for (const pe of this.attached) {
        const item = pe.bound.item;
        if (item === undefined || item.ghost === true || item.portraitOnly === true) continue;
        if (item.kind === 'settler' || item.kind === 'vehicle') {
          if (item.player !== undefined && item.inHouse !== true)
            this.nightBearers.mark(pe, level * BEARER_GLOW, false);
        } else if (item.kind === 'building' && item.builtPct === undefined) {
          const on = lightOn('building', item.ref, level);
          if (on <= 0) continue;
          this.nightBearers.mark(pe, on * HOUSE_GLOW, true);
          const { x, y } = pe.container.position;
          out.push('building', item.ref, x, y);
        }
      }
    }
    this.nightBearers.end();
  }

  private drawDamage(frame: PoolFrame): void {
    this.buildingDamage.draw(
      this.damaged,
      this.damageSubject,
      frame.tick + frame.alpha,
      frame.wind,
      frame.buildingDamage === true,
      frame.enhancedSampling === true,
      frame.camera.scale ?? 1,
    );
    // Outlines copy the bound texture. Refresh after swaps/releases, including a fully repaired house
    // that has just left the damaged list, so a stamp cannot retain a recycled atlas slot, and a hurt
    // gate's outline follows its holes.
    for (const refs of [frame.selection, frame.flagged, drawnMarksOf(frame.marks)])
      for (const ref of refs ?? NO_REFS) this.refreshDamageableSelection(ref, frame);
    if (frame.hovered !== undefined) this.refreshDamageableSelection(frame.hovered, frame);
  }

  private refreshDamageableSelection(ref: number, frame: PoolFrame): void {
    const pe = this.pool.get(ref);
    const item = pe?.bound.item;
    const damageable = pe?.kind === 'building' || pe?.kind === 'palisade';
    if (damageable && pe.attached && item !== undefined) this.applySelection(pe, item, frame, false);
  }
  private readonly ships: ShipAfloat[] = [];
  private readonly walkers: DrawnWalker[] = [];
  /** Scratch {@link keelOf} answers in, valid until the next call. */
  private readonly keelScratch: number[] = [];
  private readonly portrait: PortraitSubject;
  private readonly binder: LayerBinder;
  private readonly selectionEffects: SelectionEffects;
  private readonly nightBearers = new NightBearers();
  private readonly bloodCoats = new BloodCoats();
  private readonly epoch = new FrameEpoch();
  /** What each kind can draw around its anchor; a kind absent here is culled by the scene's box alone. */
  private readonly reaches: KindReaches;
  /** Whether this pass culls by the same boxes as the last one: the screen's alone, the camera, screen
   *  and cast shear unchanged. */
  private cullsStand = false;
  private cullScreenOnly = false;
  private cullShear = Number.NaN;
  /** The insets the last frame framed, and those this frame frames so far. */
  private framed: FramedInset[] = [];
  private framing: FramedInset[] = [];
  /** Last {@link reconcile}'s device grid, so the portrait pass re-places the meshes the way it drew
   *  them. */
  private snapResolution: number | undefined;

  setBloodEnabled(enabled: boolean): void {
    this.bloodCoats.setEnabled(enabled);
    if (!enabled) for (const pe of this.pool.values()) coatBody(pe, 0);
  }

  ingestBlood(events: readonly SimEvent[], tick: number): void {
    this.bloodCoats.ingest(events, tick);
    if (events.length > 0) this.coatsIngested = true;
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
    this.resourceBinding = sheet?.bindings.resource;
    this.selectionEffects = new SelectionEffects(textures);
    this.portrait = new PortraitSubject(spriteLayer);
    this.binder = new LayerBinder(textures, sheet, stakes, roads);
    this.reaches = kindReaches(sheet);
  }

  /**
   * Reconcile the pool to one frame: update, depth-sort and attach the drawn entities, detach the rest,
   * and reap the ones that left the snapshot.
   */
  reconcile(frame: PoolFrame): void {
    [this.framed, this.framing] = [this.framing, this.framed];
    this.framing.length = 0;
    const scene = this.sceneFor(frame);
    this.epoch.advance(frame, this.textures.textureRevision);
    this.snapResolution = frame.snapResolution;
    if (this.repeatsStill(scene, frame)) {
      // No new palette frame: a human a still frame leaves unpresented keeps its row as drawn.
      this.presentMoving(frame);
      this.stepLoopers(frame);
      this.reap(scene.liveRefs);
      this.sheet?.palette?.flush();
      this.drawDamage(frame);
      return;
    }
    this.sheet?.palette?.beginFrame();
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
    this.steppers.length = 0;
    this.stepperStep = loopStepOf(frame.tick, frame.alpha, frame.environmentMotion === true);
    this.coatsIngested = false;
    this.movingHeld.length = 0;
    this.passHasPortrait = false;
    const kept = scene.kept;
    const generation = this.holdGeneration;
    const culls = this.cullBoxes(frame);
    const cullsStand = this.cullsStand;
    // A new list per full pass: a reader keying on the list sees a rebuild as a new one.
    const drawn: SpriteDrawItem[] | null = culls === undefined ? null : [];
    for (let i = 0; i < scene.items.length; i++) {
      const item = scene.items[i];
      if (item === undefined) continue;
      // A self-contained item kept from the last build, its entity holding still: nothing to present.
      const held =
        kept !== undefined && kept[i] === 1 && (item as unknown as HoldMarked)[HELD] === generation;
      // A held item passed every cull since its hold began, so under the last pass's boxes it still does.
      if (held && cullsStand) {
        drawn?.push(item);
        this.lastPooled[i] = undefined;
        continue;
      }
      // An item drawing nothing on screen stays detached, and out of the drawn list the pickers read.
      const boxes = culls?.[item.kind];
      if (
        boxes !== undefined &&
        item.portraitOnly !== true &&
        !shows(boxes, item, scaledSlack(this.reaches[item.kind], item))
      ) {
        this.lastPooled[i] = undefined;
        this.release(item);
        continue;
      }
      drawn?.push(item);
      if (held) {
        this.lastPooled[i] = undefined;
        continue;
      }
      const pe = (repeated ? this.lastPooled[i] : undefined) ?? this.pooledFor(item);
      this.visit(pe, item, i, frame);
    }
    // A held entity a selection, flag, mark, hover or flash now names draws its emphasis, which only a
    // visit applies.
    for (const refs of [frame.selection, frame.flagged, frame.flashes?.keys(), drawnMarksOf(frame.marks)]) {
      for (const ref of refs ?? NO_REFS) {
        const pe = this.pool.get(ref);
        const item = pe?.bound.item;
        if (pe !== undefined && pe.held === generation && pe.lastSeen !== this.frameId && item !== undefined)
          this.visitHeld(pe, item as SpriteDrawItem, frame);
      }
    }
    if (frame.hovered !== undefined) {
      const pe = this.pool.get(frame.hovered);
      const item = pe?.bound.item;
      if (pe !== undefined && pe.held === generation && pe.lastSeen !== this.frameId && item !== undefined)
        this.visitHeld(pe, item as SpriteDrawItem, frame);
    }
    this.stepLoopers(frame);
    this.lastItems = scene.items;
    this.drawn = drawn ?? scene.items;
    this.lastPooled.length = scene.items.length;
    this.passEpoch = this.epoch.current;
    this.passMarks = frame.marks;
    this.passErased = frame.erased;
    this.passStyle = frame.selectionStyle;
    this.passHovered = frame.hovered;

    // Iterating `attached` instead of the whole pool keeps the detach scan bounded by the screen.
    // Deleting the current entry mid-iteration is well-defined for a Set.
    for (const pe of this.attached) {
      if (pe.lastSeen === this.frameId || pe.held === generation) continue;
      this.selectionEffects.clear(pe);
      pe.container.removeFromParent();
      pe.attached = false;
      this.attached.delete(pe);
    }

    this.reap(scene.liveRefs);
    this.sheet?.palette?.flush();
    this.drawDamage(frame);
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
    const layer = this.layerFor(item);
    if (!pe.attached || drawLayerOf(pe.container) !== layer) {
      layer.addChild(pe.container);
      pe.attached = true;
      this.attached.add(pe);
    } else if (layer instanceof DepthSortedLayer) {
      // Entities at one exact depth paint in the order this pass visits them, without the band
      // rebuild a re-add costs.
      layer.rearrive(pe.container);
    }
    pe.lastSeen = this.frameId;
    if (item.portraitOnly === true) {
      this.portrait.capture(item.ref, pe, item.frozen === true);
      this.passHasPortrait = true;
    }
    const rests = !emphasis && this.restsInPlace(pe, item);
    const still = rests && pe.bound.clockFree;
    // Only a static-run item may stand unvisited: the scene names it among its released statics when a
    // delta touches it, its withheld state changes or it leaves the view. Any other kind is rebuilt every
    // build, and only a visit notices it left the draw list.
    const loops = rests && pe.bound.loopsOnly && isStaticItem(item);
    pe.held = (still && isStaticItem(item)) || loops ? this.holdGeneration : -1;
    (item as unknown as HoldMarked)[HELD] = pe.held;
    if (loops) {
      pe.loopStep = loopStepOf(frame.tick, frame.alpha, frame.environmentMotion === true);
      if (!pe.looping) {
        pe.looping = true;
        this.loopers.push(pe);
      }
    } else if (!still && index >= 0) {
      const repeat = emphasis ? 'moves' : this.repeatUntilTick(pe, item, frame);
      if (repeat === 'moves') {
        this.moving.push(index);
        this.movingRefs.add(item.ref);
      } else if (repeat === 'steps') {
        this.steppers.push(index);
      }
    }
  }

  /**
   * Whether the present `pe` just ran stands for every frame of this tick ({@link repeatWithinTick}), so
   * the still frames need not ask: a figure on its tick anchor that wears no drying blood coat, bound in
   * full.
   */
  private repeatUntilTick(pe: PooledEntity, item: DrawItem, frame: PoolFrame): 'holds' | 'steps' | 'moves' {
    const repeat = repeatWithinTick(pe, item, frame.tick, this.sheet, frame.environmentMotion === true);
    if (repeat === 'moves' || pe.bound.retrying) return 'moves';
    return this.bloodCoats.packed(item.ref, frame.tick + frame.alpha) === 0 ? repeat : 'moves';
  }

  /**
   * Per kind with a reach, where an item's drawn feet must stand to show this frame; undefined keeps every
   * item of the scene. An item shows on screen or in a portrait inset, which frames the world around its
   * subjects off the main screen too. The insets frame after this reconcile, so their views are the last
   * frame's; until the insets have framed the frame's subjects once, the scene's own box decides.
   */
  private cullBoxes(frame: PoolFrame): Partial<Record<DrawItem['kind'], Viewport[]>> | undefined {
    const subjects = portraitSubjectsOf(frame);
    const castShear = frame.shadowStyle?.castShear ?? 0;
    const screenOnly = subjects.length === 0;
    this.cullsStand =
      screenOnly && this.cullScreenOnly && !this.epoch.viewMoved && castShear === this.cullShear;
    this.cullScreenOnly = screenOnly;
    this.cullShear = castShear;
    if (!screenOnly && !framesSubjects(this.framed, subjects)) return undefined;
    const screen = cameraViewport(frame.camera, frame.screenW, frame.screenH);
    const boxes: Partial<Record<DrawItem['kind'], Viewport[]>> = {};
    for (const kind of Object.keys(this.reaches) as (keyof KindReaches)[]) {
      const reach = this.reaches[kind];
      if (reach === undefined) continue;
      const kindBoxes = [cullBox(screen, reach, castShear, frame.camera.scale ?? 1)];
      if (subjects.length > 0) {
        for (const inset of this.framed) {
          const box = cullBox(inset.view, reach, castShear, inset.zoom);
          kindBoxes.push({
            minX: box.minX - INSET_FOLLOW_SLACK,
            minY: box.minY - INSET_FOLLOW_SLACK,
            maxX: box.maxX + INSET_FOLLOW_SLACK,
            maxY: box.maxY + INSET_FOLLOW_SLACK,
          });
        }
      }
      boxes[kind] = kindBoxes;
    }
    return boxes;
  }

  /** Let go of a culled item's hold, so the detach sweep takes its entity and a later frame tests the
   *  item again instead of standing it unvisited. */
  private release(item: SpriteDrawItem): void {
    const marked = item as unknown as HoldMarked;
    if (marked[HELD] === undefined || marked[HELD] === -1) return;
    marked[HELD] = -1;
    const pe = this.pool.get(item.ref);
    if (pe !== undefined) pe.held = -1;
  }

  /**
   * Release every hold when something a held entity draws from changed without its draw item changing
   * (a bind input, the wind or motion setting, the selection style, a full scene build),
   * and each one the scene released: touched by a delta, withheld or handed back, or out of view.
   */
  private reviseHolds(scene: SpriteScene, frame: PoolFrame): void {
    if (
      scene.kept === undefined ||
      this.epoch.bind !== this.holdBind ||
      this.epoch.motion !== this.holdMotion ||
      frame.erased !== this.holdErased ||
      frame.selectionStyle !== this.holdStyle
    ) {
      this.holdGeneration++;
      this.holdBind = this.epoch.bind;
      this.holdMotion = this.epoch.motion;
      this.holdErased = frame.erased;
      this.holdStyle = frame.selectionStyle;
    }
    for (const ref of scene.releasedStatics ?? NO_REFS) {
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
    // A moved camera re-placed the paletted layers an outline copies.
    return this.applySelection(pe, item, frame, !this.epoch.viewMoved);
  }

  /** Apply `item`'s emphasis to `pe`; `fits` lets an outline laid over the same bind stand. */
  private applySelection(pe: PooledEntity, item: DrawItem, frame: PoolFrame, fits: boolean): boolean {
    const ref = item.ref;
    // Ghosts and portrait insets never take an emphasis.
    const plain = item.ghost === true || item.portraitOnly === true;
    const flagged = !plain && frame.flagged?.has(ref) === true;
    const selected = !plain && frame.selection?.has(ref) === true;
    const flash = plain ? undefined : frame.flashes?.get(ref);
    const tone = plain || flagged || selected ? undefined : frame.marks?.get(ref);
    const mark = tone === undefined || tone === 'refused' ? undefined : TARGET_MARK_STYLE[tone];
    // Artistic approximation of the original's hovered-target contour, like the selection outline: a
    // flag keeps its amber, a selected entity its own style, a pick's target its mark, and while no pick
    // is armed anything else the cursor rests over draws the ivory outline.
    const style = flagged
      ? 'outline'
      : selected
        ? frame.selectionStyle
        : mark !== undefined || (!plain && frame.hovered === ref && frame.marks === undefined)
          ? 'outline'
          : undefined;
    // A doomed target is only ever the one aimed at.
    const aimed = tone === 'doomed' || frame.hovered === ref;
    const seconds = frame.selectionTime ?? 0;
    this.selectionEffects.update(
      pe,
      style,
      frame.camera.scale ?? 1,
      seconds,
      flagged ? 0xffc020 : mark?.outline,
      flash,
      mark === undefined ? undefined : aimed ? TARGET_MARK_LIFT : targetMarkBreath(seconds),
      mark?.liftTone,
      fits ? pe.bindSerial : undefined,
    );
    return style !== undefined || flash !== undefined;
  }

  /** Whether `container` is a pooled entity the sprite layer may draw from its retained mesh
   *  ({@link meshablePooled}). */
  meshable(container: Container): boolean {
    const pe = (container as PooledContainer)[POOLED];
    return pe !== undefined && meshablePooled(pe);
  }

  /** Whether `pe` stands where it is whatever the frame alpha, drawing what its layers alone decide: held
   *  when they are {@link BindStamp.clockFree}, stepped on the animation clock when they only loop. */
  private restsInPlace(pe: PooledEntity, item: DrawItem): boolean {
    return (
      item.hpFrac === undefined &&
      pe.reveal === undefined &&
      !pe.bound.retrying &&
      resolvesWithoutClock(item) &&
      atRest(pe.motion)
    );
  }

  /**
   * Present each held looper whose animation clock reached a new whole tick, as a visit would; one that
   * no longer holds, or holds still, leaves the list.
   */
  private stepLoopers(frame: PoolFrame): void {
    const step = loopStepOf(frame.tick, frame.alpha, frame.environmentMotion === true);
    const generation = this.holdGeneration;
    const loopers = this.loopers;
    let kept = 0;
    for (let i = 0; i < loopers.length; i++) {
      const pe = loopers[i];
      if (pe === undefined) continue;
      if (pe.held !== generation || !pe.attached || !pe.bound.loopsOnly) {
        pe.looping = false;
        continue;
      }
      loopers[kept++] = pe;
      const item = pe.bound.item;
      if (pe.loopStep === step || item === undefined) continue;
      pe.loopStep = step;
      // As a visit of a held entity: the bounds it stamped stand until this present restamps them.
      if (pe.boundsFrame === pe.lastSeen) pe.boundsFrame = this.frameId - 1;
      pe.lastSeen = this.frameId;
      // Its hold stands for the bind inputs, the erased regions and its palette: only the layers can move.
      const layers = presentAtRest(
        pe,
        item,
        frame.tick,
        frame.alpha,
        this.sheet,
        frame.environmentMotion === true,
        frame.wind,
        frame.seaClock,
      );
      pe.bound.alpha = frame.alpha;
      if (pe.bound.presents(pe.motion, layers)) {
        pe.bound.carry(item, this.epoch.current);
        this.keepBound(pe);
      } else {
        this.bindPresented(pe, item, layers, frame, frame.erased?.get(item.ref));
        // A stand-in for a turned-away bake binds again next frame, a still one included.
        if (pe.bound.retrying) {
          this.release(item as SpriteDrawItem);
          this.movingHeld.push(pe);
        }
      }
    }
    loopers.length = kept;
  }

  /**
   * Whether this frame differs from the last full pass only in the frame alpha: the same draw list, no
   * tick, setting, camera or mark change, and every selected or flagged entity already among the
   * moving ones. Then only {@link moving} needs a present; everything else holds still where it is.
   */
  private repeatsStill(scene: SpriteScene, frame: PoolFrame): boolean {
    if (
      scene.items !== this.lastItems ||
      this.coatsIngested ||
      this.epoch.current !== this.passEpoch ||
      this.epoch.viewMoved ||
      this.passHasPortrait ||
      frame.marks !== this.passMarks ||
      frame.erased !== this.passErased ||
      frame.selectionStyle !== this.passStyle ||
      frame.hovered !== this.passHovered
    )
      return false;
    for (const ref of frame.selection ?? NO_REFS) if (!this.movingRefs.has(ref)) return false;
    for (const ref of frame.flagged ?? NO_REFS) if (!this.movingRefs.has(ref)) return false;
    for (const ref of frame.flashes?.keys() ?? NO_REFS) if (!this.movingRefs.has(ref)) return false;
    return true;
  }

  /** A still frame's pass: present the entities that move with the frame clock, in draw-list order. */
  private presentMoving(frame: PoolFrame): void {
    for (const i of this.moving) {
      const item = this.lastItems[i];
      const pe = this.lastPooled[i];
      if (item !== undefined && pe !== undefined) this.presentItemAt(pe, item, frame, true);
    }
    for (const pe of this.movingHeld) {
      const item = pe.bound.item;
      if (item !== undefined && pe.attached) this.presentItemAt(pe, item, frame, true);
    }
    const step = loopStepOf(frame.tick, frame.alpha, frame.environmentMotion === true);
    if (step === this.stepperStep) return;
    this.stepperStep = step;
    for (const i of this.steppers) {
      const item = this.lastItems[i];
      const pe = this.lastPooled[i];
      if (item === undefined || pe === undefined) continue;
      this.presentItemAt(pe, item, frame, true);
      // A stand-in for a turned-away bake binds again on the next frame, a still one included.
      if (pe.bound.retrying) {
        this.moving.push(i);
        this.movingRefs.add(item.ref);
      }
    }
  }

  /** Visit a held entity off the draw list for its emphasis; one the emphasis keeps from holding still
   *  moves on with the still frames. */
  private visitHeld(pe: PooledEntity, item: SpriteDrawItem, frame: PoolFrame): void {
    this.visit(pe, item, -1, frame);
    if (pe.held === -1) this.movingHeld.push(pe);
  }

  /** Collect the drawn damaged buildings, ships and walkers off a new draw list. */
  private collectOverlays(items: readonly SpriteDrawItem[]): void {
    this.damaged.length = 0;
    this.ships.length = 0;
    this.walkers.length = 0;
    const vehicles = this.sheet?.bindings.vehicle;
    for (const item of items) {
      const kind = item.kind;
      if (kind === 'settler') {
        if (standsOnMapGround(item)) this.walkers.push({ ref: item.ref, marksGround: marksGround(item) });
      } else if (kind === 'building' || kind === 'palisade') {
        if (item.hpFrac !== undefined)
          this.damaged.push({
            ref: item.ref,
            hpFrac: item.hpFrac,
            ...(item.ghost === true ? { ghost: true } : {}),
          });
      } else if (
        kind === 'vehicle' &&
        vehicles !== undefined &&
        // A portrait-only ship is hidden on the map, so it pushes no water there.
        item.ghost !== true &&
        item.portraitOnly !== true
      ) {
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
   * the same inputs keep it without a present, even under a frame alpha its present would repeat in, as
   * does an equal item that resolves without a clock under the same bind inputs, and a present under the
   * same bind inputs keeps it when it resolved exactly what was bound, as a new tick does for most of a
   * still town. A construction site always binds: its eased reveal moves every frame, and a reveal bake
   * left unbound may be evicted.
   */
  private presentPooled(pe: PooledEntity, item: DrawItem, frame: PoolFrame, continuous: boolean): void {
    const stamp = pe.bound;
    const erased = frame.erased?.get(item.ref);
    const steady = continuous && pe.reveal === undefined;
    if (
      steady &&
      (stamp.alpha === frame.alpha ||
        repeatsInTick(pe, item, frame.tick, frame.alpha, this.sheet, frame.environmentMotion === true)) &&
      stamp.holds(item, this.epoch.current, erased) &&
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
      stamp.bindHolds(item, this.epoch.bind, erased) &&
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
    // The sprites still show the last bind, and a bind now would read what that one did, the layers and
    // the drawn anchor apart.
    const inputsHold =
      steady &&
      // The present may have started a construction reveal, which binds every frame.
      item.hpFrac === undefined &&
      pe.reveal === undefined &&
      stamp.bindHolds(item, this.epoch.bind, erased) &&
      this.binder.paletteHolds(pe, item);
    if (inputsHold && stamp.presents(pe.motion, layers)) {
      stamp.carry(item, this.epoch.current);
      this.keepBound(pe);
      return;
    }
    this.bindPresented(pe, item, layers, frame, erased, inputsHold);
  }

  /** Bind the layers a present of `item` resolved onto `pe`, and stamp what the bind read; `inputsHold`
   *  as {@link LayerBinder.bind} takes it. */
  private bindPresented(
    pe: PooledEntity,
    item: DrawItem,
    layers: readonly ResolvedLayer[] | null,
    frame: PoolFrame,
    erased: ErasedRegion | undefined,
    inputsHold = false,
  ): void {
    const deferrals = this.textures.deferrals;
    this.binder.bind(pe, item, layers, frame, this.frameId, inputsHold);
    pe.bound.record(item, this.epoch, erased, pe.motion, layers);
    // A bake the budget turned away left a stand-in on this entity alone: it binds again next frame.
    if (this.textures.deferrals !== deferrals) pe.bound.retry();
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
        pe.container.removeFromParent();
        this.attached.delete(pe);
      }
      this.selectionEffects.clear(pe);
      pe.container.destroy({ children: true });
      pe.held = -1;
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

  /** Apply after reconciliation and collapse drawing, before the world renders. */
  coverGroundPiles(covers: readonly Viewport[]): void {
    this.groundPileCover.apply(this.lastItems, this.pool, covers);
  }

  /** Only a drawn building: a culled one keeps the textures of its last bind, which the reveal cache
   *  may since have evicted and destroyed. Its collapse resolves the normal appearance instead. */
  captureBuildingDamage(ref: number): readonly FallenBody[] | undefined {
    const pe = this.damageSubject(ref);
    if (pe === undefined || pe.paletted) return undefined;
    const sprites: readonly Sprite[] = pe.sprites;
    return this.buildingDamage.capture(
      ref,
      sprites.filter((_, i) => pe.pickExempt[i] !== true),
      (sprite) => pe.layers.finish()[sprites.indexOf(sprite)],
    );
  }

  /** This frame's drawn ships, at sea or moored, valid until the next {@link reconcile}; off the culled
   *  draw list like {@link damagedBuildings}. */
  shipsAfloat(): readonly ShipAfloat[] {
    return this.ships;
  }

  /** This frame's drawn humans on the map ground, valid until the next {@link reconcile}; off the culled
   *  draw list like {@link shipsAfloat}. */
  walkersDrawn(): readonly DrawnWalker[] {
    return this.walkers;
  }

  /** {@link keelOf} for `ref`, valid until the next call. */
  keelOf(ref: number): readonly number[] | undefined {
    const pe = this.pool.get(ref);
    return keelOf(pe, this.currentFrameOf(pe), this.keelScratch);
  }

  stats(): { drawn: number; pooled: number } {
    return { drawn: this.lastItems.length, pooled: this.pool.size };
  }

  /** The last {@link reconcile}'s drawn, depth-sorted items, valid until the next reconcile: the scene's
   *  draw list less the items culled for drawing nothing on screen, which have no bounds to pick by. */
  drawnItems(): readonly DrawItem[] {
    return this.drawn;
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

  siteFlagHit(ref: number, wx: number, wy: number): boolean {
    const pe = this.pool.get(ref);
    return siteFlagHit(pe, this.currentFrameOf(pe), wx, wy);
  }

  anchorOf(ref: number): { x: number; y: number } | undefined {
    const pe = this.pool.get(ref);
    return anchorOf(pe, this.currentFrameOf(pe));
  }

  /**
   * Scope one portrait inset's render: re-place the self-placing paletted meshes for the inset camera,
   * reveal the inset's force-hidden `subjects`, solo an indoor or riding one, then restore all of it even
   * if `render` throws - a failed cutout must not leave a real unit hidden on the main map.
   */
  portraitPass(
    subjects: readonly number[],
    inset: PortraitView,
    main: PortraitView,
    render: (soloKeep: Container | null) => void,
  ): void {
    this.framing.push({
      subjects: [...subjects],
      view: cameraViewport(inset.camera, inset.width, inset.height),
      zoom: inset.camera.scale ?? 1,
    });
    this.selectionEffects.setVisible(false);
    this.placePaletted(inset.camera, inset.width, inset.height);
    this.portrait.show(subjects);
    const soloKeep = this.portrait.beginSolo(subjects);
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
          this.layerFor(item).addChild(pe.container);
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
      const soloLayer = solo?.parent ?? this.spriteLayer;
      if (solo !== null) stash = stashHidden(soloLayer.children, solo);
      if (view.solo === undefined || solo !== null) render(solo === null ? null : soloLayer);
    } finally {
      if (stash !== null) restoreStash(stash);
      for (const pe of borrowed) pe.container.removeFromParent();
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
    // Without a device grid a quad stands at its offset under every camera: only a vehicle's
    // self-placing meshes need placing then.
    const quadsHold = snap === undefined;
    for (const pe of this.attached) {
      if (!pe.paletted || (quadsHold && pe.kind !== 'vehicle')) continue;
      const originX = snapToDevicePixels(cameraScreenX(camera, pe.motion.drawX), snap);
      const originY = snapToDevicePixels(cameraScreenY(camera, pe.motion.drawY), snap);
      for (const spr of pe.sprites) {
        if (!spr.visible) continue;
        if (spr instanceof PalettedQuad) {
          if (!quadsHold) spr.placeFor(camera, pe.motion.drawX, pe.motion.drawY, snap);
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
    this.groundPileCover.clear();
    this.bloodCoats.setEnabled(false);
    this.buildingDamage.destroy();
    for (const pe of this.pool.values()) {
      this.selectionEffects.clear(pe);
      pe.container.destroy({ children: true });
    }
    this.pool.clear();
    this.attached.clear();
    this.nightBearers.clear();
    this.lastItems = [];
    this.drawn = [];
    this.lastPooled.length = 0;
    this.moving.length = 0;
    this.movingRefs.clear();
    this.steppers.length = 0;
    this.movingHeld.length = 0;
    this.loopers.length = 0;
    this.passEpoch = -1;
    this.passHovered = undefined;
    this.reapCursor = undefined;
    this.sceneCache.clear();
    this.incremental.clear();
  }
}

/** A fog memory, a portrait-only body and a worker shown inside a house stand on no map ground. */
function standsOnMapGround(item: SpriteDrawItem): boolean {
  return item.ghost !== true && item.portraitOnly !== true && item.inHouse !== true;
}
