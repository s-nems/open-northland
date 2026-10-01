import { components, type Entity, playerCommand } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { grassTerrain } from '../../src/catalog/buildings.js';
import { JOB_TRADER } from '../../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import {
  BUILDING_BAKERY,
  BUILDING_WAREHOUSE_00,
  GOOD_BREAD,
  GOOD_COIN,
  GOOD_FOOD_SIMPLE,
  GOOD_IRON,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../src/game/sandbox/index.js';
import { tradePanelModel } from '../../src/hud/details-panel/model/trade.js';
import { createSceneSim, createSceneWorld } from '../../src/scenes/runtime.js';
import { sceneTrader, tradeScene } from '../../src/scenes/trade.js';
import { ctxOf } from '../support/sandbox.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(tradeScene, import.meta.url);

const { Building, Stockpile } = components;

const DISH_MAP_W = 24;
const DISH_MAP_H = 12;
const BAKERY_AT = { x: 5, y: 5 } as const;
const STORE_AT = { x: 15, y: 5 } as const;
const BREAD_STOCKED = 4;

function ironAtHome(sim: ReturnType<typeof createSceneSim>): number {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (components.ownerOf(sim.world, e) === HUMAN_PLAYER) {
      return sim.world.get(e, Stockpile).amounts.get(GOOD_IRON) ?? 0;
    }
  }
  return 0;
}

/** The Trade section's agreement rows end to end: dropping the choice stops the exchange. */
it('a trader with no agreement chosen carts nothing across', () => {
  const sim = createSceneSim(tradeScene);
  sim.run(1);
  const trader = sceneTrader(sim);
  expect(trader).toBeDefined();
  if (trader === undefined) return;
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'setTradeAgreement', entity: trader, agreement: -1 }));
  sim.run(tradeScene.runTicks);

  expect(ironAtHome(sim)).toBe(0);
  const view = sim.traderView(trader);
  expect(view?.agreement).toBe(-1);
  expect(view?.cargo.some((line) => line.good === GOOD_COIN)).toBe(false);
});

/** A dish a house holds is offered as its edible at a storehouse, which stocks the edible only. */
it('offers the edible of a dish the other stop holds as a good to carry', () => {
  const sim = createSceneWorld({ seed: 1, terrain: grassTerrain(DISH_MAP_W, DISH_MAP_H), build: () => {} });
  const bakery = placeBuiltSandboxBuilding(sim, BUILDING_BAKERY, BAKERY_AT.x, BAKERY_AT.y, HUMAN_PLAYER);
  components.setStockAmount(sim.world, bakery, GOOD_BREAD, BREAD_STOCKED);
  const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, STORE_AT.x, STORE_AT.y, HUMAN_PLAYER);
  const trader = spawnSettlerDirect(sim, JOB_TRADER, BAKERY_AT.x, BAKERY_AT.y + 2, HUMAN_PLAYER);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: bakery }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: store }));
  sim.run(1);
  const ctx = { ...ctxOf(sim), traderView: (entity: number) => sim.traderView(entity as Entity) };

  const model = tradePanelModel(ctx, sim.snapshot(), trader);

  expect(model?.stops.map((stop) => stop.house)).toEqual([bakery, store]);
  expect(model?.stock?.b.some((row) => row.goodType === GOOD_FOOD_SIMPLE)).toBe(true);
  expect(model?.transfers).toEqual([]);
});
