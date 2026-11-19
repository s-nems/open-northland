import { Container, Matrix } from 'pixi.js';
import { GLOW_PALETTE_INDEX } from '../../data/palettes/glow-colour.js';
import { createHumanPaletteColours } from '../../data/palettes/human-palettes.js';
import type { SpriteDrawItem } from '../../data/scene/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { GhostOutlineSprite, SelectionGraphics, SelectionSprite } from '../selection/sprite-effect.js';
import type { HumanPaletteLut } from '../textures/human-palette-lut.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { worldBatched } from '../world-batch/batcher.js';
import { SELECTION_STAMP } from '../world-batch/shader.js';
import { pixelHit } from './picking/pick.js';
import { pooledDepth } from './pooled-depth.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';
import { frameTransform, placeOutline } from './selection-effects.js';

/**
 * Occlusion ghosts: a settler a standing sprite hides shows over that sprite, so the player can follow
 * people behind houses, walls and trees. The scan runs over the painter-ordered draw list after each
 * reconcile: a unit is ghosted when a later-drawn occluder's art covers part of it, and the ghost draws
 * in an overlay above the sprite layer, per body layer, as the {@link GhostMarks} ask: a `SELECTION_STAMP`
 * fill quad, a `SELECTION_GHOST_OUTLINE` ring quad, or both, the fill under the ring. Ghosts tint with
 * the colour their unit's body wears — the team step of the entity's own composed palette row — so
 * friends and foes read apart through the cover; where no colour resolves they keep {@link GHOST_TINT}.
 *
 * On top of the marks, the view can ask to see through a cover: while the hold-to-reveal key is down,
 * a selected unit hides behind one, or the cursor rests near a covered unit, the sprites that hide it
 * draw translucent ({@link OCCLUDER_FADE_ALPHA}) until the ask lifts, which the scan undoes itself —
 * a cover fades only while some covered unit asks for it.
 *
 * Approximation, not observed original behaviour: the original's hidden-unit rendering has no readable
 * source here. The fill and ring alphas, the reach, the coverage samples and the fade's alpha and proximity are tuned
 * by eye; the occluder kinds are the standing sprites tall enough to hide a person (delivery flags and
 * loose heaps are not, and a unit behind one stays plain). Vehicles are neither ghosted nor occluders:
 * their paletted layers are self-placing meshes the ring quad cannot copy, so a cart behind a house
 * stays hidden.
 *
 * The occluders beyond the pool's own draw list arrive through {@link GhostOccluder}: a decoded map's
 * virgin trees and rocks draw on the retained map-object layer and never enter the scene items, so
 * the renderer hands the frame's visible tall objects in as static candidates.
 */

/** One occluder candidate the pool's draw list cannot see, as the static map-object layer reports it:
 *  a tall landscape object's bound pose this frame. Its art is the truth the scan tests against. */
export interface GhostOccluder {
  /** The painter depth the object sorts at in the shared entity layer, comparable with a draw item's. */
  readonly depth: number;
  /** The world-px box of the bound pose, or `undefined` when the pose has none this frame. */
  bounds(): EntityBounds | undefined;
  /** Whether the bound pose's art covers the world point; `undefined` keeps the box verdict, as the
   *  picker does where its pixels are unreadable. */
  hit(wx: number, wy: number): boolean | undefined;
  /** Fade the occluder's drawn art to `alpha`, or `undefined` restores it: the scan fades a sprite
   *  that hides a resident the view asks to see through. Absent keeps the candidate unfadeable - the
   *  scan still rings the unit over it. */
  setFade?(alpha: number | undefined): void;
}

/** Which marks a ghost draws: a team-coloured fill of the body, a ring around it, or both. */
export interface GhostMarks {
  readonly fill: boolean;
  readonly ring: boolean;
}

/** What the scan may fade occluders for this frame, as the app reports the view's asks. */
export interface OccluderFade {
  /** The frame's selected ids: a covered unit among them fades the sprites that cover it. */
  readonly selection: ReadonlySet<number> | undefined;
  /** The cursor's world position: a covered unit within {@link OCCLUDER_FADE_PROXIMITY} of it fades
   *  its covers. Absent while the pointer leaves the canvas or a tool claims it. */
  readonly pointer: { readonly x: number; readonly y: number } | undefined;
  /** The hold-to-reveal key held down: every covered unit's covers fade. */
  readonly held: boolean;
}

