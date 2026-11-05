import { TICKS_PER_SECOND } from '@open-northland/sim';
import type { SceneDefinition } from '../types.js';
import { sceneTrader } from './trade.js';
import { buildTradeSea, TRADE_SEA_ZOOM, tradeSeaShip, tradeSeaTerrain } from './trade-sea.js';

/**
 * The `trade-sea` world with no ship pinned: the route crosses the sea, so the trader's Trade section
 * says it needs a ship, and the moored ship is free to pin. The trader fills its cart and stays ashore
 * until the player presses "Pin a ship" and picks the ship. The browser view is that press, the lit
 * ship and the voyage after it.
 */

/** Past the tick a pinned trader has boarded, so staying ashore shows; the test watches every tick. */
const RUN_TICKS = TICKS_PER_SECOND * 100;

export const tradeSeaPinScene: SceneDefinition = {
  id: 'trade-sea-pin',
  seed: 46,
  terrain: tradeSeaTerrain(),
  build: (sim) => buildTradeSea(sim, false),
  runTicks: RUN_TICKS,
  initialZoom: TRADE_SEA_ZOOM,
  checks: [
    {
      label: 'with no ship pinned the route reads as needing one and the moored ship can be pinned',
      predicate: (sim) => {
        const trader = sceneTrader(sim);
        const ship = tradeSeaShip(sim);
        if (trader === undefined || ship === undefined) return false;
        const view = sim.traderView(trader);
        return (
          view?.shipState === 'needed' &&
          view.ship === null &&
          sim.tradeShipsPinnableBy(trader).includes(ship)
        );
      },
    },
  ],
};
