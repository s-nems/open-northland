import { describe, expect, it } from 'vitest';
import { Building, Stockpile, UnderConstruction } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { colonyBuildingsOn } from '../../../../src/systems/ai-shared/home-roster.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { seatArmsStock } from '../../../../src/systems/computer-player/military/outfit.js';
import {
  ARMORY_TYPE,
  colonyState,
  colonyWorld,
  FOOD,
  mooredShip,
  overflowContent,
  SMALL_SHIP,
  SPEAR,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { BARRACKS_TYPE, SEAT, STOCK_TOP_TYPE, VIKING } from '../support.js';

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

/** A seat with room at home and a barracks, whose colony runs and is fed. */
function runningWorld(): Simulation {
  const sim = colonyWorld(7, overflowContent());
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BARRACKS_TYPE,
    ...BARRACKS_AT,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
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
  it('raises an armory of its own and its spears reach the barracks at home', () => {
    const sim = runningWorld();
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
});
