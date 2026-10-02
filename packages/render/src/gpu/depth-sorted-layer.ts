import { Container, type ContainerChild } from 'pixi.js';

/** Painter-depth span one band holds, in world px of feet row (a row is 38): narrower bands rebuild
 *  fewer entries per change but each adds a render-group pass and a draw call. Chosen by measuring the
 *  instruction rebuild at the dense and the widest zoom. */
const BAND_DEPTH = 32;

/** A band's place in painter order; a NaN depth files last. */
function bandIndexOf(depth: number): number {
  const index = Math.floor(depth / BAND_DEPTH);
  return Number.isNaN(index) ? Number.POSITIVE_INFINITY : index;
}

const ordinaryDepthChanged = Container.prototype.depthOfChildModified;

/** A child's depth write queues its band for sorting instead of Pixi's whole-group invalidation. */
const bandDepthChanged: Container['depthOfChildModified'] = function (this: Container) {
  const band = this.parent;
  if (band instanceof DepthBand) band.layer.queueSort(band);
  else ordinaryDepthChanged.call(this);
};

/** Scratch the merge sort reuses across bands and frames. */
class SortScratch {
  entries: (Container | undefined)[] = [];
  depths = new Float64Array(0);
  merged = new Float64Array(0);

  reserve(n: number): void {
    if (n <= this.depths.length) return;
    const capacity = Math.max(n, this.depths.length * 2);
    this.depths = new Float64Array(capacity);
    this.merged = new Float64Array(capacity);
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

  /** Stable merge by depth; invalidates this band's instructions only when its painter order changed. */
  sortByDepth(scratch: SortScratch): void {
    const children = this.children;
    const n = children.length;
    scratch.reserve(n);
    const depths = scratch.depths;
    for (let i = 0; i < n; i++) depths[i] = children[i]?.zIndex ?? 0;
    let ordered = true;
    for (let i = 1; i < n && ordered; i++) ordered = (depths[i - 1] ?? 0) <= (depths[i] ?? 0);
    if (ordered) return;
    const entries = scratch.entries;
    const merged = scratch.merged;
    // Stable merge preserves insertion order at identical depths, as Pixi's stable sort does.
    for (let width = 1; width < n; width *= 2) {
      for (let start = 0; start < n; start += width * 2) {
        const mid = Math.min(n, start + width),
          end = Math.min(n, mid + width);
        let left = start,
          right = mid;
        for (let i = start; i < end; i++) {
          const takeLeft = left < mid && (right >= end || (depths[left] ?? 0) <= (depths[right] ?? 0));
          const from = takeLeft ? left++ : right++;
          entries[i] = children[from];
          merged[i] = depths[from] ?? 0;
        }
      }
      for (let i = 0; i < n; i++) {
        const child = entries[i];
        if (child !== undefined) children[i] = child;
        depths[i] = merged[i] ?? 0;
      }
    }
    scratch.clear(n);
    this.renderGroup.structureDidChange = true;
  }
}

/** A child leaving its band for the one its new depth files into. */
interface Migrant {
  readonly child: Container;
  readonly from: DepthBand;
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
  /** Arrival order of the children added since the last sort, for a fresh child changing band. */
  private readonly arrivals = new Map<Container, number>();
  private arrivalCount = 0;
  private readonly scratch = new SortScratch();

  constructor() {
    super();
    // Every render sorts first, so a portrait or map-view pass draws the current painter order too.
    this.onRender = () => this.sortChildren();
  }

  override addChild<U extends ContainerChild[]>(...children: U): U[0] {
    for (const child of children) {
      if (child.parent instanceof DepthBand && child.parent.layer === this) child.parent.removeChild(child);
      const band = this.bandAt(bandIndexOf(child.zIndex));
      band.addChild(child);
      this.arrivals.set(child, this.arrivalCount++);
      this.queueSort(band);
    }
    // Pixi's contract: the first argument. Indexing a generic array cannot prove it exists.
    return children[0] as U[0];
  }

  override removeChild<U extends ContainerChild[]>(...children: U): U[0] {
    for (const child of children) {
      const band = child.parent;
      if (band instanceof DepthBand && band.layer === this) band.removeChild(child);
    }
    return children[0] as U[0];
  }

  /** Every entry in painter order; allocates, for tests and tools rather than per-frame work. */
  entries(): Container[] {
    return this.children.flatMap((band) => band.children);
  }

  queueSort(band: DepthBand): void {
    this.unsorted.add(band);
    this.sortDirty = true;
  }

  override sortChildren = (): void => {
    if (!this.sortDirty) return;
    const touched = [...this.unsorted].sort((a, b) => a.index - b.index);
    const migrants = this.takeMigrants(touched);
    for (const migrant of migrants) this.settle(migrant, touched);
    for (const band of touched) {
      if (band.parent !== this) continue;
      if (band.children.length === 0) {
        this.retire(band);
        continue;
      }
      band.sortByDepth(this.scratch);
      band.freshFrom = band.children.length;
      band.risen = 0;
    }
    // The moves above re-queue the bands they touched, all of them sorted by now.
    this.unsorted.clear();
    this.sortDirty = false;
    this.arrivals.clear();
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    for (const band of this.spareBands) band.destroy();
    this.spareBands.length = 0;
    super.destroy(options);
  }

  /** Lift out every child whose depth now files into another band, ascending by source band. */
  private takeMigrants(touched: readonly DepthBand[]): Migrant[] {
    const migrants: Migrant[] = [];
    for (const band of touched) {
      const children = band.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child === undefined || bandIndexOf(child.zIndex) === band.index) continue;
        migrants.push({ child, from: band, fresh: i >= band.freshFrom });
      }
    }
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
      const seq = this.arrivals.get(child) ?? this.arrivalCount;
      let at = band.freshFrom;
      while (at < band.children.length) {
        const other = band.children[at];
        if (other !== undefined && (this.arrivals.get(other) ?? 0) > seq) break;
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
