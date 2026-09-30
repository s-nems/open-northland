import type { SpriteDrawItem } from './draw-item.js';

/** Retains only the last visible order; a camera jump falls back to bounded merge work. */
export class SpriteDepthOrder {
  private readonly ranks = new Map<number, number>();
  private readonly scratch: (SpriteDrawItem | undefined)[] = [];
  // Numeric keys move with their object slots; buffers grow only when the visible count exceeds
  // capacity.
  private depths = new Float64Array(0);
  private refs = new Float64Array(0);
  private scratchDepths = new Float64Array(0);
  private scratchRefs = new Float64Array(0);

  sort(items: SpriteDrawItem[]): void {
    const n = items.length;
    this.reserve(n);
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
      this.ranks.clear();
      for (let i = 0; i < n; i++) {
        const item = items[i];
        if (item !== undefined) this.ranks.set(item.ref, i);
      }
      this.clearScratch(n);
      return;
    }
    let sameMembers = n === this.ranks.size;
    if (sameMembers) {
      for (let i = 0; i < n; i++) {
        const ref = this.refs[i] ?? 0;
        const rank = this.ranks.get(ref);
        if (rank === undefined) {
          sameMembers = false;
          break;
        }
        this.scratch[rank] = items[i];
        this.scratchDepths[rank] = this.depths[i] ?? 0;
        this.scratchRefs[rank] = ref;
      }
    }
    if (sameMembers) {
      for (let i = 0; i < n; i++) {
        const item = this.scratch[i];
        if (item !== undefined) items[i] = item;
        this.depths[i] = this.scratchDepths[i] ?? 0;
        this.refs[i] = this.scratchRefs[i] ?? 0;
      }
      // Ordinary motion crosses few neighbours. Teleports never turn this into quadratic work.
      let shifts = 0;
      const budget = n * Math.max(1, Math.ceil(Math.log2(n)));
      for (let i = 1; i < n; i++) {
        const item = items[i];
        if (item === undefined) continue;
        const depth = this.depths[i] ?? 0;
        const ref = this.refs[i] ?? 0;
        let j = i;
        while (j > 0) {
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
        if (shifts > budget) {
          this.merge(items);
          break;
        }
      }
    } else this.merge(items);
    if (!sameMembers) this.ranks.clear();
    for (let i = 0; i < n; i++) this.ranks.set(this.refs[i] ?? 0, i);
    this.clearScratch(n);
  }

  private reserve(n: number): void {
    if (n <= this.depths.length) return;
    const capacity = Math.max(n, this.depths.length * 2);
    this.depths = new Float64Array(capacity);
    this.refs = new Float64Array(capacity);
    this.scratchDepths = new Float64Array(capacity);
    this.scratchRefs = new Float64Array(capacity);
  }

  private clearScratch(n: number): void {
    this.scratch.length = n;
    for (let i = 0; i < n; i++) this.scratch[i] = undefined;
  }

  private merge(items: SpriteDrawItem[]): void {
    const n = items.length;
    for (let width = 1; width < n; width *= 2) {
      for (let start = 0; start < n; start += width * 2) {
        const mid = Math.min(n, start + width);
        const end = Math.min(n, mid + width);
        let left = start,
          right = mid;
        for (let i = start; i < end; i++) {
          const a = left < mid ? items[left] : undefined;
          const b = right < end ? items[right] : undefined;
          const leftDepth = this.depths[left] ?? 0;
          const rightDepth = this.depths[right] ?? 0;
          if (
            a !== undefined &&
            (b === undefined ||
              leftDepth < rightDepth ||
              (leftDepth === rightDepth && (this.refs[left] ?? 0) <= (this.refs[right] ?? 0)))
          ) {
            this.scratch[i] = a;
            this.scratchDepths[i] = leftDepth;
            this.scratchRefs[i] = this.refs[left] ?? 0;
            left++;
          } else if (b !== undefined) {
            this.scratch[i] = b;
            this.scratchDepths[i] = rightDepth;
            this.scratchRefs[i] = this.refs[right] ?? 0;
            right++;
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const item = this.scratch[i];
        if (item !== undefined) items[i] = item;
        this.depths[i] = this.scratchDepths[i] ?? 0;
        this.refs[i] = this.scratchRefs[i] ?? 0;
      }
    }
  }
}
