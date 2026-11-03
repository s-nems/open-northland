import {
  cellAnchorNode,
  components,
  type Entity,
  playerCommand,
  type Simulation,
  systems,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  VEHICLE_SHIP_SMALL,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';
import {
  EAST_HOUSE_AT,
  spawnTradeSeaCrew,
  TRADE_SEA_ZOOM,
  tradeSeaTerrain,
  WEST_HOUSE_AT,
} from './trade-sea.js';

/**
 * Stock levels held between two islands. Each island has two warehouses under one signpost, and both
 * stops of the trader's route stand for their whole settlement. The east island is filled up to 20
 * bricks and 20 stone out of both west warehouses, and the west island takes the east's wood down to 30
 * out of both east warehouses. The browser view is the check that the trader works both warehouses on
 * each shore and stops at the levels, and that both stops' "osada" chips stay lit.
 */

/** The second warehouse of each island, north of the route's own. */
const WEST_SECOND_AT = { x: 4, y: 2 } as const;
const EAST_SECOND_AT = { x: 21, y: 2 } as const;
/** One signpost per island between its two warehouses. */
const WEST_POST_AT = { x: 3, y: 6 } as const;
const EAST_POST_AT = { x: 23, y: 6 } as const;

/** The level the east island is filled up to, per good. */
const EAST_LEVEL = 20;
/** The wood left on the east island. */
const EAST_WOOD_KEPT = 30;
/** The east island's stock of each building good, split over its two warehouses. */
const EAST_HELD = [2, 3] as const;
/** The west island's stock of each, the first warehouse short of the east's shortfall so the second gives too. */
const WEST_HELD = [8, 20] as const;
const EAST_WOOD = [25, 25] as const;
const WEST_SLOT = 0;
const EAST_SLOT = 1;
const BUILDING_GOODS = ['brick', 'stone'] as const;

/** Headroom over the measured run: seed 45 settles the last level by tick 2806, and the checks then
 *  hold to the end. */
const RUN_TICKS = TICKS_PER_SECOND * 300;

const { Building, Owner, setStockAmount, Stockpile, TRADE_LIMIT_NONE } = components;

function stampPost(sim: Simulation, at: { readonly x: number; readonly y: number }): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('trade-sea-settlements scene: mapped sim');
  const anchor = cellAnchorNode(at.x, at.y);
  systems.createSignpost(sim.world, terrain, terrain.nodeAt(anchor.hx, anchor.hy), HUMAN_PLAYER);
}

function warehouseAt(sim: Simulation, at: { readonly x: number; readonly y: number }): Entity {
  return placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, at.x, at.y, HUMAN_PLAYER);
}

function build(sim: Simulation): void {
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  const west = [warehouseAt(sim, WEST_HOUSE_AT), warehouseAt(sim, WEST_SECOND_AT)];
  const east = [warehouseAt(sim, EAST_HOUSE_AT), warehouseAt(sim, EAST_SECOND_AT)];
  stampPost(sim, WEST_POST_AT);
  stampPost(sim, EAST_POST_AT);
  const wood = goodBySlug(sim, 'wood');
  const stock = (houses: readonly Entity[], good: number, amounts: readonly number[]): void => {
    houses.forEach((house, i) => {
      setStockAmount(sim.world, house, good, amounts[i] ?? 0);
    });
  };
  for (const slug of BUILDING_GOODS) {
    stock(west, goodBySlug(sim, slug), WEST_HELD);
    stock(east, goodBySlug(sim, slug), EAST_HELD);
  }
  stock(east, wood, EAST_WOOD);

  const { trader, ship } = spawnTradeSeaCrew(sim, VEHICLE_SHIP_SMALL);
  const [westStop, eastStop] = [west[0], east[0]];
  if (westStop === undefined || eastStop === undefined) throw new Error('both islands have a warehouse');
  const order = (command: Parameters<typeof playerCommand>[1]): void => {
    sim.enqueue(playerCommand(HUMAN_PLAYER, command));
  };
  order({ kind: 'attachTradeHouse', entity: trader, house: westStop });
  order({ kind: 'attachTradeHouse', entity: trader, house: eastStop });
  const limits = (house: Entity, good: number, upTo: number, keep: number): void => {
    order({ kind: 'setTradeImport', entity: trader, house, good, on: true });
    order({ kind: 'setTradeImportLimits', entity: trader, house, good, upTo, keep });
  };
  for (const slug of BUILDING_GOODS) limits(eastStop, goodBySlug(sim, slug), EAST_LEVEL, TRADE_LIMIT_NONE);
  limits(westStop, wood, TRADE_LIMIT_NONE, EAST_WOOD_KEPT);
  order({ kind: 'setTradeShip', entity: trader, ship });
  for (const house of [westStop, eastStop]) {
    order({ kind: 'setTradeSettlement', entity: trader, house, on: true });
  }
}

/** The warehouses on the island of the route's stop at `slot`, the stop's own first: the scene places
 *  the west pair before the east pair, so ids run in that order. */
function islandWarehouses(sim: Simulation, slot: number): Entity[] {
  const all = [...sim.world.query(Building, Owner)]
    .filter(
      (house) =>
        sim.world.get(house, Owner).player === HUMAN_PLAYER &&
        sim.world.get(house, Building).buildingType === BUILDING_WAREHOUSE_00,
    )
    .sort((a, b) => a - b);
  const perIsland = WEST_HELD.length;
  return all.slice(slot * perIsland, (slot + 1) * perIsland);
}

function held(sim: Simulation, house: Entity, slug: string): number {
  return sim.world.get(house, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0;
}

function islandStock(sim: Simulation, slot: number, slug: string): number {
  return islandWarehouses(sim, slot).reduce((sum, house) => sum + held(sim, house, slug), 0);
}

export const tradeSeaSettlementsScene: SceneDefinition = {
  id: 'trade-sea-settlements',
  seed: 45,
  terrain: tradeSeaTerrain(),
  build,
  runTicks: RUN_TICKS,
  initialZoom: TRADE_SEA_ZOOM,
  checks: [
    {
      label: 'the east island holds exactly 20 bricks and 20 stone over its two warehouses',
      predicate: (sim) => BUILDING_GOODS.every((slug) => islandStock(sim, EAST_SLOT, slug) === EAST_LEVEL),
    },
    {
      label: "the east island's wood came down to 30 over its two warehouses, and no lower",
      predicate: (sim) => islandStock(sim, EAST_SLOT, 'wood') === EAST_WOOD_KEPT,
    },
    {
      label: 'both west warehouses gave bricks',
      predicate: (sim) => {
        const houses = islandWarehouses(sim, WEST_SLOT);
        return (
          houses.length === WEST_HELD.length &&
          houses.every((house, i) => held(sim, house, 'brick') < (WEST_HELD[i] ?? 0))
        );
      },
    },
  ],
};
