import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Carrying,
  CurrentAtomic,
  DeliveryFlag,
  FishSwarm,
  MoveGoal,
  Owner,
  Position,
  Settler,
  Stockpile,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, nodeOfPosition, positionOfNode, Simulation } from '../../src/index.js';
import {
  addFishSwarms,
  FISH_CAST_ATOMIC,
  FISH_CAUGHT_ATOMIC,
  FISH_FAILED_ATOMIC,
  fishReproductionSystem,
  takeFishNear,
} from '../../src/systems/economy/fish.js';
import { syncWorkFlagToJob } from '../../src/systems/economy/work-flag.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap, waterColumnMap } from '../fixtures/terrain.js';

const FISHER = 22;
const FISH = 122;
const FOOD = 3;

function fishingContent(): ContentSet {
  const base = testContent();
  return {
    ...base,
    goods: [
      ...base.goods,
      {
        typeId: FISH,
        id: 'fish',
        weight: 1,
        atomics: {},
        productionInputs: [],
        classification: { producedOnMap: true, producedInHouse: false, inputGood: false },
      },
    ],
    jobs: [
      ...base.jobs,
      { typeId: FISHER, id: 'fisher', allowedAtomics: [36, 37, 38], forbiddenAtomics: [] },
    ],
    jobExperience: [
      ...base.jobExperience,
      {
        typeId: 900,
        id: 'fisher_fish',
        jobType: FISHER,
        goodType: FISH,
        experienceFactor: 150,
        baseRepeatCounter: 5,
      },
    ],
  };
}

