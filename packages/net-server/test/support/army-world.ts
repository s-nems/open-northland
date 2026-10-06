import {
  components,
  type Entity,
  fx,
  type GroupDestination,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '@open-northland/sim';
import { expect } from 'vitest';
import { testContent } from '../../../sim/test/fixtures/content.js';

export const SOLDIERS = 1000;
const WIDTH = 260;
const HEIGHT = 80;
export const map: TerrainMap = {
  resolution: 'half-cell',
  width: WIDTH,
  height: HEIGHT,
  typeIds: new Array<number>(WIDTH * HEIGHT).fill(0),
};
export function world(): Simulation {
  const sim = new Simulation({ seed: 7, content: testContent(), map });
  for (let i = 0; i < SOLDIERS; i++) {
    const entity = sim.world.create();
    sim.world.add(entity, components.Position, positionOfNode(2 + (i % 40) * 2, 2 + Math.floor(i / 40) * 2));
    components.addPerson(sim.world, entity, {
      tribe: 1,
      jobType: 31,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(entity, components.Owner, { player: 0 });
    sim.world.add(entity, components.WalkFacing, {
      direction: components.WALK_DIRECTION.E,
      target: components.WALK_DIRECTION.E,
    });
  }
  return sim;
}

export function members(sim: Simulation, offset: number): GroupDestination[] {
  return [...sim.world.query(components.Settler)].map((entity: Entity, i) => ({
    entity,
    x: offset + (i % 40) * 2,
    y: 2 + Math.floor(i / 40) * 2,
  }));
}

export function expectRouted(sim: Simulation, orders: readonly GroupDestination[]): void {
  for (const { entity, x, y } of orders) {
    expect(sim.world.get(entity, components.MoveGoal).cell).toBe(sim.terrain?.nodeAt(x, y));
    expect(sim.world.has(entity, components.PathFollow)).toBe(true);
    expect(sim.world.has(entity, components.PathRequest)).toBe(false);
  }
}
