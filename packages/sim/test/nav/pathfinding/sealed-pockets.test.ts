import { describe, expect, it, vi } from 'vitest';
import { buildTerrainGraph, findPath, type NodeId, Rng, type TerrainGraph } from '../../../src/index.js';
import {
  POCKET_PROBE_MAX_EXPLORED,
  RACE_SLICE_EXPLORED,
  SealedPockets,
  type SearchStats,
} from '../../../src/nav/pathfinding/index.js';
import { testContent } from '../../fixtures/content.js';

/** Counts the searches `SealedPockets` runs, so a refusal it proves without one shows. */
const searches = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../../src/nav/pathfinding/find-path.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/nav/pathfinding/find-path.js')>();
  return {
    ...real,
    findPath: (...args: Parameters<typeof real.findPath>): ReturnType<typeof real.findPath> => {
      searches.count += 1;
      return real.findPath(...args);
    },
  };
});

const GRASS = 0;
const SIZE = 120;
/** A walled square whose interior holds well over the pocket probe's settle cap. */
const WALL_FROM = 70;
const WALL_TO = 100;
const ROUNDS = 40;
/** Bodies shuffled inside the walls each round, so every repeat floods another pocket. */
const BODIES = 12;
const SEED = 7;

function open(): TerrainGraph {
  return buildTerrainGraph(testContent(), {
    resolution: 'half-cell',
    width: SIZE,
    height: SIZE,
    typeIds: new Array<number>(SIZE * SIZE).fill(GRASS),
  });
}

function walls(terrain: TerrainGraph): Set<NodeId> {
  const blocked = new Set<NodeId>();
  for (let i = WALL_FROM; i <= WALL_TO; i++) {
    blocked.add(terrain.nodeAt(i, WALL_FROM));
    blocked.add(terrain.nodeAt(i, WALL_TO));
    blocked.add(terrain.nodeAt(WALL_FROM, i));
    blocked.add(terrain.nodeAt(WALL_TO, i));
  }
  return blocked;
}

function inside(rng: Rng, terrain: TerrainGraph): NodeId {
  const span = WALL_TO - WALL_FROM - 1;
  return terrain.nodeAt(WALL_FROM + 1 + rng.int(span), WALL_FROM + 1 + rng.int(span));
}

/** Whether more nodes than the pocket probe settles are reachable from `goal`: findPath's `goalOpen`. */
function outgrowsProbe(terrain: TerrainGraph, goal: NodeId, blocked: Set<NodeId>): boolean {
  const seen = new Set<NodeId>([goal]);
  const queue = [goal];
  for (const node of queue) {
    if (seen.size > POCKET_PROBE_MAX_EXPLORED) return true;
    for (const step of terrain.steps(node, blocked)) {
      if (seen.has(step.node)) continue;
      seen.add(step.node);
      queue.push(step.node);
    }
  }
  return false;
}

describe('SealedPockets', () => {
  it('answers every request as findPath does, settle count included, while the walls hold or open', () => {
    const terrain = open();
    const pockets = new SealedPockets(terrain);
    const rng = new Rng(SEED);
    const wall = walls(terrain);
    const gate = terrain.nodeAt(WALL_FROM, (WALL_FROM + WALL_TO) >> 1);
    let provedWithoutSearch = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const blocked = new Set(wall);
      for (let i = 0; i < BODIES; i++) blocked.add(inside(rng, terrain));
      // The gate stands open for a few rounds mid-run, and some walkers ask from inside the walls.
      if (round > ROUNDS / 2 && round < ROUNDS / 2 + 4) blocked.delete(gate);
      const start =
        round % 5 === 4 ? inside(rng, terrain) : terrain.nodeAt(rng.int(WALL_FROM - 1), rng.int(SIZE));
      const goal = inside(rng, terrain);
      const expected: SearchStats = { explored: 0 };
      const held: SearchStats = { explored: 0 };
      const want = findPath(terrain, start, goal, blocked, expected, 'land');
      const searchesBefore = searches.count;
      expect(pockets.findPath(start, goal, blocked, held, RACE_SLICE_EXPLORED)).toEqual(want);
      if (searches.count === searchesBefore) provedWithoutSearch += 1;
      expect(held.explored).toBe(expected.explored);
    }
    expect(provedWithoutSearch).toBeGreaterThan(0);
  });

  it('answers a goal proved open alike without the probe, charging what that search settles', () => {
    const terrain = open();
    const pockets = new SealedPockets(terrain);
    const rng = new Rng(SEED);
    const wall = walls(terrain);
    let provedWithoutSearch = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const blocked = new Set(wall);
      for (let i = 0; i < BODIES; i++) blocked.add(inside(rng, terrain));
      const start =
        round % 5 === 4 ? inside(rng, terrain) : terrain.nodeAt(rng.int(WALL_FROM - 1), rng.int(SIZE));
      const goal = inside(rng, terrain);
      if (blocked.has(goal) || !outgrowsProbe(terrain, goal, blocked)) continue;
      const want = findPath(terrain, start, goal, blocked, undefined, 'land');
      const expected: SearchStats = { explored: 0 };
      const held: SearchStats = { explored: 0 };
      expect(findPath(terrain, start, goal, blocked, expected, 'land', RACE_SLICE_EXPLORED, true)).toEqual(
        want,
      );
      const searchesBefore = searches.count;
      expect(pockets.findPath(start, goal, blocked, held, RACE_SLICE_EXPLORED, true)).toEqual(want);
      if (searches.count === searchesBefore) provedWithoutSearch += 1;
      expect(held.explored).toBe(expected.explored);
    }
    expect(provedWithoutSearch).toBeGreaterThan(0);
  });
});
