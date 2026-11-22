import { Container, Matrix, type Sprite } from 'pixi.js';
import { GLOW_PALETTE_INDEX } from '../../data/palettes/glow-colour.js';
import { createHumanPaletteColours, type HumanPaletteBook } from '../../data/palettes/human-palettes.js';
import type { DrawItem, SpriteDrawItem } from '../../data/scene/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { isShadowTexture } from '../pixel-art/registry.js';
import { GhostOutlineSprite, SelectionGraphics, SelectionSprite } from '../selection/sprite-effect.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { worldBatched } from '../world-batch/batcher.js';
import { SELECTION_COVER, SELECTION_STAMP } from '../world-batch/shader.js';
import { clipDepthOf, GhostClip } from './ghost-clip.js';
import { pooledDepth } from './pooled-depth.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';
import { frameTransform, placeOutline } from './selection-effects.js';

/**
 * Occlusion ghosts: the part of a settler a standing sprite hides shows over that sprite as a fill, a
 * ring or both ({@link GhostMarks}), tinted with its owner's team colour; the part in plain view
 * stays unmarked. The see-through view fades every occluder on the screen to
 * {@link OCCLUDER_FADE_ALPHA} instead, with or without the marks.
 *
 * Approximation: the original's hidden-unit rendering has no readable source. The alphas and the reach
 * are tuned by eye. The occluder kinds are the standing sprites tall enough
 * to hide a person. Vehicles neither ghost nor occlude: their paletted layers are self-placing meshes
 * a stamp quad cannot copy.
 */

/** One occluder candidate the pool's draw list cannot see, as the static map-object layer reports it:
 *  a tall landscape object's bound pose this frame. */
export interface GhostOccluder {
  /** The painter depth the object sorts at in the shared entity layer, comparable with a draw item's. */
  readonly depth: number;
  /** The world-px box of the bound pose, or `undefined` when the pose has none this frame. */
  bounds(): EntityBounds | undefined;
  /** The sprite drawing the bound pose in the shared entity layer, whose art and placement the ghosts'
   *  clip copies. */
  body(): Sprite | undefined;
  /** Fade the occluder's drawn art to `alpha`; `undefined` restores it. A candidate without it never
   *  fades. */
  setFade?(alpha: number | undefined): void;
}

/** Which marks a ghost draws: a team-coloured fill of the body, a ring around it, or both. */
export interface GhostMarks {
  readonly fill: boolean;
  readonly ring: boolean;
}

/** How translucent a standing sprite draws in the see-through view. Approximation, tuned by eye. */
export const OCCLUDER_FADE_ALPHA = 0.45;

/** The kinds whose art can hide a unit standing behind it. */
const OCCLUDER_KINDS: ReadonlySet<DrawItem['kind']> = new Set([
  'building',
  'palisade',
  'signpost',
  'resource',
  'berrybush',
]);

/** Whether an entity of `kind` can stand as an occluder in the scan. */
export function occludes(kind: DrawItem['kind']): boolean {
  return OCCLUDER_KINDS.has(kind);
}

/** One unit candidate's record in {@link OcclusionGhosts.unitSeen}: whether it drew with current
 *  bounds, then everything the cover walk and its stamp read of it. */
const SEEN_DRAWN = 0;
const SEEN_X = 1;
const SEEN_Y = 2;
const SEEN_BIND = 3;
const SEEN_DEPTH = 4;
const SEEN_MIN_X = 5;
const SEEN_MIN_Y = 6;
const SEEN_MAX_X = 7;
const SEEN_MAX_Y = 8;
const SEEN_STRIDE = 9;

/** The ghost's tint where no team colour resolves: a sheet without a palette. Approximation, tuned by
 *  eye for legibility. */
export const GHOST_TINT = 0xf0ede2;
/** The ring's alpha over the cover. Approximation, tuned by eye. */
export const GHOST_ALPHA = 0.4;
/** The fill's alpha alone, and under a ring, where it only tints the body the ring already traces.
 *  Approximation, tuned by eye. */
export const GHOST_FILL_ALPHA = 0.45;
export const GHOST_UNDER_RING_FILL_ALPHA = 0.2;
/** Screen px the ring reaches past the body art. Approximation, tuned by eye for legibility. */
export const GHOST_OUTLINE_RADIUS = 2;
/** Bytes per palette entry: the team palettes are RGB triplets. */
const RGB = 3;

/**
 * The tint a ghost takes, per pooled entity: step {@link GLOW_PALETTE_INDEX} of its owner's plain team
 * palette, the step a hero's glow reads. The body's own palette is no source: a woman's dress, a
 * soldier's armor or a hero's recipe repaint that step there. No darkness lift, unlike the hero glow.
 */
export function ghostTintOf(book: HumanPaletteBook): (pe: PooledEntity) => number {
  const scratch = createHumanPaletteColours();
  const tintByPlayer = new Map<number, number>();
  return (pe) => {
    const player = pe.bound.item?.player ?? 0;
    let tint = tintByPlayer.get(player);
    if (tint === undefined) {
      book.composeTeam(player, scratch);
      tint = teamTint(scratch.body);
      tintByPlayer.set(player, tint);
    }
    return tint;
  };
}

