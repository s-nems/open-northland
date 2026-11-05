import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Building,
  ComputerColony,
  noteSettlerProgress,
  Settler,
  SettlerProgress,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import type { Simulation } from '../../../../../src/index.js';
import { everySettlerOf } from '../../../../../src/systems/ai-shared/home-roster.js';
import { foundColony } from '../../../../../src/systems/computer-player/colony/settlement/founding.js';
import {
  colonyLessons,
  schoolLacking,
} from '../../../../../src/systems/computer-player/colony/settlement/school.js';
import { blankColony, colonyWorld, looseColonyEnv } from '../../../../fixtures/colony-islands.js';
import {
  CIVILIST,
  FARM_TYPE,
  FARMER,
  FARMER_TRACK,
  MILL_TYPE,
  MILLER,
  MILLER_GATE_XP,
  SCHOOL_TYPE,
  SEAT,
  STOCK_TYPE,
  technologyContent,
  VIKING,
} from '../../support.js';

/** Spots on the east island, clear of its deposits and of each other. */
const COLONY_SCHOOL = { x: 160, y: 64 };
const COLONY_STORE = { x: 160, y: 84 };
const COLONY_MILL = { x: 150, y: 104 };
/** Where the colony's one man stands. */
const COLONY_MAN_AT = { x: 168, y: 76 };
/** Home's farm, south of the headquarters. */
const HOME_FARM = { x: 60, y: 90 };

/** Place a finished building of the seat's at `at`, and step it in. */
function place(
  sim: Simulation,
  buildingType: number,
  at: { readonly x: number; readonly y: number },
): Entity {
  const before = new Set(sim.world.query(Building));
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType,
    ...at,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
  sim.step();
  const placed = [...sim.world.query(Building)].find((e) => !before.has(e));
  if (placed === undefined) throw new Error(`setup: no building ${buildingType}`);
  return placed;
}

describe('a colony school', () => {
  it('is the plan’s row once the store stands and while the colony has none', () => {
    const sim = colonyWorld(7, technologyContent());
    const terrain = sim.terrain;
    const carrier = aiControlEntity(sim.world, SEAT);
    if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
    const land = terrain.componentOf(terrain.nodeAt(COLONY_SCHOOL.x, COLONY_SCHOOL.y));
    const colony = blankColony(land);
    sim.world.add(carrier, ComputerColony, { colonies: [colony], rejected: [], retryAt: 0 });
    const env = looseColonyEnv(sim, colony);
    const place = (buildingType: number, at: { x: number; y: number }, underConstruction: boolean) => {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType,
        ...at,
        tribe: VIKING,
        owner: SEAT,
        force: true,
        underConstruction,
      });
      sim.step();
      return [...sim.world.query(Building)].filter(
        (e) => sim.world.get(e, Building).buildingType === buildingType,
      );
    };
    expect(schoolLacking(env, [])).toEqual([]);
    const store = place(STOCK_TYPE, COLONY_STORE, false);
    expect(schoolLacking(env, store)).toEqual(['school']);
    const school = place(SCHOOL_TYPE, COLONY_SCHOOL, true);
    expect(schoolLacking(env, [...store, ...school])).toEqual([]);
  });
});

describe("a colony school's lessons", () => {
  it('teach a colony man the trade a workshop seat lacks, and keep the pupil out of posts that decision', () => {
    const sim = colonyWorld(7, technologyContent());
    const terrain = sim.terrain;
    const carrier = aiControlEntity(sim.world, SEAT);
    if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
    // A farmer of home past the miller's gate: the seat has discovered the miller.
    const farm = place(sim, FARM_TYPE, HOME_FARM);
    const farmer = everySettlerOf(sim.world, SEAT).find(
      (e) => sim.world.get(e, Settler).jobType === CIVILIST,
    );
    if (farmer === undefined) throw new Error('setup: no man at home');
    sim.enqueueSetup({ kind: 'assignWorker', entity: farmer, building: farm, jobPriority: [FARMER] });
    sim.step();
    sim.world.mut(farmer, SettlerProgress).experience.set(FARMER_TRACK, MILLER_GATE_XP);
    noteSettlerProgress(sim.world, farmer);
    sim.step();
    for (const [type, at] of [
      [STOCK_TYPE, COLONY_STORE],
      [SCHOOL_TYPE, COLONY_SCHOOL],
      [MILL_TYPE, COLONY_MILL],
    ] as const)
      place(sim, type, at);
    const before = new Set(everySettlerOf(sim.world, SEAT));
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: CIVILIST,
      ...COLONY_MAN_AT,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const man = everySettlerOf(sim.world, SEAT).find((e) => !before.has(e));
    if (man === undefined) throw new Error('setup: no colony man');
    const land = terrain.componentOf(terrain.nodeAt(COLONY_STORE.x, COLONY_STORE.y));
    const colony = blankColony(land, { site: { hx: COLONY_STORE.x, hy: COLONY_STORE.y } });
    sim.world.add(carrier, ComputerColony, { colonies: [colony], rejected: [], retryAt: 0 });
    const env = looseColonyEnv(sim, colony);

    const lessons = colonyLessons(env, [man]);
    expect(lessons.commands).toContainEqual(
      expect.objectContaining({ kind: 'learn', entity: man, target: 'job', typeId: MILLER }),
    );
    expect(lessons.pupils).toContain(man);
    const orders = foundColony(env, colony).filter((order) => 'entity' in order && order.entity === man);
    expect(orders.map((order) => order.kind)).toEqual(['learn']);
  });
});
