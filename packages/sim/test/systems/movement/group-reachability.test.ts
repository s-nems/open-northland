import { describe, expect, it } from 'vitest';
import { Position } from '../../../src/components/index.js';
import { exportSaveGame, positionOfNode, restoreSimulation, Simulation } from '../../../src/index.js';
import { type BlockOverlay, LayeredBlocks } from '../../../src/nav/block-overlay.js';
import { findPath } from '../../../src/nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import {
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../../../src/systems/footprint/index.js';
import { walkBlockMask } from '../../../src/systems/footprint/walk-block-mask.js';
import { GroupReachability } from '../../../src/systems/movement/group-reachability.js';
import {
  structureRouteSealed,
  structureSameRegion,
  structureStandable,
} from '../../../src/systems/movement/structure-route.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap, waterColumnMap } from '../../fixtures/terrain.js';

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(100, 40) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  const wall = sim.world.create();
  sim.world.add(wall, Position, positionOfNode(50, 0));
  stampResourceFootprintData(sim.world, wall, {
    walk: Array.from({ length: 40 }, (_, dy) => ({ dx: 0, dy })),
    build: [],
    work: [],
  });
  return {
    sim,
    terrain,
    wall,
    mask: walkBlockMask(sim.world, ctxOf(sim), terrain),
    reachability: new GroupReachability(terrain),
  };
}

/** Every standable node's region label under `blocked` by a full flood, 0 off every region. */
function floodRegions(terrain: TerrainGraph, blocked: BlockOverlay): Int32Array {
  const flood = new Int32Array(terrain.nodeCount);
  let label = 0;
  for (let seedNode = 0; seedNode < terrain.nodeCount; seedNode++) {
    const node = seedNode as NodeId;
    if (flood[node] !== 0 || !terrain.isWalkable(node) || blocked.has(node)) continue;
    label++;
    flood[node] = label;
    const queue = [node];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const step of terrain.steps(queue[cursor] as NodeId, blocked)) {
        if (flood[step.node] !== 0) continue;
        flood[step.node] = label;
        queue.push(step.node);
      }
    }
  }
  return flood;
}

