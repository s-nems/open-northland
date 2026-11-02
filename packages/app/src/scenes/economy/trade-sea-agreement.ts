import {
  components,
  type MissionScript,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_COIN,
  GOOD_IRON,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_BIG,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';
import { POST_MISSION_ID, sceneTrader, stockOf, TRADER_NATION } from './trade.js';
import {
  EAST_HOUSE_AT,
  HANDCART_HOLD,
  spawnTradeSeaCrew,
  TRADE_SEA_ZOOM,
  tradeSeaTerrain,
  WEST_HOUSE_AT,
} from './trade-sea.js';

/**
 * A trade agreement across the sea: a friendly nation's warehouse on the east island offers iron and wood
 * for coins, and the trader takes the coins over on the big ship pinned to its route. The iron outweighs
 * one cart load, so the cart ferries between ship and warehouse on both shores. The browser view pairs this
 * with the Trade section of the selected trader and the offers in the diplomacy window.
 */

/** One coin buys four iron, the agreement the route trades on. */
const COIN_FOR_IRON = 1;
const IRON_FOR_COIN = 4;
/** The second offer the house lists, one coin for five wood. */
const COIN_FOR_WOOD = 1;
const WOOD_FOR_COIN = 5;
const IRON_AGREEMENT = 0;
const OFFERS_ON_THE_HOUSE = 2;
const FOREIGN_STOP_SLOT = 1;

const COIN_STOCKED = 6;
const IRON_BOUGHT = COIN_STOCKED * IRON_FOR_COIN;
/** Double what the coins buy, so the house still shows stock when the trader is done. */
const IRON_STOCK_MARGIN = 2;
const IRON_STOCKED = IRON_STOCK_MARGIN * IRON_BOUGHT;
const WOOD_STOCKED = 30;

/** Headroom over the measured run: seed 47 lands the last iron by tick 1874. */
const RUN_TICKS = TICKS_PER_SECOND * 180;

const { setStockAmount, stampMissionId } = components;

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
          amount: IRON_BOUGHT,
        },
      ],
      results: [],
    },
  ],
};

function build(sim: Simulation): void {
  const home = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    WEST_HOUSE_AT.x,
    WEST_HOUSE_AT.y,
    HUMAN_PLAYER,
  );
  setStockAmount(sim.world, home, GOOD_COIN, COIN_STOCKED);
  const post = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    EAST_HOUSE_AT.x,
    EAST_HOUSE_AT.y,
    TRADER_NATION,
  );
  setStockAmount(sim.world, post, GOOD_IRON, IRON_STOCKED);
  setStockAmount(sim.world, post, GOOD_WOOD, WOOD_STOCKED);
  stampMissionId(sim.world, post, POST_MISSION_ID);
  const { trader, ship } = spawnTradeSeaCrew(sim, VEHICLE_SHIP_BIG);

  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_PLAYER, to: TRADER_NATION, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: TRADER_NATION, to: HUMAN_PLAYER, state: 'friend' });
  sim.enqueueSetup({
    kind: 'addTradeAgreement',
    missionId: POST_MISSION_ID,
    giveGood: GOOD_COIN,
    giveAmount: COIN_FOR_IRON,
    takeGood: GOOD_IRON,
    takeAmount: IRON_FOR_COIN,
  });
  sim.enqueueSetup({
    kind: 'addTradeAgreement',
    missionId: POST_MISSION_ID,
    giveGood: GOOD_COIN,
    giveAmount: COIN_FOR_WOOD,
    takeGood: GOOD_WOOD,
    takeAmount: WOOD_FOR_COIN,
  });
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: home }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: post }));
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, { kind: 'setTradeAgreement', entity: trader, agreement: IRON_AGREEMENT }),
  );
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'setTradeShip', entity: trader, ship }));
}

export const tradeSeaAgreementScene: SceneDefinition = {
  id: 'trade-sea-agreement',
  seed: 47,
  terrain: tradeSeaTerrain(),
  build,
  missions,
  runTicks: RUN_TICKS,
  initialZoom: TRADE_SEA_ZOOM,
  checks: [
    {
      label: 'the agreement holds and the route crosses on the pinned big ship with the cart',
      predicate: (sim) => {
        const trader = sceneTrader(sim);
        const view = trader === undefined ? undefined : sim.traderView(trader);
        return (
          view?.agreementHolds === true &&
          view.agreement === IRON_AGREEMENT &&
          view.stops[FOREIGN_STOP_SLOT]?.offers.length === OFFERS_ON_THE_HOUSE &&
          view.shipState === 'ready' &&
          view.ship?.vehicleType === VEHICLE_SHIP_BIG &&
          view.cart?.vehicleType === VEHICLE_HANDCART
        );
      },
    },
    {
      label: 'coins reached the east warehouse and more iron came home than one cart holds, four for one',
      predicate: (sim) => {
        const coinsGiven = stockOf(sim, TRADER_NATION, GOOD_COIN);
        const ironTaken = IRON_STOCKED - stockOf(sim, TRADER_NATION, GOOD_IRON);
        const ironHome = stockOf(sim, HUMAN_PLAYER, GOOD_IRON);
        return (
          coinsGiven === COIN_STOCKED &&
          ironTaken === coinsGiven * IRON_FOR_COIN &&
          ironHome === ironTaken &&
          ironHome > HANDCART_HOLD
        );
      },
    },
    {
      label: 'the traded goods fired the NumberOfGoodsTraded goal',
      predicate: (sim) => sim.missionStatus()[0]?.done === true,
    },
  ],
};
