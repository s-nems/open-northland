import { Container, Matrix, type Texture } from 'pixi.js';
import type { SpriteDrawItem } from '../../data/scene/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { SelectionGraphics, SelectionSprite } from '../selection/sprite-effect.js';
import { worldBatched } from '../world-batch/batcher.js';
import { SELECTION_STAMP } from '../world-batch/shader.js';
import { pixelHit } from './picking/pick.js';
import { pooledDepth } from './pooled-depth.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';
import { frameTransform } from './selection-effects.js';

/**
 * Occlusion ghosts: a settler a standing sprite hides shows as a translucent silhouette over that
 * sprite, so the player can follow people behind houses, walls and trees. The scan runs over the
 * painter-ordered draw list after each reconcile: a unit is ghosted when a later-drawn occluder's art
 * covers part of it, and the ghost draws as one `SELECTION_STAMP` quad per body layer in an overlay
 * above the sprite layer, so it shows through the cover without leaving its painter-order slot.
 *
 * Approximation, not observed original behaviour: the original's hidden-unit rendering has no readable
 * source here. The stamp colour, alpha and the coverage samples are tuned by eye; the occluder kinds
 * are the standing sprites tall enough to hide a person (delivery flags and loose heaps are not, and a
 * unit behind one stays plain). Vehicles are neither ghosted nor occluders: their paletted layers are
 * self-placing meshes the stamp quad cannot copy, so a cart behind a house stays hidden.
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
}

/** The kinds whose art can hide a unit standing behind it. */
const OCCLUDER_KINDS: ReadonlySet<SpriteDrawItem['kind']> = new Set([
  'building',
  'palisade',
  'signpost',
  'resource',
]);

/** The ghost's stamp colour and alpha over the cover. Approximation, tuned by eye for legibility. */
export const GHOST_TINT = 0xf0ede2;
export const GHOST_ALPHA = 0.4;

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
  /** One stamp quad per stamped body layer, grown on demand and hidden beyond the body's layer count. */
  readonly quads: SelectionSprite[];
  /** The placeholder's stamp, minted when an unbound body draws the marker instead of atlas layers. */
  placeholder: SelectionGraphics | undefined;
  /** The entity the stamps copy; a ref the pool freed destroys the stamp with it. */
  pe: PooledEntity;
  /** The bind the quads were laid from, and whether the camera had moved then: either changing lays
   *  them again, since a rebind re-resolves layers and a moved camera re-nudges paletted ones. */
  bindSerial: number;
  laidUnderMovedView: boolean;
}

/**
 * The occlusion ghost overlay and its per-frame scan. The renderer mounts {@link container} above the
 * sprite layer; the pool calls {@link scan} once per reconcile with the draw list it just presented.
 */
export class OcclusionGhosts {
  readonly container = new Container();

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
  /** Scratch for laying one stamp quad over its body layer. */
  private readonly transform = new Matrix();

  /**
   * Scan the painter-ordered draw list the pool just presented: collect the settlers and the standing
   * sprites, find the covered units and update their stamps. `frameOf` answers the frame id a pooled
   * entity's stamped bounds and pixels are valid for; `viewMoved` says the camera moved since the last
   * scan, which re-lays the paletted layers a stamp copies. `staticOccluders` carries the frame's
   * visible map-object candidates, whose drawn poses the pool's list never sees. `wildlifeTribes`
   * lists the animal tribes the sheet knows: their walkers draw behind trees like anyone else, but a
   * ghosted deer tells the player nothing and a herd would fill the overlay, so they stay unghosted.
   *
   * Depth throughout is the painter depth the shared entity layer sorts at - the pool's own
   * {@link pooledDepth} over the item being drawn and the entity's drawn motion, a static candidate's
   * own - never the scene item's oracle sort key, which lives on a different scale and would bury
   * every static tree behind a row's worth of key.
   */
  scan(
    items: readonly SpriteDrawItem[],
    pool: ReadonlyMap<number, PooledEntity>,
    frameOf: (pe: PooledEntity) => number,
    viewMoved: boolean,
    staticOccluders: readonly GhostOccluder[] = [],
    wildlifeTribes?: ReadonlySet<number>,
  ): void {
    this.run++;
    this.unitCount = 0;
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
      if (this.coveredUnit(pe, this.unitDepth[u] ?? 0, frameOf)) this.stamp(pe, viewMoved);
    }
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

