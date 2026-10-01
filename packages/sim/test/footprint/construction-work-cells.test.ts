import type { FootprintCell } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Palisade, Position } from '../../src/components/index.js';
import { fx, positionOfNode } from '../../src/index.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { translatedCells } from '../../src/systems/footprint/geometry.js';
import { constructionWorkCells } from '../../src/systems/footprint/interaction.js';
import { ctxOf, grassMap, mappedSim, terrainOf } from './resource-footprint/support.js';

const CASES = 300;
const BODY_REACH = 4;
const BODY_CELLS = 14;
const BLOCKED_CELLS = 10;
const MAP_CELLS = 12;

/** A deterministic integer stream for the fixtures (a 32-bit LCG). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/** The contract by plain sets: walkable unblocked cells reachable from the body's margin inside its
 *  one-node box, kept where they touch the body, ascending. */
function reference(
  terrain: TerrainGraph,
  bodyCells: readonly NodeId[],
  blocked: ReadonlySet<NodeId>,
): NodeId[] {
  const body = new Set(bodyCells);
  const xs = bodyCells.map((c) => terrain.xOf(c));
  const ys = bodyCells.map((c) => terrain.yOf(c));
  const [bx0, bx1, by0, by1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [x0, x1] = [Math.max(0, bx0 - 1), Math.min(terrain.width - 1, bx1 + 1)];
  const [y0, y1] = [Math.max(0, by0 - 1), Math.min(terrain.height - 1, by1 + 1)];
  const open = (x: number, y: number) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cell = terrain.nodeAt(x, y);
    return !body.has(cell) && !blocked.has(cell) && terrain.isWalkable(cell);
  };
  const exterior = new Set<NodeId>();
  const queue: Array<[number, number]> = [];
  const visit = (x: number, y: number) => {
    if (!open(x, y) || exterior.has(terrain.nodeAt(x, y))) return;
    exterior.add(terrain.nodeAt(x, y));
    queue.push([x, y]);
  };
  if (by0 > 0) for (let x = x0; x <= x1; x++) visit(x, y0);
  if (by1 < terrain.height - 1) for (let x = x0; x <= x1; x++) visit(x, y1);
  if (bx0 > 0) for (let y = y0; y <= y1; y++) visit(x0, y);
  if (bx1 < terrain.width - 1) for (let y = y0; y <= y1; y++) visit(x1, y);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i] as [number, number];
    visit(x, y - 1);
    visit(x + 1, y);
    visit(x, y + 1);
    visit(x - 1, y);
  }
  const work = new Set<NodeId>();
  for (const cell of body) {
    for (const n of terrain.walkableNeighbours(cell)) if (exterior.has(n)) work.add(n);
  }
  return [...work].sort((a, b) => a - b);
}

describe('constructionWorkCells', () => {
  it('lists the body-adjacent exterior cells, ascending, for random bodies, holes and edges', () => {
    const sim = mappedSim(grassMap(MAP_CELLS, MAP_CELLS));
    const terrain = terrainOf(sim);
    const next = lcg(11);
    const span = 2 * BODY_REACH + 1;
    for (let i = 0; i < CASES; i++) {
      const ax = next() % terrain.width;
      const ay = next() % terrain.height;
      const walk: FootprintCell[] = Array.from({ length: 1 + (next() % BODY_CELLS) }, () => ({
        dx: (next() % span) - BODY_REACH,
        dy: (next() % span) - BODY_REACH,
      }));
      const blocked = new Set(
        Array.from({ length: next() % BLOCKED_CELLS }, () => (next() % terrain.nodeCount) as NodeId),
      );
      const site = sim.world.create();
      sim.world.add(site, Position, positionOfNode(ax, ay));
      sim.world.add(site, Palisade, {
        gfxIndex: 0,
        tribe: 0,
        built: fx.fromInt(0),
        walk,
        placementWalk: walk,
        construction: [],
        repairPerStrike: 0,
        reservation: null,
        gate: null,
      });
      const body = translatedCells(terrain, walk, ax, ay);
      if (body.length === 0) body.push(terrain.nodeAtClamped(ax, ay));
      expect(constructionWorkCells(sim.world, ctxOf(sim), terrain, site, blocked)).toEqual(
        reference(terrain, body, blocked),
      );
      sim.world.destroy(site);
    }
  });
});
