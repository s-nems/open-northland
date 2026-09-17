import { components, playerCommand } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { GOOD_COIN, GOOD_IRON } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneTrader, tradeScene } from '../../src/scenes/trade.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(tradeScene, import.meta.url);

const { Building, Stockpile } = components;

function ironAtHome(sim: ReturnType<typeof createSceneSim>): number {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (components.ownerOf(sim.world, e) === HUMAN_PLAYER) {
      return sim.world.get(e, Stockpile).amounts.get(GOOD_IRON) ?? 0;
    }
  }
  return 0;
}

/** The Handel section's agreement rows end to end: dropping the choice stops the exchange. */
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
