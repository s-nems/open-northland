import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { aiControlEntity, Building, ComputerColony, Stockpile } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { liftStore } from '../../../../src/systems/computer-player/colony/settlement/lifts.js';
import { colonyStoreType } from '../../../../src/systems/computer-player/colony/store-type.js';
import { blankColony, colonyContent, colonyWorld, looseColonyEnv } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT, STOCK_TOP_TYPE, STOCK_TYPE, VIKING, WOOD } from '../support.js';

/** A store on the east island, clear of its deposits. */
const COLONY_STORE = { x: 160, y: 64 };
/** What upgrading the fixture's store to its top tier takes: the top tier's own bill. */
const COLONY_STORE_NODE = { hx: COLONY_STORE.x, hy: COLONY_STORE.y };
const LIFT_WOOD = 2;
const RAIDERS = 2;

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

function lift(sim: Simulation, store: Entity, raiders = 0) {
  const state = sim.world.get(aiControlEntity(sim.world, SEAT) as Entity, ComputerColony);
  const colony = { ...blankColony(state.colonies[0]?.land ?? -1) };
  if (raiders > 0) colony.threat = { at: { hx: 0, hy: 0 }, men: raiders, since: sim.tick };
  const env = looseColonyEnv(sim, colony);
  return liftStore(env, colony, { buildings: [store], store, origin: COLONY_STORE_NODE, plan: [] });
}
describe('a colony warehouse', () => {
  it('is placed at the top tier once the tribe has it, else at the highest it has', () => {
    const top = colonyWorld(7, chainedStores(colonyContent()));
    expect(colonyStoreType(top.world, ctxOf(top), SEAT)?.typeId).toBe(STOCK_TOP_TYPE);
    const banned = colonyWorld(7, chainedStores(colonyContent(), true));
    expect(colonyStoreType(banned.world, ctxOf(banned), SEAT)?.typeId).toBe(STOCK_TYPE);
  });

  it('placed lower goes straight to the top tier once its own pile holds the bill and no raider is about', () => {
    const { sim, store } = colonyWithStore(chainedStores(colonyContent()), LIFT_WOOD);
    expect(lift(sim, store)).toEqual([{ kind: 'upgradeBuilding', building: store, target: STOCK_TOP_TYPE }]);
    expect(lift(sim, store, RAIDERS)).toEqual([]);
    sim.world.mut(store, Stockpile).amounts.set(WOOD, LIFT_WOOD - 1);
    expect(lift(sim, store)).toEqual([]);
  });

  it('stays where it is while the top tier is not the tribe’s', () => {
    const { sim, store } = colonyWithStore(chainedStores(colonyContent(), true), LIFT_WOOD);
    expect(lift(sim, store)).toEqual([]);
  });
});
