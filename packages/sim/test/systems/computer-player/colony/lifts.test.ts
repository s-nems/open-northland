import { describe, expect, it } from 'vitest';
import { aiControlEntity, Building, ComputerColony, Stockpile } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { liftColony } from '../../../../src/systems/computer-player/colony/lifts.js';
import { blankColony, colonyWorld, looseColonyEnv } from '../../../fixtures/colony-islands.js';
import {
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  SEAT,
  STOCK_TOP_TYPE,
  VIKING,
  WOOD,
} from '../support.js';

/** A store and a bakery on the east island, clear of its deposits and of each other. */
const COLONY_STORE = { x: 160, y: 64 };
const COLONY_BAKERY = { x: 160, y: 84 };
const ORIGIN = { hx: COLONY_STORE.x, hy: COLONY_STORE.y };
/** A home site on the home island, beside its headquarters. */
const HOME_SITE = { x: 72, y: 84 };
/** The fixture's upper bakery's bill: two wood. */
const LIFT_WOOD = 2;
const RAIDERS = 2;

function placed(sim: Simulation, buildingType: number, at: { x: number; y: number }): Entity {
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
  const found = [...sim.world.query(Building)].find(
    (e) => sim.world.get(e, Building).buildingType === buildingType,
  );
  if (found === undefined) throw new Error(`setup: no building of type ${buildingType}`);
  return found;
}

/** A running colony of the seat round a top-tier store holding `wood` and a lower-tier bakery. */
function colonyWithBakery(wood: number): { sim: Simulation; store: Entity; bakery: Entity } {
  const sim = colonyWorld(7);
  const store = placed(sim, STOCK_TOP_TYPE, COLONY_STORE);
  const bakery = placed(sim, BAKERY_TYPE, COLONY_BAKERY);
  const terrain = sim.terrain;
  const carrier = aiControlEntity(sim.world, SEAT);
  if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
  const land = terrain.componentOf(terrain.nodeAt(COLONY_STORE.x, COLONY_STORE.y));
  sim.world.add(carrier, ComputerColony, { colonies: [blankColony(land)], rejected: [], retryAt: 0 });
  sim.world.mut(store, Stockpile).amounts.set(WOOD, wood);
  return { sim, store, bakery };
}

function lift(sim: Simulation, buildings: readonly Entity[], raiders = 0) {
  const state = sim.world.get(aiControlEntity(sim.world, SEAT) as Entity, ComputerColony);
  const colony = { ...blankColony(state.colonies[0]?.land ?? -1) };
  if (raiders > 0) colony.threat = { at: { hx: 0, hy: 0 }, men: raiders, since: sim.tick };
  const env = looseColonyEnv(sim, colony);
  return liftColony(env, colony, { buildings, store: buildings[0] ?? null, origin: ORIGIN, plan: [] });
}

describe('a colony lift', () => {
  it('raises a workshop placed below its chain top once the stores hold the bill and no raider is about', () => {
    const { sim, store, bakery } = colonyWithBakery(LIFT_WOOD);
    expect(lift(sim, [store, bakery])).toEqual([
      { kind: 'upgradeBuilding', building: bakery, target: BAKERY_TOP_TYPE },
    ]);
    expect(lift(sim, [store, bakery], RAIDERS)).toEqual([]);
  });

  it('waits for the bill in the colony’s stores', () => {
    const { sim, store, bakery } = colonyWithBakery(LIFT_WOOD - 1);
    expect(lift(sim, [store, bakery])).toEqual([]);
  });

  it('waits while home’s own sites lack a good of its bill past what home’s stores hold', () => {
    const { sim, store, bakery } = colonyWithBakery(LIFT_WOOD);
    const hq = [...sim.world.query(Building)].find(
      (e) => sim.world.get(e, Building).buildingType === HQ_TYPE,
    );
    if (hq === undefined) throw new Error('setup: no headquarters');
    sim.world.mut(hq, Stockpile).amounts.delete(WOOD);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      ...HOME_SITE,
      tribe: VIKING,
      owner: SEAT,
      force: true,
      underConstruction: true,
    });
    sim.step();
    expect(lift(sim, [store, bakery])).toEqual([]);
  });
});
