import type { BuildingType } from '@open-northland/data';
import { Building, UnderConstruction, Upgrading } from '../../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../../core/content-index.js';
import { ONE } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import {
  buildingTypeByContentId,
  countedTiers,
  goodTypeByContentId,
  upgradesInto,
} from '../../../ai-shared/content-lookup.js';
import { colonyOverflow, homeBuildings } from '../../../ai-shared/home-roster.js';
import type { SystemContext } from '../../../context.js';
import { homeStockOf } from '../../home-stock.js';
import { anyLiveResource, knownResourceTest } from '../../live-resources.js';
import { technologyReach } from '../../technology/reach.js';
import { unservedAnchor } from '../ground/affinity.js';
import { seatHomesCap } from '../ground/plots.js';
import {
  type BuildLineId,
  type BuildOrder,
  type BuildOrderEntry,
  type EntryStatus,
  isLaneEntry,
  type LineStatuses,
  linesByPriority,
  orderSteps,
} from '../order/entries.js';
import { coverageOf, seatCovered } from '../towers/tower-coverage.js';
import { stepHeld } from './holds.js';
import { housingShort } from './housing.js';
import {
  type DecisionMemo,
  decisionMemo,
  memoFlagsByGood,
  memoGrassScarce,
  memoHerdless,
  memoNeedsShips,
  memoRoles,
  type OwnedTally,
  ownedTally,
} from './memo.js';

const NO_BUILDING_TYPE = -1;

/** The buildings of `tiers` the seat's order has handed to its colony: home's step reads them as its own,
 *  so its line moves on. */
function handedOverCount(
  index: ContentIndex,
  world: World,
  player: number,
  tiers: ReadonlySet<number>,
  memo: DecisionMemo,
): number {
  memo.handedOver ??= colonyOverflow(world, player);
  let count = 0;
  for (const { building } of memo.handedOver)
    if (tiers.has(index.buildingTypeBySlug.get(building) ?? NO_BUILDING_TYPE)) count++;
  return count;
}

function countOfTypes(tally: OwnedTally, types: ReadonlySet<number>): number {
  let count = 0;
  for (const type of types) count += tally.byType.get(type) ?? 0;
  return count;
}

/** The upgrades in flight whose building sits below `tiers` and is becoming one of them. */
function becomingCounted(tally: OwnedTally, tiers: ReadonlySet<number>): number {
  let count = 0;
  for (const [type, becoming] of tally.upgrading) if (!tiers.has(type) && tiers.has(becoming)) count++;
  return count;
}

/** The owned buildings an upgrade `entry` may lift: every one, or with a `role` only the joineries holding
 *  it this decision. */
export function upgradeFilter(
  world: World,
  ctx: SystemContext,
  player: number,
  entry: Extract<BuildOrderEntry, { kind: 'upgrade' }>,
  memo: DecisionMemo,
): ((e: Entity) => boolean) | undefined {
  if (entry.role === undefined) return undefined;
  const roleOf = memoRoles(world, ctx, player, memo);
  return (e) => roleOf(e) === entry.role;
}

