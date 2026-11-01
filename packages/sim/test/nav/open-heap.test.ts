import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/index.js';
import { heapDecrease, heapPopRoot, heapPush, heapReplaceRoot } from '../../src/nav/pathfinding/open-heap.js';
import { INITIAL_HEAP_CAPACITY, type SearchScratch } from '../../src/nav/pathfinding/scratch.js';
import { type NodeId, StepGate } from '../../src/nav/terrain/index.js';

/** Enough nodes that the open set outgrows its first allocation twice. */
const NODE_COUNT = INITIAL_HEAP_CAPACITY * 3;
/** Small coprime moduli, so many nodes tie on f and the g, deviation and id tie-breaks all decide. */
const F_VALUES = 97;
const G_VALUES = 13;
const DEV_VALUES = 5;
/** Operations in the mixed run, and its seed. */
const MIXED_OPERATIONS = 20_000;
const MIXED_SEED = 11;
/** Largest drop a decrease applies to f and g alike, so h = f - g holds as in a search. */
const MAX_DECREASE = 8;

interface OpenKey {
  node: number;
  f: number;
  g: number;
  dev: number;
}

function before(a: OpenKey, b: OpenKey): number {
  return a.f - b.f || b.g - a.g || a.dev - b.dev || a.node - b.node;
}

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
    const keys: OpenKey[] = [];
    for (let node = 0; node < NODE_COUNT; node++) {
      const key = { node, f: (node * 31) % F_VALUES, g: (node * 7) % G_VALUES, dev: node % DEV_VALUES };
      keys.push(key);
      heapPush(s, node as NodeId, key.f, key.g, key.dev);
    }
    expect(s.heap.length).toBeGreaterThan(INITIAL_HEAP_CAPACITY);
    const expected = [...keys].sort(before).map((k) => k.node);
    const popped: number[] = [];
    while (s.heapSize > 0) {
      const root = s.heap[0] ?? -1;
      expect(s.heapIdx[root]).toBe(0);
      popped.push(root);
      heapPopRoot(s);
    }
    expect(popped).toEqual(expected);
  });

  it('keeps the reference minimum at the root through pushes, decreases, root replacements and pops', () => {
    const s = scratchOf(NODE_COUNT);
    const rng = new Rng(MIXED_SEED);
    const open = new Map<number, OpenKey>();
    let nextNode = 0;
    const fresh = (): OpenKey => ({
      node: nextNode++,
      f: rng.int(F_VALUES),
      g: rng.int(G_VALUES),
      dev: rng.int(DEV_VALUES),
    });
    for (let op = 0; op < MIXED_OPERATIONS; op++) {
      const kind = rng.int(4);
      const root = s.heap[0] ?? -1;
      if (kind === 0 && nextNode < NODE_COUNT) {
        const key = fresh();
        open.set(key.node, key);
        heapPush(s, key.node as NodeId, key.f, key.g, key.dev);
      } else if (kind === 1 && nextNode > 0) {
        const key = open.get(rng.int(nextNode));
        if (key !== undefined) {
          const drop = 1 + rng.int(MAX_DECREASE);
          key.f -= drop;
          key.g -= drop;
          heapDecrease(s, s.heapIdx[key.node] ?? -1, key.f, key.g);
        }
      } else if (kind === 2 && open.size > 0 && nextNode < NODE_COUNT) {
        open.delete(root);
        const key = fresh();
        open.set(key.node, key);
        heapReplaceRoot(s, key.node as NodeId, key.f, key.g, key.dev);
      } else if (kind === 3 && open.size > 0) {
        open.delete(root);
        heapPopRoot(s);
      }
      expect(s.heapSize).toBe(open.size);
      if (open.size === 0) continue;
      const least = [...open.values()].reduce((a, b) => (before(a, b) <= 0 ? a : b));
      expect(s.heap[0]).toBe(least.node);
      expect(s.heapIdx[least.node]).toBe(0);
    }
  });
});
