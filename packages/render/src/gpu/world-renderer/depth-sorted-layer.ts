import {
  Container,
  type ContainerChild,
  type InstructionSet,
  type Renderer,
  type RenderLayer,
} from 'pixi.js';
import { rowOfDepth } from '../../data/scene/index.js';
import type { StillBandCollector } from '../still-mesh/still-mesh.js';

/** Painter-depth span one band holds, in world px of feet row (a row is 38): narrower bands rebuild
 *  fewer entries per change but each adds a render-group pass and a draw call. Chosen by measuring the
 *  instruction rebuild at the dense and the widest zoom. */
export const BAND_DEPTH = 32;

/** A band's place in painter order; a NaN depth files last. */
function bandIndexOf(depth: number): number {
  const index = Math.floor(depth / BAND_DEPTH);
  return Number.isNaN(index) ? Number.POSITIVE_INFINITY : index;
}

const ordinaryDepthChanged = Container.prototype.depthOfChildModified;

/** A child's depth write queues its band for sorting instead of Pixi's whole-group invalidation, and
 *  the child for the band its new depth files into. */
const bandDepthChanged: Container['depthOfChildModified'] = function (this: Container) {
  const band = this.parent;
  if (band instanceof DepthBand) band.layer.depthChanged(this, band);
  else ordinaryDepthChanged.call(this);
};

/** When a child last arrived in its layer, added or {@link DepthSortedLayer.rearrive}d, by the layer's
 *  arrival count. */
const ARRIVAL: unique symbol = Symbol('arrival');
type ArrivalHost = Container & { [ARRIVAL]?: number };

/** The tie key of a child that arrived before the running sort: below every arrival, so it keeps its
 *  place ahead of them and, by the merge's stability, among its own. */
const SETTLED = -1;

/** A child's order among children of one exact depth in a sort that began at arrival `sortFrom`: a
 *  settled child keeps its place, then this sort's arrivals follow in arrival order, as Pixi's stable
 *  sort orders children appended since its last sort. */
function tieOf(child: Container | undefined, sortFrom: number): number {
  const arrival = (child as ArrivalHost | undefined)?.[ARRIVAL] ?? SETTLED;
  return arrival >= sortFrom ? arrival : SETTLED;
}

/** Scratch the merge sort reuses across bands and frames. */
class SortScratch {
  entries: (Container | undefined)[] = [];
  depths = new Float64Array(0);
  merged = new Float64Array(0);
  ties = new Float64Array(0);
  mergedTies = new Float64Array(0);

  reserve(n: number): void {
    if (n <= this.depths.length) return;
    const capacity = Math.max(n, this.depths.length * 2);
    this.depths = new Float64Array(capacity);
    this.merged = new Float64Array(capacity);
    this.ties = new Float64Array(capacity);
    this.mergedTies = new Float64Array(capacity);
  }

  clear(n: number): void {
    this.entries.length = n;
    for (let i = 0; i < n; i++) this.entries[i] = undefined;
  }
}

/**
 * One painter-depth range of a {@link DepthSortedLayer}, its own Pixi render group: a structural change
 * inside it (a child added, removed, hidden, or reordered) rebuilds only this band's instructions.
 */
class DepthBand extends Container {
  index = 0;
  /** Children from here on were added since the last sort, in the order they arrived. */
  freshFrom = 0;
  /** Children at the front that rose into this band during the running sort. */
  risen = 0;

  constructor(readonly layer: DepthSortedLayer) {
    super();
    this.isRenderGroup = true;
    this.on('childAdded', (child) => {
      // Custom notifications keep their side effects and ordinary Pixi invalidation.
      if (child.depthOfChildModified === ordinaryDepthChanged) child.depthOfChildModified = bandDepthChanged;
    });
    this.on('childRemoved', (child, _band, index) => {
      if (child.depthOfChildModified === bandDepthChanged) child.depthOfChildModified = ordinaryDepthChanged;
      if (index < this.freshFrom) this.freshFrom--;
      // An emptied band retires at the next sort.
      if (this.children.length === 0) this.layer.queueSort(this);
    });
  }

  /** The layer's still mesh, when set, collects this band: its runs of pooled entries draw from the mesh. */
  override collectRenderablesSimple(
    instructionSet: InstructionSet,
    renderer: Renderer,
    layer: RenderLayer,
  ): void {
    if (this.layer.stills?.collectBand(this, instructionSet, renderer, layer) !== true)
      super.collectRenderablesSimple(instructionSet, renderer, layer);
  }

