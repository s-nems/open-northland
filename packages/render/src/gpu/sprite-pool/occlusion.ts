import { Container, Matrix, type Sprite } from 'pixi.js';
import { GLOW_PALETTE_INDEX } from '../../data/palettes/glow-colour.js';
import { createHumanPaletteColours, type HumanPaletteBook } from '../../data/palettes/human-palettes.js';
import type { SpriteDrawItem } from '../../data/scene/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { isShadowTexture } from '../pixel-art/registry.js';
import {
  CoverSprite,
  GhostOutlineSprite,
  SelectionGraphics,
  SelectionSprite,
} from '../selection/sprite-effect.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { worldBatched } from '../world-batch/batcher.js';
import { SELECTION_STAMP } from '../world-batch/shader.js';
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
const OCCLUDER_KINDS: ReadonlySet<SpriteDrawItem['kind']> = new Set([
  'building',
  'palisade',
  'signpost',
  'resource',
  'berrybush',
]);

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
/** World px a mark's box grows by before it claims covers, and that a cover's quad may stand out of its
 *  occluder's box and still be cut: slack for the rounding between the boxes and the quads they bound. */
const MARK_BOX_SLACK = 1;
/** Units of its own bounds, texels of its art, a cut cover keeps past the marks it clips. */
const COVER_CLIP_MARGIN = 1;
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
  /** The scan run {@link clip} was gathered in, and the world-px box of the marks that test this
   *  occluder's depth in that run: all of its copies a mark can read. */
  clipRun: number;
  readonly clip: MutableBox;
}

/** An occluder's copies in the ghosts' clip: one quad per art layer drawn this frame. */
interface CoverStamp {
  readonly container: Container;
  readonly quads: CoverSprite[];
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
  /** The box of every shown quad, in the container's space, as last laid. */
  readonly box: MutableBox;
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
  /** The slots this scan found in front of a unit, laid once every mark has claimed its part. */
  private readonly covering: OccluderSlot[] = [];
  /** The scan's unit candidates, flat. */
  private readonly unitPe: (PooledEntity | undefined)[] = [];
  private readonly unitDepth: number[] = [];
  private unitCount = 0;
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
  private readonly inverse = new Matrix();
  private readonly box: MutableBox = emptyBox();

  /**
   * Scan the painter-ordered draw list the pool just presented: fade the occluders when `revealAll`
   * asks, find the covered settlers and lay their `marks`. `frameOf` answers the frame id a pooled
   * entity's bounds are valid for, `viewMoved` re-lays the paletted layers a ring copies,
   * and `zoom` holds the ring's screen width. `staticOccluders` are the visible map objects, which the
   * pool's list never holds. The walkers of `wildlifeTribes` stay unghosted: a herd would fill the
   * overlay and tells the player nothing.
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
  ): void {
    this.run++;
    this.unitCount = 0;
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
    // Nothing probes the grid, so it stays as the last probing scan left it for the next eviction.
    const marking = marks.fill || marks.ring;
    if ((this.unitCount === 0 || !marking) && !revealAll) {
      this.restoreFades();
      this.sweep();
      return;
    }
    for (let o = 0; o < this.occluderCount; o++) {
      const pe = this.occluderPe[o];
      if (pe !== undefined) this.mark(pe, undefined, pe, this.occluderDepth[o] ?? 0, pe.bounds);
    }
    for (const occ of staticOccluders) this.mark(occ, occ, undefined, occ.depth, occ.bounds());
    // Before the eviction swaps this scan's marks away.
    if (revealAll) this.fadeAllMarked();
    this.evictUnmarked();
    for (let u = 0; marking && u < this.unitCount; u++) {
      const pe = this.unitPe[u];
      if (pe === undefined) continue;
      const depth = this.unitDepth[u] ?? 0;
      if (!this.coverUnit(pe, depth)) continue;
      const stamp = this.stamp(pe, depth, viewMoved, zoom, marks);
      if (stamp !== undefined) this.claimCovers(stamp, depth);
    }
    for (const slot of this.covering) this.layCover(slot);
    this.covering.length = 0;
    this.restoreFades();
    this.sweep();
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
      if (slot.run === this.run) continue;
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

  /** The slot entries across the grid's cells: the registered occluders, once per cell each touches. */
  get gridEntries(): number {
    let entries = 0;
    for (const cell of this.cellSlots.values()) entries += cell.length;
    return entries;
  }

