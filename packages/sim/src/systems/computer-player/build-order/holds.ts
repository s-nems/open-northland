import type { BuildingType } from '@open-northland/data';
import {
  aiControlEntity,
  Building,
  playerPlacementTribes,
  StalledPlacements,
  UnderConstruction,
  Upgrading,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import {
  buildingTypeByContentId,
  countedTiers,
  goodTypeByContentId,
  tiersAtOrAbove,
} from '../../ai-shared/content-lookup.js';
import { everyBuildingOf, homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled, goodEnabled } from '../../progression/index.js';
import { technologyReach } from '../technology/reach.js';
import { crewAt, fullCrew, plannedOperators } from '../workforce/staffing-rows.js';
import {
  type BuildOrder,
  type BuildOrderEntry,
  isLaneEntry,
  type LineStatuses,
  type StepHold,
  stepKey,
} from './entries.js';
import { filledTowersWait } from './filled-towers.js';
import { type DecisionMemo, memoNeedsShips } from './memo.js';
import { militaryWaits, seatDefenceFirst } from './seat-order.js';

/** Whether an unmet step still holds its line: a placement of one more workshop while the ones standing
 *  lack crews ({@link copyAwaitsCrews}), or a placement, upgrade, collector or tower ring on its
 *  `holdUntil` ({@link StepHold}) while the seat has no standing building of the id at that tier or above
 *  (no site either for a placed hold, while its defence does not come first), or has
 *  not discovered the good, while it still could and `order` may still raise that building or one making
 *  the good ({@link orderMayRaise}), while no other line's step wants the good ({@link goodWanted}), while
 *  another line's step is ready to place one of the named buildings ({@link placementDue}), while it
 *  counts fewer settlers than the hold names, while its military deadline lies further off than the
 *  lead and its defence does not come first, while any of an `all` hold's parts holds, or while every one
 *  of an `any` hold's parts holds. `owned` is the seat's {@link homeBuildings} list and `statuses` this
 *  decision's `lineStatuses` of `order`. */
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
  return holdOpen(
    world,
    ctx,
    player,
    owned,
    entry.holdUntil,
    memo,
    holdScope(world, ctx, player, owned, order, statuses, entry, memo),
  );
}

function holdScope(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  order: BuildOrder,
  statuses: LineStatuses,
  held: BuildOrderEntry,
  memo: DecisionMemo,
): HoldScope {
  return {
    mayRaise: (typeId) => orderMayRaise(world, ctx, owned, order, statuses, held, typeId),
    wanted: (goodType) => goodWanted(world, ctx, player, order, statuses, held, goodType),
    due: (buildings) => placementDue(world, ctx, player, owned, order, statuses, held, buildings, memo),
  };
}

/**
 * Whether a placement step of `order` other than `held` is ready to place one of `buildings` (at that
 * tier or above) now: the first unmet step of its line, its tier open to the seat, no wait for the crews
 * of its copies, no spot search waiting out a failed try (a well with no room) and no hold of its own
 * still open. Lanes never count: the housing lane stays unmet through every home upgrade and while its
 * gate is shut, so the opening's home placement stands for the homes. A step's own hold never asks this
 * again, so the check goes one step deep.
 */
function placementDue(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  order: BuildOrder,
  statuses: LineStatuses,
  held: BuildOrderEntry,
  buildings: readonly string[],
  memo: DecisionMemo,
): boolean {
  const tribe = playerPlacementTribes(world, player)?.[0];
  if (tribe === undefined) return false;
  const index = contentIndex(ctx.content);
  const families = new Set<number>();
  for (const id of buildings) {
    const type = buildingTypeByContentId(ctx.content, id);
    if (type !== undefined) for (const tier of tiersAtOrAbove(index, type)) families.add(tier);
  }
  const carrier = aiControlEntity(world, player);
  const retryTicks = carrier === null ? undefined : world.tryGet(carrier, StalledPlacements)?.retryTicks;
  for (const line of order.lines) {
    const lineStatus = statuses.get(line.id);
    const at = line.steps.findIndex((entry, step) => !isLaneEntry(entry) && lineStatus?.[step] === 'unmet');
    const entry = line.steps[at];
    if (entry === undefined || entry === held || entry.kind !== 'place') continue;
    const type = buildingTypeByContentId(ctx.content, entry.building);
    if (type === undefined || !families.has(type.typeId)) continue;
    if (!buildingEnabled(world, ctx, player, tribe, type.typeId)) continue;
    if (ctx.tick < (retryTicks?.get(stepKey(line.id, at)) ?? 0)) continue;
    if (copyAwaitsCrews(world, ctx, player, owned, entry)) continue;
    if (entry.holdUntil !== undefined) {
      const own: HoldScope = {
        ...holdScope(world, ctx, player, owned, order, statuses, entry, memo),
        due: () => false,
      };
      if (holdOpen(world, ctx, player, owned, entry.holdUntil, memo, own)) continue;
    }
    return true;
  }
  return false;
}

/** What a hold asks of the order beyond the seat: whether it may yet raise a building of the type
 *  ({@link orderMayRaise}), whether another step wants the good ({@link goodWanted}), and whether another
 *  step is ready to place one of the buildings ({@link placementDue}). */
interface HoldScope {
  readonly mayRaise: (typeId: number) => boolean;
  readonly wanted: (goodType: number) => boolean;
  readonly due: (buildings: readonly string[]) => boolean;
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
      // A workshop handed to the colony serves a hold as well as one at home.
      for (const e of everyBuildingOf(world, player)) {
        if (!counted.has(world.get(e, Building).buildingType)) continue;
        if (!world.has(e, UnderConstruction) || world.has(e, Upgrading)) return false;
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
    case 'noneDue':
      return scope.due(hold.buildings);
    case 'shipPath':
      return !seatDefenceFirst(world, ctx, player) && memoNeedsShips(world, ctx, player, memo);
    case 'settlers':
      return homeSettlers(world, ctx, player).length < hold.count;
    case 'deadline':
      return militaryWaits(world, ctx, player, hold.leadTicks);
    case 'tick':
      return ctx.tick < hold.tick;
    case 'filledGround':
      return filledTowersWait(world, ctx, player, owned);
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