describe('group failure reachability', () => {
  it('keeps earlier complete regions while discarding an unfinished or connected pair', () => {
    const { terrain, mask, reachability } = fixture();
    const posts = new Set(
      [25, 75].flatMap((x) => Array.from({ length: terrain.height }, (_, y) => terrain.nodeAt(x, y))),
    );
    const blocked = new LayeredBlocks([mask.levelled(), posts]);
    const [a, b, c, d] = [4, 35, 60, 85].map((x) => terrain.nodeAt(x, 4));
    if (a === undefined || b === undefined || c === undefined || d === undefined)
      throw new Error('missing region endpoints');
    reachability.rememberFailure(mask, blocked, a, b);
    expect(reachability.unreachable(mask, blocked, a, b)).toBe(true);
    reachability.rememberFailure(mask, blocked, c, d);
    expect(reachability.unreachable(mask, blocked, a, b)).toBe(true);
    expect(reachability.unreachable(mask, blocked, c, d)).toBe(true);
    // The first pair learns the smaller region to the right of x=25. The left region remains
    // unlabeled, so this connected pair meets during learning and must discard both frontiers.
    reachability.rememberFailure(mask, blocked, a, terrain.nodeAt(8, 8));
    expect(reachability.unreachable(mask, blocked, a, b)).toBe(true);
    expect(reachability.unreachable(mask, blocked, c, d)).toBe(true);
    for (const start of [a, b, c, d]) {
      const neighbour = terrain.nodeAt(terrain.xOf(start) + 2, 8);
      expect(findPath(terrain, start, neighbour, blocked)).not.toBeNull();
      expect(reachability.unreachable(mask, blocked, start, neighbour)).toBe(false);
    }
  });

  it('keeps owner-specific body overlays separate and leaves blocked-body starts escapable', () => {
    const { terrain, mask, reachability } = fixture();
    const posts = new Set(Array.from({ length: terrain.height }, (_, y) => terrain.nodeAt(25, y)));
    const outsider = new LayeredBlocks([mask.levelled(), posts]);
    const owner = mask.levelled();
    const start = terrain.nodeAt(4, 4),
      goal = terrain.nodeAt(40, 4);
    expect(findPath(terrain, start, goal, outsider)).toBeNull();
    reachability.rememberFailure(mask, outsider, start, goal);
    expect(reachability.unreachable(mask, outsider, start, goal)).toBe(true);
    expect(reachability.unreachable(mask, owner, start, goal)).toBe(false);
    expect(findPath(terrain, start, goal, owner)).not.toBeNull();
    const blockedStart = terrain.nodeAt(25, 4);
    expect(reachability.unreachable(mask, outsider, blockedStart, goal)).toBe(false);
    expect(findPath(terrain, blockedStart, goal, outsider)).not.toBeNull();
  });

  it('agrees with the pathfinder across uneven pockets and diagonal gaps', () => {
    const { terrain, mask, reachability } = fixture();
    const posts = new Set(Array.from({ length: 35 }, (_, y) => terrain.nodeAt(25 + (y % 3), y)));
    const blocked = new LayeredBlocks([mask.levelled(), posts]);
    const endpoints = [4, 20, 26, 40, 60, 80].flatMap((x) => [4, 16, 36].map((y) => terrain.nodeAt(x, y)));
    for (const start of endpoints) {
      for (const goal of endpoints) {
        const route = findPath(terrain, start, goal, blocked);
        if (reachability.unreachable(mask, blocked, start, goal)) expect(route).toBeNull();
        if (route === null) reachability.rememberFailure(mask, blocked, start, goal);
        if (route !== null) expect(reachability.unreachable(mask, blocked, start, goal)).toBe(false);
      }
    }
  });

  it('shares a complete region across distinct endpoints without rejecting routes inside either side', () => {
    const { terrain, mask, reachability } = fixture();
    const a = terrain.nodeAt(4, 4),
      b = terrain.nodeAt(70, 4);
    expect(reachability.unreachable(mask, mask.levelled(), a, b)).toBe(false);
    reachability.rememberFailure(mask, mask.levelled(), a, b);
    expect(reachability.unreachable(mask, mask.levelled(), terrain.nodeAt(8, 8), terrain.nodeAt(80, 8))).toBe(
      true,
    );
    expect(reachability.unreachable(mask, mask.levelled(), terrain.nodeAt(80, 8), terrain.nodeAt(8, 8))).toBe(
      true,
    );
    expect(reachability.unreachable(mask, mask.levelled(), a, terrain.nodeAt(8, 8))).toBe(false);
    expect(reachability.unreachable(mask, mask.levelled(), b, terrain.nodeAt(80, 8))).toBe(false);
    reachability.rememberFailure(mask, mask.levelled(), b, a);
    expect(reachability.unreachable(mask, mask.levelled(), a, b)).toBe(true);
    expect(reachability.unreachable(mask, mask.levelled(), b, terrain.nodeAt(80, 8))).toBe(false);
  });

  it('answers pairs past the search cap as a full flood of the regions does', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(240, 120) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    const mask = walkBlockMask(sim.world, ctxOf(sim), terrain);
    // A wall across the map and a sealed chamber on its left side.
    const posts = new Set<NodeId>();
    for (let y = 0; y < terrain.height; y++) posts.add(terrain.nodeAt(120, y));
    for (let i = 30; i <= 44; i++) {
      for (const [x, y] of [
        [i, 30],
        [i, 44],
        [30, i],
        [44, i],
      ] as const) {
        posts.add(terrain.nodeAt(x, y));
      }
    }
    const blocked = new LayeredBlocks([mask.levelled(), posts]);
    const flood = floodRegions(terrain, blocked);
    const reachability = new GroupReachability(terrain);
    const endpoints = [
      [4, 4],
      [110, 115],
      [37, 37],
      [30, 37],
      [130, 4],
      [235, 115],
    ].map(([x, y]) => terrain.nodeAt(x ?? 0, y ?? 0));
    for (const a of endpoints) {
      for (const b of endpoints) {
        const joined = flood[a] !== 0 && flood[a] === flood[b];
        expect(reachability.sameRegion(mask, blocked, a, b)).toBe(joined);
      }
    }
  });

  it('leaves blocked-start escapes to the pathfinder and invalidates after the wall opens', () => {
    const { sim, terrain, wall, mask, reachability } = fixture();
    const a = terrain.nodeAt(4, 4),
      b = terrain.nodeAt(70, 4),
      blockedStart = terrain.nodeAt(50, 4);
    reachability.rememberFailure(mask, mask.levelled(), a, b);
    expect(reachability.unreachable(mask, mask.levelled(), blockedStart, a)).toBe(false);
    expect(reachability.unreachable(mask, mask.levelled(), blockedStart, b)).toBe(false);
    expect(reachability.unreachable(mask, mask.levelled(), a, blockedStart)).toBe(false);
    unstampResourceFootprint(sim.world, wall);
    expect(reachability.unreachable(mask, mask.levelled(), a, b)).toBe(false);
    reachability.rememberFailure(mask, mask.levelled(), a, b);
    expect(reachability.unreachable(mask, mask.levelled(), a, b)).toBe(false);
  });
});

