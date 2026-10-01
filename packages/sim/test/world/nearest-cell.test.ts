import { describe, expect, it } from 'vitest';
import { hexDistanceBetween } from '../../src/nav/halfcell.js';
import { type LandscapeProps, type NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { nearestCell, nearestHexCell } from '../../src/systems/spatial/metric.js';

const GRASS = 0;
const PROPS = new Map<number, LandscapeProps>([
  [GRASS, { walkable: true, buildable: true, plantable: true }],
]);
const SIDE = 12;
const CASES = 200;
const CANDIDATES_PER_CASE = 9;

/** A deterministic integer stream for the fixtures (a 32-bit LCG). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/** The winner as the contract states it: the least `(distance, id)` among the accepted candidates. */
function reference(
  candidates: readonly NodeId[],
  distance: (cell: NodeId) => number,
  accept: (cell: NodeId) => boolean,
): NodeId | null {
  const ranked = candidates.filter(accept).sort((a, b) => distance(a) - distance(b) || a - b);
  return ranked[0] ?? null;
}

describe('nearestCell and nearestHexCell', () => {
  const terrain = new TerrainGraph(SIDE, SIDE, new Int32Array(SIDE * SIDE).fill(GRASS), PROPS);
  const next = lcg(7);
  const cases = Array.from({ length: CASES }, () => ({
    from: (next() % terrain.nodeCount) as NodeId,
    candidates: Array.from({ length: CANDIDATES_PER_CASE }, () => (next() % terrain.nodeCount) as NodeId),
    rejected: new Set(
      Array.from({ length: CANDIDATES_PER_CASE }, () => (next() % terrain.nodeCount) as NodeId),
    ),
  }));
  const manhattan = (a: NodeId, b: NodeId) =>
    Math.abs(terrain.xOf(a) - terrain.xOf(b)) + Math.abs(terrain.yOf(a) - terrain.yOf(b));
  const hex = (a: NodeId, b: NodeId) =>
    hexDistanceBetween(terrain.xOf(a), terrain.yOf(a), terrain.xOf(b), terrain.yOf(b));

  it('pick the nearest accepted candidate, the least id on a tie', () => {
    for (const { from, candidates, rejected } of cases) {
      const accept = (cell: NodeId) => !rejected.has(cell);
      expect(nearestCell(terrain, candidates, from, accept)).toBe(
        reference(candidates, (c) => manhattan(c, from), accept),
      );
      expect(nearestHexCell(terrain, candidates, from, accept)).toBe(
        reference(candidates, (c) => hex(c, from), accept),
      );
    }
  });

  it('ask accept only of a candidate that would beat the best so far', () => {
    for (const { from, candidates, rejected } of cases) {
      const asked: NodeId[] = [];
      const accept = (cell: NodeId) => {
        asked.push(cell);
        return !rejected.has(cell);
      };
      nearestCell(terrain, candidates, from, accept);
      let best: { dist: number; cell: NodeId } | undefined;
      const expected: NodeId[] = [];
      for (const cell of candidates) {
        const dist = manhattan(cell, from);
        if (best !== undefined && (dist > best.dist || (dist === best.dist && cell >= best.cell))) continue;
        expected.push(cell);
        if (!rejected.has(cell)) best = { dist, cell };
      }
      expect(asked).toEqual(expected);
    }
  });
});
