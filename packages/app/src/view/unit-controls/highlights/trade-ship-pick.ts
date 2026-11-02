import type { TargetMark } from '@open-northland/render';
import { entitiesWith, entityById, type WorldSnapshot } from '@open-northland/sim';
import { num } from '../../../game/snapshot/index.js';
import { markOf } from './target-mark.js';

/** The sim's ship pin rule (`SessionHost.tradeShipsPinnableBy`): whether the ship pins to the trader. */
export type TradeShipRule = (trader: number, ship: number) => boolean;

/** The ship pinned to the trader, or undefined. */
function pinnedShipOf(snapshot: WorldSnapshot, trader: number): number | undefined {
  const pin = entityById(snapshot, trader)?.components.TradeShip as { vehicle?: unknown } | undefined;
  return num(pin?.vehicle);
}

/** The "pin a ship to the route" pick: a ship the rule takes is lit, the trader's own pinned ship
 *  refused, and the rest stay unjudged. */
export const tradeShipPick = {
  highlight(snapshot: WorldSnapshot, trader: number, canPin: TradeShipRule): TargetMark[] {
    const pinned = pinnedShipOf(snapshot, trader);
    const items: TargetMark[] = [];
    for (const e of entitiesWith(snapshot, 'Vehicle')) {
      if (canPin(trader, e.id)) items.push(markOf(e.id, true));
      else if (e.id === pinned) items.push(markOf(e.id, false));
    }
    return items;
  },
};
