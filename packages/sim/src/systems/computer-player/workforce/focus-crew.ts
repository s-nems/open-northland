import { BuildMode, Carrying, Settler, SiteAssignment, Stockpile } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { constructionBillOf, constructionTotalUnits } from '../../stores/index.js';
import type { WantedGood } from './collectors/index.js';
import type { SeatSupply } from './supply.js';

/**
 * Pin the seat's `builders` to its focus `site` (`../build-order/food-first.ts`) with the player's
 * `assignBuilder` order, the nearest first and ties to the lower id, up to one builder per unit of the
 * site's bill: each unit is one haul and its hammer steps, so a builder past them would only wait beside
 * the site while the other sites keep their crews (authored: the mill's bill is five units, the
 * bakery's six, the well's three, so a seat of few builders sends them all). The other sites wait
 * until the focus stands (owner ruling). A builder on a road run, mid-action or holding a load is pinned
 * on a later decision, since the order would cancel the one or carry the load off to a site that may not
 * take it. A pin lapses when the site stands.
 *
 * While the site lacks a good neither the seat's store (`stocked`) nor a crew hand holds, the pins are
 * lifted instead, so the builders raise the workshop that makes it (authored: on
 * battle_for_the_four_hills_multiplayer, seed 7, every bakery stood at five of six units for an hour,
 * its pillar waiting on a mason hut whose builders were all pinned to the bakery).
 *
 * A `cap` bounds the crew below the bill, so the seat's other builders stay on its other sites. Builders
 * pinned past the cap are released, the farthest first and ties to the higher id, except one an atomic
 * holds, who is released on a later decision.
 */
export function focusCrewOrders(
  world: World,
  ctx: SystemContext,
  player: number,
  site: Entity,
  builders: readonly Entity[],
  builderJob: number | null,
  stocked: (good: number) => number,
  cap: number | null = null,
): PlayerCommand[] {
  if (builderJob === null) return [];
  const onSite: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    const assigned = world.tryGet(e, SiteAssignment);
    if (assigned?.site === site) onSite.push(e);
  }
  if (!siteSourced(world, ctx, site, onSite, stocked)) {
    return onSite
      .filter((e) => world.get(e, SiteAssignment).pinned && !atomicHoldsSettler(world, e))
      .map((entity): PlayerCommand => ({ kind: 'unassignBuilder', entity }));
  }
  const at = anchorNodeOf(world, site);
  if (at === null) return [];
  // Counted from the whole site crew, so a pinned builder another phase took this decision still counts.
  let pinned = 0;
  for (const e of onSite)
    if (world.get(e, SiteAssignment).pinned && world.get(e, Settler).jobType === builderJob) pinned++;
  const releasable: Placed[] = [];
  const free: Placed[] = [];
  for (const e of builders) {
    if (world.get(e, Settler).jobType !== builderJob) continue;
    const assigned = world.tryGet(e, SiteAssignment);
    const pin = assigned?.pinned === true && assigned.site === site;
    if (atomicHoldsSettler(world, e)) continue;
    if (!pin && (world.has(e, BuildMode) || world.has(e, Carrying))) continue;
    const here = anchorNodeOf(world, e);
    if (here === null) continue;
    (pin ? releasable : free).push({ e, distance: Math.abs(here.hx - at.hx) + Math.abs(here.hy - at.hy) });
  }
  const bill = constructionTotalUnits(world, ctx, site);
  const limit = cap === null ? bill : Math.min(bill, cap);
  if (pinned > limit) {
    releasable.sort((a, b) => b.distance - a.distance || b.e - a.e);
    return releasable
      .slice(0, pinned - limit)
      .map(({ e }): PlayerCommand => ({ kind: 'unassignBuilder', entity: e }));
  }
  free.sort((a, b) => a.distance - b.distance || a.e - b.e);
  const crew = Math.min(limit, pinned + free.length);
  return free
    .slice(0, Math.max(0, crew - pinned))
    .map(({ e }): PlayerCommand => ({ kind: 'assignBuilder', entity: e, site }));
}

/** A builder and his half-cell distance to the focus site. */
interface Placed {
  readonly e: Entity;
  readonly distance: number;
}

/** Whether every line of `site`'s bill is on site, in a `crew` hand or in the seat's store. */
function siteSourced(
  world: World,
  ctx: SystemContext,
  site: Entity,
  crew: readonly Entity[],
  stocked: (good: number) => number,
): boolean {
  const held = world.tryGet(site, Stockpile)?.amounts;
  for (const line of constructionBillOf(world, ctx, site)) {
    let have = Math.max(held?.get(line.goodType) ?? 0, 0) + stocked(line.goodType);
    for (const e of crew) {
      const load = world.tryGet(e, Carrying);
      if (load?.goodType === line.goodType) have += load.amount;
    }
    if (have < line.amount) return false;
  }
  return true;
}

/** The builders the seat keeps while the bread chain's focus site rises, ahead of every gatherer post
 *  and workshop hand (authored, the pair `BUILDERS_PER_OPEN_SITE` puts on one site): on
 *  battle_for_the_four_hills_multiplayer, seed 7, a seat of eight men had every man posted and no builder
 *  from minute 19 to 26 while its bakery site waited with sixteen pillars in store. */
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