/** How translucent a standing sprite draws while it hides a resident the view asks to see through (the
 *  reveal key, a selected unit or the cursor resting near one). Approximation, tuned by eye. */
export const OCCLUDER_FADE_ALPHA = 0.45;
/** How near, in world px, the cursor must rest to a covered unit to fade its covers - about two tiles,
 *  since the player knows roughly where the hidden one stands. Approximation, tuned by eye. */
export const OCCLUDER_FADE_PROXIMITY = 64;

/** The kinds whose art can hide a unit standing behind it. */
const OCCLUDER_KINDS: ReadonlySet<SpriteDrawItem['kind']> = new Set([
  'building',
  'palisade',
  'signpost',
  'resource',
]);

/** The ghost ring's tint where nothing resolves: no sheet palette at all, or the playerless placeholder
 *  marker. Approximation, tuned by eye for legibility. */
export const GHOST_TINT = 0xf0ede2;
/** The ring's alpha over the cover. Approximation, tuned by eye. */
export const GHOST_ALPHA = 0.4;
/** The fill's alpha alone, and under a ring, where it only tints the body the ring already traces.
 *  Approximation, tuned by eye. */
export const GHOST_FILL_ALPHA = 0.45;
export const GHOST_UNDER_RING_FILL_ALPHA = 0.2;
/** Screen px the ring reaches past the body art, one pass per ring. Approximation, tuned by eye for
 *  legibility: the selection outline's own keyline reach, drawn without the body under it. */
export const GHOST_OUTLINE_RADIUS = 2;
/** Bytes per palette entry: the team palettes are RGB triplets. */
const RGB = 3;

/**
 * The tint a ghost ring takes, per pooled entity: a body bound through the human LUT reads the row it
 * draws through — step {@link GLOW_PALETTE_INDEX} of its composed body palette, the step the hero glow
 * reads — so the ring shows the exact colour the unit itself wears, its sex and palette rolls included.
 * A look baked on a plain atlas draws no team band; its ring composes the owner's team palette instead
 * (`composeTeam`, the male recipe, whose ramp the women's recipe shares). No darkness lift, unlike the
 * glow: the ring answers to the unit's colour, not the glow's legibility.
 */
export function ghostTintOf(lut: HumanPaletteLut): (pe: PooledEntity) => number {
  const scratch = createHumanPaletteColours();
  return (pe) => {
    if (pe.paletted && pe.palette === lut) return lut.teamColourAt(pe.lutRow);
    lut.book.composeTeam(pe.bound.item?.player ?? 0, scratch);
    return teamTint(scratch.body);
  };
}

/** The tint number of the palette's team step: the RGB triplet at {@link GLOW_PALETTE_INDEX}. */
function teamTint(palette: Uint8Array): number {
  const at = GLOW_PALETTE_INDEX * RGB;
  return ((palette[at] ?? 0) << 16) | ((palette[at + 1] ?? 0) << 8) | (palette[at + 2] ?? 0);
}

/**
 * Where the scan samples the unit's box for cover, as (u, v) shares from the box's top-left. The strip
 * runs down the body's own extent, so a cover touching only the generous box's air does not ghost the
 * unit; one covered point ghosts it, since any hidden body pixel is worth the outline.
 */
