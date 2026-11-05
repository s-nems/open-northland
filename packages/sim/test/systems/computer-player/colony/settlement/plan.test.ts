import { describe, expect, it } from 'vitest';
import {
  Building,
  noteSettlerProgress,
  Settler,
  SettlerProgress,
} from '../../../../../src/components/index.js';
import type { ColonyEnv } from '../../../../../src/systems/computer-player/colony/env.js';
import { homeTeaches } from '../../../../../src/systems/computer-player/colony/settlement/industry-read.js';
import {
  type HomesRead,
  homeStepDue,
  siteFree,
} from '../../../../../src/systems/computer-player/colony/settlement/plan.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import {
  colonyBuildingsOf,
  colonyState,
  colonyWorld,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../../fixtures/context.js';
import {
  aiSim,
  CIVILIST,
  entityOfBuilding,
  FARM_TYPE,
  FARMER,
  FARMER_TRACK,
  HOME_TOP_TYPE,
  HOME_TYPE,
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
} from '../../support.js';

const SCHOOL_OFF = 8;
const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const SECOND_SHIP_AT = { x: 90, y: 100 };
const FOUND_DUE_TICKS = minutesToTicks(16);
const HOMES_DUE_TICKS = minutesToTicks(20);
const FARM_ID = 'work_farm_00';
const LADDER_DUE_TICKS = minutesToTicks(14);
/** The fixture's home chain, base tier to top. */
const HOME_MID_TYPE = HOME_TYPE + 1;
const HOME_TYPES = [HOME_TYPE, HOME_MID_TYPE, HOME_TOP_TYPE];
/** A top-tier home's family slots. */
const HOME_SLOTS = 5;
const FARM_OFF = 6;

const read = (over: Partial<HomesRead>): HomesRead => ({
  homeless: 1,
  freeSlots: 0,
  fed: true,
  roomy: true,
  ahead: 0,
  ...over,
});

describe('a colony site', () => {
  it("goes up on its own kind's budget, so stuck homes hold back no workshop", () => {
    const homesStuck = { industry: 0, other: 2 };
    expect(siteFree('work_farm_00', homesStuck)).toBe(true);
    expect(siteFree('home_level_00', homesStuck)).toBe(false);
    const workshopsStuck = { industry: 2, other: 0 };
    expect(siteFree('work_joinery_03', workshopsStuck)).toBe(false);
    expect(siteFree('tower_00', workshopsStuck)).toBe(true);
  });
});

describe('a colony home', () => {
  it('rises for each family it cannot house, with no fixed number, while the colony is fed and roomy', () => {
    expect(homeStepDue(read({}))).toBe(true);
    expect(homeStepDue(read({ homeless: 9, freeSlots: 8 }))).toBe(true);
    expect(homeStepDue(read({ freeSlots: 1 }))).toBe(false);
    expect(homeStepDue(read({ fed: false }))).toBe(false);
    expect(homeStepDue(read({ roomy: false }))).toBe(false);
  });

  it("keeps a home's slots free ahead of its families", () => {
    expect(homeStepDue(read({ homeless: 0, ahead: HOME_SLOTS }))).toBe(true);
    expect(homeStepDue(read({ homeless: 0, freeSlots: HOME_SLOTS, ahead: HOME_SLOTS }))).toBe(false);
    expect(homeStepDue(read({ homeless: 0, ahead: HOME_SLOTS, fed: false }))).toBe(false);
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

describe('a running colony', () => {
  it('raises its homes straight at the top tier the tribe has', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    const homes = (): number[] =>
      colonyBuildingsOf(sim)
        .map((e) => sim.world.get(e, Building).buildingType)
        .filter((type) => HOME_TYPES.includes(type));
    expect(stepUntil(sim, FOUND_DUE_TICKS + HOMES_DUE_TICKS, () => homes().length > 0)).toBe(true);
    expect(homes().every((type) => type === HOME_TOP_TYPE)).toBe(true);
  });

  it('raises a farm on the colony once the fishers do not meet its hunger', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    const farmRow = (): boolean => colonyState(sim)?.builds.some((b) => b.building === FARM_ID) === true;
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    expect(farmRow()).toBe(false);
    expect(stepUntil(sim, LADDER_DUE_TICKS, farmRow)).toBe(true);
    sim.step();
    const farm = colonyBuildingsOf(sim).find((e) => sim.world.get(e, Building).buildingType === FARM_TYPE);
    expect(farm).toBeDefined();
  });
});