/** The tint number of the palette's team step: the RGB triplet at {@link GLOW_PALETTE_INDEX}. */
function teamTint(palette: Uint8Array): number {
  const at = GLOW_PALETTE_INDEX * RGB;
  return ((palette[at] ?? 0) << 16) | ((palette[at + 1] ?? 0) << 8) | (palette[at + 2] ?? 0);
}

/** World px per occluder-registry cell. Coarse on purpose: an occluder registers into each cell its box
 *  touches, a unit probes the few its own box touches, and the box test filters the rest. */
const CELL = 128;

/** A cell key from its grid coordinates; collisions are impossible below a million cells per axis and
 *  would only add candidates the box test filters. */
const cellKey = (gx: number, gy: number): number => gx * 1000003 + gy;

/**
 * One occluder's registration, kept while its occluder is marked on consecutive probing scans: a scan
 * only restamps depth and box and re-registers into the grid when the box actually moved, instead of
 * refilling the cells every frame. A slot its scan leaves unmarked - an occluder that left the view, or
 * a pooled entity the pool replaced or freed - leaves the grid, so the cells hold the visible occluders,
 * not every one the session has seen.
 */
interface OccluderSlot {
  /** The occluder object the slot is registered by in {@link OcclusionGhosts.slots}. */
  readonly key: object;
  /** The static candidate; absent for a pool occluder. */
  readonly occ: GhostOccluder | undefined;
  /** The pooled entity behind a pool occluder's slot. */
  readonly pe: PooledEntity | undefined;
  /** The painter depth the occluder sorts at this frame. */
  depth: number;
  /** The box the slot is registered by, restamped in place. Mutable, since an {@link EntityBounds}
   *  stamps itself readonly. */
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** The cell keys {@link bounds} currently occupies, empty while unregistered. */
  readonly cells: number[];
  /** The scan run the slot was last marked in; probes skip older ones. */
  run: number;
  /** The unit walk that last visited the slot, deduping a multi-cell occluder within one walk. */
  visited: number;
  /** The scan run the slot last stood in front of a ghosted unit, and its copies in the clip, minted
   *  the first time it does. */
  coverRun: number;
  cover: CoverStamp | undefined;
}

/** An occluder's copies in the ghosts' clip: one quad per art layer drawn this frame. */
interface CoverStamp {
  readonly container: Container;
  readonly quads: SelectionSprite[];
}

/** A unit's pooled ghost stamps, kept while its unit draws and dropped when it stops. */
interface GhostStamp {
  readonly container: Container;
  /** One fill and one ring quad per stamped body layer, grown on demand and hidden beyond the body's
   *  layer count or outside the marks. Fills sit under every ring in the container. */
  readonly fills: SelectionSprite[];
  readonly rings: GhostOutlineSprite[];
  /** The placeholder's stamp, minted when an unbound body draws the marker instead of atlas layers. */
  placeholder: SelectionGraphics | undefined;
  /** The entity the stamps copy, refreshed when the pool replaces its ref's entity. */
  pe: PooledEntity;
  /** The bind and view the quads were laid from, and whether the camera had moved then: any changing
   *  lays them again, since a rebind re-resolves layers and a moved or rezooned camera re-places the
   *  paletted quads a ring copies and re-scales the reach the ring rides on. */
  bindSerial: number;
  laidUnderMovedView: boolean;
  laidAtZoom: number;
  laidFill: boolean;
  laidRing: boolean;
}

/**
 * The occlusion ghost overlay and its per-frame scan. The renderer mounts {@link container} above the
 * sprite layer; the pool calls {@link scan} once per reconcile with the draw list it just presented.
 */
export class OcclusionGhosts {
  readonly container = new Container();
  private readonly clip = new GhostClip(this.container);

  constructor(
    private readonly textures: TextureCache,
    /** A ghosted unit's tint, per entity; absent draws every ghost in {@link GHOST_TINT}. */
    private readonly tintOf: ((pe: PooledEntity) => number) | undefined,
  ) {}

