import type { ContentSet } from '@open-northland/data';
import {
  ProductionCounters,
  productionCountOf,
  Resource,
  ResourceLayers,
  Settler,
  writeProductionGoods,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { isFisherJob, isHunterJob, jobChangesProduction } from '../readviews/index.js';
import { fishGoodOf } from './fish.js';
import { jobCanHarvestGood } from './work-flag.js';

// The goods a gathering trade takes from the map, and the production counters that hold a gatherer to
// some of them (`ProductionCounters`).

const gatherGoodsByContent = new WeakMap<ContentSet, Map<number, readonly number[]>>();

/**
 * The goods `jobType` gathers, ascending goodType: every good it may harvest, and the land fisher's catch.
 * These are the goods a gatherer's production counters name.
 */
export function jobGatherGoods(ctx: ContentContext, jobType: number): readonly number[] {
  let byJob = gatherGoodsByContent.get(ctx.content);
  if (byJob === undefined) {
    byJob = new Map();
    gatherGoodsByContent.set(ctx.content, byJob);
  }
  let goods = byJob.get(jobType);
  if (goods === undefined) {
    const found = ctx.content.goods.map((g) => g.typeId).filter((g) => jobCanHarvestGood(ctx, jobType, g));
    const fish = fishGoodOf(ctx.content);
    if (fish !== undefined && isFisherJob(ctx.content, jobType) && !found.includes(fish)) found.push(fish);
    goods = found.sort((a, b) => a - b);
    byJob.set(jobType, goods);
  }
  return goods;
}

/** The kind of trade that brings a good in off the map, for the player to assign. */
export type GatheringTrade = 'collector' | 'hunter' | 'fisher';

/** Which kind names a good several kinds gather. */
const GATHERING_TRADE_ORDER: readonly GatheringTrade[] = ['collector', 'hunter', 'fisher'];

const gatheringTradeByContent = new WeakMap<ContentSet, ReadonlyMap<number, GatheringTrade>>();

/**
 * The kind of trade that gathers `goodType` off the map ({@link jobGatherGoods}), or null when none does
 * or some building type turns it out too, so a workshop can supply it as well. A good several kinds
 * gather names the first of {@link GATHERING_TRADE_ORDER}.
 */
export function gatheringTradeOf(ctx: ContentContext, goodType: number): GatheringTrade | null {
  let byGood = gatheringTradeByContent.get(ctx.content);
  if (byGood === undefined) {
    byGood = gatheringTrades(ctx);
    gatheringTradeByContent.set(ctx.content, byGood);
  }
  return byGood.get(goodType) ?? null;
}

function gatheringTrades(ctx: ContentContext): ReadonlyMap<number, GatheringTrade> {
  const index = contentIndex(ctx.content);
  const made = new Set<number>();
  for (const building of ctx.content.buildings) {
    for (const good of building.produces) made.add(good);
    for (const output of index.mergedRecipeByBuilding.get(building.typeId)?.outputs ?? [])
      made.add(output.goodType);
  }
  const kinds = new Map<number, Set<GatheringTrade>>();
  for (const job of ctx.content.jobs) {
    const kind = tradeKindOf(ctx, job.typeId);
    for (const good of jobGatherGoods(ctx, job.typeId)) {
      if (made.has(good)) continue;
      let found = kinds.get(good);
      if (found === undefined) {
        found = new Set();
        kinds.set(good, found);
      }
      found.add(kind);
    }
  }
  const byGood = new Map<number, GatheringTrade>();
  for (const [good, found] of kinds) {
    const kind = GATHERING_TRADE_ORDER.find((k) => found.has(k));
    if (kind !== undefined) byGood.set(good, kind);
  }
  return byGood;
}

function tradeKindOf(ctx: ContentContext, jobType: number): GatheringTrade {
  if (isHunterJob(ctx.content, jobType)) return 'hunter';
  return isFisherJob(ctx.content, jobType) ? 'fisher' : 'collector';
}

/** Whether `goodType` is one of {@link jobGatherGoods}. */
export function jobGathersGood(ctx: ContentContext, jobType: number, goodType: number): boolean {
  return jobGatherGoods(ctx, jobType).includes(goodType);
}

/** Whether `e`'s counters still let it gather `goodType`: the counter is at least one, or the trade
 *  holds no counters the player can set ({@link jobChangesProduction}). */
export function gatherGoodOpen(
  world: World,
  ctx: ContentContext,
  e: Entity,
  jobType: number | null,
  goodType: number,
): boolean {
  if (!jobChangesProduction(ctx.content, jobType)) return true;
  return productionCountOf(world.tryGet(e, ProductionCounters), goodType) >= 1;
}

/**
 * The goods of `jobType` that `e`'s counters still let it gather, or undefined when it holds no counters
 * and so gathers every one. A trade whose production the player cannot change gathers every good,
 * whatever counters an earlier trade left on the person.
 */
export function openGatherGoods(
  world: World,
  ctx: ContentContext,
  e: Entity,
  jobType: number,
): ReadonlySet<number> | undefined {
  if (!jobChangesProduction(ctx.content, jobType)) return undefined;
  const counters = world.tryGet(e, ProductionCounters);
  if (counters === undefined) return undefined;
  return new Set(jobGatherGoods(ctx, jobType).filter((g) => productionCountOf(counters, g) >= 1));
}

/**
 * Whether resource `node` still holds a good of `open`: its current good or one buried beneath it. A
 * carcass alternates its stages, so a body worth an open good is worked through its stopped stages too.
 */
export function nodeHoldsOpenGood(world: World, node: Entity, open: ReadonlySet<number>): boolean {
  const res = world.tryGet(node, Resource);
  if (res !== undefined && open.has(res.goodType)) return true;
  return world.tryGet(node, ResourceLayers)?.layers.some((layer) => open.has(layer.goodType)) ?? false;
}

/**
 * Hold gatherer `e` to `goodType` alone - that good unlimited, every other good of its trade `0` - or,
 * with `null`, release it to every good by dropping its counters.
 */
export function holdToGatherGood(
  world: World,
  ctx: ContentContext,
  e: Entity,
  jobType: number,
  goodType: number | null,
): void {
  if (goodType === null) world.remove(e, ProductionCounters);
  else writeProductionGoods(world, e, jobGatherGoods(ctx, jobType), new Set([goodType]));
}

/**
 * The one good gatherer `e` is held to: its counters stop every other good of its trade. Undefined while it
 * holds no counters, or while they leave several goods, or none, open.
 */
export function heldGatherGood(world: World, ctx: ContentContext, e: Entity): number | undefined {
  const jobType = world.tryGet(e, Settler)?.jobType;
  if (jobType == null) return undefined;
  const open = openGatherGoods(world, ctx, e, jobType);
  if (open === undefined || open.size !== 1) return undefined;
  const [good] = open;
  return good;
}
