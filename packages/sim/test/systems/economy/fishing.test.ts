import { type ContentSet, GROUND_LAND, GROUND_WATER } from '@open-northland/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  DeliveryFlag,
  Equipment,
  type EquipmentSlot,
  FishSwarm,
  FOG_MODE,
  HaulFlag,
  JobAssignment,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  Owner,
  Position,
  ProductionCounters,
  productionCountOf,
  SettlerProgress,
  Stockpile,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, type NodeId, nodeOfPosition, positionOfNode, Simulation } from '../../../src/index.js';
import {
  addFishSwarms,
  FISH_CAST_ATOMIC,
  FISH_CAUGHT_ATOMIC,
  FISH_FAILED_ATOMIC,
  FISH_REPRODUCTION_TICKS,
  FISH_SHORE_SEARCH_RADIUS,
  FISH_SPREAD_RADIUS,
  fishReproductionSystem,
  takeFishNear,
  workplaceShoreSearchRadius,
} from '../../../src/systems/economy/fish.js';
import { syncWorkFlagToJob } from '../../../src/systems/economy/work-flag.js';
import { wearStepOf } from '../../../src/systems/equipment/index.js';
import { assignWorker, setProductionCount, unassignWorker } from '../../../src/systems/orders/index.js';
import { CATCH_SIGHT_NODES, FogState } from '../../../src/systems/vision/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap, waterColumnMap } from '../../fixtures/terrain.js';

