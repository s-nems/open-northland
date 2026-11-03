import { describe, expect, it } from 'vitest';
import { noteSettlerProgress, Settler, SettlerProgress } from '../../../../src/components/index.js';
import {
  type HomesRead,
  homeStepDue,
  homeTeaches,
  type LadderRead,
  nextFoodStep,
} from '../../../../src/systems/computer-player/colony/plan.js';
import type { ColonyEnv } from '../../../../src/systems/computer-player/colony/voyage.js';
import {
  aiSim,
  CIVILIST,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  FARMER,
  FARMER_TRACK,
  HQ_X,
  HQ_Y,
  MILLER,
  MILLER_GATE_XP,
  placeHq,
  SCHOOL_TYPE,
  SEAT,
  spawnMen,
  technologyContent,
  VIKING,
} from '../support.js';

const SCHOOL_OFF = 8;
const FARM_OFF = 6;

const read = (over: Partial<HomesRead>): HomesRead => ({
  homeless: 1,
  freeSlots: 0,
  fed: true,
  roomy: true,
  cramped: false,
  ...over,
});

describe('a colony home', () => {
  it('rises for each family it cannot house, with no fixed number, while the colony is fed and roomy', () => {
    expect(homeStepDue(read({}))).toBe(true);
    expect(homeStepDue(read({ homeless: 9, freeSlots: 8 }))).toBe(true);
    expect(homeStepDue(read({ freeSlots: 1 }))).toBe(false);
    expect(homeStepDue(read({ fed: false }))).toBe(false);
    expect(homeStepDue(read({ roomy: false }))).toBe(false);
  });

  it('stands a home ahead of its families while home has no room to build', () => {
    expect(homeStepDue(read({ homeless: 0 }))).toBe(false);
    expect(homeStepDue(read({ homeless: 0, cramped: true }))).toBe(true);
    expect(homeStepDue(read({ homeless: 0, freeSlots: 1, cramped: true }))).toBe(false);
  });
});

const FARM = 'work_farm_00';
const MILL = 'work_mill_00';
const WELL = 'work_well_00';
const BAKERY = 'work_bakery_00';
const ANIMAL_FARM = 'work_animal_farm';
const HIVE = 'work_hive_00';
const BREWERY = 'work_brewery';

const ladder = (over: Partial<LadderRead>, standing: readonly string[] = []): LadderRead => ({
  raised: new Set(standing),
  standing: new Set(standing),
  hungry: true,
  field: true,
  grass: true,
  animals: true,
  open: () => true,
  ...over,
});

describe('a colony food ladder', () => {
  it('runs farm, mill, well and bakery in turn, one standing before the next', () => {
    expect(nextFoodStep(ladder({}))).toBe(FARM);
    expect(nextFoodStep(ladder({}, [FARM]))).toBe(MILL);
    expect(nextFoodStep(ladder({}, [FARM, MILL]))).toBe(WELL);
    expect(nextFoodStep(ladder({}, [FARM, MILL, WELL]))).toBe(BAKERY);
    expect(nextFoodStep(ladder({ raised: new Set([FARM]) }))).toBeNull();
  });

  it('stays down while the colony eats well', () => {
    expect(nextFoodStep(ladder({ hungry: false }))).toBeNull();
  });

  it('takes the animal farm and brewery where no field fits', () => {
    const grassOnly = { field: false };
    expect(nextFoodStep(ladder(grassOnly))).toBe(WELL);
    expect(nextFoodStep(ladder(grassOnly, [WELL]))).toBe(ANIMAL_FARM);
    expect(nextFoodStep(ladder(grassOnly, [WELL, ANIMAL_FARM]))).toBe(HIVE);
    expect(nextFoodStep(ladder(grassOnly, [WELL, ANIMAL_FARM, HIVE]))).toBe(BREWERY);
  });

  it('passes the animal farm over with no animals on the land, and goes on with the brewery', () => {
    expect(nextFoodStep(ladder({ field: false, animals: false }, [WELL]))).toBe(HIVE);
  });

  it('raises nothing green with no grass at all', () => {
    expect(nextFoodStep(ladder({ field: false, grass: false }))).toBeNull();
  });

  it('goes on to the green ladder once the grain ladder is done', () => {
    expect(nextFoodStep(ladder({}, [FARM, MILL, WELL, BAKERY]))).toBe(ANIMAL_FARM);
  });

  it('asks the tribe and the men: a locked or unearned step passes to what can run', () => {
    const noMill = ladder({ open: (building) => building !== MILL }, [FARM]);
    expect(nextFoodStep(noMill)).toBe(WELL);
  });

  it('raises no well or hive for a brewery nobody can run', () => {
    const open = (building: string): boolean => building !== BREWERY && building !== ANIMAL_FARM;
    expect(nextFoodStep(ladder({ field: false, open }))).toBeNull();
  });
});

describe('a colony trade', () => {
  it('is in reach once a school at home teaches it', () => {
    const content = technologyContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: FARM_TYPE,
      x: HQ_X + FARM_OFF,
      y: HQ_Y + FARM_OFF,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
    spawnMen(sim, 1);
    sim.step();
    const farmer = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === CIVILIST);
    if (farmer === undefined) throw new Error('setup: no man');
    sim.enqueueSetup({
      kind: 'assignWorker',
      entity: farmer,
      building: entityOfBuilding(sim, FARM_TYPE),
      jobPriority: [FARMER],
    });
    sim.step();
    sim.world.mut(farmer, SettlerProgress).experience.set(FARMER_TRACK, MILLER_GATE_XP);
    noteSettlerProgress(sim.world, farmer);
    sim.step();
    const env = (): ColonyEnv =>
      ({ world: sim.world, ctx: { ...ctxOf(sim), content }, seat: SEAT }) as unknown as ColonyEnv;
    expect(homeTeaches(env(), MILLER)).toBe(false);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: SCHOOL_TYPE,
      x: HQ_X + SCHOOL_OFF,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
    sim.step();
    expect(homeTeaches(env(), MILLER)).toBe(true);
  });
});