  /** Free every stamp and the occluder grid and undo every fade; the overlay stays mounted. The pool
   *  calls this in the scan's place while nothing asks for one; a cleared overlay walks empty maps. */
  reset(): void {
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
   *  moved. An unchanged box keeps its cell entries from earlier runs, so an unchanged frame costs one
   *  depth stamp per occluder instead of a grid refill. */
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
        coverRun: -1,
        cover: undefined,
        clipRun: -1,
        clip: emptyBox(),
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
          if (slot.run !== this.run || slot.visited === run) continue;
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

  /**
   * Add `stamp`'s box to the clip of every occluder whose depth its marks can read: one nearer than the
   * unit, since a mark draws only over a nearer cover's depth and a farther cover never lowers the
   * depth below the unit's own. A cover is then cut to what its marks claimed.
   */
  private claimCovers(stamp: GhostStamp, depth: number): void {
    const local = stamp.box;
    if (local.minX > local.maxX) return;
    const { x, y } = stamp.container.position;
    const b = this.box;
    b.minX = local.minX + x - MARK_BOX_SLACK;
    b.minY = local.minY + y - MARK_BOX_SLACK;
    b.maxX = local.maxX + x + MARK_BOX_SLACK;
    b.maxY = local.maxY + y + MARK_BOX_SLACK;
    this.unitRun++;
    const run = this.unitRun;
    for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++) {
      for (let gy = Math.floor(b.minY / CELL); gy <= Math.floor(b.maxY / CELL); gy++) {
        const cell = this.cellSlots.get(cellKey(gx, gy));
        if (cell === undefined) continue;
        for (const slot of cell) {
          if (slot.run !== this.run || slot.visited === run) continue;
          slot.visited = run;
          if (slot.depth <= depth || !boxesOverlap(b, slot.bounds)) continue;
          if (slot.clipRun !== this.run) {
            slot.clipRun = this.run;
            clearBox(slot.clip);
          }
          growBox(slot.clip, b);
        }
      }
    }
  }

