import { describe, expect, it } from 'vitest';
import {
  FarmAnimal,
  LostWay,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  UnreachableGoals,
} from '../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../src/core/loop.js';
import { nodeOfPosition, positionOfNode, Simulation } from '../../src/index.js';
import { dynamicBlockOverlay, stampResourceFootprintData } from '../../src/systems/footprint/index.js';
import { livestockAssignmentSystem } from '../../src/systems/livestock/index.js';
import { pathfindingSystem } from '../../src/systems/movement/routing.js';
import { movementSystem } from '../../src/systems/movement/system.js';
import { grassNodeMap, waterColumnMap } from '../fixtures/terrain.js';
import { breederAt, cowAt, ctxOf, farmAt, livestockContent } from './support.js';

/** Half-width (nodes) of the pen around a walled-in cow: wider than the breeder's two-point reach. */
const PEN_RADIUS = 4;

describe('a breeder approaching moving livestock', () => {
  it.each([
    { flank: 'resource', summoned: false },
    { flank: 'resource', summoned: true },
    { flank: 'water', summoned: false },
    { flank: 'water', summoned: true },
  ])('approaches a legal $flank diagonal with summoned=$summoned', ({ flank, summoned }) => {
    const map = grassNodeMap(64, 64);
    const typeIds = [...map.typeIds];
    if (flank === 'water') typeIds[19 * 64 + 26] = 1;
    const sim = new Simulation({ seed: 1, content: livestockContent(), map: { ...map, typeIds } });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected terrain');
    const farm = farmAt(sim, 20, 20, { owner: 0 });
    const breeder = breederAt(sim, 20, 20, farm);
    const animal = cowAt(sim, 26, 18, { owner: 0, farm });
    cowAt(sim, 4, 4, { owner: 0, farm });
    cowAt(sim, 5, 4, { owner: 0, farm });
    if (summoned) sim.world.mut(animal, FarmAnimal).summoner = breeder;
    if (flank === 'resource') {
      const obstacle = sim.world.create();
      sim.world.add(obstacle, Position, positionOfNode(26, 19));
      stampResourceFootprintData(sim.world, obstacle, {
        walk: [{ dx: 0, dy: 0 }],
        build: [],
        work: [],
      });
    }
    const goal = terrain.nodeAt(27, 20);
    sim.world.add(animal, MoveGoal, { cell: goal });
    sim.world.add(animal, PathRequest, { start: terrain.nodeAt(26, 18), goal, failed: false });
    pathfindingSystem(sim.world, ctxOf(sim));
    let besideFlank = false;
    for (let tick = 0; tick < 64 && !besideFlank; tick++) {
      movementSystem(sim.world, ctxOf(sim));
      const position = sim.world.get(animal, Position);
      const node = nodeOfPosition(position.x, position.y);
      besideFlank = node.hx === 26 && node.hy === 19;
    }
    expect(besideFlank).toBe(true);
    expect(sim.world.has(animal, PathFollow)).toBe(true);

    let claimed = summoned;
    for (let tick = 0; tick < 240 && sim.world.isAlive(animal); tick++) {
      sim.step();
      const request = sim.world.tryGet(breeder, PathRequest);
      expect(request?.failed).not.toBe(true);
      if (request !== undefined) {
        expect(terrain.isWalkable(request.goal)).toBe(true);
        expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(request.goal)).toBe(false);
      }
      claimed ||= sim.world.tryGet(animal, FarmAnimal)?.summoner === breeder;
      expect(sim.events.current()).not.toContainEqual({ kind: 'settlerLost', entity: breeder });
      expect(sim.world.has(breeder, LostWay)).toBe(false);
      expect(
        sim.world
          .tryGet(breeder, UnreachableGoals)
          ?.entries.some((entry) => entry.cell === terrain.nodeAt(26, 19)),
      ).not.toBe(true);
    }
    expect(claimed).toBe(true);
    expect(sim.world.isAlive(animal)).toBe(false);
  });

  it('keeps a walled-in animal on bounded failed-route recovery', () => {
    const sim = new Simulation({ seed: 1, content: livestockContent(), map: grassNodeMap(64, 64) });
    const farm = farmAt(sim, 20, 20, { owner: 0 });
    const breeder = breederAt(sim, 20, 20, farm);
    const animal = cowAt(sim, 40, 20, { owner: 0, farm });
    cowAt(sim, 4, 4, { owner: 0, farm });
    cowAt(sim, 5, 4, { owner: 0, farm });
    // A pen of blocked nodes too wide to stand within arm's reach of the cow, on the farm's own land.
    const pen = sim.world.create();
    sim.world.add(pen, Position, positionOfNode(40, 20));
    const walk: { dx: number; dy: number }[] = [];
    for (let dy = -PEN_RADIUS; dy <= PEN_RADIUS; dy++) {
      for (let dx = -PEN_RADIUS; dx <= PEN_RADIUS; dx++) if (dx !== 0 || dy !== 0) walk.push({ dx, dy });
    }
    stampResourceFootprintData(sim.world, pen, { walk, build: [], work: [] });
    const lost: number[] = [];
    for (let tick = 0; tick < 160; tick++) {
      sim.step();
      for (const event of sim.events.current()) {
        if (event.kind === 'settlerLost' && event.entity === breeder) lost.push(sim.tick);
      }
    }
    expect(lost.length).toBeGreaterThan(0);
    for (let index = 0; index < lost.length; index++) {
      expect((lost[index] ?? 0) - (lost[index - 1] ?? 0)).toBeGreaterThanOrEqual(4 * TICKS_PER_SECOND);
    }
    expect(sim.world.isAlive(animal)).toBe(true);
    expect(sim.world.get(animal, FarmAnimal).farm).toBe(farm);
  });

  it('keeps a herd animal that reads a shore node for a moment', () => {
    const map = grassNodeMap(64, 64);
    const typeIds = [...map.typeIds];
    typeIds[19 * 64 + 26] = 1;
    const sim = new Simulation({ seed: 1, content: livestockContent(), map: { ...map, typeIds } });
    const farm = farmAt(sim, 20, 20, { owner: 0 });
    const animal = cowAt(sim, 26, 19, { owner: 0, farm });

    livestockAssignmentSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(animal, FarmAnimal).farm).toBe(farm);
  });

  it('lets a herd animal across water go instead of chasing it', () => {
    const sim = new Simulation({ seed: 1, content: livestockContent(), map: waterColumnMap(32, 32, 12) });
    const farm = farmAt(sim, 20, 20, { owner: 0 });
    const breeder = breederAt(sim, 20, 20, farm);
    const animal = cowAt(sim, 28, 20, { owner: 0, farm });
    cowAt(sim, 40, 40, { owner: 0, farm });
    cowAt(sim, 41, 40, { owner: 0, farm });
    for (let tick = 0; tick < 160; tick++) {
      sim.step();
      expect(sim.events.current()).not.toContainEqual({ kind: 'settlerLost', entity: breeder });
    }
    expect(sim.world.isAlive(animal)).toBe(true);
    expect(sim.world.has(animal, FarmAnimal)).toBe(false);
  });
});
