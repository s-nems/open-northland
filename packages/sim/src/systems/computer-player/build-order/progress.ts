import type { BuildingType } from '@open-northland/data';
import { Building, playerPlacementTribes, UnderConstruction, Upgrading } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import {
  buildingTypeByContentId,
  countedTiers,
  goodTypeByContentId,
} from '../../ai-shared/content-lookup.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedBuildings, ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood } from '../../economy/gather-goods.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { buildingEnabled, goodEnabled } from '../../progression/index.js';
import { seatStockOf } from '../../stores/index.js';
import { seatBaseOf } from '../base.js';
import { seatHerdKept } from '../herd.js';
import { type JoineryRole, joineryRoles } from '../joinery-role.js';
import { anyLiveResource, knownResourceTest } from '../live-resources.js';
import { rivalOverSea } from '../sea-route.js';
import { technologyReach } from '../technology/reach.js';
import { crewAt, fullCrew, plannedOperators } from '../workforce/staffing-rows.js';
import {
  type BuildLineId,
  type BuildOrder,
  type BuildOrderEntry,
  isLaneEntry,
  linesByPriority,
  orderSteps,
  type StepHold,
} from './entries.js';
import { grassScarce } from './grass-reserve.js';
import { housingShort } from './housing.js';
import { unservedAnchor } from './placement.js';
import { militaryWaits, seatDefenceFirst } from './seat-order.js';
import { coverageOf, seatCovered } from './tower-coverage.js';

/** `skip` (not expressible in this content set, nothing left to collect, enough of it stored, or a
 *  discovery the seat can never make) counts as done for sequencing. */
export type EntryStatus = 'skip' | 'satisfied' | 'unmet';

/** Whether `from` sits strictly below `target` on the `upgradeTarget` chain. The visited guard bounds
 *  a malformed cyclic chain. */
export function upgradesInto(index: ContentIndex, from: BuildingType, target: BuildingType): boolean {
  const visited = new Set<number>();
  let step: BuildingType | undefined = from;
  while (step !== undefined && !visited.has(step.typeId)) {
    visited.add(step.typeId);
    if (step.typeId === target.typeId) return step !== from;
    step = step.upgradeTarget === undefined ? undefined : index.buildings.get(step.upgradeTarget);
  }
  return false;
}

/** One decision's answers, so the entries that ask the same question work it out once: whether the map
 *  holds a live resource, per good type, whether a rival lies over the sea, whether the seat is short of
 *  grass, and the top-tier joineries' roles. */
export interface DecisionMemo {
  readonly live: Map<number, boolean>;
  rivalOverSea: boolean | undefined;
  grassScarce: boolean | undefined;
  /** Whether the seat keeps no pair of either livestock species (`../herd.ts`). */
  herdless: boolean | undefined;
  roleOf: ((joinery: Entity) => JoineryRole) | undefined;
  /** The seat's live flags by the one good each holder gathers. */
  flagsByGood: ReadonlyMap<number, number> | undefined;
  /** {@link OwnedTally} per owned-building list the decision asks about. */
  readonly tallies: Map<readonly Entity[], OwnedTally>;
}

/** One owned-building list counted once, so each entry sums its tiers instead of walking the list. */
interface OwnedTally {
  readonly byType: ReadonlyMap<number, number>;
  readonly homes: number;
  /** Each building with an upgrade in flight: its type and the tier it is becoming. */
  readonly upgrading: readonly (readonly [type: number, becoming: number])[];
}

function ownedTally(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  memo: DecisionMemo,
): OwnedTally {
  const known = memo.tallies.get(owned);
  if (known !== undefined) return known;
  const byType = new Map<number, number>();
  let homes = 0;
  const upgrading: (readonly [number, number])[] = [];
  for (const e of owned) {
    const type = world.get(e, Building).buildingType;
    byType.set(type, (byType.get(type) ?? 0) + 1);
    const ownedType = index.buildings.get(type);
    if (ownedType?.kind === 'home') homes++;
    const becoming = world.tryGet(e, Upgrading)?.target;
    if (becoming !== undefined) upgrading.push([type, becoming]);
  }
  const tally = { byType, homes, upgrading };
  memo.tallies.set(owned, tally);
  return tally;
}

function countOfTypes(tally: OwnedTally, types: ReadonlySet<number>): number {
  let count = 0;
  for (const type of types) count += tally.byType.get(type) ?? 0;
  return count;
}

export function decisionMemo(): DecisionMemo {
  return {
    live: new Map(),
    rivalOverSea: undefined,
    grassScarce: undefined,
    herdless: undefined,
    roleOf: undefined,
    flagsByGood: undefined,
    tallies: new Map(),
  };
}