  /** Lay `slot`'s copies over its art as drawn this frame, one quad per layer that hides anything: a
   *  shadow and a layer the picker ignores hide nothing. */
  private layCover(slot: OccluderSlot): void {
    if (slot.clipRun !== this.run) {
      slot.clipRun = this.run;
      clearBox(slot.clip);
    }
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
        this.layCoverQuad(coverQuadAt(cover, count++), body, z, slot, cover.container);
      }
    } else {
      const body = slot.occ?.body();
      if (body !== undefined) this.layCoverQuad(coverQuadAt(cover, count++), body, z, slot, cover.container);
    }
    // A layer the art dropped takes its copy with it, for the same reason an unused cover dies.
    while (cover.quads.length > count) cover.quads.pop()?.destroy();
  }

  private layCoverQuad(
    quad: CoverSprite,
    body: Sprite,
    z: number,
    slot: OccluderSlot,
    container: Container,
  ): void {
    body.updateLocalTransform();
    quad.clipDepth = z;
    quad.texture = body.texture;
    const placed = frameTransform(this.transform, body.localTransform, body.anchor, body.texture);
    quad.setFromMatrix(placed);
    quad.alpha = this.clipCover(quad, placed, slot, container) ? 1 : 0;
  }

  /**
   * Cut `quad`, placed by `placed` in `container`, to the marks `slot` gathered; false when none can
   * read it, so it draws nothing. Depth is tested only on a mark's own pixels, so the picture keeps
   * every fragment it had. A quad standing out of the occluder's box, which the marks claimed by, stays
   * whole.
   */
  private clipCover(quad: CoverSprite, placed: Matrix, slot: OccluderSlot, container: Container): boolean {
    const { x, y } = container.position;
    const own = quad.visualBounds;
    const world = boxOfRect(this.box, placed, own.minX, own.minY, own.maxX, own.maxY);
    const within = slot.bounds;
    const bounded =
      world.minX + x >= within.minX - MARK_BOX_SLACK &&
      world.minY + y >= within.minY - MARK_BOX_SLACK &&
      world.maxX + x <= within.maxX + MARK_BOX_SLACK &&
      world.maxY + y <= within.maxY + MARK_BOX_SLACK;
    const clip = slot.clip;
    if (!bounded || placed.a * placed.d - placed.b * placed.c === 0) {
      quad.setClip(
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      );
      return true;
    }
    if (clip.minX > clip.maxX) return false;
    const inverse = this.inverse.copyFrom(placed).invert();
    const cut = boxOfRect(this.box, inverse, clip.minX - x, clip.minY - y, clip.maxX - x, clip.maxY - y);
    const minX = Math.max(own.minX, Math.floor(cut.minX) - COVER_CLIP_MARGIN);
    const minY = Math.max(own.minY, Math.floor(cut.minY) - COVER_CLIP_MARGIN);
    const maxX = Math.min(own.maxX, Math.ceil(cut.maxX) + COVER_CLIP_MARGIN);
    const maxY = Math.min(own.maxY, Math.ceil(cut.maxY) + COVER_CLIP_MARGIN);
    if (minX >= maxX || minY >= maxY) return false;
    quad.setClip(minX, minY, maxX, maxY);
    return true;
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
  private stamp(
    pe: PooledEntity,
    depth: number,
    viewMoved: boolean,
    zoom: number,
    marks: GhostMarks,
  ): GhostStamp | undefined {
    const ref = pe.bound.item?.ref;
    if (ref === undefined) return undefined;
    this.ghostedUnits.add(ref);
    let stamp = this.stamps.get(ref);
    if (stamp === undefined) {
      stamp = {
        container: new Container(),
        fills: [],
        rings: [],
        placeholder: undefined,
        box: emptyBox(),
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
    return stamp;
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
    const box = stamp.box;
    clearBox(box);
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
        growBox(box, boxOfQuad(this.box, this.transform, quad));
      }
      // Last: the ring grows the transform past the body.
      if (ring) {
        const quad = ringAt(stamp, rings++);
        quad.tint = tint;
        quad.alpha = body.alpha * GHOST_ALPHA;
        placeOutline(quad, body.texture, this.transform, this.textures, reach);
        // The ring's own quad: the body's grown by the reach, unless a flat transform hid it.
        if (quad.alpha > 0) growBox(box, boxOfQuad(this.box, this.transform, quad));
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
      const drawn = stamped.context.bounds;
      growBox(box, boxOfRect(this.box, this.transform, drawn.minX, drawn.minY, drawn.maxX, drawn.maxY));
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
function coverQuadAt(cover: CoverStamp, index: number): CoverSprite {
  const held = cover.quads[index];
  if (held !== undefined) return held;
  const quad = worldBatched(new CoverSprite());
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

interface MutableBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A box holding nothing: its minimum lies past its maximum until something grows it. */
function emptyBox(): MutableBox {
  return clearBox({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
}

function clearBox(box: MutableBox): MutableBox {
  box.minX = Number.POSITIVE_INFINITY;
  box.minY = Number.POSITIVE_INFINITY;
  box.maxX = Number.NEGATIVE_INFINITY;
  box.maxY = Number.NEGATIVE_INFINITY;
  return box;
}

function growBox(box: MutableBox, by: EntityBounds): void {
  if (by.minX < box.minX) box.minX = by.minX;
  if (by.minY < box.minY) box.minY = by.minY;
  if (by.maxX > box.maxX) box.maxX = by.maxX;
  if (by.maxY > box.maxY) box.maxY = by.maxY;
}

/** `out` set to the box of the rectangle `minX..maxY` after `m` places it. */
function boxOfRect(
  out: MutableBox,
  m: Matrix,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): MutableBox {
  const ax = m.a * minX;
  const bx = m.a * maxX;
  const cx = m.c * minY;
  const dx = m.c * maxY;
  const ay = m.b * minX;
  const by = m.b * maxX;
  const cy = m.d * minY;
  const dy = m.d * maxY;
  out.minX = Math.min(ax, bx) + Math.min(cx, dx) + m.tx;
  out.maxX = Math.max(ax, bx) + Math.max(cx, dx) + m.tx;
  out.minY = Math.min(ay, by) + Math.min(cy, dy) + m.ty;
  out.maxY = Math.max(ay, by) + Math.max(cy, dy) + m.ty;
  return out;
}

/** `out` set to the box `quad` covers when `placed` is the matrix it was laid from. */
function boxOfQuad(out: MutableBox, placed: Matrix, quad: Sprite): MutableBox {
  const own = quad.visualBounds;
  return boxOfRect(out, placed, own.minX, own.minY, own.maxX, own.maxY);
}

function boxesOverlap(a: EntityBounds, b: EntityBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
