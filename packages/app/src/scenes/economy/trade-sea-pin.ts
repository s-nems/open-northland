import type { SceneDefinition } from '../types.js';
import { sceneTrader } from './trade.js';
import {
  buildTradeSea,
  TRADE_SEA_EAST_SLOT,
  TRADE_SEA_ZOOM,
  tradeSeaTerrain,
  tradeSeaWoodAt,
} from './trade-sea.js';

/**
 * The `trade-sea` world with no ship pinned: the route crosses the sea, so the trader's Trade section
 * says it needs a ship. The trader fills its cart and waits until the player presses "Pin a ship" and
 * picks the moored ship. The browser view is that press, the lit ship and the voyage after it.
 */

/** Long enough to show the trader does not set out on its own. */
const RUN_TICKS = 300;

export const tradeSeaPinScene: SceneDefinition = {
  id: 'trade-sea-pin',
  seed: 46,
  terrain: tradeSeaTerrain(),
  build: (sim) => buildTradeSea(sim, false),
  runTicks: RUN_TICKS,
  initialZoom: TRADE_SEA_ZOOM,
  checks: [
    {
      label: 'with no ship pinned the route reads as needing one and no wood crosses',
      predicate: (sim) => {
        const trader = sceneTrader(sim);
        const view = trader === undefined ? undefined : sim.traderView(trader);
        return (
          view?.shipState === 'needed' && view.ship === null && tradeSeaWoodAt(sim, TRADE_SEA_EAST_SLOT) === 0
        );
      },
    },
  ],
};
