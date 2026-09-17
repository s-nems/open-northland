import type { BuildingHighlightItem } from '@open-northland/render';
import { entityById, ONE, type WorldSnapshot } from '@open-northland/sim';
import { num } from '../../../game/snapshot.js';

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

function isStandingHouse(e: { readonly components: Readonly<Record<string, unknown>> }): boolean {
  const building = e.components.Building as { built?: unknown } | undefined;
  return (
    building !== undefined && num(building.built) === ONE && e.components.UnderConstruction === undefined
  );
}

/**
 * The "add a house to the trade route" pick: every finished building on the map is a candidate, lit
 * green unless the route already names it. Ownership is no gate, since the exchange happens at another
 * tribe's house; the sim's authority check admits the foreign house for these orders alone.
 */
export const tradeHousePick = {
  highlight(snapshot: WorldSnapshot, settler: number): BuildingHighlightItem[] {
    const taken = routeHousesOf(snapshot, settler);
    const items: BuildingHighlightItem[] = [];
    for (const e of snapshot.entities) {
      if (!isStandingHouse(e)) continue;
      items.push({ id: e.id, ok: !taken.has(e.id) });
    }
    return items;
  },
  assignableAt(snapshot: WorldSnapshot, building: number, settler: number): boolean {
    const e = entityById(snapshot, building);
    return e !== undefined && isStandingHouse(e) && !routeHousesOf(snapshot, settler).has(building);
  },
};