  /** Free every stamp and the occluder grid; the overlay stays mounted. The pool calls this in the
   *  scan's place while the setting is off, and once it has cleared, each call walks empty maps. */
  reset(): void {
    for (const stamp of this.stamps.values()) stamp.container.destroy({ children: true });
    this.stamps.clear();
    this.clearGrid();
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

  /** Whether any standing sprite drawn in front of the unit covers sampled body points of it. */
  private coveredUnit(pe: PooledEntity, depth: number, frameOf: (pe: PooledEntity) => number): boolean {
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
            if (hit !== false) return true;
          }
        }
      }
    }
    return false;
  }

  /** Show or mint `pe`'s stamps, tracking its body's placement; lay the quads when the body rebinds. */
  private stamp(pe: PooledEntity, viewMoved: boolean): void {
    const ref = pe.bound.item?.ref;
    if (ref === undefined) return;
    this.ghostedUnits.add(ref);
    let stamp = this.stamps.get(ref);
    if (stamp === undefined) {
      stamp = {
        container: new Container(),
        quads: [],
        placeholder: undefined,
        pe,
        bindSerial: -1,
        laidUnderMovedView: !viewMoved,
      };
      this.stamps.set(ref, stamp);
      this.container.addChild(stamp.container);
    }
    stamp.container.alpha = 1;
    stamp.container.position.copyFrom(pe.container.position);
    if (pe.bindSerial !== stamp.bindSerial || viewMoved !== stamp.laidUnderMovedView)
      this.lay(pe, stamp, viewMoved);
  }

  /** Lay one stamp quad per stamped body layer, each over its body's placement and share of the alpha. */
  private lay(pe: PooledEntity, stamp: GhostStamp, viewMoved: boolean): void {
    stamp.bindSerial = pe.bindSerial;
    stamp.laidUnderMovedView = viewMoved;
    let count = 0;
    for (let i = 0; i < pe.sprites.length; i++) {
      const body = pe.sprites[i];
      // A vehicle's hull meshes place themselves per camera, which a copied quad cannot follow; a
      // settler never binds one.
      if (body === undefined || !body.visible || body.alpha <= 0 || body instanceof PalettedSprite) continue;
      if ('glow' in body && body.glow === true) continue;
      if (!pe.paletted && pe.pickExempt[i] === true) continue;
      const texture = body.texture;
      body.updateLocalTransform();
      frameTransform(this.transform, body.localTransform, body.anchor, texture);
      const quad = quadAt(stamp, count++);
      quad.tint = GHOST_TINT;
      quad.alpha = body.alpha * GHOST_ALPHA;
      quad.texture = texture;
      quad.setFromMatrix(this.transform);
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
      stamped.alpha = pe.placeholder.alpha * GHOST_ALPHA;
      stamped.setFromMatrix(this.transform.copyFrom(pe.placeholder.localTransform));
      marker = true;
    }
    for (let i = count; i < stamp.quads.length; i++) {
      const quad = stamp.quads[i];
      if (quad !== undefined) hideQuad(quad);
    }
    if (stamp.placeholder !== undefined && !marker) stamp.placeholder.alpha = 0;
  }
}

/** The stamp quad at `index` of `stamp`, minted over whatever stood there. */
function quadAt(stamp: GhostStamp, index: number): SelectionSprite {
  const held = stamp.quads[index];
  if (held !== undefined) return held;
  const quad = worldBatched(new SelectionSprite());
  quad.selectionEffect = SELECTION_STAMP;
  stamp.quads[index] = quad;
  stamp.container.addChild(quad);
  return quad;
}

/** Retire a stamp quad in place: zero alpha repacks without rebuilding the batch's instructions. The
 *  quad keeps its texture: swapping to {@link Texture.EMPTY} names a page the batch does not hold, so
 *  a full batch would rebuild the render group's whole instruction set on every hide and re-show. */
function hideQuad(quad: SelectionSprite): void {
  quad.alpha = 0;
}

/** Hide a whole stamp set the same way. */
function hideStamp(stamp: GhostStamp): void {
  stamp.container.alpha = 0;
  for (const quad of stamp.quads) if (quad !== undefined) hideQuad(quad);
  if (stamp.placeholder !== undefined) stamp.placeholder.alpha = 0;
}

function boxesOverlap(a: EntityBounds, b: EntityBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