  private readonly stamps = new Map<number, GhostStamp>();
  /** The occluder slots by their occluder object - the pool's entities for its own standing sprites,
   *  the map layer's candidates for the landscape. */
  private slots = new WeakMap<object, OccluderSlot>();
  /** The grid cells holding the registered slots; a cell left empty is dropped. */
  private readonly cellSlots = new Map<number, OccluderSlot[]>();
  /** The slots this probing scan marked, and the ones the last probing scan did: every registered slot
   *  is in the latter, so the eviction walks the previous view's occluders, not the grid. */
  private marked: OccluderSlot[] = [];
  private previouslyMarked: OccluderSlot[] = [];
  /** The scan's pool occluders, flat, marked only once a unit drew and the grid is probed. */
  private readonly occluderPe: PooledEntity[] = [];
  private readonly occluderDepth: number[] = [];
  private occluderCount = 0;
  /** The current scan run, stamped on every slot marked this frame. */
  private run = 0;
  /** The running unit walk, stamped on every slot it visited. */
  private unitRun = 0;
  /** The slots holding a cover, which the sweep hides or frees. */
  private readonly coverSlots = new Set<OccluderSlot>();
  /** The slots the last unit walk found in front of a unit, laid after the walk and again on each frame
   *  it repeats in, since an occluder's art may sway where it stands. */
  private readonly covering: OccluderSlot[] = [];
  /** The settlers of the last walked draw list that may ghost, flat, with what the scan last read of
   *  each ({@link SEEN_STRIDE} numbers per candidate): a frame repeating the list re-reads only these. */
  private readonly candidatePe: PooledEntity[] = [];
  private readonly candidateItem: SpriteDrawItem[] = [];
  private readonly unitSeen: number[] = [];
  private candidateCount = 0;
  /** The candidates that drew with current bounds, flat. */
  private readonly unitPe: (PooledEntity | undefined)[] = [];
  private readonly unitDepth: number[] = [];
  private readonly unitRef: number[] = [];
  private unitCount = 0;
  /** The run the grid's occluders were last marked in; a scan that only walks units keeps it. */
  private markRun = 0;
  /** The static candidates' slots as the last marking scan saw them, parallel to its list; `undefined`
   *  where a candidate had no box. */
  private readonly staticSlots: (OccluderSlot | undefined)[] = [];
  /** What the last scan ran under, for a frame repeating the draw list to compare; `scanned` falls
   *  with a {@link reset}, `probed` when the scan left the grid unmarked. */
  private scanned = false;
  private probed = false;
  private lastViewMoved = false;
  private lastZoom = 1;
  private lastRevealAll = false;
  private lastFill = false;
  private lastRing = false;
  private lastWildlife: ReadonlySet<number> | undefined;
  private listWalks = 0;
  /** The units that drew this frame and the ones a ghost shows, so a stamp hides or dies by them. */
  private readonly drawnUnits = new Set<number>();
  private readonly ghostedUnits = new Set<number>();
  /** The occluders the last scan faded, and the ones the running scan has: the restore walks the first
   *  against the second, then the pair swaps. */
  private fadedPes = new Set<PooledEntity>();
  private fadedNowPes = new Set<PooledEntity>();
  private fadedStatic = new Set<GhostOccluder>();
  private fadedNowStatic = new Set<GhostOccluder>();
  /** Scratch for laying one ring quad or the placeholder over its body layer. */
  private readonly transform = new Matrix();

  /**
   * Scan the painter-ordered draw list the pool just presented: fade the occluders when `revealAll`
   * asks, find the covered settlers and lay their `marks`. `frameOf` answers the frame id a pooled
   * entity's bounds are valid for, `viewMoved` re-lays the paletted layers a ring copies,
   * and `zoom` holds the ring's screen width. `staticOccluders` are the visible map objects, which the
   * pool's list never holds. The walkers of `wildlifeTribes` stay unghosted: a herd would fill the
   * overlay and tells the player nothing.
   *
   * `restless` marks a frame that repeats the last scan's draw list, pool entities and view: it names
   * the occluder-kind items presented since. Such a frame keeps the occluder marks and walks the units
   * again only when one of them moved or rebound.
   *
   * Depth is the painter depth the shared entity layer sorts at ({@link pooledDepth}, or a static
   * candidate's own), never the scene item's sort key, which lives on another scale.
   */
  scan(
    items: readonly SpriteDrawItem[],
    pool: ReadonlyMap<number, PooledEntity>,
    frameOf: (pe: PooledEntity) => number,
    viewMoved: boolean,
    zoom: number,
    staticOccluders: readonly GhostOccluder[] = [],
    wildlifeTribes?: ReadonlySet<number>,
    revealAll = false,
    marks: GhostMarks = { fill: false, ring: true },
    restless?: readonly DrawItem[],
  ): void {
    const repeats =
      restless !== undefined &&
      this.scanned &&
      zoom === this.lastZoom &&
      revealAll === this.lastRevealAll &&
      marks.fill === this.lastFill &&
      marks.ring === this.lastRing &&
      wildlifeTribes === this.lastWildlife &&
      this.rescanRepeated(restless, pool, frameOf, viewMoved, zoom, staticOccluders, marks);
    this.lastViewMoved = viewMoved;
    if (repeats) return;
    this.scanned = true;
    this.lastZoom = zoom;
    this.lastRevealAll = revealAll;
    this.lastFill = marks.fill;
    this.lastRing = marks.ring;
    this.lastWildlife = wildlifeTribes;
    this.listWalks++;
    this.run++;
    this.fadedNowPes.clear();
    this.fadedNowStatic.clear();
    this.occluderCount = 0;
    this.candidateCount = 0;
    this.covering.length = 0;
    for (const item of items) {
      // A portrait cutout hides on the main map, and a fog ghost is a dimmed memory, not a live body.
      if (item.portraitOnly === true || item.ghost === true) continue;
      const pe = pool.get(item.ref);
      if (pe === undefined || !pe.attached) continue;
      if (item.kind === 'settler') {
        if (wildlifeTribes !== undefined && item.tribe !== undefined && wildlifeTribes.has(item.tribe))
          continue;
        const at = this.candidateCount++;
        this.candidatePe[at] = pe;
        this.candidateItem[at] = item;
      } else if (OCCLUDER_KINDS.has(item.kind) && pe.boundsFrame === frameOf(pe)) {
        const at = this.occluderCount++;
        this.occluderPe[at] = pe;
        this.occluderDepth[at] = pooledDepth(pe, item);
      }
    }
    this.candidatePe.length = this.candidateCount;
    this.candidateItem.length = this.candidateCount;
    this.readUnits(frameOf);
    this.collectDrawnUnits();
    // Nothing probes the grid, so it stays as the last probing scan left it for the next eviction.
    const marking = marks.fill || marks.ring;
    this.probed = (this.unitCount !== 0 && marking) || revealAll;
    if (!this.probed) {
      this.restoreFades();
      this.sweep();
      return;
    }
    this.markRun = this.run;
    for (let o = 0; o < this.occluderCount; o++) {
      const pe = this.occluderPe[o];
      if (pe !== undefined) this.mark(pe, undefined, pe, this.occluderDepth[o] ?? 0, pe.bounds);
    }
    this.staticSlots.length = staticOccluders.length;
    for (let i = 0; i < staticOccluders.length; i++) {
      const occ = staticOccluders[i];
      this.staticSlots[i] =
        occ === undefined ? undefined : this.mark(occ, occ, undefined, occ.depth, occ.bounds());
    }
    // Before the eviction swaps this scan's marks away.
    if (revealAll) this.fadeAllMarked();
    this.evictUnmarked();
    this.coverUnits(viewMoved, zoom, marks);
    this.restoreFades();
    this.sweep();
  }