describe('structural chase refusals', () => {
  it('shares complete queue regions, joins them after a gap opens, and rebuilds them after closing', () => {
    const { sim, terrain, wall, mask, reachability } = fixture();
    const ctx = ctxOf(sim);
    const left = terrain.nodeAt(8, 8);
    const right = terrain.nodeAt(80, 8);
    reachability.rememberFailure(mask, mask.levelled(), left, right);
    expect(reachability.sameRegion(mask, mask.levelled(), left, right)).toBe(false);
    const same = (a: NodeId, b: NodeId) => structureSameRegion(sim.world, ctx, terrain, a, b);
    expect(same(left, right)).toBe(false);
    for (let y = 1; y < 35; y++) {
      expect(same(terrain.nodeAt(85, y), right)).toBe(true);
      expect(same(terrain.nodeAt(6, y), right)).toBe(false);
    }
    for (let y = 1; y < 35; y++) expect(same(terrain.nodeAt(6, y), left)).toBe(true);
    unstampResourceFootprint(sim.world, wall);
    expect(same(left, right)).toBe(true);
    stampResourceFootprintData(sim.world, wall, {
      walk: Array.from({ length: 40 }, (_, dy) => ({ dx: 0, dy })),
      build: [],
      work: [],
    });
    expect(same(left, right)).toBe(false);
    expect(structureStandable(sim.world, ctx, terrain, terrain.nodeAt(50, 8))).toBe(false);
    expect(same(terrain.nodeAt(50, 8), right)).toBe(false);
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: sim.content,
      map: grassNodeMap(100, 40),
    });
    const coldTerrain = restored.terrain;
    if (coldTerrain === undefined) throw new Error('missing restored terrain');
    expect(structureSameRegion(restored.world, ctxOf(restored), coldTerrain, left, right)).toBe(false);
  });

  it('recomputes the same refusals with a cold cache after restoring', () => {
    const { sim, terrain } = fixture();
    const left = terrain.nodeAt(8, 8);
    const right = terrain.nodeAt(80, 8);
    expect(structureRouteSealed(sim.world, ctxOf(sim), terrain, left, right)).toBe(true);
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: sim.content,
      map: grassNodeMap(100, 40),
    });
    const graph = restored.terrain;
    if (graph === undefined) throw new Error('missing restored terrain');
    expect(structureRouteSealed(restored.world, ctxOf(restored), graph, left, right)).toBe(true);
    expect(structureRouteSealed(restored.world, ctxOf(restored), graph, left, graph.nodeAt(10, 8))).toBe(
      false,
    );
    expect(structureRouteSealed(restored.world, ctxOf(restored), graph, graph.nodeAt(50, 8), right)).toBe(
      false,
    );
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('shares the sealed region across the army and retries after a breach', () => {
    const { sim, terrain, wall } = fixture();
    const ctx = ctxOf(sim);
    expect(structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(4, 4), terrain.nodeAt(70, 4))).toBe(
      true,
    );
    for (let y = 5; y < 35; y++)
      expect(structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(8, y), terrain.nodeAt(80, y))).toBe(
        true,
      );
    unstampResourceFootprint(sim.world, wall);
    expect(structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(8, 8), terrain.nodeAt(80, 8))).toBe(
      false,
    );
    stampResourceFootprintData(sim.world, wall, {
      walk: Array.from({ length: 40 }, (_, dy) => ({ dx: 0, dy })),
      build: [],
      work: [],
    });
    expect(structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(8, 8), terrain.nodeAt(80, 8))).toBe(
      true,
    );
    expect(structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(50, 8), terrain.nodeAt(80, 8))).toBe(
      false,
    );
  });
});

