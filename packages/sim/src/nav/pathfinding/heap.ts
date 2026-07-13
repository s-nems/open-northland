/** A heap record stores its own index so decrease-key can restore the heap without a linear search. */
export interface IndexedHeapRecord {
  heapIdx: number;
}

/** Move `heap[start]` toward the root until its parent is no better. */
export function siftUp<T extends IndexedHeapRecord>(
  heap: T[],
  start: number,
  better: (a: T, b: T) => boolean,
): void {
  const record = heap[start];
  if (record === undefined) return;
  let index = start;
  while (index > 0) {
    const parentIndex = (index - 1) >> 1;
    const parent = heap[parentIndex];
    if (parent === undefined || !better(record, parent)) break;
    heap[index] = parent;
    parent.heapIdx = index;
    index = parentIndex;
  }
  heap[index] = record;
  record.heapIdx = index;
}

/** Move `heap[start]` toward the leaves until neither child beats it. */
export function siftDown<T extends IndexedHeapRecord>(
  heap: T[],
  start: number,
  better: (a: T, b: T) => boolean,
): void {
  const record = heap[start];
  if (record === undefined) return;
  const size = heap.length;
  let index = start;
  for (;;) {
    let childIndex = 2 * index + 1;
    if (childIndex >= size) break;
    let child = heap[childIndex];
    if (child === undefined) break;
    const right = childIndex + 1 < size ? heap[childIndex + 1] : undefined;
    if (right !== undefined && better(right, child)) {
      child = right;
      childIndex += 1;
    }
    if (!better(child, record)) break;
    heap[index] = child;
    child.heapIdx = index;
    index = childIndex;
  }
  heap[index] = record;
  record.heapIdx = index;
}
