import {
  components,
  type Entity,
  type MissionScript,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_TRADER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_COIN,
  GOOD_IRON,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The land trader and a map's trade agreement: a neutral tribe's warehouse offers iron for coins, the
 * player's trader takes command of a handcart and plies it between the home warehouse and that house,
 * and the goods it brings back count toward the script's `NumberOfGoodsTraded` goal, which turns the
 * neighbour friendly. The browser view pairs this with the Handel section of the selected trader, which
 * names the cart and its load.
 */

const MAP_W = 24;
const MAP_H = 12;

/** The neutral trading nation; friendly toward nobody until the goal fires. */
const TRADER_NATION = 1;

const HOME_AT = { x: 5, y: 5 } as const;
const POST_AT = { x: 17, y: 5 } as const;
const TRADER_AT = { x: 6, y: 8 } as const;
/** The handcart the trader commands, a cell beside the trader. */
const CART_AT = { x: 7, y: 8 } as const;

/** The mission object id the agreement names, the `sethouse` column a map would author. */
const POST_MISSION_ID = 900;
/** The agreement: one coin buys four iron (a corpus-like rate; both goods exist in either content base). */
const COIN_PER_BATCH = 1;
const IRON_PER_BATCH = 4;
const COIN_STOCKED = 6;
const IRON_STOCKED = 12;
/** The goal: two batches of iron brought home. */
const IRON_TRADED_GOAL = 8;

/** Several round trips across the map, with slack for the walk. */
const RUN_TICKS = 60 * systems.MISSION_EVALUATION_TICKS;

const { setStockAmount, stampMissionId, Building, Settler, Stockpile } = components;

const missions: MissionScript = {
  missions: [
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: true,
      goals: [
        {
          opcode: 'NumberOfGoodsTraded',
          player: HUMAN_PLAYER,
          otherPlayer: TRADER_NATION,
          amount: IRON_TRADED_GOAL,
        },
      ],
      results: [
        { opcode: 'SetDiplomacy', player: TRADER_NATION, otherPlayer: HUMAN_PLAYER, state: 'friend' },
      ],
    },
  ],
};

function build(sim: Simulation): void {
  const home = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, HOME_AT.x, HOME_AT.y, HUMAN_PLAYER);
  setStockAmount(sim.world, home, GOOD_COIN, COIN_STOCKED);
  const post = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, POST_AT.x, POST_AT.y, TRADER_NATION);
  setStockAmount(sim.world, post, GOOD_IRON, IRON_STOCKED);
  stampMissionId(sim.world, post, POST_MISSION_ID);
  const trader = spawnSettlerDirect(sim, JOB_TRADER, TRADER_AT.x, TRADER_AT.y, HUMAN_PLAYER);
  const cart = spawnVehicleDirect(sim, VEHICLE_HANDCART, CART_AT.x, CART_AT.y);

  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_PLAYER, to: TRADER_NATION, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: TRADER_NATION, to: HUMAN_PLAYER, state: 'neutral' });
  sim.enqueueSetup({
    kind: 'addTradeAgreement',
    missionId: POST_MISSION_ID,
    giveGood: GOOD_COIN,
    giveAmount: COIN_PER_BATCH,
    takeGood: GOOD_IRON,
    takeAmount: IRON_PER_BATCH,
  });
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: home }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: post }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
}

function warehouseOf(sim: Simulation, player: number): Entity | undefined {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (components.ownerOf(sim.world, e) === player) return e;
  }
  return undefined;
}

function stockOf(sim: Simulation, player: number, good: number): number {
  const house = warehouseOf(sim, player);
  return house === undefined ? 0 : (sim.world.get(house, Stockpile).amounts.get(good) ?? 0);
}

export function sceneTrader(sim: Simulation): Entity | undefined {
  for (const e of sim.world.query(Settler)) {
    if (sim.world.get(e, Settler).jobType === JOB_TRADER) return e;
  }
  return undefined;
}

export const tradeScene: SceneDefinition = {
  id: 'trade',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  missions,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the trader commands the handcart and trades on the agreement the neutral warehouse offers',
      predicate: (sim) => {
        const trader = sceneTrader(sim);
        const view = trader === undefined ? undefined : sim.traderView(trader);
        return (
          view?.agreementHolds === true &&
          view.stops.length === 2 &&
          view.cart?.vehicleType === VEHICLE_HANDCART
        );
      },
    },
    {
      label: 'coins reached the trading post and iron came home, four for one',
      predicate: (sim) => {
        const coinsGiven = stockOf(sim, TRADER_NATION, GOOD_COIN);
        const ironTaken = IRON_STOCKED - stockOf(sim, TRADER_NATION, GOOD_IRON);
        return (
          coinsGiven > 0 &&
          ironTaken === coinsGiven * IRON_PER_BATCH &&
          stockOf(sim, HUMAN_PLAYER, GOOD_IRON) >= IRON_TRADED_GOAL
        );
      },
    },
    {
      label: 'the traded goods fired the NumberOfGoodsTraded goal, which made the nation friendly',
      predicate: (sim) => sim.diplomacyStance(TRADER_NATION, HUMAN_PLAYER) === 'friend',
    },
  ],
};
