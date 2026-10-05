import { expect, it } from 'vitest';
import { nearestYardDoor, strayYardOf } from '../../src/systems/livestock/stray-yard.js';
import { cowAt, ctxOf, farmAt, livestockSim } from './support.js';

it('finds the same nearest door as a canonical scan across both tree axes and equal-distance splits', () => {
  const sim = livestockSim();
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('livestockSim always has a map');
  const doors = [];
  // Deliberately mixed creation order, with many collinear and equidistant candidates.
  for (const x of [45, 5, 35, 15, 25]) {
    for (const y of [15, 45, 25, 5, 35]) {
      doors.push({ entity: farmAt(sim, x, y, { owner: 0, buildingType: 7 }), x, y });
    }
  }
  const yard = strayYardOf(sim.world, ctxOf(sim), terrain, 0);
  if (yard === null) throw new Error('the finished warehouses provide yards');
  for (let x = 0; x < 64; x += 5) {
    for (let y = 0; y < 64; y += 5) {
      const animal = cowAt(sim, x, y, { owner: 0 });
      let expected = doors[0];
      let distance = Number.POSITIVE_INFINITY;
      for (const door of doors) {
        const candidate = Math.abs(x - door.x) + Math.abs(y - door.y);
        if (candidate < distance) {
          expected = door;
          distance = candidate;
        }
      }
      if (expected === undefined) throw new Error('fixture has doors');
      expect(nearestYardDoor(sim.world, terrain, yard, animal)).toBe(terrain.nodeAt(expected.x, expected.y));
      sim.world.destroy(animal);
    }
  }
});
