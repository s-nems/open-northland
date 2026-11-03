import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Stockpile, UnderConstruction } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { colonyBuildingsOn } from '../../../../src/systems/ai-shared/home-roster.js';
import { colonyIndustries } from '../../../../src/systems/computer-player/colony/industry-read.js';
import { colonyStockPolicyOf } from '../../../../src/systems/computer-player/colony/stock-policy.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { seatArmsStock } from '../../../../src/systems/computer-player/military/outfit.js';
import {
  ARMORY_TYPE,
  colonyBuildingsOf,
  colonyState,
  colonyWorld,
  editColony,
  FOOD,
  looseColonyEnv,
  mooredShip,
  overflowContent,
  SMALL_SHIP,
  SPEAR,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { BARRACKS_TYPE, SEAT, STOCK_TOP_TYPE, VIKING, WOOD } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const RUNNING_DUE_TICKS = minutesToTicks(30);
const PLANNED_DUE_TICKS = minutesToTicks(15);
const WORKSHOP_DUE_TICKS = minutesToTicks(30);
const HOME_DUE_TICKS = minutesToTicks(60);
const SECOND_SHIP_AT = { x: 90, y: 100 };
/** Beside the headquarters, inside its signposts. */
const BARRACKS_AT = { x: 60, y: 80 };
const ARMORY_ID = 'work_armory_00';
/** A meal a mouth for a colony's first party and more. */
const COLONY_FOOD = 40;

const HOLY_OIL = 48;
const MUSHROOM = 49;
const DRUID_HUT_TYPE = 60;
const TEMPLE_TYPE = 61;
const DRUID = 11;
/** Beside the barracks, inside the headquarters' signposts. */
const DRUID_HUT_AT = { x: 60, y: 96 };
/** The holy oil a temple wants in store. */
const TEMPLE_OIL_UNITS = 1;

/** {@link overflowContent} with a druid hut boiling holy oil and a temple, the armourer's prayer place. */
function templeContent(): ContentSet {
  const base = overflowContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: HOLY_OIL, id: 'holy_oil', weight: 1 },
      { typeId: MUSHROOM, id: 'mushroom', weight: 1 },
    ],
    jobs: [...base.jobs, { typeId: DRUID, id: 'druid' }],
    buildings: [
      ...base.buildings,
      {
        typeId: DRUID_HUT_TYPE,
        id: 'work_druid_00',
        kind: 'workplace',
        workers: [{ jobType: DRUID, count: 1 }],
        recipes: [
          {
            inputs: [{ goodType: MUSHROOM, amount: 1 }],
            outputs: [{ goodType: HOLY_OIL, amount: 1 }],
            ticks: 180,
          },
        ],
        construction: [{ goodType: WOOD, amount: 2 }],
      },
      {
        typeId: TEMPLE_TYPE,
        id: 'work_temple',
        kind: 'workplace',
        workers: [],
        construction: [{ goodType: WOOD, amount: 2 }],
      },
    ],
  });
}

/** The mushrooms an armoury's bill takes in {@link mushroomArmoryContent}. */
const ARMORY_MUSHROOMS = 2;

/** {@link overflowContent} with an armoury whose bill takes mushrooms, a good neither settlement has. */
function mushroomArmoryContent(): ContentSet {
  const base = overflowContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: MUSHROOM, id: 'mushroom', weight: 1 }],
    buildings: base.buildings.map((b) =>
      b.typeId === ARMORY_TYPE
        ? { ...b, construction: [...b.construction, { goodType: MUSHROOM, amount: ARMORY_MUSHROOMS }] }
        : b,
    ),
  });
}

function placeAtHome(sim: Simulation, buildingType: number, at: { x: number; y: number }): void {
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType,
    ...at,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
}

/** A seat with room at home and a barracks, whose colony runs and is fed; with `oil`, home boils holy oil. */
function runningWorld(oil = false, content = oil ? templeContent() : overflowContent()): Simulation {
  const sim = colonyWorld(7, content);
  placeAtHome(sim, BARRACKS_TYPE, BARRACKS_AT);
  if (oil) placeAtHome(sim, DRUID_HUT_TYPE, DRUID_HUT_AT);
  stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
  mooredShip(sim);
  stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, RUNNING_DUE_TICKS, () => colonyState(sim)?.phase === 'running'))
    throw new Error('setup: no running colony');
  const land = colonyState(sim)?.land ?? -1;
  const store = colonyBuildingsOn(sim.world, ctxOf(sim), SEAT, land).find(
    (e) => sim.world.get(e, Building).buildingType === STOCK_TOP_TYPE,
  );
  if (store === undefined) throw new Error('setup: no colony store');
  sim.world.mut(store, Stockpile).amounts.set(FOOD, COLONY_FOOD);
  return sim;
}

function colonyArmory(sim: Simulation): Entity | undefined {
  const land = colonyState(sim)?.land ?? -1;
  return colonyBuildingsOn(sim.world, ctxOf(sim), SEAT, land).find(
    (e) => sim.world.get(e, Building).buildingType === ARMORY_TYPE,
  );
}

describe('a colony with wood and room', () => {
  it('chooses an armoury, raises it and its spears reach the barracks at home', () => {
    const sim = runningWorld();
    const colony = editColony(sim);
    const chosen = colonyIndustries(looseColonyEnv(sim, colony), colony, colonyBuildingsOf(sim));
    expect(chosen?.site.wood).toBe(true);
    expect(chosen?.choices.map((c) => c.industry)).toContain('armoury');
    const planned = () => colonyState(sim)?.builds.some((b) => b.building === ARMORY_ID) === true;
    expect(stepUntil(sim, PLANNED_DUE_TICKS, planned)).toBe(true);
    expect(colonyState(sim)?.overflow).toEqual([]);
    expect(
      stepUntil(sim, WORKSHOP_DUE_TICKS, () => {
        const armory = colonyArmory(sim);
        return armory !== undefined && !sim.world.has(armory, UnderConstruction);
      }),
    ).toBe(true);
    const armed = () => seatArmsStock(sim.world, ctxOf(sim), SEAT)?.units(SPEAR) ?? 0;
    expect(stepUntil(sim, HOME_DUE_TICKS, () => armed() > 0)).toBe(true);
  });

  it('opens its armoury site only once its stores hold the bill', () => {
    const sim = runningWorld(false, mushroomArmoryContent());
    expect(stepUntil(sim, PLANNED_DUE_TICKS, () => colonyArmory(sim) !== undefined)).toBe(false);
    const store = colonyBuildingsOf(sim).find(
      (e) => sim.world.get(e, Building).buildingType === STOCK_TOP_TYPE,
    );
    if (store === undefined) throw new Error('setup: no colony store');
    sim.world.mut(store, Stockpile).amounts.set(MUSHROOM, ARMORY_MUSHROOMS);
    expect(stepUntil(sim, PLANNED_DUE_TICKS, () => colonyArmory(sim) !== undefined)).toBe(true);
  });

  it("has its trader bring the holy oil its armourers' temple takes, home boiling it", () => {
    const sim = runningWorld(true);
    const colony = editColony(sim);
    const env = looseColonyEnv(sim, colony);
    const chosen = colonyIndustries(env, colony, colonyBuildingsOf(sim));
    expect(chosen?.choices.map((c) => c.industry)).toEqual(expect.arrayContaining(['armoury', 'temple']));
    const oil = colonyStockPolicyOf(env, new Set()).inbound.find((m) => m.good === HOLY_OIL);
    expect(oil?.upTo).toBe(TEMPLE_OIL_UNITS);
  });
});
