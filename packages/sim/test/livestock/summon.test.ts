import { describe, expect, it } from 'vitest';
import { FarmAnimal, Frightened, JobAssignment, MoveGoal, Stranded } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { livestockSummonSystem } from '../../src/systems/index.js';
import { breederAt, cowAt, ctxOf, farmAt, livestockSim } from './support.js';

const P0 = 0;
const FARM_AT = { hx: 20, hy: 20 } as const;

/** A farm with its breeder and one animal the breeder has taken in hand, `offDoor` nodes east of the door. */
function summoned(offDoor = 2): { sim: Simulation; farm: Entity; breeder: Entity; animal: Entity } {
  const sim = livestockSim();
  const farm = farmAt(sim, FARM_AT.hx, FARM_AT.hy, { owner: P0 });
  const breeder = breederAt(sim, FARM_AT.hx, FARM_AT.hy, farm);
  const animal = cowAt(sim, FARM_AT.hx + offDoor, FARM_AT.hy, { owner: P0, farm });
  sim.world.mut(animal, FarmAnimal).summoner = breeder;
  return { sim, farm, breeder, animal };
}

function summon(sim: Simulation): void {
  livestockSummonSystem(sim.world, ctxOf(sim));
}

describe('the slaughter summon', () => {
  it('walks the animal to the door', () => {
    const { sim, animal } = summoned();
    summon(sim);
    expect(sim.world.get(animal, MoveGoal).cell).toBe(sim.terrain?.nodeAt(FARM_AT.hx, FARM_AT.hy));
  });

  it('holds an animal standing on the door for the knife', () => {
    const { sim, animal } = summoned(0);
    summon(sim);
    expect(sim.world.has(animal, MoveGoal)).toBe(false);
    expect(sim.world.get(animal, FarmAnimal).summoner).not.toBeNull();
  });

  it('releases the animal when its breeder dies or leaves the farm', () => {
    const dead = summoned();
    dead.sim.world.destroy(dead.breeder);
    summon(dead.sim);
    expect(dead.sim.world.get(dead.animal, FarmAnimal).summoner).toBeNull();
    expect(dead.sim.world.has(dead.animal, MoveGoal)).toBe(false);

    const moved = summoned();
    const elsewhere = farmAt(moved.sim, 4, 4, { owner: P0 });
    moved.sim.world.mut(moved.breeder, JobAssignment).workplace = elsewhere;
    summon(moved.sim);
    expect(moved.sim.world.get(moved.animal, FarmAnimal).summoner).toBeNull();
  });

  it('releases an animal whose walk in failed, so it cannot hold the cycle', () => {
    const { sim, animal } = summoned();
    sim.world.add(animal, Stranded, { retryAt: sim.tick + 1 });
    summon(sim);
    expect(sim.world.get(animal, FarmAnimal).summoner).toBeNull();
  });

  it('leaves a frightened animal to the fright drive, still in hand', () => {
    const { sim, animal } = summoned();
    const from = sim.terrain?.nodeAt(FARM_AT.hx + 4, FARM_AT.hy) ?? 0;
    sim.world.add(animal, Frightened, { until: sim.tick + 10, repathAt: sim.tick, from });
    summon(sim);
    expect(sim.world.has(animal, MoveGoal)).toBe(false);
    expect(sim.world.get(animal, FarmAnimal).summoner).not.toBeNull();
  });
});
