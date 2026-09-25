import type { BuildingHighlightItem } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { num } from '../../../game/snapshot.js';

/** The sim's trade-stop rule (`Simulation.canAttachTradeHouse`): whether the trader's route takes the
 *  house. */
export type TradeHouseRule = (trader: number, house: number) => boolean;

/** The houses a trader's route already names, read off its snapshot `TradeRoute`. */
function routeHousesOf(snapshot: WorldSnapshot, settler: number): Set<number> {
  const route = entityById(snapshot, settler)?.components.TradeRoute as { stops?: unknown } | undefined;
  const houses = new Set<number>();
  if (!Array.isArray(route?.stops)) return houses;
  for (const stop of route.stops) {
    const house = num((stop as { house?: unknown }).house);
    if (house !== undefined) houses.add(house);
  }
  return houses;
}

/**
 * The "add a house to the trade route" pick: a house an armed trader's route takes is lit green, one
 * already on a route red, and the rest stay unlit, so another tribe's houses light only where an
 * agreement trades.
 */
export const tradeHousePick = {
  highlight(
    snapshot: WorldSnapshot,
    settlers: readonly number[],
    canAttach: TradeHouseRule,
  ): BuildingHighlightItem[] {
    const routes = settlers.map((settler) => routeHousesOf(snapshot, settler));
    const items: BuildingHighlightItem[] = [];
    for (const e of snapshot.entities) {
      if (e.components.Building === undefined) continue;
      if (settlers.some((settler) => canAttach(settler, e.id))) items.push({ id: e.id, ok: true });
      else if (routes.some((taken) => taken.has(e.id))) items.push({ id: e.id, ok: false });
    }
    return items;
  },
  onRoute(snapshot: WorldSnapshot, building: number, settler: number): boolean {
    return routeHousesOf(snapshot, settler).has(building);
  },
};