const COVER_SAMPLES: readonly (readonly [number, number])[] = [
  [0.5, 0.15],
  [0.5, 0.35],
  [0.35, 0.5],
  [0.65, 0.5],
  [0.5, 0.6],
  [0.35, 0.75],
  [0.65, 0.75],
  [0.5, 0.9],
];

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
  /** The static candidate, whose own `hit` answers the pixel probes; absent for a pool occluder. */
  readonly occ: GhostOccluder | undefined;
  /** The pooled entity behind the slot, whose `pixelHit` answers instead of `occ.hit`. */
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
  /** The entity the stamps copy; a ref the pool freed destroys the stamp with it. */
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

  constructor(
    private readonly textures: TextureCache,
    /** The tint a ghosted unit's ring takes, per entity; absent draws every ring in {@link GHOST_TINT}. */
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
  /** The scan's unit candidates, flat. */
  private readonly unitPe: (PooledEntity | undefined)[] = [];
  private readonly unitDepth: number[] = [];
  private unitCount = 0;
  /** The units that drew this frame and the ones a ghost shows, so a stamp hides or dies by them. */
  private readonly drawnUnits = new Set<number>();
  private readonly ghostedUnits = new Set<number>();
  /** The occluders the last scan faded and this one did, and the same for this scan alone: the restore
   *  walks the last scan's set against this scan's, then the pair swaps for the next scan. */
  private fadedPes = new Set<PooledEntity>();
  private fadedNowPes = new Set<PooledEntity>();
  private fadedStatic = new Set<GhostOccluder>();
  private fadedNowStatic = new Set<GhostOccluder>();
  /** The covering slots of the unit under the walk, when the scan collects them to fade. */
  private readonly covers: OccluderSlot[] = [];
  /** The fade context of the running scan; absent collects no covers and nothing fades. */
  private fade: OccluderFade | undefined = undefined;
  /** Scratch for laying one ring quad or the placeholder over its body layer. */
  private readonly transform = new Matrix();

  /**
   * Scan the painter-ordered draw list the pool just presented: collect the settlers and the standing
   * sprites, find the covered units and update their stamps. `frameOf` answers the frame id a pooled
   * entity's stamped bounds and pixels are valid for; `viewMoved` says the camera moved since the last
   * scan, which re-lays the paletted layers a ring copies, and `zoom` is the camera's scale, whose
   * divisor holds the ring's screen width. `staticOccluders` carries the frame's visible map-object
   * candidates, whose drawn poses the pool's list never sees. `wildlifeTribes` lists the animal tribes
   * the sheet knows: their walkers draw behind trees like anyone else, but a ghosted deer tells the
   * player nothing and a herd would fill the overlay, so they stay unghosted.
   *
   * Depth throughout is the painter depth the shared entity layer sorts at - the pool's own
   * {@link pooledDepth} over the item being drawn and the entity's drawn motion, a static candidate's
   * own - never the scene item's oracle sort key, which lives on a different scale and would bury
   * every static tree behind a row's worth of key.
   *
   * `fade` carries the view's asks to see through a cover - the reveal key, a selected unit, the
   * cursor resting near one - and absent fades nothing, which also undoes the last scan's fades.
   * `marks` picks what a ghost draws.
   */
  scan(
    items: readonly SpriteDrawItem[],
    pool: ReadonlyMap<number, PooledEntity>,
    frameOf: (pe: PooledEntity) => number,
    viewMoved: boolean,
    zoom: number,
    staticOccluders: readonly GhostOccluder[] = [],
    wildlifeTribes?: ReadonlySet<number>,
    fade?: OccluderFade | undefined,
    marks: GhostMarks = { fill: false, ring: true },
  ): void {
    this.run++;
    this.unitCount = 0;
    this.fade = fade;
    this.fadedNowPes.clear();
    this.fadedNowStatic.clear();
    this.occluderCount = 0;
    this.drawnUnits.clear();
    this.ghostedUnits.clear();
    for (const item of items) {
      // A portrait cutout hides on the main map, and a fog ghost is a dimmed memory, not a live body.
      if (item.portraitOnly === true || item.ghost === true) continue;
      const pe = pool.get(item.ref);
      if (pe === undefined || !pe.attached) continue;
      if (item.kind === 'settler') {
        if (pe.boundsFrame !== frameOf(pe)) continue;
        if (wildlifeTribes !== undefined && item.tribe !== undefined && wildlifeTribes.has(item.tribe))
          continue;
        this.drawnUnits.add(item.ref);
        const at = this.unitCount++;
        this.unitPe[at] = pe;
        this.unitDepth[at] = pooledDepth(pe, item);
      } else if (OCCLUDER_KINDS.has(item.kind) && pe.boundsFrame === frameOf(pe)) {
        const at = this.occluderCount++;
        this.occluderPe[at] = pe;
        this.occluderDepth[at] = pooledDepth(pe, item);
      }
    }
    // No unit drew: nothing probes the grid, so it stays as the last probing scan left it, to be
    // marked and evicted against that scan next time; the sweep alone frees the vanished units' stamps.
    if (this.unitCount === 0) {
      this.sweepStamps();
      return;
    }
    for (let o = 0; o < this.occluderCount; o++) {
      const pe = this.occluderPe[o];
      if (pe !== undefined) this.mark(pe, undefined, pe, this.occluderDepth[o] ?? 0, pe.bounds);
    }
    for (const occ of staticOccluders) this.mark(occ, occ, undefined, occ.depth, occ.bounds());
    this.evictUnmarked();
    for (let u = 0; u < this.unitCount; u++) {
      const pe = this.unitPe[u];
      if (pe === undefined) continue;
      const covered = this.coveredUnit(pe, this.unitDepth[u] ?? 0, frameOf, this.fadesFor(pe), this.covers);
      if (!covered) continue;
      if (marks.fill || marks.ring) this.stamp(pe, viewMoved, zoom, marks);
      this.fadeCovers();
    }
    this.restoreFades();
    this.sweepStamps();
  }

  /** Free or hide the stamps whose units no longer ghost: a unit still drawn keeps a hidden stamp it
   *  may re-show next frame, a vanished one dies with its ref. */
  private sweepStamps(): void {
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
      if (slot.run === this.run) continue;
      this.unregisterSlot(slot);
      this.slots.delete(slot.key);
    }
    const evicted = this.previouslyMarked;
    evicted.length = 0;
    this.previouslyMarked = this.marked;
    this.marked = evicted;
  }

  /** The slot entries across the grid's cells: the registered occluders, once per cell each touches. */
  get gridEntries(): number {
    let entries = 0;
    for (const cell of this.cellSlots.values()) entries += cell.length;
    return entries;
  }

  /** Free every stamp and the occluder grid, and undo every occluder fade still out; the overlay
   *  stays mounted. The pool calls this in the scan's place while the setting is off, and once it
   *  has cleared, each call walks empty maps. */
  reset(): void {
    for (const stamp of this.stamps.values()) stamp.container.destroy({ children: true });
    this.stamps.clear();
    this.clearGrid();
    for (const pe of this.fadedPes) if (!pe.container.destroyed) pe.container.alpha = 1;
    for (const occ of this.fadedStatic) occ.setFade?.(undefined);
    this.fadedPes.clear();
    this.fadedNowPes.clear();
    this.fadedStatic.clear();
    this.fadedNowStatic.clear();
  }

  /** Free every stamp and cell; the pool calls this on its own teardown. */
  destroy(): void {
    this.reset();
    this.container.destroy({ children: true });
  }

  private clearGrid(): void {
    if (this.cellSlots.size === 0) return;
    this.cellSlots.clear();
    this.slots = new WeakMap();
    this.marked.length = 0;
    this.previouslyMarked.length = 0;
  }

  /** Mark `key`'s occluder for the running scan at `depth`, registering its box into the grid when it
   *  moved. An unchanged box keeps its cell entries from earlier runs, so an unchanged frame costs one
   *  depth stamp per occluder instead of a grid refill. `occ` answers the pixel probes unless `pe`
   *  does. */
  private mark(
    key: object,
    occ: GhostOccluder | undefined,
    pe: PooledEntity | undefined,
    depth: number,
    bounds: EntityBounds | undefined,
  ): void {
    if (bounds === undefined) return;
    let slot = this.slots.get(key);
    if (slot === undefined) {
      slot = {
        key,
        occ,
        pe,
        depth,
        bounds: { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY },
        cells: [],
        run: this.run,
        visited: -1,
      };
      this.slots.set(key, slot);
      this.marked.push(slot);
      this.registerSlot(slot, bounds);
      return;
    }
    if (slot.run !== this.run) this.marked.push(slot);
    slot.run = this.run;
    slot.depth = depth;
    const b = slot.bounds;
    if (
      slot.cells.length !== 0 &&
      b.minX === bounds.minX &&
      b.minY === bounds.minY &&
      b.maxX === bounds.maxX &&
      b.maxY === bounds.maxY
    )
      return;
    // The box moved: leave the cells it no longer occupies, then register the new extent.
    this.unregisterSlot(slot);
    b.minX = bounds.minX;
    b.minY = bounds.minY;
    b.maxX = bounds.maxX;
    b.maxY = bounds.maxY;
    this.registerSlot(slot, b);
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

  /** Whether any standing sprite drawn in front of the unit covers sampled body points of it. When
   *  `collect` holds, the covering slots gather into `covers` and the walk keeps probing past the
   *  first one, so every cover can fade; otherwise the walk stops at the first. */
  private coveredUnit(
    pe: PooledEntity,
    depth: number,
    frameOf: (pe: PooledEntity) => number,
    collect: boolean,
    covers: OccluderSlot[],
  ): boolean {
    const b = pe.bounds;
    this.unitRun++;
    const run = this.unitRun;
    for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++) {
      for (let gy = Math.floor(b.minY / CELL); gy <= Math.floor(b.maxY / CELL); gy++) {
        const cell = this.cellSlots.get(cellKey(gx, gy));
        if (cell === undefined) continue;
        for (const slot of cell) {
          // A slot from an earlier run stands unmarked this frame; one big occluder spans several cells
          // the unit's box may share, so the walk dedupes per slot.
          if (slot.run !== this.run || slot.visited === run) continue;
          slot.visited = run;
          if (slot.depth <= depth) continue;
          const ob = slot.bounds;
          if (!boxesOverlap(b, ob)) continue;
          const width = b.maxX - b.minX;
          const height = b.maxY - b.minY;
          let coveredSlot = false;
          for (const [u, v] of COVER_SAMPLES) {
            const px = b.minX + u * width;
            const py = b.minY + v * height;
            // The occluder's box must hold the sample before its pixels answer anything.
            if (px < ob.minX || px > ob.maxX || py < ob.minY || py > ob.maxY) continue;
            const hit =
              slot.pe !== undefined
                ? pixelHit(slot.pe, frameOf(slot.pe), px, py)
                : slot.occ === undefined
                  ? undefined
                  : slot.occ.hit(px, py);
            if (hit !== false) {
              coveredSlot = true;
              break;
            }
          }
          if (coveredSlot) {
            if (collect) covers.push(slot);
            else return true;
          }
        }
      }
    }
    return covers.length > 0;
  }

  /** Whether this scan should know which sprites cover `pe`: the reveal key holds, its unit is
   *  selected or the cursor rests within the fade's proximity of its anchor. */
  private fadesFor(pe: PooledEntity): boolean {
    const fade = this.fade;
    if (fade === undefined) return false;
    if (fade.held === true) return true;
    const ref = pe.bound.item?.ref;
    if (ref !== undefined && fade.selection?.has(ref) === true) return true;
    const pointer = fade.pointer;
    if (pointer === undefined) return false;
    const dx = pointer.x - pe.container.position.x;
    const dy = pointer.y - pe.container.position.y;
    return dx * dx + dy * dy <= OCCLUDER_FADE_PROXIMITY * OCCLUDER_FADE_PROXIMITY;
  }

  /** Fade every sprite that covered the last stamped unit, and note them for the restore. */
  private fadeCovers(): void {
    for (const slot of this.covers) {
      const pe = slot.pe;
      if (pe !== undefined) {
        if (!pe.container.destroyed) pe.container.alpha = OCCLUDER_FADE_ALPHA;
        this.fadedNowPes.add(pe);
      } else if (slot.occ?.setFade !== undefined) {
        slot.occ.setFade(OCCLUDER_FADE_ALPHA);
        this.fadedNowStatic.add(slot.occ);
      }
    }
    this.covers.length = 0;
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

  /** Show or mint `pe`'s stamps, tracking its body's placement; lay the rings when the body rebinds. */
  private stamp(pe: PooledEntity, viewMoved: boolean, zoom: number, marks: GhostMarks): void {
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
      this.container.addChild(stamp.container);
    }
    stamp.container.alpha = 1;
    stamp.container.position.copyFrom(pe.container.position);
    if (
      pe.bindSerial !== stamp.bindSerial ||
      viewMoved !== stamp.laidUnderMovedView ||
      zoom !== stamp.laidAtZoom ||
      marks.fill !== stamp.laidFill ||
      marks.ring !== stamp.laidRing
    )
      this.lay(pe, stamp, viewMoved, zoom, marks);
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
    // The ghost reads the colour the entity draws with; an owner change rebinds the body, which lays
    // the quads again.
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

function boxesOverlap(a: EntityBounds, b: EntityBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
