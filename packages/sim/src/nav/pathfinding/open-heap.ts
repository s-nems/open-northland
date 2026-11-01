import type { NodeId } from '../terrain/index.js';
import type { SearchScratch } from './scratch.js';

/** Children per heap slot: slot `i`'s are `ARITY * i + 1` through `ARITY * i + ARITY`. Four halves the
 *  depth of a binary heap and keeps a slot's children adjacent; the total order makes the pop sequence the
 *  same at any arity. */
const ARITY_SHIFT = 2;
const ARITY = 1 << ARITY_SHIFT;

/** The canonical open-set order (f, h, dev, node id), all ascending. Ending on the id makes it total, so
 *  the heap's minimum is unique and independent of the heap's internal layout. With f equal, the smaller
 *  h = f - g is the larger g. */
function better(
  fa: number,
  ga: number,
  devA: number,
  a: number,
  fb: number,
  gb: number,
  devB: number,
  b: number,
) {
  if (fa !== fb) return fa < fb;
  if (ga !== gb) return ga > gb;
  if (devA !== devB) return devA < devB;
  return a < b;
}

/** Append `node` with its open keys and restore the heap order, doubling the heap when it is full. */
export function heapPush(s: SearchScratch, node: NodeId, f: number, g: number, dev: number): void {
  const index = s.heapSize;
  if (index === s.heap.length) growHeap(s);
  s.heap[index] = node;
  s.heapF[index] = f;
  s.heapG[index] = g;
  s.heapDev[index] = dev;
  s.heapSize += 1;
  siftUp(s, index);
}

/** Lower the keys of the open slot at `index` to `f` and `g`, which never raises it in the order. */
export function heapDecrease(s: SearchScratch, index: number, f: number, g: number): void {
  s.heapF[index] = f;
  s.heapG[index] = g;
  siftUp(s, index);
}

/** Remove the root, moving the last slot to the top. The caller has read the root's node. */
export function heapPopRoot(s: SearchScratch): void {
  s.heapSize -= 1;
  const last = s.heapSize;
  if (last === 0) return;
  s.heap[0] = s.heap[last] ?? 0;
  s.heapF[0] = s.heapF[last] ?? 0;
  s.heapG[0] = s.heapG[last] ?? 0;
  s.heapDev[0] = s.heapDev[last] ?? 0;
  siftDown(s, 0);
}

function growHeap(s: SearchScratch): void {
  const capacity = Math.min(s.heap.length * 2, s.heapIdx.length);
  const heap = new Int32Array(capacity);
  const heapF = new Float64Array(capacity);
  const heapG = new Float64Array(capacity);
  const heapDev = new Float64Array(capacity);
  heap.set(s.heap);
  heapF.set(s.heapF);
  heapG.set(s.heapG);
  heapDev.set(s.heapDev);
  s.heap = heap;
  s.heapF = heapF;
  s.heapG = heapG;
  s.heapDev = heapDev;
}

/** Move the slot at `heap[start]` toward the root until its parent is no better. */
function siftUp(s: SearchScratch, start: number): void {
  const { heap, heapF, heapG, heapDev, heapIdx } = s;
  if (start >= s.heapSize) return;
  const node = heap[start] ?? 0;
  const f = heapF[start] ?? 0;
  const g = heapG[start] ?? 0;
  const dev = heapDev[start] ?? 0;
  let index = start;
  while (index > 0) {
    const parentIndex = (index - 1) >> ARITY_SHIFT;
    const parent = heap[parentIndex] ?? 0;
    const parentF = heapF[parentIndex] ?? 0;
    const parentG = heapG[parentIndex] ?? 0;
    const parentDev = heapDev[parentIndex] ?? 0;
    if (!better(f, g, dev, node, parentF, parentG, parentDev, parent)) break;
    heap[index] = parent;
    heapF[index] = parentF;
    heapG[index] = parentG;
    heapDev[index] = parentDev;
    heapIdx[parent] = index;
    index = parentIndex;
  }
  heap[index] = node;
  heapF[index] = f;
  heapG[index] = g;
  heapDev[index] = dev;
  heapIdx[node] = index;
}

/** Move the slot at `heap[start]` toward the leaves until no child beats it. */
function siftDown(s: SearchScratch, start: number): void {
  const { heap, heapF, heapG, heapDev, heapIdx } = s;
  const size = s.heapSize;
  if (start >= size) return;
  const node = heap[start] ?? 0;
  const f = heapF[start] ?? 0;
  const g = heapG[start] ?? 0;
  const dev = heapDev[start] ?? 0;
  let index = start;
  for (;;) {
    const firstChild = ARITY * index + 1;
    if (firstChild >= size) break;
    let childIndex = firstChild;
    let child = heap[firstChild] ?? 0;
    let childF = heapF[firstChild] ?? 0;
    let childG = heapG[firstChild] ?? 0;
    let childDev = heapDev[firstChild] ?? 0;
    const lastChild = Math.min(firstChild + ARITY, size);
    for (let sibling = firstChild + 1; sibling < lastChild; sibling++) {
      const other = heap[sibling] ?? 0;
      const otherF = heapF[sibling] ?? 0;
      const otherG = heapG[sibling] ?? 0;
      const otherDev = heapDev[sibling] ?? 0;
      if (better(otherF, otherG, otherDev, other, childF, childG, childDev, child)) {
        child = other;
        childF = otherF;
        childG = otherG;
        childDev = otherDev;
        childIndex = sibling;
      }
    }
    if (!better(childF, childG, childDev, child, f, g, dev, node)) break;
    heap[index] = child;
    heapF[index] = childF;
    heapG[index] = childG;
    heapDev[index] = childDev;
    heapIdx[child] = index;
    index = childIndex;
  }
  heap[index] = node;
  heapF[index] = f;
  heapG[index] = g;
  heapDev[index] = dev;
  heapIdx[node] = index;
}