function memoFlagsByGood(
  world: World,
  ctx: SystemContext,
  player: number,
  memo: DecisionMemo,
): ReadonlyMap<number, number> {
  if (memo.flagsByGood === undefined) {
    const flags = new Map<number, number>();
    for (const e of ownedSettlers(world, player)) {
      if (liveWorkFlag(world, e) === undefined) continue;
      const good = heldGatherGood(world, ctx, e);
      if (good !== undefined) flags.set(good, (flags.get(good) ?? 0) + 1);
    }
    memo.flagsByGood = flags;
  }
  return memo.flagsByGood;
}

/** Whether the seat keeps no pair of either livestock species, asked once a decision. */
function memoHerdless(world: World, ctx: SystemContext, player: number, memo: DecisionMemo): boolean {
  memo.herdless ??= seatHerdKept(world, ctx, player) === 'none';
  return memo.herdless;
}

/** {@link grassScarce} around the seat's base; false with no base or terrain. */
function memoGrassScarce(world: World, ctx: SystemContext, player: number, memo: DecisionMemo): boolean {
  if (memo.grassScarce === undefined) {
    const base = seatBaseOf(world, ctx, player);
    const node = base === null ? null : anchorNodeOf(world, base);
    memo.grassScarce = node !== null && ctx.terrain !== undefined && grassScarce(ctx.terrain, node);
  }
  return memo.grassScarce;
}

