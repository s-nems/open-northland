import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/world.js';
import { findPath, Simulation } from '../../src/index.js';
import type { BlockOverlay } from '../../src/nav/block-overlay.js';
import type { SearchStats } from '../../src/nav/pathfinding/index.js';
import { scratchFor } from '../../src/nav/pathfinding/scratch.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { ROUTE_MEMO_TICKS, type RouteMemo, routeMemoOf } from '../../src/systems/movement/route-memo.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const SIZE = 40;
const WALL_X = 20;
const GAP_Y = 30;
const PLAYER = 0;
const OTHER_PLAYER = 1;
const TICK = 100;

class SetOverlay implements BlockOverlay {
  readonly nodes = new Set<NodeId>();
  has(node: NodeId): boolean {
    return this.nodes.has(node);
  }
  get size(): number {
    return this.nodes.size;
  }
}

interface Fixture {
  sim: Simulation;
  terrain: TerrainGraph;
  memo: RouteMemo;
  walker: Entity;
  blocked: SetOverlay;
  start: NodeId;
  goal: NodeId;
}

/** A grass map split by a wall with one gap, so a route bends through it. */
function fixture(): Fixture {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(SIZE, SIZE) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const blocked = new SetOverlay();
  for (let y = 0; y < SIZE; y++) if (y !== GAP_Y) blocked.nodes.add(terrain.nodeAt(WALL_X, y));
  return {
    sim,
    terrain,
    memo: routeMemoOf(sim.world, terrain),
    walker: sim.world.create(),
    blocked,
    start: terrain.nodeAt(2, 2),
    goal: terrain.nodeAt(SIZE - 3, 2),
  };
}

function route(f: Fixture, tick: number, player = PLAYER): { path: NodeId[] | null; explored: number } {
  const stats: SearchStats = { explored: 0 };
  const path = f.memo.route(f.walker, tick, f.start, f.goal, player, f.blocked, stats);
  return { path, explored: stats.explored };
}

function fresh(f: Fixture): { path: NodeId[] | null; explored: number } {
  const stats: SearchStats = { explored: 0 };
  return { path: findPath(f.terrain, f.start, f.goal, f.blocked, stats), explored: stats.explored };
}

const searches = (f: Fixture): number => scratchFor(f.terrain, 'forward').query;

describe('route memo', () => {
  it('serves a repeat whose asked nodes answer alike, charging the settles without a search', () => {
    const f = fixture();
    const first = route(f, TICK);
    expect(first).toEqual(fresh(f));
    expect(first.explored).toBeGreaterThan(0);
    // A block nowhere near the route's search leaves every asked node's answer as it was.
    f.blocked.nodes.add(f.terrain.nodeAt(2, SIZE - 1));
    const before = searches(f);
    expect(route(f, TICK + 1)).toEqual(first);
    expect(searches(f)).toBe(before);
  });

  it('searches again when a node the search asked flips, and matches a fresh search', () => {
    const f = fixture();
    route(f, TICK);
    f.blocked.nodes.add(f.terrain.nodeAt(WALL_X, GAP_Y));
    f.blocked.nodes.delete(f.terrain.nodeAt(WALL_X, GAP_Y - 1));
    const before = searches(f);
    const again = route(f, TICK + 1);
    expect(searches(f)).toBeGreaterThan(before);
    expect(again).toEqual(fresh(f));
  });

  it('searches again for another view, another goal, or after the window', () => {
    const f = fixture();
    route(f, TICK);
    let before = searches(f);
    route(f, TICK + 1, OTHER_PLAYER);
    expect(searches(f)).toBeGreaterThan(before);
    f.memo.expire(TICK + 2 + ROUTE_MEMO_TICKS);
    before = searches(f);
    route(f, TICK + 2 + ROUTE_MEMO_TICKS, OTHER_PLAYER);
    expect(searches(f)).toBeGreaterThan(before);
  });

  it('verifies that every held route replays its search, and reports one that does not', () => {
    const f = fixture();
    route(f, TICK);
    expect(f.sim.world.verifyCaches()).toEqual([]);
    const entries = (f.memo as unknown as { entries: Map<Entity, { path: NodeId[] }> }).entries;
    const held = entries.get(f.walker);
    if (held === undefined) throw new Error('route not held');
    held.path = held.path.slice(1);
    expect(f.sim.world.verifyCaches()).toContain(
      `routeMemo entry for entity ${f.walker} does not replay its search`,
    );
  });
});