const FISHER = 22;
const OWNER = 0;
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
  afterEach(() => vi.restoreAllMocks());

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

  it('searches for a shore from his flag, so a flag fisher far from his water walks back to it', () => {
    // The water sits at the west end of a long strip, the fisher at the east end, well past his own
    // 20-node shore search; his flag stands on the swarm's shore.
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(96, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 5, hy: 3, count: 5, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const shore = sim.world.get(swarm, FishSwarm).shore;
    if (shore === null) throw new Error('fish swarm has no shore');
    const c = terrain.coordsOf(shore);
    const fisher = fisherAt(sim, 90, 3);
    sim.world.add(fisher, Owner, { player: 0 });
    syncWorkFlagToJob(sim.world, ctxOf(sim), fisher, FISHER);
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: fisher, x: c.x, y: c.y });
    sim.step();

    let cast = false;
    for (let tick = 0; tick < 900 && !cast; tick++) {
      sim.step();
      cast = sim.world.tryGet(fisher, CurrentAtomic)?.atomicId === FISH_CAST_ATOMIC;
    }
    expect(cast).toBe(true);

    // Without a flag the same man searches from his feet and never finds the water.
    const idle = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(96, 6) });
    const idleTerrain = idle.terrain;
    if (idleTerrain === undefined) throw new Error('test needs terrain');
    addFishSwarms(idle.world, idleTerrain, [{ hx: 5, hy: 3, count: 5, continent: 7 }]);
    const stranded = fisherAt(idle, 90, 3);
    for (let tick = 0; tick < 900; tick++) idle.step();
    expect(idle.world.tryGet(stranded, CurrentAtomic)?.atomicId).not.toBe(FISH_CAST_ATOMIC);
    expect(idle.world.has(stranded, MoveGoal)).toBe(false);
  });

  it("retires an HQ-employed fisher's yard flag, banks the catch into the HQ and keeps his post's flag", () => {
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
    const postFlag = sim.world.get(fisher, HaulFlag).flag;

    for (let tick = 0; tick < 500 && (sim.world.get(hq, Stockpile).amounts.get(FOOD) ?? 0) === 0; tick++) {
      sim.step();
    }

    expect(sim.world.has(fisher, Carrying)).toBe(false);
    expect(sim.world.get(hq, Stockpile).amounts.get(FOOD)).toBe(1);

    // Released, he keeps the flag his post took as his yard: the flag is his, not the building's.
    unassignWorker(sim.world, ctxOf(sim), { kind: 'unassignWorker', entity: fisher });
    expect(sim.world.has(fisher, JobAssignment)).toBe(false);
    expect(sim.world.has(fisher, HaulFlag)).toBe(false);
    expect(sim.world.get(fisher, WorkFlag).flag).toBe(postFlag);
  });

  it("searches for a shore from his post's flag, so a posted fisher works far water and banks at his post", () => {
    // The water sits at the west end of a long strip, the HQ and its fisher at the east end, well past
    // his 20-node shore search; the flag his post took stands inland of the swarm's shore, inside that
    // search of it.
    const FLAG_INLAND = 10;
    const run = (
      flagged: boolean,
    ): { shore: NodeId; firstGoal: NodeId | undefined; cast: boolean; banked: number } => {
      const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(96, 6) });
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('test needs terrain');
      const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 5, hy: 3, count: 5, continent: 7 }]);
      const shore = swarm === undefined ? null : sim.world.get(swarm, FishSwarm).shore;
      if (shore === null) throw new Error('fish swarm has no shore');
      const hq = sim.world.create();
      sim.world.add(hq, Position, positionOfNode(88, 3));
      sim.world.add(hq, Building, { buildingType: 1, tribe: 1, built: fx.fromInt(1), level: 0 });
      sim.world.add(hq, Stockpile, { amounts: new Map() });
      sim.world.add(hq, Owner, { player: OWNER });
      const fisher = fisherAt(sim, 90, 3);
      sim.world.add(fisher, Owner, { player: OWNER });
      sim.world.add(fisher, JobAssignment, { workplace: hq });
      const c = terrain.coordsOf(shore);
      if (flagged) sim.enqueueSetup({ kind: 'setWorkFlag', entity: fisher, x: c.x + FLAG_INLAND, y: c.y });
      sim.step();
      const firstGoal = sim.world.tryGet(fisher, MoveGoal)?.cell;
      let cast = false;
      for (let tick = 0; tick < 2000 && (sim.world.get(hq, Stockpile).amounts.get(FOOD) ?? 0) === 0; tick++) {
        sim.step();
        cast ||= sim.world.tryGet(fisher, CurrentAtomic)?.atomicId === FISH_CAST_ATOMIC;
      }
      expect(sim.world.has(fisher, JobAssignment)).toBe(true);
      return { shore, firstGoal, cast, banked: sim.world.get(hq, Stockpile).amounts.get(FOOD) ?? 0 };
    };

    const flagged = run(true);
    // He heads straight for the water his flag marks, not for the flag first.
    expect(flagged.firstGoal).toBe(flagged.shore);
    expect(flagged).toMatchObject({ cast: true, banked: 1 });
    // Without the flag the same man searches from his post and never finds the water.
    expect(run(false)).toMatchObject({ cast: false, banked: 0 });
  });

  it('waits at its post flag when no water lies within the search from it', () => {
    const DRY_FLAG = { hx: 88, hy: 3 } as const;
    /** Close enough to the flag to stand at it: its interaction cell lies a step or two aside. */
    const AT_FLAG_NODES = 4;
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(96, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    addFishSwarms(sim.world, terrain, [{ hx: 5, hy: 3, count: 5, continent: 7 }]);
    const hq = sim.world.create();
    sim.world.add(hq, Position, positionOfNode(50, 3));
    sim.world.add(hq, Building, { buildingType: 1, tribe: 1, built: fx.fromInt(1), level: 0 });
    sim.world.add(hq, Stockpile, { amounts: new Map() });
    sim.world.add(hq, Owner, { player: OWNER });
    const fisher = fisherAt(sim, 52, 3);
    sim.world.add(fisher, Owner, { player: OWNER });
    sim.world.add(fisher, JobAssignment, { workplace: hq });
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: fisher, x: DRY_FLAG.hx, y: DRY_FLAG.hy });

    let cast = false;
    for (let tick = 0; tick < 2000; tick++) {
      sim.step();
      cast ||= sim.world.tryGet(fisher, CurrentAtomic)?.atomicId === FISH_CAST_ATOMIC;
    }
    const at = sim.world.get(fisher, Position);
    expect(cast).toBe(false);
    expect(Math.abs(nodeOfPosition(at.x, at.y).hx - DRY_FLAG.hx)).toBeLessThanOrEqual(AT_FLAG_NODES);
    expect(sim.world.get(fisher, JobAssignment).workplace).toBe(hq);
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

  it("explores around the swarm a catch came from, for the fisher's owner", () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(12, 6) });
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 5, hy: 3, count: 1, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const shore = sim.world.get(swarm, FishSwarm).shore;
    if (shore === null) throw new Error('fish swarm has no shore');
    const c = terrain.coordsOf(shore);
    const fisher = fisherAt(sim, c.x, c.y);
    sim.world.add(fisher, Owner, { player: OWNER });
    syncWorkFlagToJob(sim.world, ctxOf(sim), fisher, FISHER);
    const looks = vi.spyOn(FogState.prototype, 'stampSight');
    for (let tick = 0; tick < 60 && !sim.world.has(fisher, Carrying); tick++) sim.step();
    expect(sim.world.has(fisher, Carrying)).toBe(true);
    const catches = looks.mock.calls.filter(([, , , radius]) => radius === CATCH_SIGHT_NODES);
    expect(catches).toEqual([[OWNER, 5 >> 1, 3 >> 1, CATCH_SIGHT_NODES]]);
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

  it('fishes only while its counter for the raw fish is at least one, and a catch spends one', () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(12, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [swarm] = addFishSwarms(sim.world, terrain, [{ hx: 5, hy: 3, count: 2, continent: 7 }]);
    if (swarm === undefined) throw new Error('fish swarm did not spawn');
    const shore = sim.world.get(swarm, FishSwarm).shore;
    if (shore === null) throw new Error('fish swarm has no shore');
    const c = terrain.coordsOf(shore);
    const fisher = fisherAt(sim, c.x, c.y);
    sim.world.add(fisher, Owner, { player: 0 });
    sim.world.mut(fisher, SettlerProgress).experience.set(900, 10_000); // one cast per catch
    const setCount = (count: number): void =>
      setProductionCount(sim.world, ctxOf(sim), {
        kind: 'setProductionCount',
        entity: fisher,
        goodType: FISH,
        count,
      });

    setCount(0);
    for (let tick = 0; tick < 12; tick++) sim.step();
    expect(sim.world.tryGet(fisher, CurrentAtomic)?.atomicId).not.toBe(FISH_CAST_ATOMIC);
    expect(sim.world.get(swarm, FishSwarm).count).toBe(2);
    expect(sim.workStatus(fisher)).toEqual({ kind: 'nothingSelected' });

    setCount(2);
    // Long enough to finish whatever idle clip the stopped fisher took up before it casts again.
    for (let tick = 0; tick < 300 && !sim.world.has(fisher, Carrying); tick++) sim.step();
    expect(sim.world.get(fisher, Carrying)).toEqual({ goodType: FOOD, amount: 1 });
    expect(productionCountOf(sim.world.tryGet(fisher, ProductionCounters), FISH)).toBe(1);
  });

  it('refuses a counter for a good the fisher does not gather', () => {
    const sim = new Simulation({ seed: 4, content: fishingContent(), map: grassNodeMap(12, 6) });
    const fisher = fisherAt(sim, 4, 3);
    sim.world.add(fisher, Owner, { player: 0 });
    setProductionCount(sim.world, ctxOf(sim), {
      kind: 'setProductionCount',
      entity: fisher,
      goodType: FOOD,
      count: 0,
    });
    expect(sim.world.has(fisher, ProductionCounters)).toBe(false);
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
    const map = {
      ...waterMap,
      groundKinds: waterMap.typeIds.map((typeId) => (typeId !== 1 ? GROUND_LAND : GROUND_WATER)),
    };
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
    const groundKinds = new Array<number>(width * height).fill(GROUND_LAND);
    const waterContinents = new Array<number>(width * height).fill(1);
    for (let y = 0; y < height; y++) {
      for (let x = 2; x < width; x++) {
        const node = y * width + x;
        typeIds[node] = 1;
        groundKinds[node] = GROUND_WATER;
        waterContinents[node] = 7;
      }
    }
    const map = { resolution: 'half-cell' as const, width, height, typeIds, groundKinds, waterContinents };

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
    const map = { ...waterMap, groundKinds: waterMap.typeIds.map(() => GROUND_LAND) };
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

  it('grows a nonempty, nonfull swarm on the 2160-tick cadence', () => {
    const sim = new Simulation({ seed: 1, content: fishingContent(), map: grassNodeMap(12, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const swarms = addFishSwarms(sim.world, terrain, [
      { hx: 2, hy: 2, count: 0, continent: 1 },
      { hx: 5, hy: 2, count: 2, continent: 1 },
      { hx: 8, hy: 2, count: 29, continent: 2 },
    ]);
    // Empty authored slots are intentionally not materialized.
    expect(swarms).toHaveLength(2);
    fishReproductionSystem(sim.world, { ...ctxOf(sim), tick: 2159 });
    expect(swarms.map((e) => sim.world.get(e, FishSwarm).count)).toEqual([2, 29]);
    fishReproductionSystem(sim.world, { ...ctxOf(sim), tick: 2160 });
    expect(swarms.map((e) => sim.world.get(e, FishSwarm).count)).toEqual([3, 30]);
  });

  it('has a full swarm feed its nearest nonfull swarm on the same water, an emptied one included', () => {
    const sim = new Simulation({ seed: 1, content: fishingContent(), map: grassNodeMap(48, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [full, emptied, nearerElsewhere, farther] = addFishSwarms(sim.world, terrain, [
      { hx: 20, hy: 2, count: 30, continent: 1 },
      { hx: 24, hy: 2, count: 5, continent: 1 },
      { hx: 22, hy: 2, count: 5, continent: 2 },
      { hx: 14, hy: 2, count: 5, continent: 1 },
    ]);
    if (full === undefined || emptied === undefined || nearerElsewhere === undefined || farther === undefined)
      throw new Error('fish swarms did not spawn');
    sim.world.mut(emptied, FishSwarm).count = 0;
    fishReproductionSystem(sim.world, { ...ctxOf(sim), tick: FISH_REPRODUCTION_TICKS });
    // Fed first in the pass, the emptied swarm grows again on its own visit.
    expect([full, emptied, nearerElsewhere, farther].map((e) => sim.world.get(e, FishSwarm).count)).toEqual([
      30, 2, 6, 6,
    ]);
  });

  it(`feeds no swarm ${FISH_SPREAD_RADIUS} map points or more from a full one`, () => {
    const sim = new Simulation({ seed: 1, content: fishingContent(), map: grassNodeMap(48, 6) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test needs terrain');
    const [, beyond, within] = addFishSwarms(sim.world, terrain, [
      { hx: 20, hy: 2, count: 30, continent: 1 },
      { hx: 20 + FISH_SPREAD_RADIUS, hy: 2, count: 1, continent: 1 },
      { hx: 20 - FISH_SPREAD_RADIUS + 1, hy: 2, count: 1, continent: 1 },
    ]);
    if (beyond === undefined || within === undefined) throw new Error('fish swarms did not spawn');
    sim.world.mut(beyond, FishSwarm).count = 0;
    sim.world.mut(within, FishSwarm).count = 0;
    fishReproductionSystem(sim.world, { ...ctxOf(sim), tick: FISH_REPRODUCTION_TICKS });
    expect([beyond, within].map((e) => sim.world.get(e, FishSwarm).count)).toEqual([0, 2]);
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

describe('workplaceShoreSearchRadius', () => {
  const LODGE = 950;
  const BARE = 951;
  const TRIBE = 1;
  const EVEN_ROW = 10;
  const ODD_ROW = 11;
  /** A door one node east and three rows south of the anchor: an odd row offset, which an odd anchor row
   *  pushes one more node east. */
  const DOOR = { dx: 1, dy: 3 };
  const ANCHOR_ONLY = { blocked: [{ dx: 0, dy: 0 }], familyBody: [], reserved: [], workArea: [] };

  function doorContent(): ContentSet {
    const base = fishingContent();
    const template = base.buildings[0];
    if (template === undefined) throw new Error('the fixture has no building');
    return {
      ...base,
      buildings: [
        ...base.buildings,
        { ...template, typeId: LODGE, id: 'lodge', footprint: { ...ANCHOR_ONLY, door: DOOR } },
        { ...template, typeId: BARE, id: 'bare', footprint: ANCHOR_ONLY },
      ],
    };
  }

  it("shrinks the shore search by the door's Manhattan offset from the anchor, row parity included", () => {
    const content = doorContent();
    expect(workplaceShoreSearchRadius(content, { buildingType: LODGE, tribe: TRIBE }, EVEN_ROW)).toBe(
      FISH_SHORE_SEARCH_RADIUS - DOOR.dx - DOOR.dy,
    );
    expect(workplaceShoreSearchRadius(content, { buildingType: LODGE, tribe: TRIBE }, ODD_ROW)).toBe(
      FISH_SHORE_SEARCH_RADIUS - (DOOR.dx + 1) - DOOR.dy,
    );
    expect(workplaceShoreSearchRadius(content, { buildingType: BARE, tribe: TRIBE }, EVEN_ROW)).toBe(
      FISH_SHORE_SEARCH_RADIUS,
    );
  });
});
