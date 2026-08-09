/**
 * Priority queue reproducing libc++'s `std::priority_queue` element order exactly, including the
 * pop order of tie groups: push is a plain sift-up, pop is Floyd's sift-down (walk the hole to a
 * leaf along the larger children) followed by a sift-up fixup of the relocated tail element. The
 * interpreter's event order was proven against that implementation, so the tie behavior is part
 * of its contract.
 */
export class LibcxxPriorityQueue<T> {
  private readonly heap: T[] = [];

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.heap.length;
  }

  top(): T | undefined {
    return this.heap[0];
  }

  push(value: T): void {
    this.heap.push(value);
    this.siftUp(this.heap.length);
  }

  pop(): void {
    const h = this.heap;
    const len = h.length;
    if (len > 1) {
      const top = h[0] as T;
      let hole = 0;
      let childI = 0;
      let child = 0;
      for (;;) {
        childI += child + 1;
        child = 2 * child + 1;
        if (child + 1 < len && this.less(h[childI] as T, h[childI + 1] as T)) {
          childI++;
          child++;
        }
        h[hole] = h[childI] as T;
        hole = childI;
        if (child > Math.floor((len - 2) / 2)) break;
      }
      const last = len - 1;
      if (hole === last) {
        h[hole] = top;
      } else {
        h[hole] = h[last] as T;
        h[last] = top;
        this.siftUp(hole + 1);
      }
    }
    h.pop();
  }

  /** Bubbles the element at slot `len - 1` toward the root within the first `len` slots. */
  private siftUp(len: number): void {
    const h = this.heap;
    if (len <= 1) return;
    let parent = Math.floor((len - 2) / 2);
    let hole = len - 1;
    if (!this.less(h[parent] as T, h[hole] as T)) return;
    const value = h[hole] as T;
    for (;;) {
      h[hole] = h[parent] as T;
      hole = parent;
      if (parent === 0) break;
      parent = Math.floor((parent - 1) / 2);
      if (!this.less(h[parent] as T, value)) break;
    }
    h[hole] = value;
  }
}
