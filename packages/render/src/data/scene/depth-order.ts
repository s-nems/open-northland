import type { SpriteDrawItem } from './draw-item.js';
import { DrawList } from './draw-list.js';

/** Fresh members past which a membership change sorts them by merge rather than by insertion. */
const FRESH_INSERTION_LIMIT = 32;

/**
 * Sorts each frame's draw list by depth, then ref, starting from the last order: members it held keep
 * their old rank and settle by bounded insertion, members new to it are sorted apart and merged in, so
 * a few entities entering or leaving the view cost little. A camera jump falls back to merge work.
 */
export class SpriteDepthOrder {
  /** The list each build sorted here collects into, so its size carries across builds. */
  readonly list = new DrawList();
  /** The last order's rank of each member, exactly its members. */
  private readonly ranks = new Map<number, number>();
  /** The last order's refs by rank, to drop a departed member's rank. */
  private ranked = new Float64Array(0);
  private rankedCount = 0;
  /** Per last-order rank, whether this sort seated its member again. */
  private kept = new Uint8Array(0);
  /** Item slots by rank while seeding, then merge scratch; emptied after each sort so it holds no item
   *  past it. */
  private readonly scratch: (SpriteDrawItem | undefined)[] = [];
  // Numeric keys move with their object slots; buffers grow only when the visible count exceeds
  // capacity.
  private depths = new Float64Array(0);
  private refs = new Float64Array(0);
  private scratchDepths = new Float64Array(0);
  private scratchRefs = new Float64Array(0);

  sort(items: SpriteDrawItem[]): void {
    const n = items.length;
    this.reserve(Math.max(n, this.rankedCount));
    let finite = true;
    for (let i = 0; i < n; i++) {
      const item = items[i];
      if (item === undefined) continue;
      const depth = item.depth;
      const ref = item.ref;
      this.depths[i] = depth;
      this.refs[i] = ref;
      finite &&= Number.isFinite(depth) && Number.isFinite(ref);
    }
    if (!finite) {
      items.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
      for (let i = 0; i < n; i++) this.refs[i] = items[i]?.ref ?? 0;
      this.rank(n);
      return;
    }
    const held = this.seed(items);
    this.settle(items, 0, held);
    if (n - held > FRESH_INSERTION_LIMIT) this.mergeSort(items, held, n);
    else this.insert(items, held, n, Number.POSITIVE_INFINITY);
    this.mergeRuns(items, 0, held, n);
    this.rank(n);
  }

  /**
   * Move the members the last order held to the front in that order and the fresh ones behind them;
   * returns how many were held. Each held rank seats one item, so a repeated ref seeds as fresh.
   */
  private seed(items: SpriteDrawItem[]): number {
    const n = items.length;
    // Fresh items compact to the front first, never past the slot being read.
    let fresh = 0;
    for (let i = 0; i < n; i++) {
      const item = items[i];
      if (item === undefined) continue;
      const rank = this.ranks.get(this.refs[i] ?? 0);
      if (rank !== undefined && this.scratch[rank] === undefined) {
        this.scratch[rank] = item;
        this.scratchDepths[rank] = this.depths[i] ?? 0;
        this.scratchRefs[rank] = this.refs[i] ?? 0;
        this.kept[rank] = 1;
        continue;
      }
      items[fresh] = item;
      this.depths[fresh] = this.depths[i] ?? 0;
      this.refs[fresh] = this.refs[i] ?? 0;
      fresh++;
    }
    const held = n - fresh;
    for (let i = fresh - 1; i >= 0; i--) {
      const item = items[i];
      if (item === undefined) continue;
      items[held + i] = item;
      this.depths[held + i] = this.depths[i] ?? 0;
      this.refs[held + i] = this.refs[i] ?? 0;
    }
    let at = 0;
    for (let rank = 0; rank < this.rankedCount; rank++) {
      const item = this.scratch[rank];
      if (item === undefined) continue;
      this.scratch[rank] = undefined;
      items[at] = item;
      this.depths[at] = this.scratchDepths[rank] ?? 0;
      this.refs[at] = this.scratchRefs[rank] ?? 0;
      at++;
    }
    return held;
  }

  /** Settle a nearly sorted run by insertion; ordinary motion crosses few neighbours, and past a budget
   *  of shifts the run is merge-sorted, so a teleport never turns this into quadratic work. */
  private settle(items: SpriteDrawItem[], from: number, to: number): void {
    const count = to - from;
    const budget = count * Math.max(1, Math.ceil(Math.log2(Math.max(count, 1))));
    if (!this.insert(items, from, to, budget)) this.mergeSort(items, from, to);
  }

