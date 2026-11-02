import { describe, expect, it } from 'vitest';
import { noteSettlerProgress, Settler, SettlerProgress } from '../../../../src/components/index.js';
import {
  colonyHomes,
  type HomesRead,
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
const SMALL_ROOM = 300;
const FAIR_ROOM = 1200;
const LOTS_OF_ROOM = 2400;

const read = (over: Partial<HomesRead>): HomesRead => ({
  couples: 2,
  fed: true,
  room: SMALL_ROOM,
  people: 14,
  ...over,
});

describe('a colony home', () => {
  it('waits for a couple and for food in store', () => {
    expect(colonyHomes(read({ couples: 0 }))).toBe(0);
    expect(colonyHomes(read({ fed: false }))).toBe(0);
  });

  it('runs to two by the room on the land, and past that only for a big colony with room to spare', () => {
    expect(colonyHomes(read({}))).toBe(1);
    expect(colonyHomes(read({ room: FAIR_ROOM }))).toBe(2);
    expect(colonyHomes(read({ room: LOTS_OF_ROOM }))).toBe(2);
    expect(colonyHomes(read({ room: LOTS_OF_ROOM, people: 30 }))).toBe(3);
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
