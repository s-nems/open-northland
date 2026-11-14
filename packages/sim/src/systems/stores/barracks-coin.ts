import { barracksCoinOptedOut, optOutOfBarracksCoin, ownerOf } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isBarracks } from '../readviews/buildings.js';
import { markStorePriority } from './priority.js';

// Owner ruling, our own rule: a barracks a player finishes marks the coin as priority, until that player
// unmarks the coin on one of their barracks; their later barracks then start without it for the match.

const COIN_GOOD_ID = 'coin';

function coinGood(ctx: SystemContext): number | undefined {
  return contentIndex(ctx.content).goodTypeBySlug.get(COIN_GOOD_ID);
}

/** Give a just-finished barracks its default coin mark, unless its owner opted out. */
export function markFinishedBarracksCoin(world: World, ctx: SystemContext, building: Entity): void {
  const owner = ownerOf(world, building);
  const coin = coinGood(ctx);
  if (owner === undefined || coin === undefined || barracksCoinOptedOut(world, owner)) return;
  if (isBarracks(world, ctx, building)) markStorePriority(world, ctx, building, coin);
}

/** Opt the owner out once the coin's mark was lifted on one of their barracks. */
export function noteBarracksPriorityLifted(
  world: World,
  ctx: SystemContext,
  building: Entity,
  goodType: number,
): void {
  const owner = ownerOf(world, building);
  if (owner !== undefined && goodType === coinGood(ctx) && isBarracks(world, ctx, building))
    optOutOfBarracksCoin(world, owner);
}
