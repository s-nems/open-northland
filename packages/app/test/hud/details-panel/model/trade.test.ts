import type { Entity, Simulation, TraderShipState, TraderView } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { tradePanelModel } from '../../../../src/hud/details-panel/model/trade.js';
import { messages } from '../../../../src/i18n/index.js';
import { sceneTrader } from '../../../../src/scenes/economy/trade.js';
import { tradeSeaScene, tradeSeaShip } from '../../../../src/scenes/economy/trade-sea.js';
import { tradeSeaPinScene } from '../../../../src/scenes/economy/trade-sea-pin.js';
import { createSceneSim } from '../../../../src/scenes/runtime.js';
import { ctxOf } from '../../../support/sandbox.js';

const GOOD_WOOD_UNITS = 3;

function traderModel(sim: Simulation, adjust: (view: TraderView) => TraderView = (view) => view) {
  const trader = sceneTrader(sim);
  if (trader === undefined) throw new Error('expected the scene trader');
  const ctx = {
    ...ctxOf(sim),
    traderView: (entity: number) => {
      const view = sim.traderView(entity as Entity);
      return view === undefined ? undefined : adjust(view);
    },
  };
  return tradePanelModel(ctx, sim.snapshot(), trader);
}

function sceneAt(scene: typeof tradeSeaScene): Simulation {
  const sim = createSceneSim(scene);
  sim.run(1);
  return sim;
}

describe('the Trade section’s ship row', () => {
  it('offers the pin and says why on a crossing with no ship', () => {
    const copy = messages().hud.settlerPanel;
    expect(traderModel(sceneAt(tradeSeaPinScene))?.ship).toEqual({
      ship: null,
      note: { label: copy.tradeShipNeeded, tooltip: copy.tradeShipNeededTooltip },
    });
  });

  it('explains a ship only when it cannot serve the route', () => {
    const copy = messages().hud.settlerPanel;
    const noteFor = (shipState: TraderShipState) =>
      traderModel(sceneAt(tradeSeaScene), (view) => ({ ...view, shipState }))?.ship.note;
    expect(noteFor('unreachable')).toEqual({
      label: copy.tradeShipUnreachable,
      tooltip: copy.tradeShipUnreachableTooltip,
    });
    expect(noteFor('ready')).toBeNull();
    expect(noteFor('notNeeded')).toBeNull();
  });

  it('keeps the pinned ship with its hold on a route that no longer needs it', () => {
    const sim = sceneAt(tradeSeaScene);
    const wood = sim.content.goods.find((good) => good.id === 'wood')?.typeId ?? -1;
    const row = traderModel(sim, (view) => ({
      ...view,
      shipState: 'notNeeded',
      shipCargo: [{ good: wood, amount: GOOD_WOOD_UNITS }],
    }))?.ship;
    expect(row?.ship?.entity).toBe(tradeSeaShip(sim));
    expect(row?.ship?.load).toContain(String(GOOD_WOOD_UNITS));
  });
});
