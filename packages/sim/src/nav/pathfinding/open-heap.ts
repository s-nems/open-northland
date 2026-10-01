import type { NodeId } from '../terrain/index.js';
import type { SearchScratch } from './scratch.js';

/** The canonical open-set order (f, h, dev, node id), all ascending. Ending on the id makes it total, so
 *  the heap's minimum is unique and independent of the heap's internal layout. With f equal, the smaller
 *  h = f - g is the larger g. */
function better(s: SearchScratch, a: NodeId, b: NodeId): boolean {
  const fa = s.f[a] ?? 0;
  const fb = s.f[b] ?? 0;
  if (fa !== fb) return fa < fb;
  const ga = s.g[a] ?? 0;
  const gb = s.g[b] ?? 0;
  if (ga !== gb) return ga > gb;
  const devA = s.dev[a] ?? 0;
  const devB = s.dev[b] ?? 0;
  if (devA !== devB) return devA < devB;
  return a < b;
}

/** Move the node at `heap[start]` toward the root until its parent is no better. */
export function siftUp(s: SearchScratch, start: number): void {
  const { heap, heapIdx } = s;
  if (start >= s.heapSize) return;
  const node = (heap[start] ?? 0) as NodeId;
  let index = start;
  while (index > 0) {
    const parentIndex = (index - 1) >> 1;
    const parent = (heap[parentIndex] ?? 0) as NodeId;
    if (!better(s, node, parent)) break;
    heap[index] = parent;
    heapIdx[parent] = index;
    index = parentIndex;
  }
  heap[index] = node;
  heapIdx[node] = index;
}

/** Move the node at `heap[start]` toward the leaves until neither child beats it. */
export function siftDown(s: SearchScratch, start: number): void {
  const { heap, heapIdx } = s;
  if (start >= s.heapSize) return;
  const node = (heap[start] ?? 0) as NodeId;
  const size = s.heapSize;
  let index = start;
  for (;;) {
    let childIndex = 2 * index + 1;
    if (childIndex >= size) break;
    let child = (heap[childIndex] ?? 0) as NodeId;
    const right = childIndex + 1 < size ? ((heap[childIndex + 1] ?? 0) as NodeId) : undefined;
    if (right !== undefined && better(s, right, child)) {
      child = right;
      childIndex += 1;
    }
    if (!better(s, child, node)) break;
    heap[index] = child;
    heapIdx[child] = index;
    index = childIndex;
  }
  heap[index] = node;
  heapIdx[node] = index;
}
