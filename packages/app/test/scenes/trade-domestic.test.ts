import { type Entity, playerCommand, TRADE_LIMIT_NONE } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { tradePanelModel } from '../../src/hud/details-panel/model/trade.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneTrader } from '../../src/scenes/trade.js';
import {
  tradeDomesticGood,
  tradeDomesticHouses,
  tradeDomesticScene,
  tradeDomesticStock,
} from '../../src/scenes/trade-domestic.js';
import { ctxOf } from '../support/sandbox.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(tradeDomesticScene, import.meta.url);

const SWORDS_AT_A = 12;
/** The ceiling the mark sets on B: fewer than A holds, so the ceiling is what stops the trader. */
const SWORD_CEILING = 5;

function sceneRoute() {
  const sim = createSceneSim(tradeDomesticScene);
  sim.run(1);
  const trader = sceneTrader(sim);
  const houses = tradeDomesticHouses(sim);
  const sword = tradeDomesticGood(sim, 'sword_long');
  if (trader === undefined || houses === undefined || sword === undefined) {
    throw new Error('expected the trader on its two-house route');
  }
  return { sim, trader, houses, sword };
}

it('carries long swords into B under the ceiling its mark sets, and nothing else', () => {
  const { sim, trader, houses, sword } = sceneRoute();
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'setTradeImport',
      entity: trader,
      house: houses.b,
      good: sword,
      on: true,
    }),
  );
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'setTradeImportLimits',
      entity: trader,
      house: houses.b,
      good: sword,
      upTo: SWORD_CEILING,
      keep: TRADE_LIMIT_NONE,
    }),
  );
  sim.run(tradeDomesticScene.runTicks);

  expect(tradeDomesticStock(sim, houses.b, sword)).toBe(SWORD_CEILING);
  expect(tradeDomesticStock(sim, houses.a, sword)).toBe(SWORDS_AT_A - SWORD_CEILING);
  const spear = tradeDomesticGood(sim, 'spear_wooden');
  expect(spear === undefined ? -1 : tradeDomesticStock(sim, houses.b, spear)).toBe(0);
});

it("gives the Handel model both houses' stock and the mark as a transfer", () => {
  const { sim, trader, houses, sword } = sceneRoute();
  const ctx = { ...ctxOf(sim), traderView: (entity: number) => sim.traderView(entity as Entity) };
  const model = () => tradePanelModel(ctx, sim.snapshot(), trader);

  expect(model()?.stock?.a.find((row) => row.goodType === sword)?.amount).toBe(SWORDS_AT_A);
  expect(model()?.stock?.b.find((row) => row.goodType === sword)?.amount).toBe(0);
  expect(model()?.transfers).toEqual([]);
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'setTradeImport',
      entity: trader,
      house: houses.b,
      good: sword,
      on: true,
    }),
  );
  sim.step();
  expect(model()?.transfers).toMatchObject([{ goodType: sword, direction: 'toB', upTo: TRADE_LIMIT_NONE }]);
});
