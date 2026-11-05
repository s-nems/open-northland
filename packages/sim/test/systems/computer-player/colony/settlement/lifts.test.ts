import type { ContentSet } from '@open-northland/data';
import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { aiControlEntity, Building, ComputerColony, Stockpile } from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import type { Simulation } from '../../../../../src/index.js';
import { liftColony, liftStore } from '../../../../../src/systems/computer-player/colony/settlement/lifts.js';
import {
  blankColony,
  colonyContent,
  colonyWorld,
  looseColonyEnv,
} from '../../../../fixtures/colony-islands.js';
import {
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  SEAT,
  STOCK_TOP_TYPE,
  STOCK_TYPE,
  TOWER_TYPE,
  VIKING,
  WOOD,
} from '../../support.js';

/** A store and a bakery on the east island, clear of its deposits and of each other. */
const COLONY_STORE = { x: 160, y: 64 };
const COLONY_BAKERY = { x: 160, y: 84 };
const COLONY_TOWER = { x: 184, y: 64 };
const ORIGIN = { hx: COLONY_STORE.x, hy: COLONY_STORE.y };
/** A home site on the home island, beside its headquarters. */
const HOME_SITE = { x: 72, y: 84 };
/** The fixture's upper bakery's bill: two wood. */
const LIFT_WOOD = 2;
const RAIDERS = 2;
/** A lower tower tier for the fixture's level-2 tower to lift from. */
const TOWER_BASE_TYPE = 97;

/** {@link colonyContent} with a level-1 tower whose lift to the level-2 tower costs that tower's bill. */
function towerContent(): ContentSet {
  const base = colonyContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: TOWER_BASE_TYPE,
        id: 'tower_00',
        kind: 'tower',
        upgradeTarget: TOWER_TYPE,
        construction: [{ goodType: WOOD, amount: LIFT_WOOD }],
      },
    ],
  });
}

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
function colonyWithBakery(
  wood: number,
  content = colonyContent(),
): { sim: Simulation; store: Entity; bakery: Entity } {
  const sim = colonyWorld(7, content);
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

/** `content` with the store chain joined, its top tier banned for the seat's tribe when `topBanned`. */
function chainedStores(content: ContentSet, topBanned = false): ContentSet {
  const buildings = content.buildings.map((b) =>
    b.typeId === STOCK_TYPE ? { ...b, upgradeTarget: STOCK_TOP_TYPE } : b,
  );
  if (!topBanned) return { ...content, buildings };
  const all = <T extends { readonly typeId: number }>(rows: readonly T[]) => rows.map((r) => r.typeId);
  const tribes = content.tribes.map((t) =>
    t.typeId === VIKING
      ? {
          ...t,
          permissions: {
            job: all(content.jobs),
            house: all(buildings).filter((id) => id !== STOCK_TOP_TYPE),
            good: all(content.goods),
          },
        }
      : t,
  );
  return { ...content, buildings, tribes };
}

/** A running colony of the seat on the east island round a built base-tier store holding `wood`. */
function colonyWithStore(content: ContentSet, wood: number): { sim: Simulation; store: Entity } {
  const sim = colonyWorld(7, content);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: STOCK_TYPE,
    ...COLONY_STORE,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
  sim.step();
  const terrain = sim.terrain;
  const carrier = aiControlEntity(sim.world, SEAT);
  if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
  const land = terrain.componentOf(terrain.nodeAt(COLONY_STORE.x, COLONY_STORE.y));
  sim.world.add(carrier, ComputerColony, { colonies: [blankColony(land)], rejected: [], retryAt: 0 });
  const store = [...sim.world.query(Building)].find(
    (e) => sim.world.get(e, Building).buildingType === STOCK_TYPE,
  );
  if (store === undefined) throw new Error('setup: no store');
  sim.world.mut(store, Stockpile).amounts.set(WOOD, wood);
  return { sim, store };
}

function liftStoreOf(sim: Simulation, store: Entity, raiders = 0) {
  const state = sim.world.get(aiControlEntity(sim.world, SEAT) as Entity, ComputerColony);
  const colony = { ...blankColony(state.colonies[0]?.land ?? -1) };
  if (raiders > 0) colony.threat = { at: { hx: 0, hy: 0 }, men: raiders, since: sim.tick };
  const env = looseColonyEnv(sim, colony);
  return liftStore(env, colony, { buildings: [store], store, origin: ORIGIN, plan: [] });
}

describe('a colony lift', () => {
  it('raises a workshop placed below its chain top once the stores hold the bill and no raider is about', () => {
    const { sim, store, bakery } = colonyWithBakery(LIFT_WOOD);
    expect(lift(sim, [store, bakery])).toEqual([
      { kind: 'upgradeBuilding', building: bakery, target: BAKERY_TOP_TYPE },
    ]);
    expect(lift(sim, [store, bakery], RAIDERS)).toEqual([]);
  });

  it('raises a tower to the upper tier once no workshop waits on a lift', () => {
    const { sim, store, bakery } = colonyWithBakery(LIFT_WOOD, towerContent());
    const tower = placed(sim, TOWER_BASE_TYPE, COLONY_TOWER);
    expect(lift(sim, [store, bakery, tower])).toEqual([
      { kind: 'upgradeBuilding', building: bakery, target: BAKERY_TOP_TYPE },
    ]);
    expect(lift(sim, [store, tower])).toEqual([
      { kind: 'upgradeBuilding', building: tower, target: TOWER_TYPE },
    ]);
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

describe('a colony warehouse', () => {
  it('placed lower goes straight to the top tier once its own pile holds the bill and no raider is about', () => {
    const { sim, store } = colonyWithStore(chainedStores(colonyContent()), LIFT_WOOD);
    expect(liftStoreOf(sim, store)).toEqual([
      { kind: 'upgradeBuilding', building: store, target: STOCK_TOP_TYPE },
    ]);
    expect(liftStoreOf(sim, store, RAIDERS)).toEqual([]);
    sim.world.mut(store, Stockpile).amounts.set(WOOD, LIFT_WOOD - 1);
    expect(liftStoreOf(sim, store)).toEqual([]);
  });

  it('stays where it is while the top tier is not the tribe’s', () => {
    const { sim, store } = colonyWithStore(chainedStores(colonyContent(), true), LIFT_WOOD);
    expect(liftStoreOf(sim, store)).toEqual([]);
  });
});
