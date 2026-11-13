import {
  Building,
  barracksCoinOptedOut,
  Owner,
  optOutOfBarracksCoin,
  ownerOf,
  StorePriority,
  UnderConstruction,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isBarracks } from '../readviews/index.js';
import { keepsStorePriority, stockCapacity } from '../stores/index.js';

/** The good a finished barracks marks as priority until its owner unmarks it on one (owner ruling). */
const BARRACKS_DEFAULT_GOOD_ID = 'coin';

/** Mark or unmark one good as priority in a store - see the command doc. Marking needs a finished owned
 *  store whose type keeps porters and a shelf for the good; unmarking is never refused. Unmarking the coin
 *  on a barracks ends its default mark for the owner's later barracks. */
export function setStorePriority(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setStorePriority' }>,
): void {
  const { building, goodType } = command;
  if (!world.isAlive(building)) return;
  if (command.priority) {
    markStorePriority(world, ctx, building, goodType);
    return;
  }
  const current = world.tryGet(building, StorePriority)?.goods;
  if (current === undefined || !current.includes(goodType)) return;
  if (current.length === 1) world.remove(building, StorePriority);
  else {
    const goods = world.mut(building, StorePriority).goods;
    goods.splice(goods.indexOf(goodType), 1);
  }
  const owner = ownerOf(world, building);
  if (owner !== undefined && goodType === barracksDefaultGood(ctx) && isBarracks(world, ctx, building))
    optOutOfBarracksCoin(world, owner);
}

/** A barracks just finished marks the coin as priority, unless its owner unmarked the coin on a barracks
 *  earlier in the match. */
export function markFinishedBarracksDefault(world: World, ctx: SystemContext, building: Entity): void {
  const owner = ownerOf(world, building);
  const coin = barracksDefaultGood(ctx);
  if (owner === undefined || coin === undefined || barracksCoinOptedOut(world, owner)) return;
  if (isBarracks(world, ctx, building)) markStorePriority(world, ctx, building, coin);
}

function barracksDefaultGood(ctx: SystemContext): number | undefined {
  return contentIndex(ctx.content).goodTypeBySlug.get(BARRACKS_DEFAULT_GOOD_ID);
}

function markStorePriority(world: World, ctx: SystemContext, building: Entity, goodType: number): void {
  const current = world.tryGet(building, StorePriority)?.goods;
  if (current?.includes(goodType) === true) return;
  const type = world.tryGet(building, Building)?.buildingType;
  if (type === undefined || !world.has(building, Owner) || world.has(building, UnderConstruction)) return;
  if (!keepsStorePriority(ctx.content, type) || stockCapacity(world, ctx, building, goodType) <= 0) return;
  if (current === undefined) {
    world.add(building, StorePriority, { goods: [goodType] });
    return;
  }
  const goods = world.mut(building, StorePriority).goods;
  goods.push(goodType);
  goods.sort((a, b) => a - b);
}