  /**
   * A frame repeating the last scan's draw list: re-mark the `restless` occluders, then leave the
   * overlay as laid when no occluder and no unit changed, or walk the units again over the kept marks.
   * False when an occluder joined or left the marks, which only a walk of the draw list settles.
   */
  private rescanRepeated(
    restless: readonly DrawItem[],
    pool: ReadonlyMap<number, PooledEntity>,
    frameOf: (pe: PooledEntity) => number,
    viewMoved: boolean,
    zoom: number,
    staticOccluders: readonly GhostOccluder[],
    marks: GhostMarks,
  ): boolean {
    if (!this.probed) {
      // The last scan found no unit to probe for and marked nothing: that stands while none turns up.
      this.readUnits(frameOf);
      return this.unitCount === 0;
    }
    let changed = viewMoved !== this.lastViewMoved;
    for (const item of restless) {
      if (item.portraitOnly === true || item.ghost === true) continue;
      const pe = pool.get(item.ref);
      if (pe === undefined) return false;
      const slot = this.slots.get(pe);
      const marked = slot !== undefined && slot.run === this.markRun;
      const stands = pe.attached && OCCLUDER_KINDS.has(item.kind) && pe.boundsFrame === frameOf(pe);
      if (stands !== marked) return false;
      if (slot === undefined || !stands) continue;
      const depth = pooledDepth(pe, item);
      if (depth === slot.depth && sameBox(slot.bounds, pe.bounds)) continue;
      this.mark(pe, undefined, pe, depth, pe.bounds);
      changed = true;
    }
    if (!this.staticsStand(staticOccluders)) return false;
    if (this.readUnits(frameOf)) changed = true;
    if (!changed) {
      for (const slot of this.covering) this.layCover(slot);
      return true;
    }
    this.run++;
    this.covering.length = 0;
    this.collectDrawnUnits();
    this.coverUnits(viewMoved, zoom, marks);
    this.sweep();
    return true;
  }

  /** Whether the static candidates are the ones the last marking scan saw, each at the depth and box
   *  it was marked by. */
  private staticsStand(staticOccluders: readonly GhostOccluder[]): boolean {
    if (staticOccluders.length !== this.staticSlots.length) return false;
    for (let i = 0; i < staticOccluders.length; i++) {
      const occ = staticOccluders[i];
      const slot = this.staticSlots[i];
      const bounds = occ?.bounds();
      if (occ === undefined || bounds === undefined) {
        if (slot !== undefined) return false;
        continue;
      }
      if (slot?.key !== occ || slot.depth !== occ.depth || !sameBox(slot.bounds, bounds)) return false;
    }
    return true;
  }

