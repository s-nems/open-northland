import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  DeliveryFlag,
  Equipment,
  type EquipmentSlot,
  FishSwarm,
  JobAssignment,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  Owner,
  Position,
  SettlerProgress,
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
import { wearStepOf } from '../../src/systems/equipment/index.js';
import { assignWorker, unassignWorker } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap, waterColumnMap } from '../fixtures/terrain.js';

const FISHER = 22;
const FISH = 122;
const FOOD = 3;
const TOOL_IRON = 12; // the fixture's iron tool: work factor 175

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
    buildings: base.buildings.map((building) =>
      building.typeId === 1
        ? { ...building, workers: [...(building.workers ?? []), { jobType: FISHER, count: 1 }] }
        : building,
    ),
    jobExperience: [
      ...base.jobExperience,
      {
        typeId: 900,
        id: 'fisher_fish',
        jobType: FISHER,
        goodTypes: [FISH],
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

  it('retires the flag of an HQ-employed fisher and banks the catch directly into the HQ', () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(16, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 8, hy: 3, count: 1, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const shore = sim.world.get(swarm, FishSwarm).shore;
    if (shore === null) throw new Error('fish swarm has no shore');
    const c = terrain.coordsOf(shore);

    const hq = sim.world.create();
    sim.world.add(hq, Position, positionOfNode(2, 3));
    sim.world.add(hq, Building, { buildingType: 1, tribe: 1, built: fx.fromInt(1), level: 0 });
    sim.world.add(hq, Stockpile, { amounts: new Map() });
    sim.world.add(hq, Owner, { player: 0 });

    const fisher = fisherAt(sim, c.x, c.y);
    sim.world.add(fisher, Owner, { player: 0 });
    syncWorkFlagToJob(sim.world, ctxOf(sim), fisher, FISHER);
    const oldFlag = sim.world.get(fisher, WorkFlag).flag;

    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: fisher,
      building: hq,
      jobPriority: [FISHER],
    });

    expect(sim.world.get(fisher, JobAssignment).workplace).toBe(hq);
    expect(sim.world.has(fisher, WorkFlag)).toBe(false);
    expect(sim.world.isAlive(oldFlag)).toBe(false);

    sim.enqueueSetup({ kind: 'setWorkFlag', entity: fisher, x: 6, y: 3 });
    sim.step();
    expect(sim.world.has(fisher, WorkFlag)).toBe(false);

    for (let tick = 0; tick < 500 && (sim.world.get(hq, Stockpile).amounts.get(FOOD) ?? 0) === 0; tick++) {
      sim.step();
    }

    expect(sim.world.has(fisher, Carrying)).toBe(false);
    expect(sim.world.get(hq, Stockpile).amounts.get(FOOD)).toBe(1);

    unassignWorker(sim.world, ctxOf(sim), { kind: 'unassignWorker', entity: fisher });
    expect(sim.world.has(fisher, JobAssignment)).toBe(false);
    expect(sim.world.has(fisher, WorkFlag)).toBe(true);
  });

  it('does not fish while its assigned HQ has no room for another catch', () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(16, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 8, hy: 3, count: 2, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const shore = sim.world.get(swarm, FishSwarm).shore;
    if (shore === null) throw new Error('fish swarm has no shore');
    const c = terrain.coordsOf(shore);

    const hq = sim.world.create();
    sim.world.add(hq, Position, positionOfNode(2, 3));
    sim.world.add(hq, Building, { buildingType: 1, tribe: 1, built: fx.fromInt(1), level: 0 });
    sim.world.add(hq, Stockpile, { amounts: new Map([[FOOD, 150]]) });
    sim.world.add(hq, Owner, { player: 0 });
    const fisher = fisherAt(sim, c.x, c.y);
    sim.world.add(fisher, Owner, { player: 0 });
    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: fisher,
      building: hq,
      jobPriority: [FISHER],
    });

    for (let tick = 0; tick < 20; tick++) sim.step();

    expect(sim.world.has(fisher, CurrentAtomic)).toBe(false);
    expect(sim.world.has(fisher, Carrying)).toBe(false);
    expect(sim.world.get(fisher, SettlerProgress).experience.get(900)).toBeUndefined();
    expect(sim.world.get(swarm, FishSwarm).count).toBe(2);
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
    expect(sim.world.get(fisher, SettlerProgress).experience.get(900)).toBe(150);
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
    sim.world.mut(fisher, SettlerProgress).experience.set(900, 10_000);

    const seen: number[] = [];
    for (let tick = 0; tick < 12 && !sim.world.has(fisher, Carrying); tick++) {
      sim.step();
      const atomic = sim.world.tryGet(fisher, CurrentAtomic)?.atomicId;
      if (atomic !== undefined && seen.at(-1) !== atomic) seen.push(atomic);
    }
    expect(seen).toEqual([FISH_CAST_ATOMIC, FISH_CAUGHT_ATOMIC]);
    expect(sim.world.get(fisher, Carrying)).toEqual({ goodType: FOOD, amount: 1 });
  });

  it('an iron tool cuts a novice down to two casts and wears one use per cast', () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(12, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 5, hy: 3, count: 1, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const shore = sim.world.get(swarm, FishSwarm).shore;
    if (shore === null) throw new Error('fish swarm has no shore');
    const c = terrain.coordsOf(shore);
    const fisher = fisherAt(sim, c.x, c.y);
    sim.world.add(fisher, Equipment, {
      boots: null,
      tool: { goodType: TOOL_IRON, degreeOfUse: fx.fromInt(0) },
      weapon: null,
      armor: null,
      misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
    });

    const seen: number[] = [];
    for (let tick = 0; tick < 30 && !sim.world.has(fisher, Carrying); tick++) {
      sim.step();
      const atomic = sim.world.tryGet(fisher, CurrentAtomic)?.atomicId;
      if (atomic !== undefined && seen.at(-1) !== atomic) seen.push(atomic);
    }
    // Five casts over the iron factor 175 leave two: one miss, then the catch.
    expect(seen).toEqual([FISH_CAST_ATOMIC, FISH_FAILED_ATOMIC, FISH_CAST_ATOMIC, FISH_CAUGHT_ATOMIC]);
    expect(sim.world.get(fisher, Carrying)).toEqual({ goodType: FOOD, amount: 1 });
    const step = wearStepOf(ctxOf(sim), TOOL_IRON);
    expect(sim.world.get(fisher, Equipment).tool?.degreeOfUse).toBe(fx.add(step, step));
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

  it('uses the selected water continent and excludes a swarm exactly 20 nodes from its edge', () => {
    const width = 30;
    const height = 6;
    const typeIds = new Array<number>(width * height).fill(0);
    const landVertices = new Array<boolean>(width * height).fill(true);
    const waterContinents = new Array<number>(width * height).fill(1);
    for (let y = 0; y < height; y++) {
      for (let x = 2; x < width; x++) {
        const node = y * width + x;
        typeIds[node] = 1;
        landVertices[node] = false;
        waterContinents[node] = 7;
      }
    }
    const map = { resolution: 'half-cell' as const, width, height, typeIds, landVertices, waterContinents };

    const atBoundary = new Simulation({ seed: 4, content: fishingContent(), map });
    const terrain = atBoundary.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    addFishSwarms(atBoundary.world, terrain, [{ hx: 22, hy: 3, count: 2, continent: 7 }]);
    const blocked = fisherAt(atBoundary, 1, 3);
    atBoundary.step();
    expect(atBoundary.world.has(blocked, CurrentAtomic)).toBe(false);

    const inside = new Simulation({ seed: 4, content: fishingContent(), map });
    const insideTerrain = inside.terrain;
    if (insideTerrain === undefined) throw new Error('test needs terrain');
    const [matching, otherWater] = addFishSwarms(inside.world, insideTerrain, [
      { hx: 21, hy: 3, count: 2, continent: 7 },
      { hx: 3, hy: 3, count: 2, continent: 8 },
    ]);
    if (matching === undefined || otherWater === undefined) throw new Error('fish swarms did not spawn');
    const allowed = fisherAt(inside, 1, 3);
    inside.step();
    const effect = inside.world.get(allowed, CurrentAtomic).effect;
    expect(effect).toMatchObject({ kind: 'fish', swarm: matching });
    expect(effect).not.toMatchObject({ swarm: otherWater });
    if (effect.kind !== 'fish') throw new Error('expected fishing atomic');
    expect(insideTerrain.coordsOf(effect.water)).toEqual({ x: 2, y: 3 });
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
    expect(takeFishNear(sim.world, terrain, shore, 7)).toBe(fallback);
    expect(sim.world.get(fallback, FishSwarm).count).toBe(1);
  });
});
