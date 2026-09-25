import {
  addTradeAgreement,
  addTradeStop,
  Building,
  clearTradeImports,
  ownerOf,
  removeTradeStop,
  Settler,
  setTradeAgreement,
  setTradeImport,
  tradeAgreements,
  tradeRouteOf,
} from '../../components/index.js';
import type { TradeAgreementCommand, TradeCommand } from '../../core/commands/trade.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext, SystemContext } from '../context.js';
import { isTraderJob } from '../readviews/jobs.js';
import { agreementsAt } from './agreements.js';

function isTrader(world: World, ctx: ContentContext, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && isTraderJob(ctx.content, settler.jobType);
}

/**
 * Whether `attachTradeHouse` puts `house` on the trader's route: a standing house not on it yet that
 * keeps a stock when it is the trader's own, or that offers an agreement when it is another player's.
 * Trade inside the settlement moves any good; with another tribe only the house's agreements trade, so
 * a house offering none is no stop (owner's choice, so the house pick lights only the houses that trade).
 */
export function canAttachTradeHouse(
  world: World,
  ctx: ContentContext,
  trader: Entity,
  house: Entity,
): boolean {
  if (!isTrader(world, ctx, trader) || !world.isAlive(house)) return false;
  const building = world.tryGet(house, Building);
  if (building === undefined || building.built !== ONE) return false;
  if (tradeRouteOf(world, trader)?.stops.some((stop) => stop.house === house) === true) return false;
  if (ownerOf(world, house) !== ownerOf(world, trader)) return agreementsAt(world, house).length > 0;
  return (contentIndex(ctx.content).storedGoodsByBuilding.get(building.buildingType)?.size ?? 0) > 0;
}

/** Apply one trader order. A stale house, a non-trader, or a choice the route cannot hold is skipped. */
export function applyTradeCommand(world: World, ctx: SystemContext, command: TradeCommand): void {
  if (!isTrader(world, ctx, command.entity)) return;
  switch (command.kind) {
    case 'attachTradeHouse': {
      if (!canAttachTradeHouse(world, ctx, command.entity, command.house)) return;
      const foreign = ownerOf(world, command.house) !== ownerOf(world, command.entity);
      addTradeStop(world, command.entity, command.house, foreign);
      return;
    }
    case 'detachTradeHouse':
      removeTradeStop(world, command.entity, command.house);
      return;
    case 'setTradeImport':
      setTradeImport(world, command.entity, command.house, command.good, command.on);
      return;
    case 'clearTradeImports':
      clearTradeImports(world, command.entity);
      return;
    case 'setTradeAgreement': {
      if (command.agreement < 0) {
        setTradeAgreement(world, command.entity, -1);
        return;
      }
      const offered = tradeAgreements(world)[command.agreement];
      if (offered === undefined) return;
      setTradeAgreement(world, command.entity, command.agreement);
      return;
    }
  }
}

/** Register a map's agreement row; a row naming an unknown good or a non-positive amount is skipped. */
export function registerTradeAgreement(
  world: World,
  ctx: SystemContext,
  command: TradeAgreementCommand,
): void {
  const goods = ctx.content.goods;
  const known = (good: number): boolean => goods.some((g) => g.typeId === good);
  if (!known(command.giveGood) || !known(command.takeGood)) return;
  addTradeAgreement(world, {
    missionId: command.missionId,
    giveGood: command.giveGood,
    giveAmount: command.giveAmount,
    takeGood: command.takeGood,
    takeAmount: command.takeAmount,
  });
}