function memoOverSea(world: World, ctx: SystemContext, player: number, memo: DecisionMemo): boolean {
  memo.rivalOverSea ??= rivalOverSea(world, ctx, player);
  return memo.rivalOverSea;
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

function memoRoles(
  world: World,
  ctx: SystemContext,
  player: number,
  memo: DecisionMemo,
): (joinery: Entity) => JoineryRole {
  memo.roleOf ??= joineryRoles(world, ctx, player, () => memoOverSea(world, ctx, player, memo));
  return memo.roleOf;
}

/** `owned` is the seat's {@link ownedBuildings} list and `memo` this decision's, both passed in so one
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
      } else {
        for (const e of owned) {
          const ownedType = index.buildings.get(world.get(e, Building).buildingType);
          if (ownedType === undefined) continue;
          const matches = type.kind === 'home' ? ownedType.kind === 'home' : counted.has(ownedType.typeId);
          if (matches && roleOf(e) === entry.role) have++;
        }
      }
      // A seat short of grass raises one of each bio-pattern building, the grass holding no more.
      const wanted =
        type.buildOnBioPattern && entry.count > 1 && memoGrassScarce(world, ctx, player, memo)
          ? 1
          : entry.count;
      if (have >= wanted) return 'satisfied';
      if (entry.onlyWhen === 'rivalOverSea' && !memoOverSea(world, ctx, player, memo)) return 'skip';
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
        if (inFlightUpgrades) {
          for (const [type, becoming] of tally.upgrading) if (!done.has(type) && done.has(becoming)) have++;
        }
      } else {
        const roleOf = memoRoles(world, ctx, player, memo);
        for (const e of owned) {
          if (roleOf(e) !== entry.role) continue;
          const becoming = inFlightUpgrades ? world.tryGet(e, Upgrading)?.target : undefined;
          if (done.has(world.get(e, Building).buildingType) || (becoming !== undefined && done.has(becoming)))
            have++;
        }
      }
      if (have >= entry.count) return 'satisfied';
      if (entry.onlyWhen === 'rivalOverSea' && !memoOverSea(world, ctx, player, memo)) return 'skip';
      if (entry.onlyWhen === 'livestock' && memoHerdless(world, ctx, player, memo)) return 'skip';
      return technologyReach(world, ctx, player, memo)?.house(target.typeId) === false ? 'skip' : 'unmet';
    }
    case 'collector': {
      const good = goodTypeByContentId(ctx.content, entry.good);
      if (good?.atomics?.harvest === undefined) return 'skip';
      const holders = memoFlagsByGood(world, ctx, player, memo).get(good.typeId) ?? 0;
      if (collectorStocked(world, player, entry, good.typeId, holders)) return 'skip';
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

/** Whether an unmet step still holds its line: a placement of one more workshop while the ones standing
 *  lack crews ({@link copyAwaitsCrews}), or a placement, upgrade, collector or tower ring on its
 *  `holdUntil` ({@link StepHold}) while the seat has fewer standing buildings of the id at that tier or
 *  above than it names (no site either for a placed hold, while its defence does not come first), or has
 *  not discovered the good, while it still could and `order` may still raise that building or one making
 *  the good ({@link orderMayRaise}), while no other line's step wants the good ({@link goodWanted}), while
 *  it counts fewer settlers than the hold names, while its military deadline lies further off than the
 *  lead and its defence does not come first, while any of an `all` hold's parts holds, or while every one
 *  of an `any` hold's parts holds. `owned` is the seat's {@link ownedBuildings} list and `statuses` this
 *  decision's {@link lineStatuses} of `order`. */
export function stepHeld(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  order: BuildOrder,
  statuses: LineStatuses,
  entry: BuildOrderEntry,
  memo: DecisionMemo,
): boolean {
  if (entry.kind === 'place' && copyAwaitsCrews(world, ctx, player, owned, entry)) return true;
  if (
    (entry.kind !== 'place' &&
      entry.kind !== 'upgrade' &&
      entry.kind !== 'collector' &&
      entry.kind !== 'towerCoverage') ||
    entry.holdUntil === undefined
  )
    return false;
  const scope: HoldScope = {
    mayRaise: (typeId) => orderMayRaise(world, ctx, owned, order, statuses, entry, typeId),
    wanted: (goodType) => goodWanted(world, ctx, player, order, statuses, entry, goodType),
  };
  return holdOpen(world, ctx, player, owned, entry.holdUntil, memo, scope);
}

/** What a hold asks of the order beyond the seat: whether it may yet raise a building of the type
 *  ({@link orderMayRaise}), and whether another step wants the good ({@link goodWanted}). */
interface HoldScope {
  readonly mayRaise: (typeId: number) => boolean;
  readonly wanted: (goodType: number) => boolean;
}

/**
 * Whether a step of `order` other than `held` wants `goodType` now: the first unmet step of its line, no
 * lane, holding on nothing of its own, its tier open to the seat, and the merged bill of that tier taking
 * the good. A step waiting on its own hold or on a discovery wants nothing yet.
 */
function goodWanted(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  statuses: LineStatuses,
  held: BuildOrderEntry,
  goodType: number,
): boolean {
  const tribe = playerPlacementTribes(world, player)?.[0];
  if (tribe === undefined) return false;
  const index = contentIndex(ctx.content);
  for (const line of order.lines) {
    const lineStatus = statuses.get(line.id);
    const step = line.steps.findIndex((entry, at) => !isLaneEntry(entry) && lineStatus?.[at] === 'unmet');
    const entry = line.steps[step];
    if (entry === undefined || entry === held || entry.kind === 'collector') continue;
    if ('holdUntil' in entry && entry.holdUntil !== undefined) continue;
    const type = buildingTypeByContentId(ctx.content, entry.building);
    if (type === undefined || !buildingEnabled(world, ctx, player, tribe, type.typeId)) continue;
    const bill = index.constructionBillByBuilding.get(type.typeId) ?? [];
    if (bill.some((line) => line.goodType === goodType)) return true;
  }
  return false;
}

/**
 * Whether a placement of one more workshop employing craftsmen waits for those of its chain the seat has
 * (owner ruling: upgrades and full crews come before copies, so no third bakery while two stand half
 * staffed): one still rises, or stands short of its {@link fullCrew}. A joinery placed for a role is
 * counted apart (`../joinery-role.ts`) and never waits, nor does a step placed `aheadOfCrews`.
 */
function copyAwaitsCrews(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): boolean {
  if (entry.role !== undefined || entry.aheadOfCrews === true) return false;
  const type = buildingTypeByContentId(ctx.content, entry.building);
  if (type === undefined || plannedOperators(ctx, type) === 0) return false;
  const index = contentIndex(ctx.content);
  const counted = countedTiers(ctx.content, type, entry.belowTier);
  for (const e of owned) {
    const copy = index.buildings.get(world.get(e, Building).buildingType);
    if (copy === undefined || !counted.has(copy.typeId)) continue;
    if (world.has(e, UnderConstruction)) return true;
    if (crewAt(world, ctx, e) < fullCrew(world, ctx, player, copy)) return true;
  }
  return false;
}

function holdOpen(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  hold: StepHold,
  memo: DecisionMemo,
  scope: HoldScope,
): boolean {
  const reach = technologyReach(world, ctx, player, memo);
  const { mayRaise } = scope;
  switch (hold.kind) {
    case 'built': {
      const type = buildingTypeByContentId(ctx.content, hold.building);
      if (type === undefined) return false;
      const counted = countedTiers(ctx.content, type, undefined);
      const wanted = hold.count ?? 1;
      let standing = 0;
      for (const e of owned) {
        if (!counted.has(world.get(e, Building).buildingType)) continue;
        if ((!world.has(e, UnderConstruction) || world.has(e, Upgrading)) && ++standing >= wanted)
          return false;
      }
      return reach?.house(type.typeId) !== false && mayRaise(type.typeId);
    }
    case 'placedUnlessDefending': {
      const type = buildingTypeByContentId(ctx.content, hold.building);
      if (type === undefined || seatDefenceFirst(world, ctx, player)) return false;
      const counted = countedTiers(ctx.content, type, undefined);
      if (owned.some((e) => counted.has(world.get(e, Building).buildingType))) return false;
      return reach?.house(type.typeId) !== false && mayRaise(type.typeId);
    }
    case 'good': {
      const good = goodTypeByContentId(ctx.content, hold.good);
      const tribe = playerPlacementTribes(world, player)?.[0];
      if (good === undefined || tribe === undefined) return false;
      if (goodEnabled(world, ctx, player, tribe, good.typeId)) return false;
      if (reach?.target('good', good.typeId) === false) return false;
      for (const maker of contentIndex(ctx.content).buildings.values()) {
        if (makesGood(maker, good.typeId) && mayRaise(maker.typeId)) return true;
      }
      return false;
    }
    case 'wanted': {
      const good = goodTypeByContentId(ctx.content, hold.good);
      return good !== undefined && !scope.wanted(good.typeId);
    }
    case 'settlers':
      return ownedSettlers(world, player).length < hold.count;
    case 'deadline':
      return militaryWaits(world, ctx, player, hold.leadTicks);
    case 'tick':
      return ctx.tick < hold.tick;
    case 'all':
      return hold.holds.some((part) => holdOpen(world, ctx, player, owned, part, memo, scope));
    case 'any':
      return hold.holds.every((part) => holdOpen(world, ctx, player, owned, part, memo, scope));
  }
}

function makesGood(type: BuildingType, goodType: number): boolean {
  return (
    type.produces.includes(goodType) ||
    type.recipes.some((recipe) => recipe.outputs.some((output) => output.goodType === goodType))
  );
}

/**
 * Whether the seat may yet have a building of `typeId`'s tier: it owns one at or below that tier on its
 * chain, or a step of `order` other than `held` that places such a tier is not skipped. A hold on a
 * building only a skipped step would raise, like a druid behind a dry mushroom map, then lets its step act.
 */
function orderMayRaise(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  order: BuildOrder,
  statuses: LineStatuses,
  held: BuildOrderEntry,
  typeId: number,
): boolean {
  const index = contentIndex(ctx.content);
  const reaches = (building: number | undefined): boolean => {
    const type = building === undefined ? undefined : index.buildings.get(building);
    return type !== undefined && countedTiers(ctx.content, type, undefined).has(typeId);
  };
  if (owned.some((e) => reaches(world.get(e, Building).buildingType))) return true;
  for (const line of order.lines) {
    const lineStatus = statuses.get(line.id);
    for (const [step, entry] of line.steps.entries()) {
      if (entry === held || entry.kind === 'upgrade' || entry.kind === 'collector') continue;
      if (lineStatus?.[step] === 'skip') continue;
      if (reaches(buildingTypeByContentId(ctx.content, entry.building)?.typeId)) return true;
    }
  }
  return false;
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

/** Each line's step statuses, in step order, by line id. `heldCollectors` names the unmet collector steps
 *  their `holdUntil` holds this decision, which {@link lineStatuses} works out for the workforce's
 *  {@link collectorGoodsWanted}. */
export interface LineStatuses extends ReadonlyMap<BuildLineId, readonly EntryStatus[]> {
  readonly heldCollectors?: ReadonlySet<BuildOrderEntry>;
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
  const owned = ownedBuildings(world, player);
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
  player: number,
  entry: Extract<BuildOrderEntry, { kind: 'collector' }>,
  goodType: number,
  holders: number,
): boolean {
  if (entry.stockedAt === undefined) return false;
  const line = holders > 0 ? entry.stockedAt : Math.floor(entry.stockedAt / 2);
  return seatStockOf(world, player).units(goodType) >= line;
}

/** Whether `order` names a collector step for `goodId` and every one passes over as stocked
 *  ({@link collectorStocked}), with `holders` gathering the good: then even the good's base post goes. */
export function collectorGoodStocked(
  world: World,
  player: number,
  order: BuildOrder,
  goodId: string,
  goodType: number,
  holders: number,
): boolean {
  let named = false;
  for (const entry of orderSteps(order)) {
    if (entry.kind !== 'collector' || entry.good !== goodId) continue;
    if (!collectorStocked(world, player, entry, goodType, holders)) return false;
    named = true;
  }
  return named;
}

/**
 * The collector goods the lines have reached by `tick`, in line priority order, each with the most
 * gatherers a reached step asks for: a step is reached while every step before it in its line is
 * satisfied or skipped, a lane running beside the lines never holding it, as the executor holds a line on
 * its first unmet step, a locked one included. An unmet collector step whose `fromTick` lies ahead, or
 * whose hold holds it (`heldCollectors`), holds its line unreached. Reached state is re-derived each decision, so a regressing earlier step drops a later
 * collector and returns its holder to the pool until its line re-reaches the step.
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
