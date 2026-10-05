import { AnimalType, TribeType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Frightened,
  HerdMember,
  MoveGoal,
  PathRequest,
  PathRoute,
  Position,
  Settler,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, positionOfNode, Simulation, type TerrainMap } from '../../src/index.js';
import { StepBuffer } from '../../src/nav/terrain/index.js';
import { routeStartCell } from '../../src/systems/movement/route-start.js';
import { testContent } from '../fixtures/content.js';

const DUCK = 31;
const WIDTH = 32;
const HEIGHT = 24;
function pond(): TerrainMap {
  return {
    resolution: 'half-cell',
    width: WIDTH,
    height: HEIGHT,
    typeIds: Array.from({ length: WIDTH * HEIGHT }, (_, i) => {
      const x = i % WIDTH,
        y = Math.floor(i / WIDTH);
      // An island and an isolated second pond must not become shortcuts or teleport destinations.
      return (x >= 8 && x < 25 && y >= 3 && y < 21 && !(x >= 15 && x < 18 && y >= 8 && y < 15)) ||
        (x < 3 && y < 3)
        ? 1
        : 0;
    }),
  };
}
function makeSim(map = pond()): Simulation {
  const base = testContent();
  return new Simulation({
    seed: 31,
    map,
    content: {
      ...base,
      tribes: [...base.tribes, TribeType.parse({ typeId: DUCK, id: 'ducks' })],
      animals: [
        ...base.animals,
        AnimalType.parse({
          tribeType: DUCK,
          id: 'duck',
          hitpointsAdult: 100,
          maximumGroupSize: 6,
          maximumLeaderDistance: 5,
          searchForLeader: true,
          maximumDistanceToStayPoint: 20,
          maximumDistanceToBirthPoint: 20,
        }),
      ],
    },
  });
}
function nodeOf(sim: Simulation, e: Entity) {
  const p = sim.world.get(e, Position);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing pond');
  // A diagonal shoreline leg may interpolate between a wet and a dry bracket node.
  // Its truncated node is not its navigation node; use the same wet bracket as replanning.
  return routeStartCell(terrain, p.x, p.y, 'water');
}

describe('water wildlife', () => {
  it('spawns on nearby water, wanders around an island and stays in the same pond deterministically', () => {
    const run = () => {
      const sim = makeSim();
      sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: DUCK, x: 7, y: 12 });
      sim.step();
      const ducks = [...sim.world.query(Settler)];
      expect(ducks).toHaveLength(6);
      const births = ducks.map((e) => nodeOf(sim, e));
      expect(new Set(births).size).toBe(6);
      const first = births[0];
      if (first === undefined) throw new Error('missing first duck');
      const bank = sim.terrain?.componentOf(first);
      const moved = new Set<number>();
      for (let i = 0; i < 600; i++) {
        sim.step();
        for (const [index, e] of ducks.entries()) {
          const node = nodeOf(sim, e);
          expect(sim.terrain?.isWater(node)).toBe(true);
          expect(sim.terrain?.componentOf(node)).toBe(bank);
          if (node !== births[index]) moved.add(e);
          expect(sim.world.tryGet(e, PathRequest)?.failed).not.toBe(true);
        }
      }
      expect(moved.size).toBe(6);
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });

  it('routes a duck around land and rejects a goal on land', () => {
    const sim = makeSim();
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: DUCK, x: 12, y: 11, count: 1 });
    sim.step();
    const duck = [...sim.world.query(Settler)][0];
    const terrain = sim.terrain;
    if (duck === undefined || terrain === undefined) throw new Error('missing duck');
    sim.world.remove(duck, HerdMember);
    const goal = terrain.nodeAt(21, 11);
    sim.world.add(duck, MoveGoal, { cell: goal });
    let arrived = false;
    const destination = positionOfNode(21, 11);
    let checkedRoute = false;
    for (let i = 0; i < 200; i++) {
      sim.step();
      expect(terrain.isWater(nodeOf(sim, duck))).toBe(true);
      const route = sim.world.tryGet(duck, PathRoute);
      if (route !== undefined && !checkedRoute) {
        const endpoints = route.waypoints.filter((stop) => {
          const centre = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
          return stop.x === centre.x && stop.y === centre.y;
        });
        expect(endpoints.at(-1)?.node).toBe(goal);
        const steps = new StepBuffer();
        for (const [at, stop] of endpoints.entries()) {
          expect(terrain.isWater(stop.node)).toBe(true);
          const next = endpoints[at + 1];
          if (next === undefined) continue;
          terrain.stepsInto(stop.node, undefined, steps, 'water');
          expect(Array.from({ length: steps.length }, (_, i) => steps.nodeAt(i))).toContain(next.node);
        }
        checkedRoute = true;
      }
      const p = sim.world.get(duck, Position);
      if (p.x === destination.x && p.y === destination.y) {
        arrived = true;
        break;
      }
    }
    expect(checkedRoute).toBe(true);
    expect(arrived).toBe(true);
    sim.world.add(duck, MoveGoal, { cell: terrain.nodeAt(16, 11) });
    sim.step();
    expect(sim.world.get(duck, PathRequest).failed).toBe(true);
    expect(terrain.isWater(nodeOf(sim, duck))).toBe(true);
  });

  it('replans from the wet side of a shoreline when frightened mid-step, then resumes roaming', () => {
    const sim = makeSim();
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: DUCK, x: 18, y: 8, count: 1 });
    sim.step();
    const duck = [...sim.world.query(Settler)][0];
    const terrain = sim.terrain;
    if (duck === undefined || terrain === undefined) throw new Error('missing duck');
    // Midpoint of a legal diagonal beside the island: truncation alone selects dry node (17, 8).
    const p = sim.world.mut(duck, Position);
    p.x = fx.fromInt(8.75);
    p.y = fx.fromInt(4);
    sim.world.add(duck, Frightened, {
      until: sim.tick + 40,
      repathAt: sim.tick,
      from: terrain.nodeAt(14, 8),
    });
    const visited = new Set<number>();
    for (let i = 0; i < 400; i++) {
      sim.step();
      const node = nodeOf(sim, duck);
      expect(terrain.isWater(node)).toBe(true);
      expect(sim.world.tryGet(duck, PathRequest)?.failed).not.toBe(true);
      visited.add(node);
    }
    expect(sim.world.has(duck, Frightened)).toBe(false);
    expect(visited.size).toBeGreaterThan(3);
  });

  it('does not create a floating duck on a dry map', () => {
    const sim = makeSim({ ...pond(), typeIds: Array(WIDTH * HEIGHT).fill(0) });
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: DUCK, x: 16, y: 12 });
    sim.step();
    expect([...sim.world.query(Settler)]).toHaveLength(0);
  });
});
