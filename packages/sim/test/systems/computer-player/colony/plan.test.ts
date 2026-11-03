import { describe, expect, it } from 'vitest';
import { noteSettlerProgress, Settler, SettlerProgress } from '../../../../src/components/index.js';
import { homeTeaches } from '../../../../src/systems/computer-player/colony/industry-read.js';
import {
  type HomesRead,
  homeStepDue,
  siteFree,
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

  it('stands a home ahead of its families while home has no room to build', () => {
    expect(homeStepDue(read({ homeless: 0 }))).toBe(false);
    expect(homeStepDue(read({ homeless: 0, cramped: true }))).toBe(true);
    expect(homeStepDue(read({ homeless: 0, freeSlots: 1, cramped: true }))).toBe(false);
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