  /**
   * Read the candidates into the unit list, those that drew with current bounds; whether any reads
   * unlike the last time: its place, depth, box or bind, or whether it draws at all.
   */
  private readUnits(frameOf: (pe: PooledEntity) => number): boolean {
    const seen = this.unitSeen;
    let changed = seen.length !== this.candidateCount * SEEN_STRIDE;
    seen.length = this.candidateCount * SEEN_STRIDE;
    this.unitCount = 0;
    for (let c = 0; c < this.candidateCount; c++) {
      const pe = this.candidatePe[c];
      const item = this.candidateItem[c];
      if (pe === undefined || item === undefined) continue;
      const at = c * SEEN_STRIDE;
      if (!pe.attached || pe.boundsFrame !== frameOf(pe)) {
        if (seen[at + SEEN_DRAWN] !== 0) changed = true;
        seen[at + SEEN_DRAWN] = 0;
        continue;
      }
      const depth = pooledDepth(pe, item);
      const { x, y } = pe.container.position;
      const b = pe.bounds;
      if (
        seen[at + SEEN_DRAWN] !== 1 ||
        seen[at + SEEN_X] !== x ||
        seen[at + SEEN_Y] !== y ||
        seen[at + SEEN_BIND] !== pe.bindSerial ||
        seen[at + SEEN_DEPTH] !== depth ||
        seen[at + SEEN_MIN_X] !== b.minX ||
        seen[at + SEEN_MIN_Y] !== b.minY ||
        seen[at + SEEN_MAX_X] !== b.maxX ||
        seen[at + SEEN_MAX_Y] !== b.maxY
      ) {
        changed = true;
        seen[at + SEEN_DRAWN] = 1;
        seen[at + SEEN_X] = x;
        seen[at + SEEN_Y] = y;
        seen[at + SEEN_BIND] = pe.bindSerial;
        seen[at + SEEN_DEPTH] = depth;
        seen[at + SEEN_MIN_X] = b.minX;
        seen[at + SEEN_MIN_Y] = b.minY;
        seen[at + SEEN_MAX_X] = b.maxX;
        seen[at + SEEN_MAX_Y] = b.maxY;
      }
      const u = this.unitCount++;
      this.unitPe[u] = pe;
      this.unitDepth[u] = depth;
      this.unitRef[u] = item.ref;
    }
    return changed;
  }

  /** Start a unit walk's bookkeeping from the unit list: every unit drew, none ghosts yet. */
  private collectDrawnUnits(): void {
    this.drawnUnits.clear();
    this.ghostedUnits.clear();
    for (let u = 0; u < this.unitCount; u++) {
      const ref = this.unitRef[u];
      if (ref !== undefined) this.drawnUnits.add(ref);
    }
  }

  /** Walk the unit list over the marked occluders: stamp each covered unit, then lay the covers. */
  private coverUnits(viewMoved: boolean, zoom: number, marks: GhostMarks): void {
    const marking = marks.fill || marks.ring;
    for (let u = 0; marking && u < this.unitCount; u++) {
      const pe = this.unitPe[u];
      if (pe === undefined) continue;
      const depth = this.unitDepth[u] ?? 0;
      if (this.coverUnit(pe, depth)) this.stamp(pe, depth, viewMoved, zoom, marks);
    }
    for (const slot of this.covering) this.layCover(slot);
  }

  /** Free or hide the stamps whose units no longer ghost: a unit still drawn keeps a hidden stamp it
   *  may re-show next frame, a vanished one dies with its ref. A cover no unit stands behind dies at
   *  once: a kept copy would outlive the texture it shows, which a construction site's rising walls
   *  replace and free while the site stands. */
  private sweep(): void {
    this.clip.active = this.ghostedUnits.size > 0;
    for (const slot of this.coverSlots) {
      if (slot.coverRun !== this.run) this.freeCover(slot);
    }
    for (const [ref, stamp] of this.stamps) {
      if (this.ghostedUnits.has(ref)) continue;
      if (this.drawnUnits.has(ref) && !stamp.pe.container.destroyed) {
        hideStamp(stamp);
        continue;
      }
      stamp.container.destroy({ children: true });
      this.stamps.delete(ref);
    }
  }

  /** Take the slots the last probing scan marked and this one did not out of the grid, then make this
   *  scan's marks the ones the next eviction checks. */
  private evictUnmarked(): void {
    for (const slot of this.previouslyMarked) {
      if (slot.run === this.markRun) continue;
      this.unregisterSlot(slot);
      this.slots.delete(slot.key);
    }
    const evicted = this.previouslyMarked;
    evicted.length = 0;
    this.previouslyMarked = this.marked;
    this.marked = evicted;
  }

  /** The stamps of the ghosted units and the copies of the occluders that clip them, one child each. */
  get marks(): Container {
    return this.clip.marks;
  }

  get covers(): Container {
    return this.clip.covers;
  }

  /** The scans that walked the whole draw list, which a frame repeating the last one spares. */
  get fullScans(): number {
    return this.listWalks;
  }

  /** The slot entries across the grid's cells: the registered occluders, once per cell each touches. */
  get gridEntries(): number {
    let entries = 0;
    for (const cell of this.cellSlots.values()) entries += cell.length;
    return entries;
  }

  /** Free every stamp and the occluder grid and undo every fade; the overlay stays mounted. The pool
   *  calls this in the scan's place while nothing asks for one; a cleared overlay walks empty maps. */
  reset(): void {
    this.scanned = false;
    this.candidateCount = 0;
    this.candidatePe.length = 0;
    this.candidateItem.length = 0;
    this.unitCount = 0;
    this.unitPe.length = 0;
    this.covering.length = 0;
    this.staticSlots.length = 0;
    for (const stamp of this.stamps.values()) stamp.container.destroy({ children: true });
    this.stamps.clear();
    this.clearGrid();
    for (const slot of this.coverSlots) this.freeCover(slot);
    this.clip.active = false;
    for (const pe of this.fadedPes) if (!pe.container.destroyed) pe.container.alpha = 1;
    for (const occ of this.fadedStatic) occ.setFade?.(undefined);
    this.fadedPes.clear();
    this.fadedNowPes.clear();
    this.fadedStatic.clear();
    this.fadedNowStatic.clear();
  }