describe('structural region predicate', () => {
  it('labels the exhausted side of a wall and answers later crossings from it', () => {
    const { terrain, mask, reachability } = fixture();
    const blocked = mask.levelled();
    expect(reachability.sameRegion(mask, blocked, terrain.nodeAt(10, 10), terrain.nodeAt(80, 10))).toBe(
      false,
    );
    for (let y = 0; y < 40; y += 3) {
      expect(reachability.sameRegion(mask, blocked, terrain.nodeAt(4, y), terrain.nodeAt(90, 39 - y))).toBe(
        false,
      );
    }
  });

  it('refuses a blocked or unwalkable endpoint and ground across a static divide', () => {
    const { terrain, mask, reachability } = fixture();
    const blocked = mask.levelled();
    const open = terrain.nodeAt(10, 10);
    expect(reachability.standable(blocked, terrain.nodeAt(50, 10))).toBe(false);
    expect(reachability.sameRegion(mask, blocked, terrain.nodeAt(50, 10), open)).toBe(false);
    expect(reachability.sameRegion(mask, blocked, open, terrain.nodeAt(50, 10))).toBe(false);
    expect(reachability.sameRegion(mask, blocked, open, open)).toBe(true);

    const sim = new Simulation({ seed: 1, content: testContent(), map: waterColumnMap(20, 10, 10) });
    const water = sim.terrain;
    if (water === undefined) throw new Error('missing terrain');
    const waterMask = walkBlockMask(sim.world, ctxOf(sim), water);
    const banks = new GroupReachability(water);
    const [west, east] = [4, 34].map((x) => water.nodeAt(x, 6));
    if (west === undefined || east === undefined) throw new Error('missing bank nodes');
    expect(water.componentOf(west)).not.toBe(water.componentOf(east));
    expect(banks.sameRegion(waterMask, waterMask.levelled(), west, east)).toBe(false);
  });

  it('agrees with a full flood under scattered posts', () => {
    const { terrain, mask } = fixture();
    let seed = 7;
    // mulberry32: the same posts and pairs on every run.
    const next = (bound: number): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) % bound;
    };
    const posts = new Set<NodeId>();
    for (let i = 0; i < 1200; i++) posts.add(terrain.nodeAt(next(terrain.width), next(terrain.height)));
    for (let y = 0; y < terrain.height; y++) if (y !== 20) posts.add(terrain.nodeAt(25, y));
    const blocked = new LayeredBlocks([mask.levelled(), posts]);
    const flood = floodRegions(terrain, blocked);
    const reachability = new GroupReachability(terrain);
    let connected = 0;
    for (let i = 0; i < 400; i++) {
      const a = terrain.nodeAt(next(terrain.width), next(terrain.height));
      const b = terrain.nodeAt(next(terrain.width), next(terrain.height));
      const expected = flood[a] !== 0 && flood[a] === flood[b];
      if (expected) connected++;
      expect(reachability.sameRegion(mask, blocked, a, b)).toBe(expected);
    }
    // The sample must exercise both answers.
    expect(connected).toBeGreaterThan(50);
    expect(connected).toBeLessThan(350);
  });

  it('answers like a full flood when one held overlay cycles through three', () => {
    const { terrain, mask } = fixture();
    const column = (x: number, gapY?: number): NodeId[] =>
      Array.from({ length: terrain.height }, (_, y) => y)
        .filter((y) => y !== gapY)
        .map((y) => terrain.nodeAt(x, y));
    const gapY = 20;
    // A sealed left bank, an open field with a gap and a sealed right bank: a stale complete group from
    // one would refuse a crossing another allows.
    const overlays = [
      new LayeredBlocks([mask.levelled(), new Set(column(25))]),
      new LayeredBlocks([mask.levelled(), new Set(column(25, gapY))]),
      new LayeredBlocks([mask.levelled(), new Set(column(75))]),
    ];
    const floods = overlays.map((blocked) => floodRegions(terrain, blocked));
    const reachability = new GroupReachability(terrain, 1);
    const xs = [4, 20, 40, 60, 90];
    const rounds = 3;
    const answers = { connected: 0, apart: 0 };
    for (let round = 0; round < rounds; round++) {
      overlays.forEach((blocked, i) => {
        const flood = floods[i];
        if (flood === undefined) throw new Error('missing flood');
        for (const ax of xs) {
          for (const bx of xs) {
            const a = terrain.nodeAt(ax, 4 + round);
            const b = terrain.nodeAt(bx, 30 - round);
            const expected = flood[a] !== 0 && flood[a] === flood[b];
            answers[expected ? 'connected' : 'apart']++;
            expect(reachability.sameRegion(mask, blocked, a, b)).toBe(expected);
          }
        }
      });
    }
    expect(answers.connected).toBeGreaterThan(0);
    expect(answers.apart).toBeGreaterThan(0);
  });
});
