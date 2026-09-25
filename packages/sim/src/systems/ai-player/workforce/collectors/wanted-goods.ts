import type { ContentSet } from '@open-northland/data';
import {
  AiPlayer,
  aiPlayerEntity,
  Building,
  JobAssignment,
  Settler,
  StalledPlacement,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { jobCanHarvestGood, liveWorkFlag } from '../../../economy/work-flag.js';
import { needSubjectOf, settlerMeetsNeed } from '../../../progression/index.js';
import { isCarrierJob } from '../../../stores/index.js';
import { type BuildOrderEntry, collectorGoodsWanted, type EntryStatus } from '../../build-order/index.js';
import { stockedBeyondSites } from '../../build-order/upgrade-supply.js';
import { buildingTypeByContentId, goodTypeByContentId } from '../../content-lookup.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../../seat-roster.js';

/** The goods the gatherers collect from game start, by stable content id (authored). An id absent from
 *  the content set is skipped; the build order adds its `collector` entries' goods once reached. */
export const COLLECTED_GOOD_IDS: readonly string[] = ['mud', 'stone', 'wood'];

/** How many flag gatherers the plan keeps per good, by stable content id; an unlisted good keeps
 *  {@link DEFAULT_COLLECTOR_TARGET}, or its build-order entry's `count`. Authored: three iron gatherers
 *  serve all the smithies and the iron-tool joinery. The first post is guaranteed, the rest best-effort. */
export const COLLECTOR_TARGET_BY_GOOD_ID: Readonly<Record<string, number>> = {
  wood: 2,
  stone: 2,
  iron: 3,
};
export const DEFAULT_COLLECTOR_TARGET = 1;

/** A good whose gatherers grow with the crew working it up: one more per `per` operators of `building`
 *  beyond its first `from`. */
interface CollectorGrowth {
  readonly building: string;
  readonly from: number;
  readonly per: number;
}

/** Collector growth by stable good id (authored): the second potter's tiles bring a second clay gatherer. */
export const COLLECTOR_GROWTH_BY_GOOD_ID: Readonly<Record<string, CollectorGrowth>> = {
  mud: { building: 'work_pottery_01', from: 1, per: 1 },
};

/**
 * A collected good some built workshop of the seat consumes gets one gatherer more while it runs short
 * for the seat's sites (authored): the potter or mason and his carrier can eat a raw good faster than
 * one gatherer brings it, and what lies on the workshop's shelf is his, not the builders'. Short means
 * fewer than {@link RAW_SHORT_UNITS} fetchable units beyond what the sites still lack; the extra man stays
 * until {@link RAW_COMFORT_UNITS}. Unlike a top-up, the post is filled ahead of the builder reserve, since
 * a settlement with no stone to build with has no use for builders.
 */
export const RAW_SHORT_UNITS = 6;
export const RAW_COMFORT_UNITS = 16;
const RAW_SHORTAGE_EXTRA_COLLECTORS = 1;

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
   *  or every one while the good runs short. */
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
 *  plan order, each target at least its entries' `count`, raised by its
 *  {@link COLLECTOR_GROWTH_BY_GOOD_ID} row and by one more while the good runs short
 *  ({@link RAW_SHORT_UNITS}). A good missing from the content set or with no harvest trade is skipped. */
export function wantedCollectorGoods(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
): WantedGood[] {
  const goodIds = [...COLLECTED_GOOD_IDS];
  const entryCounts = collectorGoodsWanted(order, statuses);
  for (const goodId of entryCounts.keys()) {
    if (!goodIds.includes(goodId)) goodIds.push(goodId);
  }
  const owned = ownedBuildings(world, player);
  const consumed = goodsConsumedByWorkshops(world, ctx, owned);
  const wanted: WantedGood[] = [];
  for (const goodId of goodIds) {
    const good = goodTypeByContentId(ctx.content, goodId);
    const harvestAtomic = good?.atomics?.harvest;
    if (good === undefined || harvestAtomic === undefined) continue; // not in this content set
    const job = harvestJobFor(ctx, harvestAtomic);
    if (job === null) continue;
    const base = Math.max(
      COLLECTOR_TARGET_BY_GOOD_ID[goodId] ?? DEFAULT_COLLECTOR_TARGET,
      entryCounts.get(goodId) ?? 0,
    );
    const growth = COLLECTOR_GROWTH_BY_GOOD_ID[goodId];
    const extra =
      growth === undefined
        ? 0
        : Math.floor(
            Math.max(0, workshopOperators(world, ctx, player, growth.building) - growth.from) / growth.per,
          );
    let target = base + extra;
    let min = 1;
    if (COLLECTED_GOOD_IDS.includes(goodId) && consumed.has(good.typeId)) {
      const held = flagHolders(world, ctx, player, good.typeId);
      // The extra post, once manned, holds until the comfort line, so the stock crossing one line does
      // not hire and release a man every few decisions.
      const spare = held > target ? RAW_COMFORT_UNITS : RAW_SHORT_UNITS;
      if (!stockedBeyondSites(world, ctx, player, owned, good.typeId, spare)) {
        target += RAW_SHORTAGE_EXTRA_COLLECTORS;
        min = target;
      }
    }
    wanted.push({ good, harvestAtomic, job, target, min });
  }
  return wanted;
}

/** The goods the seat's built workshops consume, by good type: the drains a raw good's shortage is
 *  measured against. */
function goodsConsumedByWorkshops(world: World, ctx: SystemContext, owned: readonly Entity[]): Set<number> {
  const index = contentIndex(ctx.content);
  const consumed = new Set<number>();
  for (const e of owned) {
    if (!isBuilt(world, e)) continue;
    const inputs = index.mergedRecipeByBuilding.get(world.get(e, Building).buildingType)?.inputs;
    for (const input of inputs ?? []) consumed.add(input.goodType);
  }
  return consumed;
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

/** The operators every building of the content id employs across the seat: its crafters, not its carriers
 *  or gatherers. */
function workshopOperators(world: World, ctx: SystemContext, player: number, buildingId: string): number {
  const type = buildingTypeByContentId(ctx.content, buildingId);
  if (type === undefined) return 0;
  const index = contentIndex(ctx.content);
  let operators = 0;
  for (const e of ownedSettlers(world, player)) {
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    if (workplace === undefined || world.tryGet(workplace, Building)?.buildingType !== type.typeId) continue;
    const job = world.get(e, Settler).jobType;
    if (job !== null && !isCarrierJob(ctx, job) && !index.harvestJobs.has(job)) operators++;
  }
  return operators;
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
