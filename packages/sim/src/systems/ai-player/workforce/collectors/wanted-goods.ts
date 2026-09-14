import type { ContentSet } from '@open-northland/data';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { jobCanHarvestGood } from '../../../economy/work-flag.js';
import { needSubjectOf, settlerMeetsNeed } from '../../../progression/index.js';
import { type BuildOrderEntry, collectorGoodsWanted, type EntryStatus } from '../../build-order/index.js';
import { goodTypeByContentId } from '../../content-lookup.js';

/** The goods the gatherers collect from game start, by stable content id (authored). An id absent from
 *  the content set is skipped; the build order adds its `collector` entries' goods once reached. */
export const COLLECTED_GOOD_IDS: readonly string[] = ['mud', 'stone', 'wood'];

/** How many flag gatherers the plan keeps per good, by stable content id; an unlisted good keeps
 *  {@link DEFAULT_COLLECTOR_TARGET}. Authored: iron runs three because the plan ends on two smithies
 *  and an iron-tool joinery. The first post is guaranteed, the rest best-effort. */
export const COLLECTOR_TARGET_BY_GOOD_ID: Readonly<Record<string, number>> = {
  wood: 2,
  stone: 2,
  iron: 3,
};
export const DEFAULT_COLLECTOR_TARGET = 1;

/** How many collect-anything gatherers (a flag with no good filter) the seat keeps, at the lowest
 *  hiring priority (authored). */
export const GENERIC_COLLECTOR_TARGET = 2;

/** A wanted collector good with its resolved gatherer trade, harvest atomic, and staffing target. */
export interface WantedGood {
  readonly good: ContentSet['goods'][number];
  readonly harvestAtomic: number;
  readonly job: number;
  readonly target: number;
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
 *  plan order. A good missing from the content set or with no harvest trade is skipped. */
export function wantedCollectorGoods(
  ctx: SystemContext,
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
): WantedGood[] {
  const goodIds = [...COLLECTED_GOOD_IDS];
  for (const goodId of collectorGoodsWanted(order, statuses)) {
    if (!goodIds.includes(goodId)) goodIds.push(goodId);
  }
  const wanted: WantedGood[] = [];
  for (const goodId of goodIds) {
    const good = goodTypeByContentId(ctx.content, goodId);
    const harvestAtomic = good?.atomics?.harvest;
    if (good === undefined || harvestAtomic === undefined) continue; // not in this content set
    const job = harvestJobFor(ctx, harvestAtomic);
    if (job === null) continue;
    const target = COLLECTOR_TARGET_BY_GOOD_ID[goodId] ?? DEFAULT_COLLECTOR_TARGET;
    wanted.push({ good, harvestAtomic, job, target });
  }
  return wanted;
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