/** `owned` is the seat's {@link homeBuildings} list and `memo` this decision's, both passed in so one
 *  decision computes them once. An upgrade in flight counts toward the tier it is becoming, as a placed
 *  site counts toward its entry, unless `inFlightUpgrades` is false. */
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
      const counted = countedTiers(ctx.content, type, entry.belowTier);
      const roleOf = entry.role === undefined ? undefined : memoRoles(world, ctx, player, memo);
      let have = 0;
      if (roleOf === undefined) {
        const tally = ownedTally(world, index, owned, memo);
        have = type.kind === 'home' ? tally.homes : countOfTypes(tally, counted);
        if (inFlightUpgrades && type.kind !== 'home') have += becomingCounted(tally, counted);
      } else {
        for (const e of owned) {
          const ownedType = index.buildings.get(world.get(e, Building).buildingType);
          if (ownedType === undefined) continue;
          const becoming = inFlightUpgrades ? world.tryGet(e, Upgrading)?.target : undefined;
          const matches =
            type.kind === 'home'
              ? ownedType.kind === 'home'
              : counted.has(ownedType.typeId) || (becoming !== undefined && counted.has(becoming));
          if (matches && roleOf(e) === entry.role) have++;
        }
      }
      have += handedOverCount(index, world, player, counted, memo);
      // A seat short of grass raises one of each bio-pattern building, the grass holding no more.
      const wanted =
        type.buildOnBioPattern && entry.count > 1 && memoGrassScarce(world, ctx, player, memo)
          ? 1
          : type.kind === 'home'
            ? seatHomesCap(world, player, entry.count)
            : entry.count;
      if (have >= wanted) return 'satisfied';
      if (entry.onlyWhen === 'needsShips' && !memoNeedsShips(world, ctx, player, memo)) return 'skip';
      if (entry.onlyWhen === 'grassScarce' && !memoGrassScarce(world, ctx, player, memo)) return 'skip';
      if (entry.onlyWhen === 'livestock' && memoHerdless(world, ctx, player, memo)) return 'skip';
      if (
        entry.unlessWithin !== undefined &&
        unservedAnchor(world, index, owned, counted, entry.unlessWithin) === null
      )
        return 'skip';
      for (const goodId of entry.needsResources ?? []) {
        const needed = goodTypeByContentId(ctx.content, goodId);
        if (needed === undefined || !liveResourceOnMap(world, ctx, player, needed.typeId, memo.live))
          return 'skip';
      }
      return technologyReach(world, ctx, player, memo)?.house(type.typeId) === false ? 'skip' : 'unmet';
    }
    case 'upgrade': {
      const target = buildingTypeByContentId(ctx.content, entry.building);
      if (target === undefined) return 'skip';
      const done = countedTiers(ctx.content, target, entry.belowTier);
      // `upgradeBuilding` keeps the lower type until the site finishes, so a site counts by the tier it is
      // becoming, which may skip tiers and so meet several entries at once.
      let have = 0;
      if (entry.role === undefined) {
        const tally = ownedTally(world, index, owned, memo);
        have = countOfTypes(tally, done);
        if (inFlightUpgrades) have += becomingCounted(tally, done);
      } else {
        const roleOf = memoRoles(world, ctx, player, memo);
        for (const e of owned) {
          if (roleOf(e) !== entry.role) continue;
          const becoming = inFlightUpgrades ? world.tryGet(e, Upgrading)?.target : undefined;
          if (done.has(world.get(e, Building).buildingType) || (becoming !== undefined && done.has(becoming)))
            have++;
        }
      }
      have += handedOverCount(index, world, player, done, memo);
      if (have >= entry.count) return 'satisfied';
      if (entry.onlyWhen === 'needsShips' && !memoNeedsShips(world, ctx, player, memo)) return 'skip';
      if (entry.onlyWhen === 'livestock' && memoHerdless(world, ctx, player, memo)) return 'skip';
      return technologyReach(world, ctx, player, memo)?.house(target.typeId) === false ? 'skip' : 'unmet';
    }
    case 'collector': {
      const good = goodTypeByContentId(ctx.content, entry.good);
      if (good?.atomics?.harvest === undefined) return 'skip';
      const holders = memoFlagsByGood(world, ctx, player, memo).get(good.typeId) ?? 0;
      if (collectorStocked(world, ctx, player, entry, good.typeId, holders)) return 'skip';
      if (holders >= collectorCount(entry)) return 'satisfied';
      // Nothing left to collect anywhere counts as done, so the list never stalls on a dry map.
      if (!liveResourceOnMap(world, ctx, player, good.typeId, memo.live)) return 'skip';
      return technologyReach(world, ctx, player, memo)?.target('good', good.typeId) === false
        ? 'skip'
        : 'unmet';
    }
    case 'towerCoverage':
    case 'storeCoverage': {
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) return 'skip';
      return seatCovered(world, ctx, player, owned, coverageOf(world, ctx, player, entry))
        ? 'satisfied'
        : 'unmet';
    }
    case 'housing': {
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) return 'skip';
      return housingShort(world, ctx, player, owned, entry) ? 'unmet' : 'satisfied';
    }
  }
}

/** Whether the map still holds a live resource of `goodType` the seat knows of, once per good per
 *  decision. */
function liveResourceOnMap(
  world: World,
  ctx: SystemContext,
  player: number,
  goodType: number,
  live: Map<number, boolean>,
): boolean {
  const held = live.get(goodType);
  if (held !== undefined) return held;
  const found = anyLiveResource(world, goodType, knownResourceTest(world, ctx, player));
  live.set(goodType, found);
  return found;
}

/**
 * The statuses of `entries` in order. Statuses are recomputed each decision and can regress (a razed
 * home, a fringe building re-arming `towerCoverage`), so consumers must tolerate a temporary drop.
 */
export function entryStatuses(
  world: World,
  ctx: SystemContext,
  player: number,
  entries: readonly BuildOrderEntry[],
): EntryStatus[] {
  const owned = homeBuildings(world, ctx, player);
  const memo = decisionMemo();
  return entries.map((entry) => entryStatus(world, ctx, player, owned, entry, memo));
}

