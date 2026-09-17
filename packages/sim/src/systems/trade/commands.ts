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
} from '../../components/index.js';
import type { TradeAgreementCommand, TradeCommand } from '../../core/commands/trade.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isTraderJob } from '../readviews/jobs.js';

function isTrader(world: World, ctx: SystemContext, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && isTraderJob(ctx.content, settler.jobType);
}

/** Apply one trader order. A stale house, a non-trader, or a choice the route cannot hold is skipped. */
export function applyTradeCommand(world: World, ctx: SystemContext, command: TradeCommand): void {
  if (!isTrader(world, ctx, command.entity)) return;
  switch (command.kind) {
    case 'attachTradeHouse': {
      if (!world.isAlive(command.house) || !world.has(command.house, Building)) return;
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