  /** Stable merge by depth, then by arrival since `sortFrom` (see {@link tieOf}); invalidates this band's
   *  instructions only when its painter order changed. */
  sortByDepth(scratch: SortScratch, sortFrom: number): void {
    const children = this.children;
    const n = children.length;
    scratch.reserve(n);
    const depths = scratch.depths;
    const ties = scratch.ties;
    for (let i = 0; i < n; i++) depths[i] = children[i]?.zIndex ?? 0;
    // Most sorts find the band in order: only neighbours of one exact depth need their arrivals read.
    let ordered = true;
    for (let i = 1; i < n && ordered; i++) {
      const da = depths[i - 1] ?? 0;
      const db = depths[i] ?? 0;
      ordered = da < db || (da === db && tieOf(children[i - 1], sortFrom) <= tieOf(children[i], sortFrom));
    }
    if (ordered) return;
    for (let i = 0; i < n; i++) ties[i] = tieOf(children[i], sortFrom);
    const before = (a: number, b: number): boolean => {
      const da = depths[a] ?? 0;
      const db = depths[b] ?? 0;
      return da < db || (da === db && (ties[a] ?? 0) <= (ties[b] ?? 0));
    };
    const entries = scratch.entries;
    const merged = scratch.merged;
    const mergedTies = scratch.mergedTies;
    // Stable merge preserves the order of settled children at one depth, as Pixi's stable sort does.
    for (let width = 1; width < n; width *= 2) {
      for (let start = 0; start < n; start += width * 2) {
        const mid = Math.min(n, start + width),
          end = Math.min(n, mid + width);
        let left = start,
          right = mid;
        for (let i = start; i < end; i++) {
          const takeLeft = left < mid && (right >= end || before(left, right));
          const from = takeLeft ? left++ : right++;
          entries[i] = children[from];
          merged[i] = depths[from] ?? 0;
          mergedTies[i] = ties[from] ?? 0;
        }
      }
      for (let i = 0; i < n; i++) {
        const child = entries[i];
        if (child !== undefined) children[i] = child;
        depths[i] = merged[i] ?? 0;
        ties[i] = mergedTies[i] ?? 0;
      }
    }
    scratch.clear(n);
    this.renderGroup.structureDidChange = true;
  }
}

/** The container `child` draws in: the layer of a depth band, else its parent. */
export function drawLayerOf(child: Container): Container | null {
  const parent = child.parent;
  return parent instanceof DepthBand ? parent.layer : parent;
}

/** A child leaving its band for the one its new depth files into. */
interface Migrant {
  readonly child: Container;
  readonly from: DepthBand;
  /** Its place among the band's children as it leaves. */
  readonly at: number;
  readonly fresh: boolean;
}

/**
 * The world's one depth-sorted layer. Children keep Pixi's stable painter order (ascending `zIndex`,
 * ties in arrival order) but live in contiguous depth bands, each its own render group, so a walker
 * crossing a row or a sprite toggling visibility rebuilds one band's instruction set, not the layer's.
 * `addChild` and `removeChild` take the entries themselves; `children` holds the bands.
 *
 * Undocumented Pixi behaviour, verified on pixi.js 8.21, re-verify on a bump: a zIndex write calls the
 * child's own `depthOfChildModified`, and a render group runs `onRender` hooks before it tests
 * `structureDidChange`.
 */
export class DepthSortedLayer extends Container {
  private readonly bands = new Map<number, DepthBand>();
  private readonly spareBands: DepthBand[] = [];
  private readonly unsorted = new Set<DepthBand>();
  /** Children whose depth left their band's range since the last sort, in the order they left; one may
   *  be listed twice, and may have come back or left the layer since. */
  private readonly leavers: Container[] = [];
  /** Arrivals so far; children that arrived since {@link sortFrom} order by it among equal depths. */
  private arrivalCount = 0;
  private sortFrom = 0;
  private readonly scratch = new SortScratch();
  /** Draws the pooled entries of each band from a retained mesh; absent, Pixi batches every entry. */
  stills: StillBandCollector | null = null;

  constructor() {
    super();
    // Every render sorts first, so a portrait or map-view pass draws the current painter order too.
    this.onRender = () => {
      this.sortChildren();
      this.stills?.beforeRender();
    };
  }

  override addChild<U extends ContainerChild[]>(...children: U): U[0] {
    for (const child of children) {
      if (child.parent instanceof DepthBand && child.parent.layer === this) child.parent.removeChild(child);
      const band = this.bandAt(bandIndexOf(child.zIndex));
      band.addChild(child);
      (child as ArrivalHost)[ARRIVAL] = this.arrivalCount++;
      this.queueSort(band);
    }
    // Pixi's contract: the first argument. Indexing a generic array cannot prove it exists.
    return children[0] as U[0];
  }

  /**
   * Paint `child`, a child of this layer, as if removed and added again: after every child of its exact
   * depth that arrived before, without the band rebuild a removal and an add cost.
   */
  rearrive(child: Container): void {
    const band = child.parent;
    if (!(band instanceof DepthBand) || band.layer !== this) return;
    (child as ArrivalHost)[ARRIVAL] = this.arrivalCount++;
    this.queueSort(band);
  }

  override removeChild<U extends ContainerChild[]>(...children: U): U[0] {
    for (const child of children) {
      const band = child.parent;
      if (band instanceof DepthBand && band.layer === this) band.removeChild(child);
    }
    return children[0] as U[0];
  }

