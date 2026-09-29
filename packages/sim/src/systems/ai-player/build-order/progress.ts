import type { BuildingType } from '@open-northland/data';
import { Building, UnderConstruction, Upgrading } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood } from '../../economy/gather-goods.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { seatBaseOf } from '../base.js';
import { buildingTypeByContentId, goodTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import { anyLiveResource } from '../live-resources.js';
import { anchorNodeOf } from '../node-geometry.js';
import { enemyOverSea } from '../sea-route.js';
import { ownedBuildings, ownedSettlers } from '../seat-roster.js';
import { type BuildOrderEntry, isLaneEntry } from './entries.js';
import { unservedAnchor } from './placement.js';
import { coverageOf, seatCovered } from './tower-coverage.js';

/** `skip` (not expressible in this content set, or nothing left to collect) counts as done for
 *  sequencing. */
export type EntryStatus = 'skip' | 'satisfied' | 'unmet';

/** Whether `from` sits strictly below `target` on the `upgradeTarget` chain. The visited guard bounds
 *  a malformed cyclic chain. */
function upgradesInto(index: ContentIndex, from: BuildingType, target: BuildingType): boolean {
  const visited = new Set<number>();
  let step: BuildingType | undefined = from;
  while (step !== undefined && !visited.has(step.typeId)) {
    visited.add(step.typeId);
    if (step.typeId === target.typeId) return step !== from;
    step = step.upgradeTarget === undefined ? undefined : index.buildings.get(step.upgradeTarget);
  }
  return false;
}

/** One decision's map-wide answers, so the entries that ask the same question search the map once:
 *  whether the map holds a live resource, per good type, and whether the enemy lies over the sea. */
export interface DecisionMemo {
  readonly live: Map<number, boolean>;
  enemyOverSea: boolean | undefined;
}

export function decisionMemo(): DecisionMemo {
  return { live: new Map(), enemyOverSea: undefined };
}

/** The tiers an entry counts: `type` and those above it on its chain, stopping below `belowTier`. */
function countedTiers(ctx: SystemContext, type: BuildingType, belowTier: string | undefined): Set<number> {
  const index = contentIndex(ctx.content);
  const counted = tiersAtOrAbove(index, type);
  const cap = belowTier === undefined ? undefined : buildingTypeByContentId(ctx.content, belowTier);
  if (cap !== undefined) for (const tier of tiersAtOrAbove(index, cap)) counted.delete(tier);
  return counted;
}

/** `owned` is the seat's {@link ownedBuildings} list and `memo` this decision's, both passed in so one
 *  decision computes them once. An upgrade in flight counts toward its next tier, as a placed site counts
 *  toward its entry, unless `inFlightUpgrades` is false. */
export function entryStatus(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  entry: BuildOrderEntry,
  memo: DecisionMemo,
  inFlightUpgrades = true,
): EntryStatus {
  const index = contentIndex(ctx.content);
  switch (entry.kind) {
    case 'place': {
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) return 'skip';
      // The placed tier or anything above it on its chain, below `belowTier`, counts, so an upgraded
      // workshop never triggers a duplicate placement; a home entry counts every home tier.
      const counted = countedTiers(ctx, type, entry.belowTier);
      let have = 0;
      for (const e of owned) {
        const ownedType = index.buildings.get(world.get(e, Building).buildingType);
        if (ownedType === undefined) continue;
        const matches = type.kind === 'home' ? ownedType.kind === 'home' : counted.has(ownedType.typeId);
        if (matches) have++;
      }
      if (have >= entry.count) return 'satisfied';
      if (entry.onlyWhen === 'enemyOverSea') {
        memo.enemyOverSea ??= enemyOverSea(world, ctx, player);
        if (!memo.enemyOverSea) return 'skip';
      }
      if (
        entry.unlessWithin !== undefined &&
        unservedAnchor(world, index, owned, counted, entry.unlessWithin) === null
      )
        return 'skip';
      for (const goodId of entry.needsResources ?? []) {
        const needed = goodTypeByContentId(ctx.content, goodId);
        if (needed === undefined || !liveResourceNearBase(world, ctx, player, needed.typeId, memo.live))
          return 'skip';
      }
      return 'unmet';
    }
    case 'upgrade': {
      const target = buildingTypeByContentId(ctx.content, entry.building);
      if (target === undefined) return 'skip';
      const done = countedTiers(ctx, target, entry.belowTier);
      let have = 0;
      for (const e of owned) {
        const type = world.get(e, Building).buildingType;
        // `upgradeBuilding` keeps the lower type until the site finishes, so the tier it is becoming
        // is that type's next one.
        const becoming =
          inFlightUpgrades && world.has(e, Upgrading) ? index.buildings.get(type)?.upgradeTarget : undefined;
        if (done.has(type) || (becoming !== undefined && done.has(becoming))) have++;
      }
      return have >= entry.count ? 'satisfied' : 'unmet';
    }
    case 'collector': {
      const good = goodTypeByContentId(ctx.content, entry.good);
      if (good?.atomics?.harvest === undefined) return 'skip';
      let holders = 0;
      for (const e of ownedSettlers(world, player)) {
        if (liveWorkFlag(world, e) !== undefined && heldGatherGood(world, ctx, e) === good.typeId) holders++;
      }
      if (holders >= collectorCount(entry)) return 'satisfied';
      // Nothing left to collect anywhere counts as done, so the list never stalls on a dry map.
      return liveResourceNearBase(world, ctx, player, good.typeId, memo.live) ? 'unmet' : 'skip';
    }
    case 'towerCoverage':
    case 'storeCoverage': {
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) return 'skip';
      return seatCovered(world, ctx, player, owned, coverageOf(entry)) ? 'satisfied' : 'unmet';
    }
  }
}

