import { components, type Entity, playerCommand, TICKS_PER_SECOND } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { GOOD_COIN, GOOD_IRON, VEHICLE_HANDCART } from '../../src/game/sandbox/index.js';
import { vehicleLabel } from '../../src/game/technology.js';
import { goodLabel } from '../../src/hud/details-panel/model/context.js';
import { tradePanelModel } from '../../src/hud/details-panel/model/trade.js';
import { messages } from '../../src/i18n/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneTrader, tradeScene } from '../../src/scenes/trade.js';
import { ctxOf } from '../support/sandbox.js';
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

/** The Handel section names the commanded cart with its load, and says so when the trader has none. */
it("the trader's Handel section shows the handcart and its load", () => {
  const sim = createSceneSim(tradeScene);
  sim.run(TICKS_PER_SECOND * 12);
  const trader = sceneTrader(sim);
  expect(trader).toBeDefined();
  if (trader === undefined) return;
  const ctx = {
    ...ctxOf(sim),
    traderView: (entity: number) => sim.traderView(entity as Entity),
    vehicleLabel: (typeId: number) => vehicleLabel(sim.content, typeId),
  };
  const model = tradePanelModel(ctx, sim.snapshot(), trader);
  expect(model).not.toBeNull();
  const view = sim.traderView(trader);
  const cartName = vehicleLabel(sim.content, VEHICLE_HANDCART);
  expect(cartName).toBeDefined();
  expect(view?.cargo.length).toBeGreaterThan(0);
  expect(model?.status[0]).toBe(`${cartName}: ${view?.cargo[0]?.amount} ${goodLabel(ctx, GOOD_COIN)}`);

  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'detachFromVehicle', entity: trader }));
  sim.run(2);
  expect(tradePanelModel(ctx, sim.snapshot(), trader)?.status[0]).toBe(messages().hud.tradeNoCart);
});
