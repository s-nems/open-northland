import { describe, expect, it } from 'vitest';
import {
  addPerson,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  PlayerOrder,
  Position,
  setDiplomacyStance,
  WALK_DIRECTION,
  WalkFacing,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, playerCommand, positionOfNode, Simulation, type TerrainMap } from '../../src/index.js';
import { StepBuffer } from '../../src/nav/terrain/index.js';
import { stampResourceFootprintData } from '../../src/systems/footprint/index.js';
import { testContent } from '../fixtures/content.js';

const MEMBERS = 1000;
const WIDTH = 400;
const HEIGHT = 96;
const WALL_X = 120;
const GAP_Y = 76;

function reportRouting(scenario: string, orders: number, expansions: number, elapsedMs?: number): void {
  if (process.env.ON_ARMY_ROUTING_REPORT === 'on')
    console.log(JSON.stringify({ scenario, orders, expansions, elapsedMs }));
}

function army(wall: boolean, wallHeight = GAP_Y) {
  const typeIds = new Array<number>(WIDTH * HEIGHT).fill(0);
  if (wall) for (let y = 0; y < wallHeight; y++) typeIds[y * WIDTH + WALL_X] = 1;
  const map: TerrainMap = { resolution: 'half-cell', width: WIDTH, height: HEIGHT, typeIds };
  const sim = new Simulation({ seed: 7, content: testContent(), map });
  const members: { entity: Entity; x: number; y: number }[] = [];
  for (let i = 0; i < MEMBERS; i++) {
    const x = 4 + (i % 32) * 2;
    const y = 4 + Math.floor(i / 32) * 2;
    const entity = sim.world.create();
    sim.world.add(entity, Position, positionOfNode(x, y));
    addPerson(sim.world, entity, {
      tribe: 1,
      jobType: 31,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(entity, Owner, { player: 0 });
    sim.world.add(entity, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
    members.push({ entity, x, y });
  }
  return { sim, members };
}

/** A standing enemy soldier on every node of the wall column. */
function enemyLine(sim: Simulation): Entity[] {
  const posts: Entity[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    const post = sim.world.create();
    sim.world.add(post, Position, positionOfNode(WALL_X, y));
    addPerson(sim.world, post, {
      tribe: 1,
      jobType: 31,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(post, Owner, { player: 1 });
    posts.push(post);
  }
  return posts;
}

describe('army player routing', () => {
  it.each([1, MEMBERS])(
    'rejects %i statically disconnected orders without a dynamic-region flood',
    (count) => {
      const { sim, members } = army(true, HEIGHT);
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('army terrain missing');
      let expansions = 0;
      const stepsInto = terrain.stepsInto.bind(terrain);
      terrain.stepsInto = (...args) => {
        expansions++;
        return stepsInto(...args);
      };
      for (const { entity, x, y } of members.slice(0, count))
        sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity, x: x + 240, y }));
      sim.step();
      for (const { entity } of members.slice(0, count))
        expect(sim.world.get(entity, PathRequest).failed).toBe(true);
      reportRouting('static-disconnected', count, expansions);
      expect(expansions).toBe(0);
    },
  );

  it.each([1, MEMBERS])(
    'rejects %i orders into a tiny sealed goal without flooding the open map',
    (count) => {
      const { sim, members } = army(false);
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('army terrain missing');
      const goalX = 300,
        goalY = 70;
      const wall = sim.world.create();
      sim.world.add(wall, Position, positionOfNode(goalX, goalY));
      const neighbours = new StepBuffer();
      terrain.stepsInto(terrain.nodeAt(goalX, goalY), undefined, neighbours);
      stampResourceFootprintData(sim.world, wall, {
        walk: Array.from({ length: neighbours.length }, (_, i) => ({
          dx: terrain.xOf(neighbours.nodeAt(i)) - goalX,
          dy: terrain.yOf(neighbours.nodeAt(i)) - goalY,
        })),
        build: [],
        work: [],
      });
      let expansions = 0;
      const stepsInto = terrain.stepsInto.bind(terrain);
      terrain.stepsInto = (...args) => {
        expansions++;
        return stepsInto(...args);
      };
      for (const { entity } of members.slice(0, count))
        sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity, x: goalX, y: goalY }));
      sim.step();
      for (const { entity } of members.slice(0, count))
        expect(sim.world.get(entity, PathRequest).failed).toBe(true);
      reportRouting('sealed-goal', count, expansions);
      expect(expansions).toBe(3);
    },
  );

  it.each(['structure', 'soldiers'] as const)(
    'rejects 1000 orders across a closed %s wall without repeating the region flood per soldier',
    (wallKind) => {
      const { sim, members } = army(false);
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('army terrain missing');
      const posts: Entity[] = [];
      if (wallKind === 'structure') {
        const wall = sim.world.create();
        sim.world.add(wall, Position, positionOfNode(WALL_X, 0));
        stampResourceFootprintData(sim.world, wall, {
          walk: Array.from({ length: HEIGHT }, (_, dy) => ({ dx: 0, dy })),
          build: [],
          work: [],
        });
      } else {
        posts.push(...enemyLine(sim));
      }
      let expansions = 0;
      const stepsInto = terrain.stepsInto.bind(terrain);
      terrain.stepsInto = (...args) => {
        expansions++;
        return stepsInto(...args);
      };
      // An attack-move routes through an enemy line, so only a plain move is refused at one.
      const kind = wallKind === 'soldiers' ? 'moveUnit' : 'attackMoveUnit';
      for (const { entity, x, y } of members) sim.enqueue(playerCommand(0, { kind, entity, x: x + 240, y }));
      sim.step();
      for (const { entity } of members) {
        expect(sim.world.get(entity, PathRequest).failed).toBe(true);
        expect(sim.world.has(entity, PathFollow)).toBe(false);
      }
      reportRouting(`closed-${wallKind}-wall`, members.length, expansions);
      expect(expansions).toBeLessThan(terrain.nodeCount * 3);
      if (wallKind === 'soldiers') {
        for (const post of posts) sim.world.destroy(post);
        for (const { entity, x, y } of members)
          sim.enqueue(playerCommand(0, { kind, entity, x: x + 240, y }));
        sim.step();
        for (const { entity } of members) {
          expect(sim.world.has(entity, PathRequest)).toBe(false);
          expect(sim.world.has(entity, PathFollow)).toBe(true);
        }
      }
    },
  );

  it('refuses an attack-move through the line of a side that is its enemy but not its target', () => {
    const { sim, members } = army(false);
    // Player 1 holds player 0 an enemy, so its line blocks player 0, who holds it a friend and never
    // fights it.
    setDiplomacyStance(sim.world, 0, 1, 'friend');
    enemyLine(sim);
    const [member] = members;
    if (member === undefined) throw new Error('army missing');
    sim.enqueue(
      playerCommand(0, { kind: 'attackMoveUnit', entity: member.entity, x: member.x + 240, y: member.y }),
    );
    sim.step();
    expect(sim.world.get(member.entity, PathRequest).failed).toBe(true);
  });

  it('routes 1000 attack-moves through a closed line of enemy soldiers', () => {
    const { sim, members } = army(false);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('army terrain missing');
    enemyLine(sim);
    let expansions = 0;
    const stepsInto = terrain.stepsInto.bind(terrain);
    terrain.stepsInto = (...args) => {
      expansions++;
      return stepsInto(...args);
    };
    for (const { entity, x, y } of members)
      sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity, x: x + 240, y }));
    sim.step();
    for (const { entity, x, y } of members) {
      expect(sim.world.has(entity, PathRequest)).toBe(false);
      expect(sim.world.get(entity, PathRoute).waypoints.at(-1)?.node).toBe(terrain.nodeAt(x + 240, y));
    }
    reportRouting('enemy-line', members.length, expansions);
    expect(expansions).toBeLessThan(terrain.nodeCount * 3);
  });

  it.each(['moveUnit', 'attackMoveUnit'] as const)(
    'starts all 1000 local %s orders in their application tick and replaces every route on redirect',
    (kind) => {
      const { sim, members } = army(false);
      for (const { entity, x, y } of members) sim.enqueue(playerCommand(0, { kind, entity, x: x + 24, y }));
      sim.step();
      expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toEqual([]);
      for (const { entity, x, y } of members) {
        expect(sim.world.has(entity, PlayerOrder)).toBe(true);
        expect(sim.world.has(entity, PathFollow)).toBe(true);
        expect(sim.world.get(entity, Position).x).toBeGreaterThan(positionOfNode(x, y).x);
        expect(sim.world.get(entity, PathRoute).waypoints.at(-1)?.node).toBe(sim.terrain?.nodeAt(x + 24, y));
      }
      for (const { entity, x, y } of members) sim.enqueue(playerCommand(0, { kind, entity, x: x - 2, y }));
      sim.step();
      expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toEqual([]);
      for (const { entity, x, y } of members) {
        const goal = sim.terrain?.nodeAt(x - 2, y);
        expect(sim.world.get(entity, MoveGoal).cell).toBe(goal);
        expect(sim.world.get(entity, PathRoute).waypoints.at(-1)?.node).toBe(goal);
      }
    },
  );

  it.each([false, true])('starts 1000 long attack-move routes in the application tick (wall=%s)', (wall) => {
    const { sim, members } = army(wall);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('army terrain missing');
    let expansions = 0;
    const stepsInto = terrain.stepsInto.bind(terrain);
    terrain.stepsInto = (...args) => {
      expansions++;
      return stepsInto(...args);
    };
    for (const { entity, x, y } of members)
      sim.enqueue(playerCommand(0, { kind: 'attackMoveUnit', entity, x: x + 240, y }));
    const started = performance.now();
    sim.step();
    reportRouting(
      wall ? 'open-wall-gap' : 'open-long',
      members.length,
      expansions,
      performance.now() - started,
    );
    expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toEqual([]);
    // Route checks stay linear in the army's total path length; a wall must not trigger one full-map
    // search per member. Timing is diagnostic only, never a machine-dependent correctness gate.
    expect(expansions).toBeLessThan(wall ? 2_000_000 : MEMBERS * 250);
    for (const { entity, x, y } of members) {
      const route = sim.world.get(entity, PathRoute).waypoints;
      expect(route.at(-1)?.node).toBe(terrain.nodeAt(x + 240, y));
      if (wall) expect(route.some(({ node }) => terrain.yOf(node) >= GAP_Y)).toBe(true);
      // Diagonal interpolation stops also carry a pacing node; only lattice centres are route nodes.
      const centres = route.filter((stop) => {
        const at = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
        return stop.x === at.x && stop.y === at.y;
      });
      expect(centres.every(({ node }) => terrain.isWalkable(node))).toBe(true);
      expect(sim.world.get(entity, PathFollow).legCost).toBeGreaterThan(0);
    }
  });
});
