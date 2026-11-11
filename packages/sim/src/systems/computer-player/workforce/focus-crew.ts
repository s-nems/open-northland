import { Stockpile } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isPrioritizedSite } from '../../settlers/drives/economy/construction-task-claims.js';
import { constructionBillOf } from '../../stores/index.js';
import type { WantedGood } from './collectors/index.js';
import type { SeatSupply } from './supply.js';

/**
 * Mark the seat's focus `site` (`../build-order/steps/food-first.ts`) with the player's
 * `setConstructionPriority` order, so every builder with a task there works it before the other sites
 * (owner ruling: the other sites wait until the focus stands). A site short of a good draws nobody, so
 * the builders raise the workshop that makes it meanwhile. With `spread` the mark is lifted instead and
 * the builders take the sites in their ordinary order.
 */
export function focusPriorityOrders(world: World, site: Entity, spread: boolean): PlayerCommand[] {
  const prioritized = !spread;
  if (isPrioritizedSite(world, site) === prioritized) return [];
  return [{ kind: 'setConstructionPriority', building: site, prioritized }];
}

/** The builders the seat keeps while the bread chain's focus site rises, ahead of every gatherer post
 *  and workshop hand (authored, the pair `BUILDERS_PER_OPEN_SITE` puts on one site): observed on
 *  battle_for_the_four_hills_multiplayer, a seat of few men had every man posted and no builder while its
 *  bakery site waited with its goods in store. */
export const FOCUS_BUILDERS = 2;

/**
 * The goods the focus `site` waits on that the seat's sites together lack (`supply` surplus under 0):
 * each bill line the site's hold does not cover yet, and for such a line the recipe inputs of its good,
 * as the stone of the bakery's pillar. Their gatherers keep their posts and take one more.
 */
export function focusShortGoods(
  world: World,
  ctx: SystemContext,
  site: Entity,
  supply: SeatSupply,
): ReadonlySet<number> {
  const short = new Set<number>();
  const lacks = (good: number): boolean => (supply.surplus(good) ?? 0) < 0;
  const held = world.tryGet(site, Stockpile)?.amounts;
  const goods = contentIndex(ctx.content).goods;
  for (const line of constructionBillOf(world, ctx, site)) {
    if (Math.max(held?.get(line.goodType) ?? 0, 0) >= line.amount || !lacks(line.goodType)) continue;
    short.add(line.goodType);
    for (const input of goods.get(line.goodType)?.productionInputs ?? [])
      if (lacks(input.goodType)) short.add(input.goodType);
  }
  return short;
}

/** `wanted` with one more post, filled ahead of the builder reserve, for each good of `short`
 *  ({@link focusShortGoods}). */
export function focusShortPosts(wanted: readonly WantedGood[], short: ReadonlySet<number>): WantedGood[] {
  return wanted.map((w) => {
    if (!short.has(w.good.typeId)) return w;
    const posts = w.row + 1;
    return { ...w, target: Math.max(w.target, posts), min: Math.max(w.min, posts), row: posts };
  });
}

/**
 * `wanted` cut by `count` posts so the seat's gatherers yield men to {@link FOCUS_BUILDERS}: one post at a
 * time off the good with the most `holders`, ties to the earlier good of `wanted`, never a good of `short`
 * nor one whose greenest holder is an apprentice, who stays on the work earning his discovery.
 * Classification then hands the cut good's greenest holder to the pool.
 */
export function focusYieldPosts(
  wanted: readonly WantedGood[],
  holders: ReadonlyMap<number, readonly Entity[]>,
  short: ReadonlySet<number>,
  apprentices: ReadonlySet<Entity>,
  count: number,
): WantedGood[] {
  const cut = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    let best: WantedGood | undefined;
    let bestLeft = 0;
    for (const w of wanted) {
      const good = w.good.typeId;
      const list = holders.get(good) ?? [];
      const left = list.length - (cut.get(good) ?? 0);
      const greenest = list[left - 1];
      if (short.has(good) || greenest === undefined || apprentices.has(greenest)) continue;
      if (left > bestLeft) {
        best = w;
        bestLeft = left;
      }
    }
    if (best === undefined) break;
    cut.set(best.good.typeId, (cut.get(best.good.typeId) ?? 0) + 1);
  }
  if (cut.size === 0) return [...wanted];
  return wanted.map((w) => {
    const by = cut.get(w.good.typeId);
    if (by === undefined) return w;
    const posts = Math.max(0, (holders.get(w.good.typeId)?.length ?? 0) - by);
    return {
      ...w,
      target: Math.min(w.target, posts),
      min: Math.min(w.min, posts),
      row: Math.min(w.row, posts),
    };
  });
}
