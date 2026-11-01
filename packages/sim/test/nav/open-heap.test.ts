import { describe, expect, it } from 'vitest';
import { heapPopRoot, heapPush } from '../../src/nav/pathfinding/open-heap.js';
import { INITIAL_HEAP_CAPACITY, type SearchScratch } from '../../src/nav/pathfinding/scratch.js';
import { type NodeId, StepGate } from '../../src/nav/terrain/index.js';

/** Enough nodes that the open set outgrows its first allocation twice. */
const NODE_COUNT = INITIAL_HEAP_CAPACITY * 3;
/** Small coprime moduli, so many nodes tie on f and the g, deviation and id tie-breaks all decide. */
const F_VALUES = 97;
const G_VALUES = 13;
const DEV_VALUES = 5;

function scratchOf(nodeCount: number): SearchScratch {
  return {
    stamps: new Int32Array(nodeCount),
    g: new Float64Array(nodeCount),
    cameFrom: new Int32Array(nodeCount),
    heapIdx: new Int32Array(nodeCount),
    heap: new Int32Array(INITIAL_HEAP_CAPACITY),
    heapF: new Float64Array(INITIAL_HEAP_CAPACITY),
    heapG: new Float64Array(INITIAL_HEAP_CAPACITY),
    heapDev: new Float64Array(INITIAL_HEAP_CAPACITY),
    heapSize: 0,
    gate: new StepGate(),
    query: 0,
  };
}

describe('open heap', () => {
  it('pops in (f, -g, dev, id) order across growth', () => {
    const s = scratchOf(NODE_COUNT);
    const keys: Array<{ node: number; f: number; g: number; dev: number }> = [];
    for (let node = 0; node < NODE_COUNT; node++) {
      const key = { node, f: (node * 31) % F_VALUES, g: (node * 7) % G_VALUES, dev: node % DEV_VALUES };
      keys.push(key);
      heapPush(s, node as NodeId, key.f, key.g, key.dev);
    }
    expect(s.heap.length).toBeGreaterThan(INITIAL_HEAP_CAPACITY);
    const expected = [...keys]
      .sort((a, b) => a.f - b.f || b.g - a.g || a.dev - b.dev || a.node - b.node)
      .map((k) => k.node);
    const popped: number[] = [];
    while (s.heapSize > 0) {
      const root = s.heap[0] ?? -1;
      expect(s.heapIdx[root]).toBe(0);
      popped.push(root);
      heapPopRoot(s);
    }
    expect(popped).toEqual(expected);
  });
});
