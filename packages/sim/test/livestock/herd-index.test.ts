import { describe, expect, it } from 'vitest';
import { FarmAnimal } from '../../src/components/index.js';
import { attachToFarm, herdedFarms, herdOf, summonedAnimals } from '../../src/systems/livestock/index.js';
import { breederAt, cowAt, farmAt, livestockSim } from './support.js';

describe('the herd index', () => {
  it('follows an animal between farms, a death and a summon, agreeing with a fresh scan', () => {
    const sim = livestockSim();
    const world = sim.world;
    const east = farmAt(sim, 20, 20, { owner: 0 });
    const west = farmAt(sim, 4, 20, { owner: 0 });
    const a = cowAt(sim, 22, 20, { owner: 0, farm: east });
    const b = cowAt(sim, 23, 20, { owner: 0, farm: east });
    const c = cowAt(sim, 6, 20, { owner: 0, farm: west });
    expect(herdOf(world, east)).toEqual([a, b]);
    expect(herdedFarms(world)).toEqual([east, west]);

    attachToFarm(world, b, west); // a value write, not a membership change
    expect(herdOf(world, east)).toEqual([a]);
    expect(herdOf(world, west)).toEqual([b, c]);

    world.destroy(a);
    expect(herdOf(world, east)).toEqual([]);
    expect(herdedFarms(world)).toEqual([west]);

    const breeder = breederAt(sim, 4, 20, west);
    world.mut(c, FarmAnimal).summoner = breeder;
    expect(summonedAnimals(world)).toEqual([c]);
    expect(world.verifyCaches()).toEqual([]);
  });
});