/** Every step's status of every line of `order`, one decision's {@link entryStatus} answers. */
export function lineStatuses(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  order: BuildOrder,
  memo: DecisionMemo = decisionMemo(),
): LineStatuses {
  const statuses = new Map<BuildLineId, readonly EntryStatus[]>();
  for (const line of order.lines) {
    statuses.set(
      line.id,
      line.steps.map((entry) => entryStatus(world, ctx, player, owned, entry, memo)),
    );
  }
  const heldCollectors = new Set<BuildOrderEntry>();
  for (const line of order.lines) {
    for (const [step, entry] of line.steps.entries()) {
      if (entry.kind !== 'collector' || entry.holdUntil === undefined) continue;
      if (statuses.get(line.id)?.[step] !== 'unmet') continue;
      if (stepHeld(world, ctx, player, owned, order, statuses, entry, memo)) heldCollectors.add(entry);
    }
  }
  return heldCollectors.size === 0 ? statuses : Object.assign(statuses, { heldCollectors });
}

/** Whether the seat owns no building `accept` takes, built or a site, below `target` on its chain: an
 *  upgrade step asking for more of the tier than the seat has buildings of the chain has nothing left to
 *  lift. */
export function nothingToUpgrade(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  target: BuildingType,
  accept?: (e: Entity) => boolean,
): boolean {
  for (const e of owned) {
    if (accept !== undefined && !accept(e)) continue;
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type !== undefined && upgradesInto(index, type, target)) return false;
  }
  return true;
}

/** The lowest-id built building `accept` takes that the seat can upgrade toward `target`; a site,
 *  including an in-flight upgrade, has `built < ONE` and is skipped. `owned` is canonical ascending, so the
 *  first hit is deterministic. */
export function upgradeCandidate(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  target: BuildingType,
  accept?: (e: Entity) => boolean,
): Entity | null {
  for (const e of owned) {
    if (accept !== undefined && !accept(e)) continue;
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

/** Whether the seat stores the collector entry's `stockedAt` units of its good, or, with nobody gathering
 *  it, still half of them, so a released post is not hired back at the next unit drawn. */
function collectorStocked(
  world: World,
  ctx: SystemContext,
  player: number,
  entry: Extract<BuildOrderEntry, { kind: 'collector' }>,
  goodType: number,
  holders: number,
): boolean {
  if (entry.stockedAt === undefined) return false;
  const line = holders > 0 ? entry.stockedAt : Math.floor(entry.stockedAt / 2);
  return homeStockOf(world, ctx, player).units(goodType) >= line;
}

/** Whether `order` names a collector step for `goodId` and every one passes over as stocked
 *  ({@link collectorStocked}), with `holders` gathering the good: then even the good's base post goes. */
export function collectorGoodStocked(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  goodId: string,
  goodType: number,
  holders: number,
): boolean {
  let named = false;
  for (const entry of orderSteps(order)) {
    if (entry.kind !== 'collector' || entry.good !== goodId) continue;
    if (!collectorStocked(world, ctx, player, entry, goodType, holders)) return false;
    named = true;
  }
  return named;
}

/**
 * The collector goods the lines have reached by `tick`, in line priority order, each with the most
 * gatherers a reached step asks for: a step is reached while every step before it in its line is
 * satisfied or skipped, a lane running beside the lines never holding it, as the executor holds a line on
 * its first unmet step, a locked one included. An unmet collector step whose `fromTick` lies ahead, or
 * whose hold holds it (`heldCollectors`), holds its line unreached. Reached state is re-derived each
 * decision, so a regressing earlier step drops a later collector and returns its holder to the pool until its
 * line re-reaches the step.
 */
export function collectorGoodsWanted(
  order: BuildOrder,
  statuses: LineStatuses,
  tick: number,
): ReadonlyMap<string, number> {
  const wanted = new Map<string, number>();
  for (const line of linesByPriority(order)) {
    const lineStatus = statuses.get(line.id) ?? [];
    for (const [i, entry] of line.steps.entries()) {
      if (isLaneEntry(entry)) continue;
      const status = lineStatus[i];
      if (entry.kind === 'collector' && status !== 'skip') {
        if (status === 'unmet' && (tick < (entry.fromTick ?? 0) || statuses.heldCollectors?.has(entry)))
          break;
        wanted.set(entry.good, Math.max(wanted.get(entry.good) ?? 0, collectorCount(entry)));
      }
      if (status === 'unmet') break;
    }
  }
  return wanted;
}
