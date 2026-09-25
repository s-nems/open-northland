import type { ContentSet } from '@open-northland/data';
import {
  AiPlayer,
  aiPlayerEntity,
  JobAssignment,
  Settler,
  StalledPlacement,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { jobCanHarvestGood, liveWorkFlag } from '../../../economy/work-flag.js';
import { needSubjectOf, settlerMeetsNeed } from '../../../progression/index.js';
import { type BuildOrderEntry, collectorGoodsWanted, type EntryStatus } from '../../build-order/index.js';
import { goodTypeByContentId } from '../../content-lookup.js';
import { ownedSettlers } from '../../seat-roster.js';
import type { SeatSupply } from '../supply.js';

/** The goods the gatherers collect from game start, by stable content id (authored). An id absent from
 *  the content set is skipped; the build order adds its `collector` entries' goods once reached. */
export const COLLECTED_GOOD_IDS: readonly string[] = ['mud', 'stone', 'wood'];

/** Fixed gatherer targets by stable content id (authored): the construction sites are these goods' main
 *  drain, which the shortage posts answer. The first post is guaranteed, the rest best-effort. */
export const COLLECTOR_TARGET_BY_GOOD_ID: Readonly<Record<string, number>> = {
  wood: 2,
  stone: 2,
};

/** The target of a good with no {@link COLLECTOR_TARGET_BY_GOOD_ID} row and no reached collector entry. */
export const DEFAULT_COLLECTOR_TARGET = 1;

/** A good with no fixed target gets one gatherer more per this many planned operators of the seat's built
 *  workshops consuming it (authored): the pottery tier planning two potters brings a second clay gatherer,
 *  and two smithies' four smiths two iron gatherers over the entry's one. */
export const OPERATORS_PER_EXTRA_GATHERER = 2;

/** How many collect-anything gatherers (a flag with no good filter) the seat keeps, at the lowest
 *  hiring priority (authored). */
export const GENERIC_COLLECTOR_TARGET = 2;

/** While a placement finds no spot, one extra collect-anything gatherer per this many civilians clears
 *  ground near the base, at least one and at most {@link MAX_CLEARING_COLLECTORS} (authored). */
export const CIVILIANS_PER_CLEARING_COLLECTOR = 5;
export const MAX_CLEARING_COLLECTORS = 10;

/** The extra gatherers a stalled placement calls for, or 0 while the build order places freely or is
 *  switched off. The count follows the seat's `civilians` each decision, so it grows with the settlement
 *  while the stall lasts. */
export function clearingCollectors(world: World, player: number, civilians: number): number {
  const carrier = aiPlayerEntity(world, player);
  if (carrier === null || !world.has(carrier, StalledPlacement)) return 0;
  // Only the build order clears the record, so a seat whose script switched it off keeps a stale one.
  if (!(world.tryGet(carrier, AiPlayer)?.modules.houseBuild ?? false)) return 0;
  return Math.min(
    MAX_CLEARING_COLLECTORS,
    Math.max(1, Math.floor(civilians / CIVILIANS_PER_CLEARING_COLLECTOR)),
  );
}

/** A wanted collector good with its resolved gatherer trade, harvest atomic, and staffing target. */
export interface WantedGood {
  readonly good: ContentSet['goods'][number];
  readonly harvestAtomic: number;
  readonly job: number;
  readonly target: number;
  /** How many of the target's posts are filled ahead of the builder reserve, one per decision: the first,
   *  or every one while a good the sites build with ({@link COLLECTED_GOOD_IDS}) runs short. */
  readonly min: number;
}

/** The lowest gatherer trade whose grants include this harvest atomic, or null. */
function harvestJobFor(ctx: SystemContext, harvestAtomic: number): number | null {
  const index = contentIndex(ctx.content);
  let best: number | null = null;
  for (const job of index.harvestJobs) {
    if (!(index.atomicsByJob.get(job)?.has(harvestAtomic) ?? false)) continue;
    if (best === null || job < best) best = job;
  }
  return best;
}

/** The generalist gatherer trade: the harvest job that can flag-harvest the most goods, ties to the
 *  lowest typeId, so the winner never depends on set iteration order. Null when the content has no
 *  harvest trade. */
export function genericCollectorJob(ctx: SystemContext): number | null {
  const index = contentIndex(ctx.content);
  let best: number | null = null;
  let bestCount = -1;
  for (const job of index.harvestJobs) {
    let count = 0;
    for (const good of ctx.content.goods) {
      if (jobCanHarvestGood(ctx, job, good.typeId)) count++;
    }
    if (count > bestCount || (count === bestCount && best !== null && job < best)) {
      best = job;
      bestCount = count;
    }
  }
  return best;
}

/** The wanted collector goods - the base set plus the build order's reached `collector` entries - in
 *  plan order. A target is the good's fixed row, else its entries' largest `count` (at least
 *  {@link DEFAULT_COLLECTOR_TARGET}) grown by {@link OPERATORS_PER_EXTRA_GATHERER}, plus the shortage
 *  posts ({@link shortageGatherers}); nothing lowers it below a reached entry's `count`, since a released
 *  holder would regress the entry and stall the order. A good missing from the content set or with no
 *  harvest trade is skipped. */
export function wantedCollectorGoods(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
  supply: SeatSupply,
): WantedGood[] {
  const goodIds = [...COLLECTED_GOOD_IDS];
  const entryCounts = collectorGoodsWanted(order, statuses);
  for (const goodId of entryCounts.keys()) {
    if (!goodIds.includes(goodId)) goodIds.push(goodId);
  }
  const wanted: WantedGood[] = [];
  for (const goodId of goodIds) {
    const good = goodTypeByContentId(ctx.content, goodId);
    const harvestAtomic = good?.atomics?.harvest;
    if (good === undefined || harvestAtomic === undefined) continue; // not in this content set
    const job = harvestJobFor(ctx, harvestAtomic);
    if (job === null) continue;
    const consumers = supply.plannedConsumers(good.typeId);
    const fixed = COLLECTOR_TARGET_BY_GOOD_ID[goodId];
    const entryCount = entryCounts.get(goodId) ?? 0;
    let target =
      fixed === undefined
        ? Math.max(DEFAULT_COLLECTOR_TARGET, entryCount) +
          Math.floor(consumers / OPERATORS_PER_EXTRA_GATHERER)
        : Math.max(fixed, entryCount);
    let min = 1;
    if (consumers > 0) {
      const engaged = flagHolders(world, ctx, player, good.typeId) > target;
      const extra = shortageGatherers(supply, good.typeId, engaged, consumers);
      if (extra > 0) {
        target += extra;
        // Iron or gold running short idles the smiths, not the builders, so its posts wait behind the
        // reserve like any other extra.
        if (COLLECTED_GOOD_IDS.includes(goodId)) min = target;
      }
    }
    wanted.push({ good, harvestAtomic, job, target, min });
  }
  return wanted;
}

/**
 * The extra gatherers a good some built workshop consumes calls for while it runs short for the seat's
 * sites (authored): one per unit its surplus lies under the comfort line, rounded up, at most one per
 * {@link OPERATORS_PER_EXTRA_GATHERER} planned consuming operators, the same rate the target grows at. The
 * workshop eats the good faster than its gatherers bring it, and what lies on its shelf is not the
 * builders'. Short is under the short line, or the comfort line while the posts are `engaged`
 * ({@link SeatSupply.isShort}), so the stock crossing one line does not hire and release a man every few
 * decisions. A building good's posts are filled ahead of the builder reserve, since a settlement with no
 * stone to build with has no use for builders.
 */
function shortageGatherers(
  supply: SeatSupply,
  goodType: number,
  engaged: boolean,
  consumers: number,
): number {
  const lines = supply.lines(goodType);
  const surplus = supply.surplus(goodType);
  if (lines === undefined || surplus === undefined || !supply.isShort(goodType, engaged)) return 0;
  return Math.min(
    Math.ceil((lines.comfort - surplus) / lines.unit),
    Math.ceil(consumers / OPERATORS_PER_EXTRA_GATHERER),
  );
}

/** The seat's men holding a live flag of `goodType` with a trade that harvests it: what
 *  `classifyWorkforce` seats on the good before its target caps them. */
function flagHolders(world: World, ctx: SystemContext, player: number, goodType: number): number {
  let holders = 0;
  for (const e of ownedSettlers(world, player)) {
    if (world.has(e, JobAssignment)) continue;
    const job = world.get(e, Settler).jobType;
    if (job === null || liveWorkFlag(world, e)?.goodType !== goodType) continue;
    if (jobCanHarvestGood(ctx, job, goodType)) holders++;
  }
  return holders;
}

/** Whether this settler's accrued XP clears the good's `needforgood` thresholds - the same gate
 *  `nearestHarvestableFor` applies, so the allocator never posts a collector its own target scan would
 *  refuse. */
export function meetsNeed(world: World, ctx: SystemContext, e: Entity, goodType: number): boolean {
  return settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'good', goodType);
}

/** Whether an accrued-XP threshold gates the good for this tribe, so only a settler who already
 *  earned that XP elsewhere can work it. An ungated good accepts any fresh hire. */
export function needsVeteran(ctx: SystemContext, tribe: number, goodType: number): boolean {
  const tribeType = contentIndex(ctx.content).tribes.get(tribe);
  if (tribeType === undefined) return false;
  return tribeType.jobRequirements.some(
    (r) => r.requirement === 'need' && r.target === 'good' && r.targetId === goodType,
  );
}