  /** Insertion-sort `[from, to)`; false once the shifts pass `budget`, leaving the run unsorted. */
  private insert(items: SpriteDrawItem[], from: number, to: number, budget: number): boolean {
    let shifts = 0;
    for (let i = from + 1; i < to; i++) {
      const item = items[i];
      if (item === undefined) continue;
      const depth = this.depths[i] ?? 0;
      const ref = this.refs[i] ?? 0;
      let j = i;
      while (j > from) {
        const previous = items[j - 1];
        const previousDepth = this.depths[j - 1] ?? 0;
        if (
          previous === undefined ||
          previousDepth < depth ||
          (previousDepth === depth && (this.refs[j - 1] ?? 0) <= ref)
        )
          break;
        items[j] = previous;
        this.depths[j] = previousDepth;
        this.refs[j] = this.refs[j - 1] ?? 0;
        j--;
        shifts++;
      }
      items[j] = item;
      this.depths[j] = depth;
      this.refs[j] = ref;
      if (shifts > budget) return false;
    }
    return true;
  }

  /** Bottom-up merge sort of `[from, to)`. */
  private mergeSort(items: SpriteDrawItem[], from: number, to: number): void {
    for (let width = 1; width < to - from; width *= 2) {
      for (let start = from; start < to; start += width * 2) {
        const mid = Math.min(to, start + width);
        this.mergeRuns(items, start, mid, Math.min(to, mid + width));
      }
    }
  }

  /** Merge the sorted runs `[from, mid)` and `[mid, to)` in place through the scratch buffers. */
  private mergeRuns(items: SpriteDrawItem[], from: number, mid: number, to: number): void {
    if (mid <= from || mid >= to) return;
    const lastLeft = mid - 1;
    // Already in order: the common case of a fresh member landing behind everything held.
    if (
      (this.depths[lastLeft] ?? 0) < (this.depths[mid] ?? 0) ||
      ((this.depths[lastLeft] ?? 0) === (this.depths[mid] ?? 0) &&
        (this.refs[lastLeft] ?? 0) <= (this.refs[mid] ?? 0))
    )
      return;
    let left = from;
    let right = mid;
    for (let i = from; i < to; i++) {
      const leftDepth = this.depths[left] ?? 0;
      const rightDepth = this.depths[right] ?? 0;
      const takeLeft =
        right >= to ||
        (left < mid &&
          (leftDepth < rightDepth ||
            (leftDepth === rightDepth && (this.refs[left] ?? 0) <= (this.refs[right] ?? 0))));
      const at = takeLeft ? left++ : right++;
      this.scratch[i] = items[at];
      this.scratchDepths[i] = this.depths[at] ?? 0;
      this.scratchRefs[i] = this.refs[at] ?? 0;
    }
    for (let i = from; i < to; i++) {
      const item = this.scratch[i];
      if (item !== undefined) items[i] = item;
      this.scratch[i] = undefined;
      this.depths[i] = this.scratchDepths[i] ?? 0;
      this.refs[i] = this.scratchRefs[i] ?? 0;
    }
  }

  /** Make the first `n` keyed refs the remembered order: departed members lose their rank, the rest
   *  take their new one. */
  private rank(n: number): void {
    for (let rank = 0; rank < this.rankedCount; rank++) {
      if (this.kept[rank] === 1) this.kept[rank] = 0;
      else this.ranks.delete(this.ranked[rank] ?? 0);
    }
    for (let i = 0; i < n; i++) {
      const ref = this.refs[i] ?? 0;
      this.ranks.set(ref, i);
      this.ranked[i] = ref;
    }
    this.rankedCount = n;
  }

  private reserve(n: number): void {
    if (n <= this.depths.length) return;
    const capacity = Math.max(n, this.depths.length * 2);
    const ranked = new Float64Array(capacity);
    ranked.set(this.ranked.subarray(0, this.rankedCount));
    this.ranked = ranked;
    this.kept = new Uint8Array(capacity);
    this.depths = new Float64Array(capacity);
    this.refs = new Float64Array(capacity);
    this.scratchDepths = new Float64Array(capacity);
    this.scratchRefs = new Float64Array(capacity);
  }
}
