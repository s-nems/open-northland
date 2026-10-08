import { describe, expect, it } from 'vitest';
import { PathFollow, PathRequest, PathRoute, Position } from '../../src/components/index.js';
import { type Fixed, fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import { NodeMask } from '../../src/nav/block-overlay.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import { routeStartCell } from '../../src/systems/movement/route-start.js';
import { placePalisade } from '../../src/systems/palisades/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * A walker pressed against a wall routes from its own side: a route from a blocked start may leave on
 * either side of it.
 */

const SIZE = 32;
const WALL_ROW = 16;
const WALL = 691;
const WALKER_X = 10;
/** The test content's wood good, the wall's construction material. */
const WOOD = 5;
const WALL_HITPOINTS = 100;

/** A map split by an unbroken wall along `WALL_ROW`. */
function walledMap(): { sim: Simulation; terrain: TerrainGraph } {
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: {
      ...grassNodeMap(SIZE, SIZE),
      landscapes: {
        placements: [],
        types: [
          {
            typeId: WALL,
            walk: [{ dx: 0, dy: 0 }],
            build: [{ dx: 0, dy: 0 }],
            groups: [],
            wall: {
              maxHitpoints: WALL_HITPOINTS,
              repairPerStrike: 1,
              construction: [{ goodType: WOOD, amount: 1 }],
            },
          },
        ],
      },
    },
  });
  const ctx = ctxOf(sim);
  for (let x = 0; x < SIZE; x++) {
    placePalisade(sim.world, ctx, {
      kind: 'placePalisade',
      gfxIndex: WALL,
      x,
      y: WALL_ROW,
      tribe: 1,
      owner: 0,
    });
  }
  if (sim.terrain === undefined) throw new Error('expected a mapped sim');
  return { sim, terrain: sim.terrain };
}

/** Three quarters of the way from the node above the wall to the wall node below it. */
function besideWall(): { x: Fixed; y: Fixed } {
  const from = positionOfNode(WALKER_X, WALL_ROW - 1);
  const to = positionOfNode(WALKER_X, WALL_ROW);
  const along = (a: Fixed, b: Fixed): Fixed =>
    fx.add(a, fx.mulDiv(fx.sub(b, a), fx.fromInt(3), fx.fromInt(4)));
  return { x: along(from.x, to.x), y: along(from.y, to.y) };
}

function walkerBesideWall(sim: Simulation, terrain: TerrainGraph, goalRow: number): Entity {
  const at = besideWall();
  const e = sim.world.create();
  sim.world.add(e, Position, at);
  // What a planner without the walk blocks asks: the nearest bracket node, here the wall itself.
  sim.world.add(e, PathRequest, {
    start: routeStartCell(terrain, at.x, at.y),
    goal: terrain.nodeAt(WALKER_X, goalRow),
    failed: false,
  });
  return e;
}

describe('routeStartCell beside walk blocks', () => {
  it('prefers an open bracket node over a nearer blocked one', () => {
    const { terrain } = walledMap();
    const { x, y } = besideWall();
    const blocked = new NodeMask(SIZE * SIZE);
    blocked.set(terrain.nodeAt(WALKER_X, WALL_ROW), true);
    expect(routeStartCell(terrain, x, y)).toBe(terrain.nodeAt(WALKER_X, WALL_ROW));
    expect(routeStartCell(terrain, x, y, 'land', blocked)).toBe(terrain.nodeAt(WALKER_X, WALL_ROW - 1));
  });

  it('keeps the nearest node when every bracket is blocked, so a walker inside a block can leave it', () => {
    const { terrain } = walledMap();
    const { x, y } = besideWall();
    const blocked = new NodeMask(SIZE * SIZE);
    blocked.set(terrain.nodeAt(WALKER_X, WALL_ROW), true);
    blocked.set(terrain.nodeAt(WALKER_X, WALL_ROW - 1), true);
    expect(routeStartCell(terrain, x, y, 'land', blocked)).toBe(terrain.nodeAt(WALKER_X, WALL_ROW));
  });
});

describe('routing a walker pressed against a wall', () => {
  it('finds no way through to the far side', () => {
    const { sim, terrain } = walledMap();
    const walker = walkerBesideWall(sim, terrain, WALL_ROW + 4);
    sim.step();
    // The refusal names the start it was searched from, which a wall breach searches again from.
    expect(sim.world.get(walker, PathRequest)).toMatchObject({
      failed: true,
      start: terrain.nodeAt(WALKER_X, WALL_ROW - 1),
    });
    expect(sim.world.has(walker, PathFollow)).toBe(false);
  });

  it('routes along its own side from the open node', () => {
    const { sim, terrain } = walledMap();
    const walker = walkerBesideWall(sim, terrain, WALL_ROW - 4);
    sim.step();
    const stops = sim.world.get(walker, PathRoute).waypoints;
    expect(stops[0]?.node).toBe(terrain.nodeAt(WALKER_X, WALL_ROW - 1));
    expect(stops.every((stop) => terrain.yOf(stop.node) < WALL_ROW)).toBe(true);
  });
});