  /**
   * Hide the overlay and the fades from a portrait or map inset, which borrows the world without
   * them, then show them again. Alpha, not visibility: Pixi repacks an alpha change in place.
   */
  setVisible(visible: boolean): void {
    this.container.alpha = visible ? 1 : 0;
    this.clip.shown = visible;
    const fade = visible ? OCCLUDER_FADE_ALPHA : undefined;
    for (const pe of this.fadedPes) if (!pe.container.destroyed) pe.container.alpha = fade ?? 1;
    for (const occ of this.fadedStatic) occ.setFade?.(fade);
  }

  /** Free every stamp and cell; the pool calls this on its own teardown. */
  destroy(): void {
    this.reset();
    this.container.destroy({ children: true });
  }

  private freeCover(slot: OccluderSlot): void {
    slot.cover?.container.destroy({ children: true });
    slot.cover = undefined;
    this.coverSlots.delete(slot);
  }

  private clearGrid(): void {
    if (this.cellSlots.size === 0) return;
    this.cellSlots.clear();
    this.slots = new WeakMap();
    this.marked.length = 0;
    this.previouslyMarked.length = 0;
  }

  /** Mark `key`'s occluder for the running scan at `depth`, registering its box into the grid when it
   *  moved; its slot, or `undefined` without a box. An unchanged box keeps its cell entries from earlier
   *  runs, so an unchanged frame costs one depth stamp per occluder instead of a grid refill. */
  private mark(
    key: object,
    occ: GhostOccluder | undefined,
    pe: PooledEntity | undefined,
    depth: number,
    bounds: EntityBounds | undefined,
  ): OccluderSlot | undefined {
    if (bounds === undefined) return undefined;
    let slot = this.slots.get(key);
    if (slot === undefined) {
      slot = {
        key,
        occ,
        pe,
        depth,
        bounds: { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY },
        cells: [],
        run: this.markRun,
        visited: -1,
        coverRun: -1,
        cover: undefined,
      };
      this.slots.set(key, slot);
      this.marked.push(slot);
      this.registerSlot(slot, bounds);
      return slot;
    }
    if (slot.run !== this.markRun) this.marked.push(slot);
    slot.run = this.markRun;
    slot.depth = depth;
    const b = slot.bounds;
    if (slot.cells.length !== 0 && sameBox(b, bounds)) return slot;
    // The box moved: leave the cells it no longer occupies, then register the new extent.
    this.unregisterSlot(slot);
    b.minX = bounds.minX;
    b.minY = bounds.minY;
    b.maxX = bounds.maxX;
    b.maxY = bounds.maxY;
    this.registerSlot(slot, b);
    return slot;
  }