/** Whether the map still holds a live resource of `goodType`, searched outward from the seat's base. */
function liveResourceNearBase(
  world: World,
  ctx: SystemContext,
  player: number,
  goodType: number,
  live: Map<number, boolean>,
): boolean {
  const known = live.get(goodType);
  if (known !== undefined) return known;
  const base = seatBaseOf(world, ctx, player);
  const near = base === null ? null : anchorNodeOf(world, base);
  const found = anyLiveResource(world, goodType, near);
  live.set(goodType, found);
  return found;
}

/**
 * Every entry's status in list order. Statuses are recomputed each decision and can regress (a razed
 * home, a fringe building re-arming `towerCoverage`), so consumers must tolerate a temporary drop.
 */
export function entryStatuses(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): EntryStatus[] {
  const owned = ownedBuildings(world, player);
  const memo = decisionMemo();
  return order.map((entry) => entryStatus(world, ctx, player, owned, entry, memo));
}

/** The lowest-id built building the seat can upgrade toward `target`; a site, including an in-flight
 *  upgrade, has `built < ONE` and is skipped. `owned` is canonical ascending, so the first hit is
 *  deterministic. */
export function upgradeCandidate(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  target: BuildingType,
): Entity | null {
  for (const e of owned) {
    const building = world.get(e, Building);
    if (building.built < ONE || world.has(e, UnderConstruction)) continue;
    const type = index.buildings.get(building.buildingType);
    if (type !== undefined && upgradesInto(index, type, target)) return e;
  }
  return null;
}

function collectorCount(entry: Extract<BuildOrderEntry, { kind: 'collector' }>): number {
  return entry.count ?? 1;
}

/**
 * The collector goods the list has reached, in order, each with the most gatherers a reached entry asks
 * for: an entry is reached while every entry before it is satisfied or skipped, a lane running beside the
 * list never holding it. Reached state is re-derived each decision, so a regressing earlier entry drops a
 * later collector and returns its holder to the pool until the list re-reaches the entry.
 */
export function collectorGoodsWanted(
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
): ReadonlyMap<string, number> {
  const wanted = new Map<string, number>();
  for (const [i, entry] of order.entries()) {
    if (isLaneEntry(entry)) continue;
    const status = statuses[i];
    if (entry.kind === 'collector' && status !== 'skip') {
      wanted.set(entry.good, Math.max(wanted.get(entry.good) ?? 0, collectorCount(entry)));
    }
    if (status === 'unmet') break;
  }
  return wanted;
}
