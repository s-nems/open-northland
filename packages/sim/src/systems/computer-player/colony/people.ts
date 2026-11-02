import { BuildMode, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { homeBuildings } from '../../ai-shared/home-roster.js';
import { onErrand } from '../../ai-shared/military/errand.js';
import { builderJobOf, classifyWorkforce } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { mayMarry } from '../../family/eligibility.js';
import { DEFAULT_BUILD_ORDER } from '../build-order/entries.js';
import { decisionMemo, lineStatuses } from '../build-order/progress.js';
import { seatBuildOrder } from '../build-order/seat-order.js';
import { computerProfileOf } from '../difficulty.js';
import { seatApprentices } from '../technology/apprentices.js';

function apprenticesOf(world: World, ctx: SystemContext, seat: number): ReadonlySet<Entity> {
  const order = seatBuildOrder(world, ctx, seat, DEFAULT_BUILD_ORDER, computerProfileOf(world, seat));
  const owned = homeBuildings(world, ctx, seat);
  return seatApprentices(
    world,
    ctx,
    seat,
    order,
    lineStatuses(world, ctx, seat, owned, order, decisionMemo()),
  );
}

/** The men of `seat` a colony may take, in the order it takes them: no post, flag or trade first, then
 *  builders, then gatherers, unwed first within each, then ascending id. A man at a workplace, a scout, a
 *  fisher, an apprentice and a man on an errand stay. */
export function spareMen(world: World, ctx: SystemContext, seat: number): Entity[] {
  const { pool } = classifyWorkforce(world, ctx, seat, [], 0);
  const apprentices = apprenticesOf(world, ctx, seat);
  const builder = builderJobOf(ctx);
  const rank = (e: Entity): number => {
    const tier = liveWorkFlag(world, e) !== undefined ? 2 : world.get(e, Settler).jobType === builder ? 1 : 0;
    return 2 * tier + (mayMarry(world, ctx.content, e) ? 0 : 1);
  };
  return pool
    .filter((e) => !apprentices.has(e) && !onErrand(world, e) && !world.has(e, BuildMode))
    .map((e) => ({ e, rank: rank(e) }))
    .sort((a, b) => a.rank - b.rank || a.e - b.e)
    .map((m) => m.e);
}