  /** Slot `slot` into every grid cell `b` touches. Cells persist across scans; the probe skips the
   *  slots of older runs. */
  private registerSlot(slot: OccluderSlot, b: EntityBounds): void {
    for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++) {
      for (let gy = Math.floor(b.minY / CELL); gy <= Math.floor(b.maxY / CELL); gy++) {
        const key = cellKey(gx, gy);
        let cell = this.cellSlots.get(key);
        if (cell === undefined) {
          cell = [];
          this.cellSlots.set(key, cell);
        }
        cell.push(slot);
        slot.cells.push(key);
      }
    }
  }

  /** Take `slot` out of every cell it sits in, for a moved box or an evicted slot. */
  private unregisterSlot(slot: OccluderSlot): void {
    for (const key of slot.cells) {
      const cell = this.cellSlots.get(key);
      if (cell === undefined) continue;
      let w = 0;
      for (let i = 0; i < cell.length; i++) {
        const held = cell[i];
        if (held !== undefined && held !== slot) cell[w++] = held;
      }
      if (w === 0) this.cellSlots.delete(key);
      else cell.length = w;
    }
    slot.cells.length = 0;
  }

  /**
   * Copy every standing sprite drawn in front of the unit, where their boxes meet, into the clip;
   * whether there is one. The boxes only pick the candidates: the clip's depth test draws a mark on
   * the pixels a cover's art really hides.
   */
  private coverUnit(pe: PooledEntity, depth: number): boolean {
    const b = pe.bounds;
    this.unitRun++;
    const run = this.unitRun;
    let covered = false;
    for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++) {
      for (let gy = Math.floor(b.minY / CELL); gy <= Math.floor(b.maxY / CELL); gy++) {
        const cell = this.cellSlots.get(cellKey(gx, gy));
        if (cell === undefined) continue;
        for (const slot of cell) {
          // A slot from an earlier run stands unmarked this frame; one big occluder spans several cells
          // the unit's box may share, so the walk dedupes per slot.
          if (slot.run !== this.markRun || slot.visited === run) continue;
          slot.visited = run;
          if (slot.depth <= depth || !boxesOverlap(b, slot.bounds)) continue;
          covered = true;
          if (slot.coverRun === this.run) continue;
          slot.coverRun = this.run;
          this.covering.push(slot);
        }
      }
    }
    return covered;
  }

  /** Lay `slot`'s copies over its art as drawn this frame, one quad per layer that hides anything: a
   *  shadow and a layer the picker ignores hide nothing. */
  private layCover(slot: OccluderSlot): void {
    let cover = slot.cover;
    if (cover === undefined) {
      cover = { container: new Container(), quads: [] };
      slot.cover = cover;
      this.coverSlots.add(slot);
      this.clip.covers.addChild(cover.container);
    }
    const z = clipDepthOf(slot.depth);
    let count = 0;
    const pe = slot.pe;
    if (pe !== undefined) {
      cover.container.position.copyFrom(pe.container.position);
      for (let i = 0; i < pe.sprites.length; i++) {
        const body = pe.sprites[i];
        if (body === undefined || !body.visible || body.alpha <= 0 || body instanceof PalettedSprite)
          continue;
        if (!pe.paletted && pe.pickExempt[i] === true) continue;
        if (isShadowTexture(body.texture)) continue;
        this.layCoverQuad(coverQuadAt(cover, count++), body, z);
      }
    } else {
      const body = slot.occ?.body();
      if (body !== undefined) this.layCoverQuad(coverQuadAt(cover, count++), body, z);
    }
    // A layer the art dropped takes its copy with it, for the same reason an unused cover dies.
    while (cover.quads.length > count) cover.quads.pop()?.destroy();
  }

  /** A cover packs its art's whole quad: cut to the marks, it would interpolate its uvs between other
   *  corners, and a fragment on a texel edge could flip its depth write and move a ghost's edge pixel. */
  private layCoverQuad(quad: SelectionSprite, body: Sprite, z: number): void {
    body.updateLocalTransform();
    quad.alpha = 1;
    quad.clipDepth = z;
    quad.texture = body.texture;
    quad.setFromMatrix(frameTransform(this.transform, body.localTransform, body.anchor, body.texture));
  }

  /** Fade every occluder this scan marked, whether or not a unit hides behind it. */
  private fadeAllMarked(): void {
    for (const slot of this.marked) {
      const pe = slot.pe;
      if (pe !== undefined) {
        if (!pe.container.destroyed) pe.container.alpha = OCCLUDER_FADE_ALPHA;
        this.fadedNowPes.add(pe);
      } else if (slot.occ?.setFade !== undefined) {
        slot.occ.setFade(OCCLUDER_FADE_ALPHA);
        this.fadedNowStatic.add(slot.occ);
      }
    }
  }

  /** Restore every occluder the last scan faded that this one did not, then hand the sets over for
   *  the next scan, whose clears empty the swapped-out one. */
  private restoreFades(): void {
    for (const pe of this.fadedPes)
      if (!this.fadedNowPes.has(pe) && !pe.container.destroyed) pe.container.alpha = 1;
    for (const occ of this.fadedStatic) if (!this.fadedNowStatic.has(occ)) occ.setFade?.(undefined);
    const pes = this.fadedPes;
    this.fadedPes = this.fadedNowPes;
    this.fadedNowPes = pes;
    const statics = this.fadedStatic;
    this.fadedStatic = this.fadedNowStatic;
    this.fadedNowStatic = statics;
  }

  /** Show or mint `pe`'s stamps at the unit's painter `depth`, tracking its body's placement; lay the
   *  quads when the body rebinds. */
  private stamp(pe: PooledEntity, depth: number, viewMoved: boolean, zoom: number, marks: GhostMarks): void {
    const ref = pe.bound.item?.ref;
    if (ref === undefined) return;
    this.ghostedUnits.add(ref);
    let stamp = this.stamps.get(ref);
    if (stamp === undefined) {
      stamp = {
        container: new Container(),
        fills: [],
        rings: [],
        placeholder: undefined,
        pe,
        bindSerial: -1,
        laidUnderMovedView: !viewMoved,
        laidAtZoom: zoom,
        laidFill: marks.fill,
        laidRing: marks.ring,
      };
      this.stamps.set(ref, stamp);
      this.clip.marks.addChild(stamp.container);
    }
    stamp.container.alpha = 1;
    stamp.container.position.copyFrom(pe.container.position);
    const replaced = stamp.pe !== pe;
    stamp.pe = pe;
    if (
      replaced ||
      pe.bindSerial !== stamp.bindSerial ||
      viewMoved !== stamp.laidUnderMovedView ||
      zoom !== stamp.laidAtZoom ||
      marks.fill !== stamp.laidFill ||
      marks.ring !== stamp.laidRing
    )
      this.lay(pe, stamp, viewMoved, zoom, marks);
    // The unit's depth moves with it, and a hidden quad keeps one it never tests.
    const z = clipDepthOf(depth);
    for (const quad of stamp.fills) quad.clipDepth = z;
    for (const quad of stamp.rings) quad.clipDepth = z;
    if (stamp.placeholder !== undefined) stamp.placeholder.clipDepth = z;
  }

  /** Lay the marks' fill and ring quads per stamped body layer, each over its body's placement and
   *  share of the alpha. */
  private lay(
    pe: PooledEntity,
    stamp: GhostStamp,
    viewMoved: boolean,
    zoom: number,
    marks: GhostMarks,
  ): void {
    stamp.bindSerial = pe.bindSerial;
    stamp.laidUnderMovedView = viewMoved;
    stamp.laidAtZoom = zoom;
    stamp.laidFill = marks.fill;
    stamp.laidRing = marks.ring;
    const reach = GHOST_OUTLINE_RADIUS / zoom;
    const { fill, ring } = marks;
    const fillAlpha = ring ? GHOST_UNDER_RING_FILL_ALPHA : GHOST_FILL_ALPHA;
    // The ghost takes its owner's colour; an owner change rebinds the body, which lays the quads again.
    const tint = this.tintOf?.(pe) ?? GHOST_TINT;
    let fills = 0;
    let rings = 0;
    for (let i = 0; i < pe.sprites.length; i++) {
      const body = pe.sprites[i];
      // A vehicle's hull meshes place themselves per camera, which a copied quad cannot follow; a
      // settler never binds one.
      if (body === undefined || !body.visible || body.alpha <= 0 || body instanceof PalettedSprite) continue;
      if ('glow' in body && body.glow === true) continue;
      if (!pe.paletted && pe.pickExempt[i] === true) continue;
      body.updateLocalTransform();
      frameTransform(this.transform, body.localTransform, body.anchor, body.texture);
      if (fill) {
        const quad = fillAt(stamp, fills++);
        quad.tint = tint;
        quad.alpha = body.alpha * fillAlpha;
        quad.texture = body.texture;
        quad.setFromMatrix(this.transform);
      }
      // Last: the ring grows the transform past the body.
      if (ring) {
        const quad = ringAt(stamp, rings++);
        quad.tint = tint;
        quad.alpha = body.alpha * GHOST_ALPHA;
        placeOutline(quad, body.texture, this.transform, this.textures, reach);
      }
    }
    let marker = false;
    if (pe.placeholder?.visible === true && pe.placeholder.alpha > 0) {
      let stamped = stamp.placeholder;
      if (stamped === undefined) {
        stamped = worldBatched(new SelectionGraphics({ context: pe.placeholder.context }));
        stamped.selectionEffect = SELECTION_STAMP;
        stamp.placeholder = stamped;
        stamp.container.addChild(stamped);
      }
      pe.placeholder.updateLocalTransform();
      stamped.tint = tint;
      stamped.alpha = pe.placeholder.alpha * (fill ? fillAlpha : GHOST_ALPHA);
      stamped.setFromMatrix(this.transform.copyFrom(pe.placeholder.localTransform));
      marker = true;
    }
    for (let i = fills; i < stamp.fills.length; i++) {
      const quad = stamp.fills[i];
      if (quad !== undefined) hideQuad(quad);
    }
    for (let i = rings; i < stamp.rings.length; i++) {
      const quad = stamp.rings[i];
      if (quad !== undefined) hideQuad(quad);
    }
    if (stamp.placeholder !== undefined && !marker) stamp.placeholder.alpha = 0;
  }
}

