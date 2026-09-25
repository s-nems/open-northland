import { BUILDING_KIND } from '@open-northland/data';
import {
  AiPlayer,
  aiPlayerEntity,
  Building,
  MissionObjectId,
  ownerOf,
  setStockAmount,
  tradeAgreements,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { handlerTurn, scriptedSeatOnTurn } from '../ai-player/cadence.js';
import type { ContentContext, System, SystemContext } from '../context.js';
import { stockOf } from '../missions/stock.js';
import { bankedSlot } from '../stores/index.js';

/**
 * Handler turns between one computer seat's stock refills, and the level a refilled shelf is left at.
 * Original behavior: on every sixth of its turns the scripted AI handler writes 5 over every stock
 * slot of the seat's finished houses of the storage main type, and `AI_Disable` stops the handler. A trader's partner pays out of that shelf: the corpus authors most computer seats' trade
 * houses empty, the trade tutorial's among them, and no agreement pays out more than 5 a batch.
 */
export const AI_STOCK_REFILL_TURNS = 6;
export const AI_STOCK_REFILL_LEVEL = 5;

/**
 * On a computer seat's refill turn, top its warehouses' shelves up to the refill level for the goods
 * a map agreement pays out there. Approximation: the original levels every slot of every warehouse of
 * the seat, cutting a fuller shelf down too; this build keeps the refill to the traded goods, so a
 * computer seat's own economy runs on what it produces. A seat that died keeps its refill, as the
 * original's handler keeps its turns (it tests its enabled byte alone).
 */
export const tradePartnerStockSystem: System = (world, ctx) => {
  if (handlerTurn(ctx.tick) % AI_STOCK_REFILL_TURNS !== 0) return;
  const seat = scriptedSeatOnTurn(world, ctx.tick);
  if (seat === null) return;
  const agreements = tradeAgreements(world);
  if (agreements.length === 0) return;
  for (const house of world.query(MissionObjectId, Building)) {
    if (ownerOf(world, house) !== seat || !isRefilledHouse(world, ctx, house)) continue;
    const id = world.get(house, MissionObjectId).id;
    for (const agreement of agreements) {
      if (agreement.missionId !== id) continue;
      const slot = bankedSlot(world, ctx, house, agreement.takeGood);
      const level = Math.min(AI_STOCK_REFILL_LEVEL, slot.capacity);
      if (stockOf(world, house, slot.goodType) < level) setStockAmount(world, house, slot.goodType, level);
    }
  }
};

/** A finished warehouse, the kind of house the refill tops up. */
function isRefilledHouse(world: World, ctx: ContentContext, house: Entity): boolean {
  const building = world.get(house, Building);
  return (
    building.built === ONE &&
    contentIndex(ctx.content).buildings.get(building.buildingType)?.kind === BUILDING_KIND.storage
  );
}

/** Whether the refill will top `house`'s shelf of `good` up to `amount` again: a finished warehouse of a
 *  scripted computer seat with room for that many. */
export function refillRestores(
  world: World,
  ctx: SystemContext,
  house: Entity,
  good: number,
  amount: number,
): boolean {
  const owner = ownerOf(world, house);
  const seat = owner === undefined ? null : aiPlayerEntity(world, owner);
  if (seat === null || !world.get(seat, AiPlayer).scripted || !isRefilledHouse(world, ctx, house))
    return false;
  return Math.min(AI_STOCK_REFILL_LEVEL, bankedSlot(world, ctx, house, good).capacity) >= amount;
}