  /**
   * Hide every shown band whose feet rows all lie outside `[minRow, maxRow]`, appending each to `hidden`
   * for `showBands`. A band hidden here changes this layer's short list of bands, never a band's own
   * instructions. A band no pass files (a key pinned above every row) stays shown.
   */
  hideBandsOutside(minRow: number, maxRow: number, hidden: Container[]): void {
    for (const band of this.children) {
      if (!(band instanceof DepthBand) || !band.visible) continue;
      const top = rowOfDepth(band.index * BAND_DEPTH);
      if (top === null || (top + BAND_DEPTH >= minRow && top <= maxRow)) continue;
      hidden.push(band);
      band.visible = false;
    }
  }

  /** Show the bands `hideBandsOutside` hid and empty the list. */
  showBands(hidden: Container[]): void {
    for (const band of hidden) band.visible = true;
    hidden.length = 0;
  }

  /** Every entry in painter order; allocates, for tests and tools rather than per-frame work. */
  entries(): Container[] {
    return this.children.flatMap((band) => band.children);
  }

  queueSort(band: DepthBand): void {
    this.unsorted.add(band);
    this.sortDirty = true;
  }

  /** `child` of `band` took a new depth: the band sorts, and the child moves if another band files it. */
  depthChanged(child: Container, band: DepthBand): void {
    this.queueSort(band);
    if (bandIndexOf(child.zIndex) !== band.index) this.leavers.push(child);
  }

  override sortChildren = (): void => {
    if (!this.sortDirty) return;
    const touched = [...this.unsorted].sort((a, b) => a.index - b.index);
    const migrants = this.takeMigrants();
    for (const migrant of migrants) this.settle(migrant, touched);
    for (const band of touched) {
      if (band.parent !== this) continue;
      if (band.children.length === 0) {
        this.retire(band);
        continue;
      }
      band.sortByDepth(this.scratch, this.sortFrom);
      band.freshFrom = band.children.length;
      band.risen = 0;
    }
    // The moves above re-queue the bands they touched, all of them sorted by now.
    this.unsorted.clear();
    this.sortDirty = false;
    this.sortFrom = this.arrivalCount;
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    for (const band of this.spareBands) band.destroy();
    this.spareBands.length = 0;
    this.stills?.destroy();
    this.stills = null;
    super.destroy(options);
  }

  /**
   * Lift out every child whose depth now files into another band, ascending by source band and by place
   * in it. Only a depth write moves a child out of its band's range, so the writes name the candidates;
   * a child with a depth notification of its own is not among them.
   */
  private takeMigrants(): Migrant[] {
    const migrants: Migrant[] = [];
    for (const child of this.leavers) {
      const band = child.parent;
      if (!(band instanceof DepthBand) || band.layer !== this) continue;
      if (bandIndexOf(child.zIndex) === band.index) continue;
      const at = band.children.indexOf(child);
      migrants.push({ child, from: band, at, fresh: at >= band.freshFrom });
    }
    this.leavers.length = 0;
    migrants.sort((p, q) => p.from.index - q.from.index || p.at - q.at);
    let kept = 0;
    for (const migrant of migrants) {
      // A child listed twice sorts next to itself.
      if (kept > 0 && migrants[kept - 1]?.child === migrant.child) continue;
      migrants[kept++] = migrant;
    }
    migrants.length = kept;
    for (const { child, from } of migrants) from.removeChild(child);
    return migrants;
  }

  /**
   * Place a migrant where Pixi's single stable sort would have it before sorting: one rising from a lower
   * band precedes everything already here, one falling from a higher band follows them but precedes
   * this frame's arrivals, and an arrival keeps its arrival order among the others.
   */
  private settle({ child, from, fresh }: Migrant, touched: DepthBand[]): void {
    const band = this.bandAt(bandIndexOf(child.zIndex));
    if (!touched.includes(band)) touched.push(band);
    if (fresh) {
      const seq = (child as ArrivalHost)[ARRIVAL] ?? this.arrivalCount;
      let at = band.freshFrom;
      while (at < band.children.length) {
        const other = band.children[at];
        if (other !== undefined && ((other as ArrivalHost)[ARRIVAL] ?? 0) > seq) break;
        at++;
      }
      band.addChildAt(child, at);
      return;
    }
    if (from.index < band.index) band.addChildAt(child, band.risen++);
    else band.addChildAt(child, band.freshFrom);
    band.freshFrom++;
  }

  private bandAt(index: number): DepthBand {
    const existing = this.bands.get(index);
    if (existing !== undefined) return existing;
    const band = this.spareBands.pop() ?? new DepthBand(this);
    band.index = index;
    band.freshFrom = 0;
    band.risen = 0;
    this.bands.set(index, band);
    let at = this.children.length;
    for (; at > 0; at--) {
      const before = this.children[at - 1];
      if (!(before instanceof DepthBand) || before.index < index) break;
    }
    super.addChildAt(band, at);
    return band;
  }

  private retire(band: DepthBand): void {
    this.bands.delete(band.index);
    super.removeChild(band);
    this.spareBands.push(band);
  }
}