/** The ghost fill quad at `index` of `stamp`, minted under every ring. */
function fillAt(stamp: GhostStamp, index: number): SelectionSprite {
  const held = stamp.fills[index];
  if (held !== undefined) return held;
  const quad = worldBatched(new SelectionSprite());
  quad.selectionEffect = SELECTION_STAMP;
  stamp.container.addChildAt(quad, stamp.fills.length);
  stamp.fills[index] = quad;
  return quad;
}

/** The ghost ring quad at `index` of `stamp`, minted over whatever stood there. */
function ringAt(stamp: GhostStamp, index: number): GhostOutlineSprite {
  const held = stamp.rings[index];
  if (held !== undefined) return held;
  const quad = worldBatched(new GhostOutlineSprite());
  stamp.rings[index] = quad;
  stamp.container.addChild(quad);
  return quad;
}

/** The cover quad at `index` of `cover`. */
function coverQuadAt(cover: CoverStamp, index: number): SelectionSprite {
  const held = cover.quads[index];
  if (held !== undefined) return held;
  const quad = worldBatched(new SelectionSprite());
  quad.selectionEffect = SELECTION_COVER;
  cover.quads[index] = quad;
  cover.container.addChild(quad);
  return quad;
}

/** Retire a stamp quad in place: zero alpha repacks without rebuilding the batch's instructions. The
 *  quad keeps its texture: swapping to an empty texture names a page the batch does not hold, so a
 *  full batch would rebuild the render group's whole instruction set on every hide and re-show. */
function hideQuad(quad: SelectionSprite): void {
  quad.alpha = 0;
}

/** Hide a whole stamp set the same way. */
function hideStamp(stamp: GhostStamp): void {
  stamp.container.alpha = 0;
  for (const quad of stamp.fills) if (quad !== undefined) hideQuad(quad);
  for (const quad of stamp.rings) if (quad !== undefined) hideQuad(quad);
  if (stamp.placeholder !== undefined) stamp.placeholder.alpha = 0;
}

function sameBox(a: EntityBounds, b: EntityBounds): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

function boxesOverlap(a: EntityBounds, b: EntityBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