function fisherAt(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  addPerson(sim.world, e, {
    tribe: 1,
    jobType: FISHER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  return e;
}

describe('fishing', () => {
  it('plants a movable catch-delivery flag for a land fisher', () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(12, 6) });
    const fisher = fisherAt(sim, 4, 3);
    sim.world.add(fisher, Owner, { player: 0 });

    syncWorkFlagToJob(sim.world, ctxOf(sim), fisher, FISHER);

    const flag = sim.world.get(fisher, WorkFlag).flag;
    expect(sim.world.has(flag, DeliveryFlag)).toBe(true);
    expect(sim.world.has(flag, Position)).toBe(true);

    sim.enqueueSetup({ kind: 'setWorkFlag', entity: fisher, x: 8, y: 3 });
    sim.step();
    expect(nodeOfPosition(sim.world.get(flag, Position).x, sim.world.get(flag, Position).y)).toEqual({
      hx: 8,
      hy: 3,
    });
  });

  it('runs cast/failure retries, catches one fish, and leaves the swarm depleted', () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(12, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 5, hy: 3, count: 1, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const shore = sim.world.get(swarm, FishSwarm).shore;
    if (shore === null) throw new Error('fish swarm has no shore');
    const c = terrain.coordsOf(shore);
    const fisher = fisherAt(sim, c.x, c.y);
    syncWorkFlagToJob(sim.world, ctxOf(sim), fisher, FISHER);

    const seen: number[] = [];
    for (let tick = 0; tick < 60 && !sim.world.has(fisher, Carrying); tick++) {
      sim.step();
      const atomic = sim.world.tryGet(fisher, CurrentAtomic)?.atomicId;
      if (atomic !== undefined && seen.at(-1) !== atomic) seen.push(atomic);
    }

    expect(seen).toEqual([
      FISH_CAST_ATOMIC,
      FISH_FAILED_ATOMIC,
      FISH_CAST_ATOMIC,
      FISH_FAILED_ATOMIC,
      FISH_CAST_ATOMIC,
      FISH_FAILED_ATOMIC,
      FISH_CAST_ATOMIC,
      FISH_FAILED_ATOMIC,
      FISH_CAST_ATOMIC,
      FISH_CAUGHT_ATOMIC,
    ]);
    expect(sim.world.get(fisher, Carrying)).toEqual({ goodType: FOOD, amount: 1 });
    expect(sim.world.get(fisher, Settler).experience.get(900)).toBe(150);
    expect(sim.world.get(swarm, FishSwarm)).toMatchObject({ count: 0, continent: 7 });

    for (let tick = 0; tick < 100 && sim.world.has(fisher, Carrying); tick++) sim.step();
    const banked = [...sim.world.query(Stockpile)].reduce(
      (sum, entity) => sum + (sim.world.get(entity, Stockpile).amounts.get(FOOD) ?? 0),
      0,
    );
    expect(sim.world.has(fisher, Carrying)).toBe(false);
    expect(banked).toBe(1);
  });

  it('uses fisher experience to reduce failed casts, down to one successful attempt', () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(12, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 5, hy: 3, count: 1, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const shore = sim.world.get(swarm, FishSwarm).shore;
    if (shore === null) throw new Error('fish swarm has no shore');
    const c = terrain.coordsOf(shore);
    const fisher = fisherAt(sim, c.x, c.y);
    sim.world.mut(fisher, Settler).experience.set(900, 10_000);

    const seen: number[] = [];
    for (let tick = 0; tick < 12 && !sim.world.has(fisher, Carrying); tick++) {
      sim.step();
      const atomic = sim.world.tryGet(fisher, CurrentAtomic)?.atomicId;
      if (atomic !== undefined && seen.at(-1) !== atomic) seen.push(atomic);
    }
    expect(seen).toEqual([FISH_CAST_ATOMIC, FISH_CAUGHT_ATOMIC]);
    expect(sim.world.get(fisher, Carrying)).toEqual({ goodType: FOOD, amount: 1 });
  });

  it("chooses a reachable nearby bank instead of the swarm's single spawn-time shore", () => {
    const waterMap = waterColumnMap(8, 4, 3);
    const map = { ...waterMap, landVertices: waterMap.typeIds.map((typeId) => typeId !== 1) };
    const sim = new Simulation({ seed: 4, content: fishingContent(), map });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 6, hy: 3, count: 3, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const spawnShore = sim.world.get(swarm, FishSwarm).shore;
    if (spawnShore === null) throw new Error('fish swarm has no shore');
    expect(terrain.coordsOf(spawnShore).x).toBeLessThan(6); // deterministic spawn fallback picked west bank

    const fisher = fisherAt(sim, 9, 3); // east bank, disconnected from the stored west-bank point
    sim.step();

    const goal = sim.world.get(fisher, MoveGoal).cell;
    expect(terrain.coordsOf(goal)).toEqual({ x: 8, y: 3 });
  });

  it('does not fall back to an arbitrary land point when a real map has no valid water edge', () => {
    const waterMap = waterColumnMap(8, 4, 3);
    const map = { ...waterMap, landVertices: waterMap.typeIds.map(() => true) };
    const sim = new Simulation({ seed: 4, content: fishingContent(), map });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 6, hy: 3, count: 3, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const fisher = fisherAt(sim, 9, 3);

    sim.step();

    expect(sim.world.has(fisher, MoveGoal)).toBe(false);
    expect(sim.world.has(fisher, CurrentAtomic)).toBe(false);
  });

  it('reproduces only a nonempty, nonfull swarm on the 2160-tick cadence', () => {
    const sim = new Simulation({ seed: 1, content: fishingContent(), map: grassNodeMap(12, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const swarms = addFishSwarms(sim.world, terrain, [
      { hx: 2, hy: 2, count: 0, continent: 1 },
      { hx: 5, hy: 2, count: 2, continent: 1 },
      { hx: 8, hy: 2, count: 30, continent: 1 },
    ]);
    // Empty authored slots are intentionally not materialized.
    expect(swarms).toHaveLength(2);
    fishReproductionSystem(sim.world, { ...ctxOf(sim), tick: 2159 });
    expect(swarms.map((e) => sim.world.get(e, FishSwarm).count)).toEqual([2, 30]);
    fishReproductionSystem(sim.world, { ...ctxOf(sim), tick: 2160 });
    expect(swarms.map((e) => sim.world.get(e, FishSwarm).count)).toEqual([3, 30]);
  });

  it('reselects a nearby nonempty swarm when a planned target was depleted by another fisher', () => {
    const sim = new Simulation({ seed: 1, content: fishingContent(), map: grassNodeMap(20, 8) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [planned, fallback] = addFishSwarms(sim.world, terrain, [
      { hx: 5, hy: 3, count: 1, continent: 7 },
      { hx: 8, hy: 3, count: 2, continent: 7 },
    ]);
    if (planned === undefined || fallback === undefined) throw new Error('fish swarms did not spawn');
    sim.world.mut(planned, FishSwarm).count = 0;
    const shore = sim.world.get(planned, FishSwarm).shore;
    if (shore === null) throw new Error('planned swarm has no shore');
    const c = terrain.coordsOf(shore);
    const fisher = fisherAt(sim, c.x, c.y);

    expect(takeFishNear(sim.world, terrain, fisher, 7)).toBe(fallback);
    expect(sim.world.get(fallback, FishSwarm).count).toBe(1);
  });
});
