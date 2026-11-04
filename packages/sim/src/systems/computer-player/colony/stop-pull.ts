import { BUILDING_KIND } from '@open-northland/data';
import { Building, ComputerColony, prioritizesGood, TradeRoute } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { homeBuildings } from '../../ai-shared/home-roster.js';
import { storesHeld } from './provision.js';
import { colonyBuildings } from './spot.js';
import { colonyEnv, type SeatEnv } from './voyage.js';

/** The made building materials home's stop store pulls in from home's workshops while a colony's marks
 *  are not met (authored): a trader loads only within its stop's reach, and a workshop out of it, the mason
 *  hut with its marble, kept its goods on its own shelf while the colony's top-tier home waited on them. */
const PULLED_MATERIAL_IDS: readonly string[] = ['brick', 'pillar', 'tile', 'ornament'];

/** Each home store some live colony route stops at, with the `pulled` goods one of those colonies holds
 *  less of than its mark fills it up to. */
function wantedAtStores(env: SeatEnv, pulled: readonly number[]): Map<Entity, Set<number>> {
  const { world, ctx, seat, carrier } = env;
  const home = new Set(homeBuildings(world, ctx, seat));
  const wanted = new Map<Entity, Set<number>>();
  for (const colony of world.tryGet(carrier, ComputerColony)?.colonies ?? []) {
    const trader = colony.phase === 'abandoned' ? null : (colony.route?.trader ?? null);
    const route = trader === null || !world.isAlive(trader) ? undefined : world.tryGet(trader, TradeRoute);
    const homeStop = route?.stops.find((stop) => home.has(stop.house));
    const awayStop = route?.stops.find((stop) => !home.has(stop.house));
    if (homeStop === undefined || awayStop === undefined) continue;
    const goods = wanted.get(homeStop.house) ?? new Set<number>();
    wanted.set(homeStop.house, goods);
    const colonyAt = colonyEnv(env, colony);
    const held = storesHeld(colonyAt, colonyBuildings(colonyAt));
    for (const good of pulled) {
      const mark = awayStop.imports.find((m) => m.good === good);
      if (mark !== undefined && (held.get(good) ?? 0) < mark.upTo) goods.add(good);
    }
  }
  return wanted;
}

/**
 * The orders that keep each `pulled` good, by default {@link PULLED_MATERIAL_IDS}, priority at a home store
 * while any of the seat's colonies routed through it holds less than its mark fills it up to: the store's
 * porters fetch the good from the workshops that made it. Every other home store, one no live route stops
 * at any more among them, has the mark lifted. Once per seat, so colonies sharing a store agree; only a
 * change issues an order.
 */
export function stopPullOrders(
  env: SeatEnv,
  pulled: readonly string[] = PULLED_MATERIAL_IDS,
): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const goods = pulled.flatMap((id) => goodTypeByContentId(ctx.content, id)?.typeId ?? []);
  const wanted = wantedAtStores(env, goods);
  const index = contentIndex(ctx.content);
  const commands: PlayerCommand[] = [];
  for (const store of homeBuildings(world, ctx, seat)) {
    if (index.buildings.get(world.get(store, Building).buildingType)?.kind !== BUILDING_KIND.storage)
      continue;
    const want = wanted.get(store);
    for (const good of goods) {
      const priority = want?.has(good) === true;
      if (priority !== prioritizesGood(world, store, good))
        commands.push({ kind: 'setStorePriority', building: store, goodType: good, priority });
    }
  }
  return commands;
}
